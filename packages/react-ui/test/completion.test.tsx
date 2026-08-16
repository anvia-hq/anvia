import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Completion, CompletionProvider } from "../src";
import { createCompletionController } from "./helpers";

afterEach(() => {
  cleanup();
});

describe("Completion primitives", () => {
  it("submits completion input and renders completion output", () => {
    const submit = vi.fn(async () => {});

    function Harness() {
      const [input, setInput] = useState("");
      return (
        <CompletionProvider
          controller={createCompletionController({
            completion: "Current answer",
            submit,
            input,
            setInput,
          })}
        >
          <Completion.Root>
            <Completion.Output />
            <Completion.Form aria-label="Completion form">
              <Completion.Input />
              <Completion.Submit />
            </Completion.Form>
          </Completion.Root>
        </CompletionProvider>
      );
    }

    render(<Harness />);

    expect(screen.getByText("Current answer")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "finish this" } });
    fireEvent.submit(screen.getByLabelText("Completion form"));

    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("respects prevented submit and supports stop", () => {
    const submit = vi.fn(async () => {});
    const stop = vi.fn();

    function Harness() {
      const [input, setInput] = useState("ready");
      return (
        <CompletionProvider
          controller={createCompletionController({
            submit,
            input,
            setInput,
            status: "ready",
            stop,
          })}
        >
          <Completion.Form
            aria-label="Completion form"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <Completion.Input />
            <Completion.Submit />
          </Completion.Form>
        </CompletionProvider>
      );
    }

    const { rerender } = render(<Harness />);

    fireEvent.submit(screen.getByLabelText("Completion form"));

    expect(submit).not.toHaveBeenCalled();

    rerender(
      <CompletionProvider
        controller={createCompletionController({
          input: "ready",
          setInput: vi.fn(),
          status: "streaming",
          stop,
        })}
      >
        <Completion.Form>
          <Completion.Stop />
        </Completion.Form>
      </CompletionProvider>,
    );

    fireEvent.click(screen.getByText("Stop"));

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("submits completion input from Enter and ignores modified Enter", () => {
    const submit = vi.fn(async () => {});

    function Harness() {
      const [input, setInput] = useState("");
      return (
        <CompletionProvider
          controller={createCompletionController({
            submit,
            input,
            setInput,
          })}
        >
          <Completion.Form>
            <Completion.Input />
          </Completion.Form>
        </CompletionProvider>
      );
    }

    render(<Harness />);

    const input = screen.getByLabelText("Prompt");
    fireEvent.change(input, { target: { value: "finish" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(submit).toHaveBeenCalledTimes(1);
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Completion, CompletionProvider } from "../src";
import { createCompletionController } from "./helpers";

describe("Completion primitives", () => {
  it("submits completion input and renders completion output", () => {
    const complete = vi.fn(async () => {});

    function Harness() {
      const [input, setInput] = useState("");
      return (
        <CompletionProvider
          controller={createCompletionController({
            completion: "Current answer",
            complete,
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

    expect(complete).toHaveBeenCalledTimes(1);
  });
});

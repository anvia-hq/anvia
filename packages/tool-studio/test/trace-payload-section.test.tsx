// @vitest-environment happy-dom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { TracePayloadSection } from "../src/ui/app/modules/tracing/trace-payload-section";
import { analyzeTracePayload } from "../src/ui/app/modules/tracing/trace-payload";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("trace payload information structure", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  it("extracts provider and Anvia tool calls without losing additional fields", () => {
    const provider = analyzeTracePayload(
      {
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ function: { name: "lookup_order", arguments: '{"orderId":"A-1"}' } }],
            },
          },
        ],
        usage: { total_tokens: 42 },
      },
      "output",
    );
    expect(provider.messages[0]?.toolCalls[0]).toMatchObject({
      name: "lookup_order",
      value: { orderId: "A-1" },
    });
    expect(provider.additional).toEqual({ usage: { total_tokens: 42 } });

    const anvias = analyzeTracePayload(
      {
        choice: [
          { type: "text", text: "I will look that up." },
          { type: "tool-call", toolName: "lookup_order", input: { orderId: "A-1" } },
        ],
        messageId: "msg_1",
      },
      "output",
    );
    expect(anvias.messages.map((message) => message.content)).toContain("I will look that up.");
    expect(anvias.messages.flatMap((message) => message.toolCalls)[0]).toMatchObject({
      name: "lookup_order",
      value: { orderId: "A-1" },
    });
    expect(anvias.additional).toEqual({ messageId: "msg_1" });

    const mixedNaming = analyzeTracePayload(
      {
        role: "assistant",
        tool_calls: [{ function: { name: "snake_case", arguments: "{}" } }],
        toolCalls: [{ name: "camelCase", input: {} }],
      },
      "output",
    );
    const toolKeys = mixedNaming.messages[0]?.toolCalls.map((tool) => tool.key) ?? [];
    expect(new Set(toolKeys).size).toBe(toolKeys.length);
  });

  it("offers readable, structured, and raw views per payload field", () => {
    ({ container, root } = mount(
      <TracePayloadSection
        field="output"
        title="Output"
        value={{
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{ function: { name: "lookup_order", arguments: '{"id":1}' } }],
              },
            },
          ],
          usage: { total_tokens: 42 },
        }}
      />,
    ));

    expect(button("Response").getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("Tool call");
    expect(container.textContent).toContain("lookup_order");
    expect(container.textContent).toContain("Additional fields");

    act(() => button("Structure").click());
    expect(button("Structure").getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("choices");

    act(() => button("Raw").click());
    expect(button("Raw").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('button[aria-label="Copy Output JSON"]')).not.toBeNull();
    expect(container.textContent).toContain('"total_tokens"');
  });

  it("keeps the selected view independent for each field", () => {
    ({ container, root } = mount(
      <>
        <TracePayloadSection
          field="input"
          title="Input"
          value={{ messages: [{ role: "user", content: "Hello" }] }}
        />
        <TracePayloadSection
          field="output"
          title="Output"
          value={{ choices: [{ message: { role: "assistant", content: "Hi" } }] }}
        />
      </>,
    ));
    const input = container.querySelector<HTMLElement>('[aria-label="Input payload"]');
    const output = container.querySelector<HTMLElement>('[aria-label="Output payload"]');
    const inputMessages = input?.querySelector<HTMLButtonElement>("button[aria-pressed='true']");
    const outputRaw = [...(output?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.textContent === "Raw",
    );

    expect(inputMessages?.textContent).toBe("Messages");
    act(() => outputRaw?.click());
    expect(input?.querySelector("button[aria-pressed='true']")?.textContent).toBe("Messages");
    expect(output?.querySelector("button[aria-pressed='true']")?.textContent).toBe("Raw");
  });

  it("uses a searchable table and JSON views for metadata", () => {
    ({ container, root } = mount(
      <TracePayloadSection
        field="metadata"
        title="Metadata"
        value={{ trace: { id: "trace_1" }, sampled: true }}
      />,
    ));

    const summary = container.querySelector("summary");
    expect(summary?.textContent).toContain("2 fields");
    act(() => summary?.click());
    expect(button("Table").getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("trace.id");

    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search metadata"]');
    act(() => {
      if (search !== null) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          search,
          "sampled",
        );
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect(container.textContent).toContain("sampled");
    expect(container.textContent).not.toContain("trace.id");

    act(() => button("JSON").click());
    expect(container.querySelector('button[aria-label="Copy Metadata JSON"]')).not.toBeNull();
  });

  it("reports zero fields for empty metadata", () => {
    ({ container, root } = mount(
      <TracePayloadSection field="metadata" title="Metadata" value={undefined} />,
    ));

    expect(container.querySelector("summary")?.textContent).toContain("0 fields");
    expect(container.textContent).toContain("No data captured");
  });

  function button(name: string): HTMLButtonElement {
    const match = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === name,
    );
    if (match === undefined) throw new Error(`${name} button not found`);
    return match;
  }
});

function mount(element: ReactNode): {
  container: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
} {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return { container, root };
}

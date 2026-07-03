import { useChat } from "@anvia/react";
import { ChatProvider, Composer, HumanInput, Message, Thread } from "@anvia/react-ui";
import "@anvia/react-ui/styles.css";
import type { MessageToolPart } from "@anvia/react-ui";
import { ArrowDown, ArrowUp, Copy, Plus, RotateCcw, Square } from "lucide-react";

const suggestions = [
  "Where is order A-100?",
  "Summarize order A-100 for support",
  "What should support do next?",
];

export function App() {
  const chat = useChat({
    endpoint: "/api/chat",
    format: "jsonl",
  });
  const hasMessages = chat.messages.length > 0;

  return (
    <main className="app-shell" aria-label="Fullstack agent chat">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            A
          </div>
          <span>Fullstack Agent</span>
        </div>
        <button className="icon-button" type="button" onClick={() => chat.reset()}>
          <Plus size={18} aria-hidden="true" />
          <span className="sr-only">New chat</span>
        </button>
      </header>

      <ChatProvider controller={chat}>
        <section className={hasMessages ? "chat-surface" : "chat-surface is-empty"}>
          <Thread.Root className="thread">
            <Thread.Viewport className="thread-viewport">
              <Thread.Empty className="empty-state">
                <div className="welcome">
                  <h1>What can I help with?</h1>
                  <div className="suggestions">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        className="suggestion"
                        type="button"
                        onClick={() => {
                          void chat.sendMessage(suggestion);
                        }}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              </Thread.Empty>
              <Thread.Messages>
                <Message.Root className="message">
                  <Message.Content className="message-content">
                    <Message.Parts>
                      {(part) =>
                        part.type === "tool" ? (
                          <Message.Part>
                            <Message.Tool className="tool-card" renderWhen="always">
                              {(tool) => <ToolCard tool={tool} />}
                            </Message.Tool>
                          </Message.Part>
                        ) : (
                          <Message.Part />
                        )
                      }
                    </Message.Parts>
                  </Message.Content>
                  <Message.Actions className="message-actions">
                    <Message.Copy className="message-action">
                      <Copy size={15} aria-hidden="true" />
                      <span className="sr-only">Copy</span>
                    </Message.Copy>
                    <Message.Regenerate className="message-action">
                      <RotateCcw size={15} aria-hidden="true" />
                      <span className="sr-only">Regenerate</span>
                    </Message.Regenerate>
                  </Message.Actions>
                </Message.Root>
              </Thread.Messages>
              <Thread.ScrollToBottom className="scroll-button">
                <ArrowDown size={16} aria-hidden="true" />
                <span className="sr-only">Scroll to latest message</span>
              </Thread.ScrollToBottom>
            </Thread.Viewport>

            <HumanInput.Approvals />
            <HumanInput.Questions />

            <Composer.Root className="composer">
              <Composer.Input placeholder="Message Fullstack Agent" rows={1} />
              <Composer.Stop className="icon-button composer-control">
                <Square size={14} fill="currentColor" aria-hidden="true" />
                <span className="sr-only">Stop</span>
              </Composer.Stop>
              <Composer.Submit className="icon-button send-button">
                <ArrowUp size={18} aria-hidden="true" />
                <span className="sr-only">Send</span>
              </Composer.Submit>
            </Composer.Root>
          </Thread.Root>
        </section>
      </ChatProvider>
    </main>
  );
}

function ToolCard({ tool }: { tool: MessageToolPart }) {
  return (
    <>
      <div className="tool-card-header">
        <span data-anvia-tool-name="">{tool.toolName}</span>
        <span className="tool-card-state">{toolStateLabel(tool.state)}</span>
      </div>
      <div className="tool-card-body">
        {tool.input !== undefined ? (
          <section className="tool-card-section">
            <div className="tool-card-label">Input</div>
            <pre data-anvia-tool-input="">{formatValue(tool.input)}</pre>
          </section>
        ) : null}
        {tool.output !== undefined ? (
          <section className="tool-card-section">
            <div className="tool-card-label">Result</div>
            <pre data-anvia-tool-output="">{formatValue(tool.output)}</pre>
          </section>
        ) : null}
        {tool.error !== undefined ? (
          <div data-anvia-tool-error="" role="alert">
            {tool.error.message}
          </div>
        ) : null}
      </div>
    </>
  );
}

function toolStateLabel(state: MessageToolPart["state"]): string {
  if (state === "output-available") {
    return "Done";
  }
  if (state === "error") {
    return "Error";
  }
  return "Running";
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

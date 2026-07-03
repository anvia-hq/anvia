import { useChat } from "@anvia/react";
import { Attachment, ChatProvider, Composer, HumanInput, Message, Thread } from "@anvia/react-ui";
import "@anvia/react-ui/styles.css";
import { ArrowDown, ArrowUp, Copy, Paperclip, Plus, RotateCcw, Square, X } from "lucide-react";

const suggestions = [
  "Where is order A-100?",
  "Summarize order A-100 for support",
  "What should support do next?",
];

export function App() {
  const chat = useChat({
    endpoint: "/api/chat",
    format: "jsonl",
    suggestions: suggestions.map((prompt) => ({ id: prompt, prompt })),
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
                  <Thread.Suggestions className="suggestions">
                    {(suggestion) => (
                      <Thread.Suggestion
                        key={suggestion.id}
                        className="suggestion"
                        suggestion={suggestion}
                      />
                    )}
                  </Thread.Suggestions>
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
                              <ToolCard />
                            </Message.Tool>
                          </Message.Part>
                        ) : part.type === "text" ? (
                          <Message.Part>
                            <Message.Markdown />
                          </Message.Part>
                        ) : part.type === "attachment" ? (
                          <Message.Part>
                            <Message.Attachment className="message-attachment" />
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

            <HumanInput.Panel />

            <Composer.Root className="composer">
              <Composer.AttachmentDropzone className="composer-dropzone">
                <Composer.Attachments>
                  {(attachment) => (
                    <Attachment.Root className="composer-attachment">
                      <Attachment.Preview />
                      <Attachment.Name />
                      <Attachment.Remove className="attachment-remove">
                        <X size={14} aria-hidden="true" />
                        <span className="sr-only">Remove {attachment.name ?? "attachment"}</span>
                      </Attachment.Remove>
                    </Attachment.Root>
                  )}
                </Composer.Attachments>
                <Composer.AddAttachment
                  accept="image/*,.pdf"
                  className="icon-button composer-control"
                  multiple
                >
                  <Paperclip size={16} aria-hidden="true" />
                  <span className="sr-only">Attach image or PDF</span>
                </Composer.AddAttachment>
                <Composer.Input placeholder="Message Fullstack Agent" rows={1} />
                <Composer.Stop className="icon-button composer-control">
                  <Square size={14} fill="currentColor" aria-hidden="true" />
                  <span className="sr-only">Stop</span>
                </Composer.Stop>
                <Composer.Submit className="icon-button send-button">
                  <ArrowUp size={18} aria-hidden="true" />
                  <span className="sr-only">Send</span>
                </Composer.Submit>
              </Composer.AttachmentDropzone>
            </Composer.Root>
          </Thread.Root>
        </section>
      </ChatProvider>
    </main>
  );
}

function ToolCard() {
  return (
    <>
      <div className="tool-card-header">
        <Message.ToolName />
        <Message.ToolStatus className="tool-card-state" />
      </div>
      <div className="tool-card-body">
        <section className="tool-card-section">
          <div className="tool-card-label">Input</div>
          <Message.ToolInput />
        </section>
        <section className="tool-card-section">
          <div className="tool-card-label">Result</div>
          <Message.ToolOutput />
        </section>
        <Message.ToolError />
      </div>
    </>
  );
}

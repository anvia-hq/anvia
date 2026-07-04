import { type UseChatStatus, useChat } from "@anvia/react";
import { ChatProvider, Composer, Message, Thread } from "@anvia/react-ui";
import { ArrowDown, ArrowUp, Copy, Plus, RotateCcw, Square } from "lucide-react";

const promptExamples = [
  "Where is order A-100?",
  "Draft a short support update for order A-100.",
  "What should support do next for Delta Kit Labs?",
];

const iconButtonClassName =
  "inline-grid h-9 w-9 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-default disabled:opacity-[0.35]";

export function App() {
  const chat = useChat({
    endpoint: "/api/completion",
    format: "jsonl",
    suggestions: promptExamples.map((prompt) => ({ id: prompt, prompt })),
  });

  return (
    <main
      aria-label="Fullstack completion chat"
      className="grid min-h-screen grid-rows-[3.5rem_minmax(0,1fr)] bg-[#f7f8f7] font-sans text-neutral-900"
    >
      <header className="flex items-center justify-between border-[#e4e7e4] border-b bg-white px-[18px] max-sm:px-3">
        <div className="inline-flex items-center gap-2.5 font-semibold text-[0.95rem] text-[#303030]">
          <div
            aria-hidden="true"
            className="grid h-7 w-7 place-items-center rounded-lg bg-neutral-900 text-[0.78rem] text-white"
          >
            A
          </div>
          <span>Fullstack Completion</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={[
              "rounded-full border px-2 py-1 font-bold text-[0.74rem] leading-none",
              chat.status === "streaming"
                ? "border-[#cfe0d8] bg-[#eef7f3] text-[#2f6f5f]"
                : chat.status === "error"
                  ? "border-[#f0cbc8] bg-[#fff3f2] text-[#9a322b]"
                  : "border-[#e2e5e2] text-[#5b625d]",
            ].join(" ")}
          >
            {statusLabel(chat.status)}
          </span>
          <button className={iconButtonClassName} onClick={() => chat.reset()} type="button">
            <Plus aria-hidden="true" size={18} />
            <span className="sr-only">New chat</span>
          </button>
        </div>
      </header>

      <ChatProvider controller={chat}>
        <section className="min-h-0">
          <Thread.Root className="grid h-[calc(100vh_-_3.5rem)] min-h-0 grid-rows-[minmax(0,1fr)_auto]">
            <Thread.Viewport className="min-h-0 overflow-auto px-4 py-6 max-sm:px-2.5 max-sm:py-4">
              <div className="mx-auto grid w-full max-w-[820px] gap-5">
                <Thread.Empty className="grid min-h-[calc(100vh_-_12rem)] place-items-center">
                  <div className="grid w-full justify-items-center gap-7">
                    <h1 className="m-0 text-center font-semibold text-4xl text-neutral-800 leading-tight tracking-normal max-sm:text-[2rem]">
                      What should support write?
                    </h1>
                    <Thread.Suggestions className="flex flex-wrap justify-center gap-2.5">
                      {(suggestion) => (
                        <Thread.Suggestion
                          className="min-h-10 cursor-pointer rounded-full border border-[#e2e5e2] bg-white px-3.5 text-[#454945] transition-colors hover:border-[#cfd6d0] hover:bg-[#f7faf8] hover:text-neutral-900 disabled:cursor-default disabled:opacity-[0.45]"
                          suggestion={suggestion}
                        />
                      )}
                    </Thread.Suggestions>
                  </div>
                </Thread.Empty>

                <Thread.Messages className="grid gap-4">
                  {(message) => (
                    <Message.Root
                      className={[
                        "group grid max-w-full gap-1.5",
                        message.role === "user" ? "justify-items-end" : "justify-items-start",
                      ].join(" ")}
                    >
                      <Message.Content
                        className={[
                          "min-w-0 max-w-full",
                          message.role === "user"
                            ? "max-w-[min(620px,88%)] rounded-[20px] bg-neutral-100 px-4 py-2.5 text-neutral-900 max-sm:max-w-[94%]"
                            : "w-full py-1 text-neutral-900",
                        ].join(" ")}
                      >
                        <Message.Parts className="grid gap-2">
                          {(part) => (
                            <Message.Part
                              className={[
                                "min-w-0",
                                part.type === "error"
                                  ? "rounded-lg border border-[#f0cbc8] bg-[#fff3f2] px-3 py-2.5 text-[#9a322b]"
                                  : "",
                              ].join(" ")}
                            >
                              {part.type === "text" ? (
                                <Message.Markdown className="max-w-none text-[0.96rem] leading-7 [&_a]:font-medium [&_a]:text-[#2f6f5f] [&_code]:rounded [&_code]:bg-neutral-100 [&_code]:px-1 [&_code]:py-0.5 [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:mb-3 [&_p:last-child]:mb-0 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-neutral-100 [&_pre]:p-3 [&_ul]:ml-5 [&_ul]:list-disc" />
                              ) : part.type === "reasoning" ? (
                                <Message.Reasoning className="rounded-lg border border-[#e6e9e6] bg-[#fbfcfb] px-3 py-2 text-[#5b625d] text-sm [&_pre]:whitespace-pre-wrap [&_summary]:cursor-pointer [&_summary]:font-medium" />
                              ) : (
                                <Message.Part />
                              )}
                            </Message.Part>
                          )}
                        </Message.Parts>
                      </Message.Content>

                      {message.role === "assistant" ? (
                        <Message.Actions className="flex min-h-8 gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          <Message.Copy className="inline-grid h-8 w-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:hidden">
                            <Copy aria-hidden="true" size={15} />
                            <span className="sr-only">Copy</span>
                          </Message.Copy>
                          <Message.Regenerate className="inline-grid h-8 w-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:hidden">
                            <RotateCcw aria-hidden="true" size={15} />
                            <span className="sr-only">Regenerate</span>
                          </Message.Regenerate>
                        </Message.Actions>
                      ) : null}
                    </Message.Root>
                  )}
                </Thread.Messages>

                <Thread.Error className="rounded-lg border border-[#f0cbc8] bg-[#fff3f2] px-3 py-2.5 text-[#9a322b]" />
              </div>

              <Thread.ScrollToBottom className="fixed right-6 bottom-24 inline-grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-[#e0e0e0] bg-white text-[#4b4b4b] shadow-[0_8px_24px_rgb(0_0_0_/_10%)] disabled:hidden">
                <ArrowDown aria-hidden="true" size={16} />
                <span className="sr-only">Scroll to latest message</span>
              </Thread.ScrollToBottom>
            </Thread.Viewport>

            <Composer.Root className="mx-auto mb-[18px] w-[min(760px,calc(100vw_-_32px))] rounded-[26px] border border-[#d9d9d9] bg-white p-2.5 shadow-[0_10px_30px_rgb(0_0_0_/_8%)] max-sm:w-[calc(100vw_-_20px)]">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                <Composer.Input
                  className="min-h-10 w-full min-w-0 resize-none border-0 bg-transparent px-2.5 py-[9px] text-neutral-900 leading-[1.4] outline-none placeholder:text-[#8a8a8a] disabled:cursor-not-allowed disabled:opacity-50"
                  maxRows={6}
                  placeholder="Message Fullstack Completion"
                  rows={1}
                />
                {chat.status === "streaming" ? (
                  <Composer.Stop className={iconButtonClassName}>
                    <Square aria-hidden="true" fill="currentColor" size={14} />
                    <span className="sr-only">Stop</span>
                  </Composer.Stop>
                ) : (
                  <Composer.Submit className="inline-grid h-9 w-9 cursor-pointer place-items-center rounded-full border-0 bg-neutral-900 text-white transition-colors hover:bg-neutral-700 disabled:cursor-default disabled:opacity-[0.35]">
                    <ArrowUp aria-hidden="true" size={18} />
                    <span className="sr-only">Send</span>
                  </Composer.Submit>
                )}
              </div>
            </Composer.Root>
          </Thread.Root>
        </section>
      </ChatProvider>
    </main>
  );
}

function statusLabel(status: UseChatStatus): string {
  if (status === "streaming") {
    return "Streaming";
  }
  if (status === "error") {
    return "Error";
  }
  return "Ready";
}

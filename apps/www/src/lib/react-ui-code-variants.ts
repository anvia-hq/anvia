interface CodeVariant {
  label: string;
  language: string;
  code: string;
}

export const threadVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { Thread } from "@anvia/react-ui";

export function ThreadArea() {
  return (
    <Thread.Root className="chat">
      <Thread.Viewport className="chat-scroll" autoScroll>
        <Thread.Empty className="empty-state">Ask your first question.</Thread.Empty>
        <Thread.Suggestions className="suggestions" />
        <Thread.Messages className="messages" />
        <Thread.Error className="thread-error" />
        <Thread.ViewportFooter>
          <Thread.ScrollToBottom className="scroll-button">Latest</Thread.ScrollToBottom>
        </Thread.ViewportFooter>
      </Thread.Viewport>
    </Thread.Root>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.chat {
  min-height: 0;
  display: grid;
}

.chat-scroll {
  min-height: 0;
  overflow-y: auto;
  padding: 24px 16px;
}

.messages,
.empty-state,
.suggestions,
.thread-error {
  width: min(760px, 100%);
  margin: 0 auto;
}

.messages {
  display: grid;
  gap: 16px;
}

.scroll-button[data-state="bottom"] {
  visibility: hidden;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { Thread } from "@anvia/react-ui";

export function ThreadArea() {
  return (
    <Thread.Root className="grid min-h-0">
      <Thread.Viewport className="min-h-0 overflow-y-auto px-4 py-6" autoScroll>
        <Thread.Empty className="mx-auto w-full max-w-3xl">Ask your first question.</Thread.Empty>
        <Thread.Suggestions className="mx-auto flex w-full max-w-3xl flex-wrap gap-2" />
        <Thread.Messages className="mx-auto grid w-full max-w-3xl gap-4" />
        <Thread.Error className="mx-auto w-full max-w-3xl" />
        <Thread.ViewportFooter>
          <Thread.ScrollToBottom className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm data-[state=bottom]:invisible">
            Latest
          </Thread.ScrollToBottom>
        </Thread.ViewportFooter>
      </Thread.Viewport>
    </Thread.Root>
  );
}
`,
  },
];

export const composerVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { Composer } from "@anvia/react-ui";

export function PromptComposer() {
  return (
    <Composer.Root className="composer">
      <Composer.Attachments className="attachments" />
      <Composer.AddAttachment accept="image/*,.pdf" multiple>
        Attach
      </Composer.AddAttachment>
      <Composer.Input minRows={1} maxRows={6} placeholder="Message Anvia..." />
      <Composer.Stop>Stop</Composer.Stop>
      <Composer.Submit>Send</Composer.Submit>
    </Composer.Root>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.composer {
  width: min(760px, calc(100% - 32px));
  margin: 0 auto 16px;
  display: flex;
  gap: 8px;
  align-items: end;
  border: 1px solid #3f3f46;
  border-radius: 18px;
  padding: 8px;
}

.attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.composer [data-anvia-composer-input] {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
}

.composer[data-state="streaming"] [data-anvia-submit] {
  display: none;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { Composer } from "@anvia/react-ui";

export function PromptComposer() {
  return (
    <Composer.Root className="mx-auto mb-4 flex w-[min(760px,calc(100%-32px))] items-end gap-2 rounded-[18px] border border-zinc-700 p-2 [&[data-state=streaming]_[data-anvia-submit]]:hidden">
      <Composer.Attachments className="flex flex-wrap gap-2" />
      <Composer.AddAttachment accept="image/*,.pdf" multiple>
        Attach
      </Composer.AddAttachment>
      <Composer.Input className="min-w-0 flex-1 resize-none bg-transparent outline-none" minRows={1} maxRows={6} />
      <Composer.Stop>Stop</Composer.Stop>
      <Composer.Submit>Send</Composer.Submit>
    </Composer.Root>
  );
}
`,
  },
];

export const completionVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { useCompletion } from "@anvia/react";
import { Completion, CompletionProvider } from "@anvia/react-ui";

export function CompletionPanel() {
  const completion = useCompletion({ endpoint: "/api/complete" });

  return (
    <CompletionProvider controller={completion}>
      <Completion.Root className="completion">
        <Completion.Output className="completion-output" />
        <Completion.Form className="completion-form">
          <Completion.Input placeholder="Draft a product update..." />
          <Completion.Stop>Stop</Completion.Stop>
          <Completion.Submit>Generate</Completion.Submit>
        </Completion.Form>
      </Completion.Root>
    </CompletionProvider>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.completion {
  width: min(760px, 100%);
  display: grid;
  gap: 16px;
}

.completion-output {
  min-height: 220px;
  border: 1px solid #3f3f46;
  border-radius: 12px;
  background: #18181b;
  padding: 16px;
  white-space: pre-wrap;
}

.completion-form {
  display: grid;
  gap: 10px;
}

.completion-form textarea {
  min-height: 120px;
  resize: vertical;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { useCompletion } from "@anvia/react";
import { Completion, CompletionProvider } from "@anvia/react-ui";

export function CompletionPanel() {
  const completion = useCompletion({ endpoint: "/api/complete" });

  return (
    <CompletionProvider controller={completion}>
      <Completion.Root className="grid w-full max-w-3xl gap-4">
        <Completion.Output className="min-h-56 whitespace-pre-wrap rounded-xl border border-zinc-700 bg-zinc-900 p-4" />
        <Completion.Form className="grid gap-2.5">
          <Completion.Input className="min-h-32 resize-y rounded-xl border border-zinc-700 bg-zinc-950 p-3 outline-none" placeholder="Draft a product update..." />
          <div className="flex gap-2">
            <Completion.Stop>Stop</Completion.Stop>
            <Completion.Submit>Generate</Completion.Submit>
          </div>
        </Completion.Form>
      </Completion.Root>
    </CompletionProvider>
  );
}
`,
  },
];

export const minimalMessageVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { Message } from "@anvia/react-ui";

export function ChatMessage() {
  return (
    <Message.Root className="message">
      <Message.Content className="message-content">
        <Message.Parts />
      </Message.Content>
      <Message.Actions className="message-actions">
        <Message.Copy>Copy</Message.Copy>
        <Message.Regenerate>Try again</Message.Regenerate>
      </Message.Actions>
    </Message.Root>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.message {
  display: grid;
  gap: 8px;
}

.message[data-role="user"] {
  justify-items: end;
}

.message-content {
  max-width: min(680px, 100%);
}

.message-actions {
  display: flex;
  gap: 6px;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { Message } from "@anvia/react-ui";

export function ChatMessage() {
  return (
    <Message.Root className="grid gap-2 data-[role=user]:justify-items-end">
      <Message.Content className="max-w-[min(680px,100%)]">
        <Message.Parts />
      </Message.Content>
      <Message.Actions className="flex gap-1.5 text-sm text-zinc-400">
        <Message.Copy>Copy</Message.Copy>
        <Message.Regenerate>Try again</Message.Regenerate>
      </Message.Actions>
    </Message.Root>
  );
}
`,
  },
];

export const minimalComposerVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { Composer } from "@anvia/react-ui";

export function ChatComposer() {
  return (
    <Composer.Root className="composer">
      <Composer.Attachments className="attachments" />
      <Composer.AddAttachment>Attach</Composer.AddAttachment>
      <Composer.Input maxRows={6} placeholder="Send a message..." />
      <Composer.Stop>Stop</Composer.Stop>
      <Composer.Submit>Send</Composer.Submit>
    </Composer.Root>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.composer {
  width: min(760px, calc(100% - 32px));
  display: flex;
  gap: 8px;
  align-items: end;
}

.attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.composer [data-anvia-composer-input] {
  min-width: 0;
  flex: 1;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { Composer } from "@anvia/react-ui";

export function ChatComposer() {
  return (
    <Composer.Root className="flex w-[min(760px,calc(100%-32px))] items-end gap-2">
      <Composer.Attachments className="flex flex-wrap gap-2" />
      <Composer.AddAttachment>Attach</Composer.AddAttachment>
      <Composer.Input className="min-w-0 flex-1 resize-none" maxRows={6} placeholder="Send a message..." />
      <Composer.Stop>Stop</Composer.Stop>
      <Composer.Submit>Send</Composer.Submit>
    </Composer.Root>
  );
}
`,
  },
];

export const starterChatVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { useChat } from "@anvia/react";
import { ChatProvider, Composer, Thread } from "@anvia/react-ui";
import "@anvia/react-ui/styles.css";

export function SupportChat() {
  const chat = useChat({
    endpoint: "/api/chat",
    suggestions: [
      { id: "summarize", label: "Summarize", prompt: "Summarize this thread." },
      { id: "next", label: "Next step", prompt: "What should I do next?" },
    ],
  });

  return (
    <ChatProvider controller={chat}>
      <Thread.Root className="chat">
        <Thread.Viewport className="chat-scroll">
          <Thread.Empty className="empty-state">Start a conversation.</Thread.Empty>
          <Thread.Suggestions className="suggestions" />
          <Thread.Messages className="messages" />
          <Thread.Error className="thread-error" />
          <Thread.ScrollToBottom className="scroll-button">Latest</Thread.ScrollToBottom>
        </Thread.Viewport>

        <Composer.Root className="composer">
          <Composer.Attachments className="composer-attachments" />
          <Composer.AddAttachment>Attach</Composer.AddAttachment>
          <Composer.Input placeholder="Ask a question..." maxRows={6} />
          <Composer.Stop>Stop</Composer.Stop>
          <Composer.Submit>Send</Composer.Submit>
        </Composer.Root>
      </Thread.Root>
    </ChatProvider>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.chat {
  min-height: 100vh;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
}

.chat-scroll {
  min-height: 0;
  overflow-y: auto;
  padding: 24px 16px;
}

.messages,
.empty-state,
.suggestions,
.thread-error {
  width: min(760px, 100%);
  margin: 0 auto;
}

.messages {
  display: grid;
  gap: 16px;
}

.messages [data-anvia-message] {
  display: grid;
  gap: 8px;
}

.messages [data-role="user"] {
  justify-items: end;
}

.composer {
  width: min(760px, calc(100% - 32px));
  margin: 0 auto 16px;
  display: flex;
  gap: 8px;
  align-items: end;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { useChat } from "@anvia/react";
import { ChatProvider, Composer, Thread } from "@anvia/react-ui";
import "@anvia/react-ui/styles.css";

export function SupportChat() {
  const chat = useChat({ endpoint: "/api/chat" });

  return (
    <ChatProvider controller={chat}>
      <Thread.Root className="grid min-h-screen grid-rows-[minmax(0,1fr)_auto] bg-zinc-950 text-zinc-100">
        <Thread.Viewport className="min-h-0 overflow-y-auto px-4 py-6">
          <Thread.Empty className="mx-auto w-full max-w-3xl">Start a conversation.</Thread.Empty>
          <Thread.Messages
            className="
              mx-auto grid w-full max-w-3xl gap-4
              [&_[data-anvia-message]]:grid
              [&_[data-anvia-message]]:gap-2
              [&_[data-role=user]]:justify-items-end
            "
          />
          <Thread.Error className="mx-auto w-full max-w-3xl" />
          <Thread.ScrollToBottom className="fixed right-4 bottom-24 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm">
            Latest
          </Thread.ScrollToBottom>
        </Thread.Viewport>

        <Composer.Root className="mx-auto mb-4 flex w-[min(760px,calc(100%-32px))] items-end gap-2 rounded-2xl border border-zinc-700 bg-zinc-900 p-2">
          <Composer.Attachments className="flex flex-wrap gap-2" />
          <Composer.AddAttachment>Attach</Composer.AddAttachment>
          <Composer.Input className="min-w-0 flex-1 resize-none bg-transparent outline-none" maxRows={6} />
          <Composer.Stop>Stop</Composer.Stop>
          <Composer.Submit>Send</Composer.Submit>
        </Composer.Root>
      </Thread.Root>
    </ChatProvider>
  );
}
`,
  },
];

export const reviewPanelVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { HumanInput } from "@anvia/react-ui";

export function ReviewPanel() {
  return (
    <HumanInput.Panel className="review-panel">
      <HumanInput.Status />
      <HumanInput.Approvals className="approvals" />
      <HumanInput.Questions className="questions" />
    </HumanInput.Panel>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.review-panel {
  display: grid;
  gap: 14px;
  border: 1px solid #3f3f46;
  border-radius: 12px;
  background: #18181b;
  padding: 14px;
}

.approvals,
.questions {
  display: grid;
  gap: 10px;
}

[data-anvia-human-input-status][data-pending="0"] {
  display: none;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { HumanInput } from "@anvia/react-ui";

export function ReviewPanel() {
  return (
    <HumanInput.Panel className="grid gap-3.5 rounded-xl border border-zinc-700 bg-zinc-900 p-3.5">
      <HumanInput.Status className="data-[pending=0]:hidden" />
      <HumanInput.Approvals className="grid gap-2.5" />
      <HumanInput.Questions className="grid gap-2.5" />
    </HumanInput.Panel>
  );
}
`,
  },
];

export const approvalVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { HumanInput } from "@anvia/react-ui";

export function Approvals() {
  return (
    <HumanInput.Approvals className="approvals">
      {(approval) => (
        <HumanInput.Approval className="approval">
          <header className="approval-header">
            <strong>{approval.toolName}</strong>
            <span>{approval.status}</span>
          </header>
          {approval.args !== undefined ? <pre>{approval.args}</pre> : null}
          <HumanInput.ApprovalReason placeholder="Why approve or reject?" />
          <div className="approval-actions">
            <HumanInput.Reject>Reject</HumanInput.Reject>
            <HumanInput.Approve>Approve</HumanInput.Approve>
          </div>
        </HumanInput.Approval>
      )}
    </HumanInput.Approvals>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.approval {
  display: grid;
  gap: 10px;
  border: 1px solid #3f3f46;
  border-radius: 10px;
  padding: 12px;
}

.approval-header,
.approval-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.approval textarea {
  min-height: 76px;
  resize: vertical;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { HumanInput } from "@anvia/react-ui";

export function Approvals() {
  return (
    <HumanInput.Approvals className="grid gap-2.5">
      {(approval) => (
        <HumanInput.Approval className="grid gap-2.5 rounded-lg border border-zinc-700 p-3">
          <header className="flex items-center justify-between gap-2.5">
            <strong>{approval.toolName}</strong>
            <span className="text-sm text-zinc-400">{approval.status}</span>
          </header>
          {approval.args !== undefined ? <pre>{approval.args}</pre> : null}
          <HumanInput.ApprovalReason className="min-h-20 resize-y rounded-lg border border-zinc-700 bg-zinc-950 p-2" placeholder="Why approve or reject?" />
          <div className="flex justify-end gap-2">
            <HumanInput.Reject>Reject</HumanInput.Reject>
            <HumanInput.Approve>Approve</HumanInput.Approve>
          </div>
        </HumanInput.Approval>
      )}
    </HumanInput.Approvals>
  );
}
`,
  },
];

export const defaultRendererVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { Thread } from "@anvia/react-ui";

export function MessageList() {
  return <Thread.Messages className="messages" />;
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.messages {
  width: min(760px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 16px;
}

.messages [data-anvia-message] {
  display: grid;
  gap: 8px;
}

.messages [data-role="user"] {
  justify-items: end;
}

.messages [data-role="assistant"] {
  justify-items: start;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { Thread } from "@anvia/react-ui";

export function MessageList() {
  return (
    <Thread.Messages
      className="
        mx-auto grid w-full max-w-3xl gap-4
        [&_[data-anvia-message]]:grid [&_[data-anvia-message]]:gap-2
        [&_[data-role=assistant]]:justify-items-start
        [&_[data-role=user]]:justify-items-end
      "
    />
  );
}
`,
  },
];

export const messageRowVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { Message, Thread } from "@anvia/react-ui";

export function MessageList() {
  return (
    <Thread.Messages className="messages">
      {(message) => (
        <Message.Root className="message">
          <Message.Content className="message-content">
            <Message.Parts />
          </Message.Content>
          {message.role === "assistant" ? (
            <Message.Actions className="message-actions">
              <Message.Copy>Copy</Message.Copy>
              <Message.Regenerate>Regenerate</Message.Regenerate>
            </Message.Actions>
          ) : null}
        </Message.Root>
      )}
    </Thread.Messages>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.message {
  display: grid;
  gap: 8px;
}

.message[data-role="user"] {
  justify-items: end;
}

.message-content {
  max-width: min(680px, 100%);
}

.message[data-role="user"] .message-content {
  max-width: min(620px, 88%);
  border-radius: 18px;
  background: #27272a;
  padding: 10px 14px;
}

.message[data-role="assistant"] .message-content {
  line-height: 1.7;
}

.message-actions {
  display: flex;
  gap: 6px;
  color: #a1a1aa;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { Message, Thread } from "@anvia/react-ui";

export function MessageList() {
  return (
    <Thread.Messages className="mx-auto grid w-full max-w-3xl gap-4">
      {(message) => (
        <Message.Root className="group/message grid gap-2 data-[role=user]:justify-items-end">
          <Message.Content
            className="
              max-w-[min(680px,100%)] leading-7
              group-data-[role=user]/message:max-w-[min(620px,88%)]
              group-data-[role=user]/message:rounded-[18px]
              group-data-[role=user]/message:bg-zinc-800
              group-data-[role=user]/message:px-3.5
              group-data-[role=user]/message:py-2.5
            "
          >
            <Message.Parts />
          </Message.Content>
          {message.role === "assistant" ? (
            <Message.Actions className="flex gap-1.5 text-zinc-400">
              <Message.Copy>Copy</Message.Copy>
              <Message.Regenerate>Regenerate</Message.Regenerate>
            </Message.Actions>
          ) : null}
        </Message.Root>
      )}
    </Thread.Messages>
  );
}
`,
  },
];

export const customRendererVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { Message } from "@anvia/react-ui";

export function MessageBody() {
  return (
    <Message.Content className="message-content">
      <Message.Parts>
        {(part) => {
          if (part.type === "text") {
            return (
              <Message.Part className="text-part">
                <Message.Markdown />
              </Message.Part>
            );
          }

          if (part.type === "attachment") {
            return (
              <Message.Part className="attachment-part">
                <Message.Attachment className="attachment-card" />
              </Message.Part>
            );
          }

          if (part.type === "tool") {
            return (
              <Message.Part className="tool-part">
                <Message.Tool className="tool-card" renderWhen="always" />
              </Message.Part>
            );
          }

          return <Message.Part className="message-part" />;
        }}
      </Message.Parts>
    </Message.Content>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.text-part {
  line-height: 1.7;
}

.attachment-card,
.tool-card {
  width: min(560px, 100%);
  border: 1px solid #3f3f46;
  border-radius: 10px;
  background: #18181b;
  padding: 12px;
}

.tool-card {
  display: grid;
  gap: 8px;
}

.message-part[data-part="error"] {
  border-left: 3px solid #fb7185;
  padding-left: 12px;
  color: #fecdd3;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { Message } from "@anvia/react-ui";

export function MessageBody() {
  return (
    <Message.Content className="leading-7">
      <Message.Parts>
        {(part) => {
          if (part.type === "text") {
            return (
              <Message.Part className="max-w-none leading-7">
                <Message.Markdown />
              </Message.Part>
            );
          }

          if (part.type === "attachment") {
            return (
              <Message.Part>
                <Message.Attachment className="w-full max-w-xl rounded-lg border border-zinc-700 bg-zinc-900 p-3" />
              </Message.Part>
            );
          }

          if (part.type === "tool") {
            return (
              <Message.Part>
                <Message.Tool
                  className="grid w-full max-w-xl gap-2 rounded-lg border border-zinc-700 bg-zinc-900 p-3"
                  renderWhen="always"
                />
              </Message.Part>
            );
          }

          return <Message.Part className="data-[part=error]:border-l-2 data-[part=error]:border-rose-400 data-[part=error]:pl-3" />;
        }}
      </Message.Parts>
    </Message.Content>
  );
}
`,
  },
];

export const markdownVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { Message } from "@anvia/react-ui";

export function MarkdownTextPart() {
  return (
    <Message.Part className="text-part">
      <Message.Markdown
        components={{
          code(props) {
            return <Message.CodeBlock {...props} />;
          },
          a(props) {
            return <a {...props} target="_blank" rel="noreferrer" />;
          },
        }}
      />
    </Message.Part>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.text-part [data-anvia-markdown] {
  display: grid;
  gap: 12px;
}

.text-part [data-anvia-code-block] {
  max-width: 100%;
  overflow-x: auto;
  border-radius: 10px;
  background: #09090b;
  padding: 12px;
}

.text-part [data-anvia-inline-code] {
  border-radius: 4px;
  background: #27272a;
  padding: 1px 4px;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { Message } from "@anvia/react-ui";

export function MarkdownTextPart() {
  return (
    <Message.Part
      className="
        [&_[data-anvia-markdown]]:grid [&_[data-anvia-markdown]]:gap-3
        [&_[data-anvia-code-block]]:max-w-full
        [&_[data-anvia-code-block]]:overflow-x-auto
        [&_[data-anvia-code-block]]:rounded-lg
        [&_[data-anvia-code-block]]:bg-zinc-950
        [&_[data-anvia-code-block]]:p-3
        [&_[data-anvia-inline-code]]:rounded
        [&_[data-anvia-inline-code]]:bg-zinc-800
        [&_[data-anvia-inline-code]]:px-1
      "
    >
      <Message.Markdown />
    </Message.Part>
  );
}
`,
  },
];

export const chatShellVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { Composer, Thread } from "@anvia/react-ui";

export function ChatShell() {
  return (
    <Thread.Root className="chat">
      <Thread.Viewport className="chat-scroll">
        <Thread.Empty className="empty-state">Start a conversation.</Thread.Empty>
        <Thread.Messages className="messages" />
        <Thread.Error className="thread-error" />
        <Thread.ScrollToBottom className="scroll-button">Latest</Thread.ScrollToBottom>
      </Thread.Viewport>

      <Composer.Root className="composer">
        <Composer.Attachments className="composer-attachments" />
        <Composer.AddAttachment>Attach</Composer.AddAttachment>
        <Composer.Input maxRows={6} placeholder="Ask a question..." />
        <Composer.Stop>Stop</Composer.Stop>
        <Composer.Submit>Send</Composer.Submit>
      </Composer.Root>
    </Thread.Root>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.chat {
  min-height: 100vh;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  background: #0f1014;
  color: #f4f4f5;
}

.chat-scroll {
  min-height: 0;
  overflow-y: auto;
  padding: 24px 16px;
}

.messages {
  width: min(760px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 16px;
}

.empty-state,
.thread-error {
  width: min(760px, 100%);
  margin: 0 auto;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { Composer, Thread } from "@anvia/react-ui";

export function ChatShell() {
  return (
    <Thread.Root className="grid min-h-screen grid-rows-[minmax(0,1fr)_auto] bg-zinc-950 text-zinc-100">
      <Thread.Viewport className="min-h-0 overflow-y-auto px-4 py-6">
        <Thread.Empty className="mx-auto w-full max-w-3xl">Start a conversation.</Thread.Empty>
        <Thread.Messages className="mx-auto grid w-full max-w-3xl gap-4" />
        <Thread.Error className="mx-auto w-full max-w-3xl" />
        <Thread.ScrollToBottom className="fixed right-4 bottom-24 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm">
          Latest
        </Thread.ScrollToBottom>
      </Thread.Viewport>

      <Composer.Root className="mx-auto mb-4 flex w-[min(760px,calc(100%-32px))] items-end gap-2 rounded-2xl border border-zinc-700 bg-zinc-900 p-2">
        <Composer.Attachments className="flex flex-wrap gap-2" />
        <Composer.AddAttachment>Attach</Composer.AddAttachment>
        <Composer.Input className="min-w-0 flex-1 resize-none bg-transparent outline-none" maxRows={6} />
        <Composer.Stop>Stop</Composer.Stop>
        <Composer.Submit>Send</Composer.Submit>
      </Composer.Root>
    </Thread.Root>
  );
}
`,
  },
];

export const messageStyleVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { Message, Thread } from "@anvia/react-ui";

export function Messages() {
  return (
    <Thread.Messages className="messages">
      {(message) => (
        <Message.Root className="message">
          <Message.Content className="message-content">
            <Message.Parts />
          </Message.Content>
        </Message.Root>
      )}
    </Thread.Messages>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.message {
  display: grid;
  gap: 8px;
}

.message[data-role="user"] {
  justify-items: end;
}

.message-content {
  max-width: min(680px, 100%);
}

.message[data-role="user"] .message-content {
  max-width: min(620px, 88%);
  border-radius: 18px;
  background: #27272a;
  padding: 10px 14px;
}

.message[data-role="assistant"] .message-content {
  line-height: 1.7;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { Message, Thread } from "@anvia/react-ui";

export function Messages() {
  return (
    <Thread.Messages className="mx-auto grid w-full max-w-3xl gap-4">
      {(message) => (
        <Message.Root className="group/message grid gap-2 data-[role=user]:justify-items-end">
          <Message.Content
            className="
              max-w-[min(680px,100%)]
              group-data-[role=assistant]/message:leading-7
              group-data-[role=user]/message:max-w-[min(620px,88%)]
              group-data-[role=user]/message:rounded-[18px]
              group-data-[role=user]/message:bg-zinc-800
              group-data-[role=user]/message:px-3.5
              group-data-[role=user]/message:py-2.5
            "
          >
            <Message.Parts />
          </Message.Content>
        </Message.Root>
      )}
    </Thread.Messages>
  );
}
`,
  },
];

export const composerStyleVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { Composer } from "@anvia/react-ui";

export function ComposerBar() {
  return (
    <Composer.Root className="composer">
      <Composer.Attachments className="composer-attachments" />
      <Composer.AddAttachment className="composer-button">Attach</Composer.AddAttachment>
      <Composer.Input className="composer-input" maxRows={6} />
      <Composer.Stop className="composer-button">Stop</Composer.Stop>
      <Composer.Submit className="composer-button composer-submit">Send</Composer.Submit>
    </Composer.Root>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.composer {
  width: min(760px, calc(100% - 32px));
  margin: 0 auto 16px;
  display: flex;
  gap: 8px;
  align-items: end;
  border: 1px solid #3f3f46;
  border-radius: 18px;
  background: #18181b;
  padding: 8px;
}

.composer-input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
}

.composer-button {
  border-radius: 10px;
  border: 1px solid #3f3f46;
  background: #27272a;
  color: #f4f4f5;
  padding: 8px 10px;
}

.composer [data-anvia-submit][data-state="disabled"] {
  opacity: 0.45;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { Composer } from "@anvia/react-ui";

export function ComposerBar() {
  return (
    <Composer.Root className="mx-auto mb-4 flex w-[min(760px,calc(100%-32px))] items-end gap-2 rounded-[18px] border border-zinc-700 bg-zinc-900 p-2">
      <Composer.Attachments className="flex flex-wrap gap-2" />
      <Composer.AddAttachment className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-2">
        Attach
      </Composer.AddAttachment>
      <Composer.Input className="min-w-0 flex-1 resize-none bg-transparent outline-none" maxRows={6} />
      <Composer.Stop className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-2">
        Stop
      </Composer.Stop>
      <Composer.Submit className="rounded-lg bg-[#2BF563] px-2.5 py-2 font-semibold text-zinc-950 data-[state=disabled]:opacity-50">
        Send
      </Composer.Submit>
    </Composer.Root>
  );
}
`,
  },
];

export const toolCardVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { Message } from "@anvia/react-ui";

export function ToolCard() {
  return (
    <Message.Tool className="tool-card" renderWhen="always">
      <header className="tool-card-header">
        <Message.ToolName />
        <Message.ToolStatus />
      </header>
      <section className="tool-card-section">
        <Message.ToolInput />
      </section>
      <section className="tool-card-section">
        <Message.ToolOutput />
        <Message.ToolError />
      </section>
    </Message.Tool>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.tool-card {
  width: min(560px, 100%);
  display: grid;
  gap: 10px;
  border: 1px solid #3f3f46;
  border-radius: 10px;
  background: #18181b;
  padding: 12px;
}

.tool-card[data-state="input-streaming"],
.tool-card[data-state="input-available"] {
  border-color: #facc15;
}

.tool-card[data-state="output-available"] {
  border-color: #22c55e;
}

.tool-card[data-state="error"] {
  border-color: #fb7185;
}

.tool-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tool-card-section pre {
  max-height: 280px;
  overflow: auto;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { Message } from "@anvia/react-ui";

export function ToolCard() {
  return (
    <Message.Tool
      className="
        grid w-full max-w-xl gap-2.5 rounded-lg border border-zinc-700 bg-zinc-900 p-3
        data-[state=error]:border-rose-400
        data-[state=input-available]:border-yellow-400
        data-[state=input-streaming]:border-yellow-400
        data-[state=output-available]:border-emerald-500
      "
      renderWhen="always"
    >
      <header className="flex items-center justify-between gap-3">
        <Message.ToolName />
        <Message.ToolStatus className="text-sm text-zinc-400" />
      </header>
      <section className="[&_pre]:max-h-72 [&_pre]:overflow-auto">
        <Message.ToolInput />
      </section>
      <section className="[&_pre]:max-h-72 [&_pre]:overflow-auto">
        <Message.ToolOutput />
        <Message.ToolError className="text-rose-200" />
      </section>
    </Message.Tool>
  );
}
`,
  },
];

export const defaultToCustomVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { Message, Thread } from "@anvia/react-ui";

export function Messages() {
  return (
    <Thread.Messages className="messages">
      {(message) => (
        <Message.Root className="message">
          <Message.Content className="message-content">
            <Message.Parts>
              {(part) => {
                if (part.type === "tool" && part.toolName === "searchDocs") {
                  return <SearchDocsTool part={part} />;
                }

                if (part.type === "attachment") {
                  return (
                    <Message.Part className="attachment-part">
                      <Message.Attachment className="attachment-preview" />
                    </Message.Part>
                  );
                }

                return <Message.Part />;
              }}
            </Message.Parts>
          </Message.Content>
        </Message.Root>
      )}
    </Thread.Messages>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.messages {
  width: min(760px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 16px;
}

.message {
  display: grid;
  gap: 8px;
}

.message[data-role="user"] {
  justify-items: end;
}

.attachment-preview {
  width: min(520px, 100%);
  border: 1px solid #3f3f46;
  border-radius: 10px;
  padding: 12px;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { Message, Thread } from "@anvia/react-ui";

export function Messages() {
  return (
    <Thread.Messages className="mx-auto grid w-full max-w-3xl gap-4">
      {(message) => (
        <Message.Root className="grid gap-2 data-[role=user]:justify-items-end">
          <Message.Content>
            <Message.Parts>
              {(part) => {
                if (part.type === "tool" && part.toolName === "searchDocs") {
                  return <SearchDocsTool part={part} />;
                }

                if (part.type === "attachment") {
                  return (
                    <Message.Part>
                      <Message.Attachment className="w-full max-w-xl rounded-lg border border-zinc-700 p-3" />
                    </Message.Part>
                  );
                }

                return <Message.Part />;
              }}
            </Message.Parts>
          </Message.Content>
        </Message.Root>
      )}
    </Thread.Messages>
  );
}
`,
  },
];

export const attachmentVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { Composer } from "@anvia/react-ui";

export function AttachmentComposer() {
  return (
    <Composer.Root className="composer">
      <Composer.AttachmentDropzone className="dropzone">
        <Composer.Attachments className="attachment-list" />
        <Composer.AddAttachment accept="image/*,.pdf" multiple>
          Attach
        </Composer.AddAttachment>
        <Composer.Input minRows={1} maxRows={6} />
        <Composer.Submit />
      </Composer.AttachmentDropzone>
    </Composer.Root>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.dropzone {
  display: grid;
  gap: 10px;
}

.dropzone[data-dragging] {
  outline: 2px solid #2bf563;
  outline-offset: 4px;
}

.attachment-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { Composer } from "@anvia/react-ui";

export function AttachmentComposer() {
  return (
    <Composer.Root className="composer">
      <Composer.AttachmentDropzone className="grid gap-2.5 data-[dragging]:outline data-[dragging]:outline-2 data-[dragging]:outline-offset-4 data-[dragging]:outline-[#2BF563]">
        <Composer.Attachments className="flex flex-wrap gap-2" />
        <Composer.AddAttachment accept="image/*,.pdf" multiple>
          Attach
        </Composer.AddAttachment>
        <Composer.Input minRows={1} maxRows={6} />
        <Composer.Submit />
      </Composer.AttachmentDropzone>
    </Composer.Root>
  );
}
`,
  },
];

export const chatSurfaceVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { useChat } from "@anvia/react";
import { ChatProvider, Composer, Thread } from "@anvia/react-ui";
import "@anvia/react-ui/styles.css";

export function AgentChat() {
  const chat = useChat({
    endpoint: "/api/chat",
    suggestions: [
      { id: "summarize", label: "Summarize", prompt: "Summarize this conversation." },
      { id: "risks", label: "Find risks", prompt: "What are the risks in this plan?" },
      { id: "next", label: "Next step", prompt: "Suggest the next implementation step." },
    ],
  });

  return (
    <ChatProvider controller={chat}>
      <Thread.Root className="chat">
        <Thread.Viewport className="chat-scroll">
          <Thread.Empty className="empty-state">
            <h1>What should we build?</h1>
            <Thread.Suggestions className="suggestions" />
          </Thread.Empty>

          <Thread.Messages className="messages" />
          <Thread.Error className="thread-error" />
          <Thread.ScrollToBottom className="scroll-button">Jump to latest</Thread.ScrollToBottom>
        </Thread.Viewport>

        <Composer.Root className="composer">
          <Composer.Attachments className="composer-attachments" />
          <Composer.AddAttachment>Attach</Composer.AddAttachment>
          <Composer.Input minRows={1} maxRows={6} placeholder="Message the agent..." />
          <Composer.Stop>Stop</Composer.Stop>
          <Composer.Submit>Send</Composer.Submit>
        </Composer.Root>
      </Thread.Root>
    </ChatProvider>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.chat {
  min-height: 100vh;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  background: #0f1014;
  color: #f4f4f5;
}

.chat-scroll {
  min-height: 0;
  overflow-y: auto;
  padding: 24px 16px;
}

.messages,
.empty-state,
.thread-error {
  width: min(760px, 100%);
  margin: 0 auto;
}

.messages {
  display: grid;
  gap: 16px;
}

.messages [data-anvia-message] {
  display: grid;
  gap: 8px;
}

.messages [data-role="user"] {
  justify-items: end;
}

.suggestions {
  margin-top: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.composer {
  width: min(760px, calc(100% - 32px));
  margin: 0 auto 16px;
  display: flex;
  gap: 8px;
  align-items: end;
  border: 1px solid #3f3f46;
  border-radius: 18px;
  background: #18181b;
  padding: 8px;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { useChat } from "@anvia/react";
import { ChatProvider, Composer, Thread } from "@anvia/react-ui";
import "@anvia/react-ui/styles.css";

export function AgentChat() {
  const chat = useChat({ endpoint: "/api/chat" });

  return (
    <ChatProvider controller={chat}>
      <Thread.Root className="grid min-h-screen grid-rows-[minmax(0,1fr)_auto] bg-zinc-950 text-zinc-100">
        <Thread.Viewport className="min-h-0 overflow-y-auto px-4 py-6">
          <Thread.Empty className="mx-auto w-full max-w-3xl">
            <h1 className="text-2xl font-semibold">What should we build?</h1>
            <Thread.Suggestions className="mt-4 flex flex-wrap gap-2" />
          </Thread.Empty>

          <Thread.Messages
            className="
              mx-auto grid w-full max-w-3xl gap-4
              [&_[data-anvia-message]]:grid
              [&_[data-anvia-message]]:gap-2
              [&_[data-role=user]]:justify-items-end
            "
          />
          <Thread.Error className="mx-auto w-full max-w-3xl" />
          <Thread.ScrollToBottom className="fixed right-4 bottom-24 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm">
            Jump to latest
          </Thread.ScrollToBottom>
        </Thread.Viewport>

        <Composer.Root className="mx-auto mb-4 flex w-[min(760px,calc(100%-32px))] items-end gap-2 rounded-[18px] border border-zinc-700 bg-zinc-900 p-2">
          <Composer.Attachments className="flex flex-wrap gap-2" />
          <Composer.AddAttachment>Attach</Composer.AddAttachment>
          <Composer.Input className="min-w-0 flex-1 resize-none bg-transparent outline-none" minRows={1} maxRows={6} />
          <Composer.Stop>Stop</Composer.Stop>
          <Composer.Submit>Send</Composer.Submit>
        </Composer.Root>
      </Thread.Root>
    </ChatProvider>
  );
}
`,
  },
];

export const releaseNoteVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { useCompletion } from "@anvia/react";
import { Completion, CompletionProvider } from "@anvia/react-ui";

export function ReleaseNoteDraft() {
  const completion = useCompletion({ endpoint: "/api/completion" });

  return (
    <CompletionProvider controller={completion}>
      <Completion.Root className="completion-panel">
        <Completion.Output>
          {(text) => (
            <article className="completion-result" aria-live="polite">
              {text.length > 0 ? text : "Your draft will appear here."}
            </article>
          )}
        </Completion.Output>

        <Completion.Form className="completion-form">
          <Completion.Input rows={5} placeholder="Draft a release note for the latest changes..." />
          <Completion.Stop>Stop</Completion.Stop>
          <Completion.Submit>Generate</Completion.Submit>
        </Completion.Form>
      </Completion.Root>
    </CompletionProvider>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.completion-panel {
  width: min(760px, 100%);
  display: grid;
  gap: 16px;
}

.completion-result {
  min-height: 180px;
  border: 1px solid #3f3f46;
  border-radius: 12px;
  background: #18181b;
  padding: 16px;
  white-space: pre-wrap;
}

.completion-form {
  display: grid;
  gap: 10px;
}

.completion-form textarea {
  resize: vertical;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { useCompletion } from "@anvia/react";
import { Completion, CompletionProvider } from "@anvia/react-ui";

export function ReleaseNoteDraft() {
  const completion = useCompletion({ endpoint: "/api/completion" });

  return (
    <CompletionProvider controller={completion}>
      <Completion.Root className="grid w-full max-w-3xl gap-4">
        <Completion.Output>
          {(text) => (
            <article className="min-h-44 whitespace-pre-wrap rounded-xl border border-zinc-700 bg-zinc-900 p-4" aria-live="polite">
              {text.length > 0 ? text : "Your draft will appear here."}
            </article>
          )}
        </Completion.Output>

        <Completion.Form className="grid gap-2.5">
          <Completion.Input className="min-h-32 resize-y rounded-xl border border-zinc-700 bg-zinc-950 p-3 outline-none" rows={5} placeholder="Draft a release note for the latest changes..." />
          <div className="flex gap-2">
            <Completion.Stop>Stop</Completion.Stop>
            <Completion.Submit>Generate</Completion.Submit>
          </div>
        </Completion.Form>
      </Completion.Root>
    </CompletionProvider>
  );
}
`,
  },
];

export const attachmentListVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { Attachment, Composer } from "@anvia/react-ui";

export function AttachmentComposer() {
  return (
    <Composer.Root className="composer">
      <Composer.Attachments className="attachment-list">
        {(attachment) => (
          <Attachment.Root className="attachment-row">
            <Attachment.Preview />
            <Attachment.Name />
            <Attachment.Remove>Remove</Attachment.Remove>
          </Attachment.Root>
        )}
      </Composer.Attachments>
      <Composer.AddAttachment accept="image/*,.pdf" multiple>
        Attach
      </Composer.AddAttachment>
      <Composer.Input />
      <Composer.Submit />
    </Composer.Root>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.attachment-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attachment-row {
  display: inline-flex;
  max-width: 240px;
  align-items: center;
  gap: 8px;
  border: 1px solid #3f3f46;
  border-radius: 10px;
  padding: 6px 8px;
}

.attachment-row [data-anvia-attachment-name] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { Attachment, Composer } from "@anvia/react-ui";

export function AttachmentComposer() {
  return (
    <Composer.Root className="composer">
      <Composer.Attachments className="flex flex-wrap gap-2">
        {(attachment) => (
          <Attachment.Root className="inline-flex max-w-60 items-center gap-2 rounded-lg border border-zinc-700 px-2 py-1.5">
            <Attachment.Preview />
            <Attachment.Name className="min-w-0 truncate" />
            <Attachment.Remove>Remove</Attachment.Remove>
          </Attachment.Root>
        )}
      </Composer.Attachments>
      <Composer.AddAttachment accept="image/*,.pdf" multiple>
        Attach
      </Composer.AddAttachment>
      <Composer.Input />
      <Composer.Submit />
    </Composer.Root>
  );
}
`,
  },
];

export const dropzoneVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { Composer } from "@anvia/react-ui";

export function DropzoneComposer() {
  return (
    <Composer.Root className="composer">
      <Composer.AttachmentDropzone className="dropzone">
        <Composer.Attachments className="attachment-list" />
        <Composer.AddAttachment accept="image/*,.pdf" multiple>
          Attach image or PDF
        </Composer.AddAttachment>
        <Composer.Input />
        <Composer.Submit />
      </Composer.AttachmentDropzone>
    </Composer.Root>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.dropzone {
  display: grid;
  gap: 10px;
  border: 1px dashed #52525b;
  border-radius: 14px;
  padding: 12px;
}

.dropzone[data-dragging] {
  border-color: #2bf563;
  background: rgba(43, 245, 99, 0.08);
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { Composer } from "@anvia/react-ui";

export function DropzoneComposer() {
  return (
    <Composer.Root className="composer">
      <Composer.AttachmentDropzone className="grid gap-2.5 rounded-xl border border-dashed border-zinc-600 p-3 data-[dragging]:border-[#2BF563] data-[dragging]:bg-[#2BF563]/10">
        <Composer.Attachments className="flex flex-wrap gap-2" />
        <Composer.AddAttachment accept="image/*,.pdf" multiple>
          Attach image or PDF
        </Composer.AddAttachment>
        <Composer.Input />
        <Composer.Submit />
      </Composer.AttachmentDropzone>
    </Composer.Root>
  );
}
`,
  },
];

export const messageRendererVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { Message } from "@anvia/react-ui";

export function AgentMessage() {
  return (
    <Message.Root className="message">
      <Message.Content className="message-content">
        <Message.Parts>
          {(part) => {
            if (part.type === "text") {
              return (
                <Message.Part className="text-part">
                  <Message.Markdown
                    components={{
                      code(props) {
                        return <Message.CodeBlock {...props} />;
                      },
                    }}
                  />
                </Message.Part>
              );
            }

            if (part.type === "attachment") {
              return (
                <Message.Part className="attachment-part">
                  <Message.Attachment className="attachment-card" />
                </Message.Part>
              );
            }

            if (part.type === "tool") {
              return (
                <Message.Part className="tool-part">
                  <Message.Tool className="tool-card" renderWhen="always" />
                </Message.Part>
              );
            }

            return <Message.Part className="message-part" />;
          }}
        </Message.Parts>
      </Message.Content>

      <Message.Actions className="message-actions">
        <Message.Copy>Copy</Message.Copy>
        <Message.Regenerate>Retry</Message.Regenerate>
      </Message.Actions>
    </Message.Root>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.message {
  display: grid;
  gap: 8px;
}

.message[data-role="user"] {
  justify-items: end;
}

.message-content {
  max-width: min(720px, 100%);
}

.message[data-role="user"] .message-content {
  max-width: min(620px, 88%);
  border-radius: 18px;
  background: #27272a;
  padding: 10px 14px;
}

.text-part {
  line-height: 1.7;
}

.attachment-card,
.tool-card {
  width: min(560px, 100%);
  border: 1px solid #3f3f46;
  border-radius: 10px;
  background: #18181b;
  padding: 12px;
}

.message-actions {
  display: flex;
  gap: 6px;
  color: #a1a1aa;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { Message } from "@anvia/react-ui";

export function AgentMessage() {
  return (
    <Message.Root className="group/message grid gap-2 data-[role=user]:justify-items-end">
      <Message.Content
        className="
          max-w-[min(720px,100%)]
          group-data-[role=user]/message:max-w-[min(620px,88%)]
          group-data-[role=user]/message:rounded-[18px]
          group-data-[role=user]/message:bg-zinc-800
          group-data-[role=user]/message:px-3.5
          group-data-[role=user]/message:py-2.5
        "
      >
        <Message.Parts>
          {(part) => {
            if (part.type === "text") {
              return (
                <Message.Part className="max-w-none leading-7">
                  <Message.Markdown />
                </Message.Part>
              );
            }

            if (part.type === "attachment") {
              return (
                <Message.Part>
                  <Message.Attachment className="w-full max-w-xl rounded-lg border border-zinc-700 bg-zinc-900 p-3" />
                </Message.Part>
              );
            }

            if (part.type === "tool") {
              return (
                <Message.Part>
                  <Message.Tool className="grid w-full max-w-xl gap-2 rounded-lg border border-zinc-700 bg-zinc-900 p-3" />
                </Message.Part>
              );
            }

            return <Message.Part />;
          }}
        </Message.Parts>
      </Message.Content>

      <Message.Actions className="flex gap-1.5 text-sm text-zinc-400">
        <Message.Copy>Copy</Message.Copy>
        <Message.Regenerate>Retry</Message.Regenerate>
      </Message.Actions>
    </Message.Root>
  );
}
`,
  },
];

export const fullStylingVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { ChatProvider, Composer, Message, Thread } from "@anvia/react-ui";
import { useChat } from "@anvia/react";
import "@anvia/react-ui/styles.css";

export function StyledChat() {
  const chat = useChat({ endpoint: "/api/chat" });

  return (
    <ChatProvider controller={chat}>
      <Thread.Root className="chat">
        <Thread.Viewport className="chat-scroll">
          <Thread.Empty className="empty-state">Start a conversation.</Thread.Empty>
          <Thread.Messages className="messages">
            {(message) => (
              <Message.Root className="message">
                <Message.Content className="message-content">
                  <Message.Parts />
                </Message.Content>
                {message.role === "assistant" ? (
                  <Message.Actions className="message-actions">
                    <Message.Copy>Copy</Message.Copy>
                    <Message.Regenerate>Retry</Message.Regenerate>
                  </Message.Actions>
                ) : null}
              </Message.Root>
            )}
          </Thread.Messages>
          <Thread.ScrollToBottom className="scroll-button">Latest</Thread.ScrollToBottom>
        </Thread.Viewport>

        <Composer.Root className="composer">
          <Composer.Attachments className="attachment-list" />
          <Composer.AddAttachment className="composer-button">Attach</Composer.AddAttachment>
          <Composer.Input className="composer-input" placeholder="Ask..." maxRows={6} />
          <Composer.Stop className="composer-button">Stop</Composer.Stop>
          <Composer.Submit className="composer-button composer-submit">Send</Composer.Submit>
        </Composer.Root>
      </Thread.Root>
    </ChatProvider>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.chat {
  min-height: 100vh;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  background: #0f1014;
  color: #f4f4f5;
}

.chat-scroll {
  min-height: 0;
  overflow-y: auto;
  padding: 24px 16px;
}

.messages,
.empty-state {
  width: min(760px, 100%);
  margin: 0 auto;
}

.messages {
  display: grid;
  gap: 16px;
}

.message {
  display: grid;
  gap: 8px;
}

.message[data-role="user"] {
  justify-items: end;
}

.message-content {
  max-width: min(680px, 100%);
}

.message[data-role="user"] .message-content {
  max-width: min(620px, 88%);
  border-radius: 18px;
  background: #27272a;
  padding: 10px 14px;
}

.message-actions {
  display: flex;
  gap: 6px;
  color: #a1a1aa;
}

.composer {
  width: min(760px, calc(100% - 32px));
  margin: 0 auto 16px;
  display: flex;
  gap: 8px;
  align-items: end;
  border: 1px solid #3f3f46;
  border-radius: 18px;
  background: #18181b;
  padding: 8px;
}

.composer-input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
}

.composer-button {
  border: 1px solid #3f3f46;
  border-radius: 10px;
  background: #27272a;
  color: inherit;
  padding: 8px 10px;
}

.composer-submit {
  background: #2bf563;
  color: #101014;
  font-weight: 700;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { ChatProvider, Composer, Message, Thread } from "@anvia/react-ui";
import { useChat } from "@anvia/react";
import "@anvia/react-ui/styles.css";

export function StyledChat() {
  const chat = useChat({ endpoint: "/api/chat" });

  return (
    <ChatProvider controller={chat}>
      <Thread.Root className="grid min-h-screen grid-rows-[minmax(0,1fr)_auto] bg-zinc-950 text-zinc-100">
        <Thread.Viewport className="min-h-0 overflow-y-auto px-4 py-6">
          <Thread.Empty className="mx-auto w-full max-w-3xl">Start a conversation.</Thread.Empty>
          <Thread.Messages className="mx-auto grid w-full max-w-3xl gap-4">
            {(message) => (
              <Message.Root className="group/message grid gap-2 data-[role=user]:justify-items-end">
                <Message.Content className="max-w-[min(680px,100%)] group-data-[role=user]/message:max-w-[min(620px,88%)] group-data-[role=user]/message:rounded-[18px] group-data-[role=user]/message:bg-zinc-800 group-data-[role=user]/message:px-3.5 group-data-[role=user]/message:py-2.5">
                  <Message.Parts />
                </Message.Content>
                {message.role === "assistant" ? (
                  <Message.Actions className="flex gap-1.5 text-sm text-zinc-400">
                    <Message.Copy>Copy</Message.Copy>
                    <Message.Regenerate>Retry</Message.Regenerate>
                  </Message.Actions>
                ) : null}
              </Message.Root>
            )}
          </Thread.Messages>
          <Thread.ScrollToBottom className="fixed right-4 bottom-24 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm data-[state=bottom]:invisible">
            Latest
          </Thread.ScrollToBottom>
        </Thread.Viewport>

        <Composer.Root className="mx-auto mb-4 flex w-[min(760px,calc(100%-32px))] items-end gap-2 rounded-[18px] border border-zinc-700 bg-zinc-900 p-2">
          <Composer.Attachments className="flex flex-wrap gap-2" />
          <Composer.AddAttachment className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-2">Attach</Composer.AddAttachment>
          <Composer.Input className="min-w-0 flex-1 resize-none bg-transparent outline-none" placeholder="Ask..." maxRows={6} />
          <Composer.Stop className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-2">Stop</Composer.Stop>
          <Composer.Submit className="rounded-lg bg-[#2BF563] px-2.5 py-2 font-bold text-zinc-950">Send</Composer.Submit>
        </Composer.Root>
      </Thread.Root>
    </ChatProvider>
  );
}
`,
  },
];

export const toolReviewVariants: CodeVariant[] = [
  {
    label: "Component",
    language: "tsx",
    code: `
import { HumanInput, Message } from "@anvia/react-ui";

export function ToolMessageParts() {
  return (
    <Message.Parts>
      {(part) =>
        part.type === "tool" ? (
          <Message.Part>
            <Message.Tool className="tool-card" renderWhen="always">
              <header className="tool-card-header">
                <Message.ToolName />
                <Message.ToolStatus />
              </header>
              <Message.ToolInput />
              <Message.ToolOutput />
              <Message.ToolError />
            </Message.Tool>
          </Message.Part>
        ) : (
          <Message.Part />
        )
      }
    </Message.Parts>
  );
}

export function ReviewPanel() {
  return (
    <HumanInput.Panel className="review-panel">
      <HumanInput.Status />
      <HumanInput.Approvals className="approvals">
        {(approval) => (
          <HumanInput.Approval className="approval">
            <strong>{approval.toolName}</strong>
            {approval.args !== undefined ? <pre>{approval.args}</pre> : null}
            <HumanInput.ApprovalReason placeholder="Reason for the audit log..." />
            <div className="approval-actions">
              <HumanInput.Reject>Reject</HumanInput.Reject>
              <HumanInput.Approve>Approve</HumanInput.Approve>
            </div>
          </HumanInput.Approval>
        )}
      </HumanInput.Approvals>
      <HumanInput.Questions className="questions">
        <HumanInput.Question className="question">
          <HumanInput.QuestionPrompt />
          <HumanInput.QuestionSubmit>Submit answer</HumanInput.QuestionSubmit>
        </HumanInput.Question>
      </HumanInput.Questions>
    </HumanInput.Panel>
  );
}
`,
  },
  {
    label: "Vanilla CSS",
    language: "css",
    code: `
.tool-card,
.review-panel,
.approval,
.question {
  border: 1px solid #3f3f46;
  border-radius: 10px;
  background: #18181b;
  padding: 12px;
}

.tool-card,
.review-panel,
.approval,
.question {
  display: grid;
  gap: 10px;
}

.tool-card-header,
.approval-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
`,
  },
  {
    label: "Tailwind",
    language: "tsx",
    code: `
import { HumanInput, Message } from "@anvia/react-ui";

export function ToolMessageParts() {
  return (
    <Message.Parts>
      {(part) =>
        part.type === "tool" ? (
          <Message.Part>
            <Message.Tool className="grid gap-2.5 rounded-lg border border-zinc-700 bg-zinc-900 p-3" renderWhen="always">
              <header className="flex items-center justify-between gap-2.5">
                <Message.ToolName />
                <Message.ToolStatus />
              </header>
              <Message.ToolInput />
              <Message.ToolOutput />
              <Message.ToolError />
            </Message.Tool>
          </Message.Part>
        ) : (
          <Message.Part />
        )
      }
    </Message.Parts>
  );
}

export function ReviewPanel() {
  return (
    <HumanInput.Panel className="grid gap-2.5 rounded-lg border border-zinc-700 bg-zinc-900 p-3">
      <HumanInput.Status />
      <HumanInput.Approvals className="grid gap-2.5" />
      <HumanInput.Questions className="grid gap-2.5" />
    </HumanInput.Panel>
  );
}
`,
  },
];

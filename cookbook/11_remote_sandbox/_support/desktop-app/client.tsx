import { SandboxDesktop, type SandboxDesktopControl } from "@anvia/react-ui/sandbox-desktop";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

// The browser side of 02-desktop-app.ts: the live desktop on the left, the agent's task and a log of
// what it does on the right. Taking over from the desktop's own button pauses the agent.

type AppEvent =
  | { type: "sandbox"; state: "starting" | "ready" | "failed"; message?: string }
  | { type: "status"; state: "idle" | "running" }
  | { type: "reset" }
  | { type: "tool"; name: string; input?: unknown }
  | { type: "tool-error"; name: string; message: string }
  | { type: "text"; text: string }
  | { type: "answer"; text: string }
  | { type: "error"; message: string }
  | { type: "stopped" };

type LogEntry = Exclude<AppEvent, { type: "sandbox" | "status" | "reset" }>;

const colors = {
  text: "#1c1c1e",
  muted: "#6b6b70",
  border: "#d9d9de",
  panel: "#f6f6f8",
  error: "#b3261e",
  accent: "#2457d6",
};

function App() {
  const [task, setTask] = useState("");
  const [sandbox, setSandbox] = useState<"starting" | "ready" | "failed">("starting");
  const [sandboxMessage, setSandboxMessage] = useState<string>();
  const [agent, setAgent] = useState<"idle" | "running">("idle");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [control, setControl] = useState<SandboxDesktopControl>();
  const [problem, setProblem] = useState<string>();
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch("/api/config")
      .then((response) => response.json() as Promise<{ task: string }>)
      .then((config) => setTask((current) => current || config.task));
    const stream = new EventSource("/api/events");
    stream.onmessage = (message) => {
      const event = JSON.parse(message.data as string) as AppEvent;
      if (event.type === "sandbox") {
        setSandbox(event.state);
        setSandboxMessage(event.message);
      } else if (event.type === "status") setAgent(event.state);
      else if (event.type === "reset") setLog([]);
      else setLog((entries) => [...entries, event]);
    };
    return () => stream.close();
  }, []);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "end" });
  }, [log]);

  const post = async (path: string, body?: unknown) => {
    setProblem(undefined);
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
    });
    if (!response.ok)
      setProblem(((await response.json()) as { error?: string }).error ?? "Request failed.");
  };

  const youHaveControl = control?.you === true;
  return (
    <div style={page}>
      <header style={header}>
        <strong>Anvia desktop agent</strong>
        <span style={{ color: colors.muted }}>
          sandbox: {sandbox}
          {sandboxMessage === undefined ? "" : ` (${sandboxMessage})`} · agent: {agent}
        </span>
      </header>
      <div style={layout}>
        <section style={desktopPane}>
          {sandbox === "ready" ? (
            <SandboxDesktop
              url="/desktop"
              // Single use, so a function: every reconnect fetches a fresh ticket.
              ticket={async () =>
                (
                  (await (await fetch("/api/ticket", { method: "POST" })).json()) as {
                    ticket: string;
                  }
                ).ticket
              }
              onControlChange={setControl}
              style={{ background: "#111" }}
            />
          ) : (
            <p style={{ padding: 24, color: colors.muted }}>
              {sandbox === "failed"
                ? "The sandbox failed to start. See the server log."
                : "Starting the sandbox…"}
            </p>
          )}
        </section>
        <aside style={side}>
          {youHaveControl ? (
            <p style={banner}>
              You are in control. The agent's actions are paused until you release.
            </p>
          ) : null}
          <label style={{ fontWeight: 600 }} htmlFor="task">
            Task
          </label>
          <textarea
            id="task"
            value={task}
            onChange={(event) => setTask(event.target.value)}
            rows={4}
            style={textarea}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={sandbox !== "ready" || agent === "running"}
              onClick={() => void post("/api/run", { task })}
              style={primary}
            >
              Run
            </button>
            <button
              type="button"
              disabled={agent !== "running"}
              onClick={() => void post("/api/stop")}
            >
              Stop
            </button>
          </div>
          {problem === undefined ? null : (
            <p style={{ color: colors.error, margin: 0 }}>{problem}</p>
          )}
          <p style={{ color: colors.muted, margin: 0, fontSize: 13 }}>
            Use "Take over" on the desktop to drive it yourself while the agent runs. Its inputs
            fail while you hold control, and it should wait and carry on when you release.
          </p>
          <div style={logBox}>
            {log.length === 0 ? (
              <span style={{ color: colors.muted }}>The agent's actions appear here.</span>
            ) : null}
            {log.map((entry, index) => (
              <LogLine key={index} entry={entry} />
            ))}
            <div ref={logEnd} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  switch (entry.type) {
    case "tool":
      return (
        <div style={line}>
          <code>{entry.name.replace("desktop_", "")}</code>{" "}
          <span style={{ color: colors.muted }}>
            {entry.input === undefined ? "" : JSON.stringify(entry.input)}
          </span>
        </div>
      );
    case "tool-error":
      return (
        <div style={{ ...line, color: colors.error }}>
          ✗ {entry.name.replace("desktop_", "")}: {entry.message}
        </div>
      );
    case "text":
      return <div style={{ ...line, fontStyle: "italic" }}>{entry.text}</div>;
    case "answer":
      return <div style={answer}>{entry.text}</div>;
    case "error":
      return <div style={{ ...line, color: colors.error }}>Error: {entry.message}</div>;
    case "stopped":
      return <div style={{ ...line, color: colors.muted }}>Stopped.</div>;
  }
}

const page: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100vh",
  fontFamily: "system-ui, sans-serif",
  color: colors.text,
};
const header: CSSProperties = {
  display: "flex",
  gap: 16,
  alignItems: "baseline",
  padding: "10px 16px",
  borderBottom: `1px solid ${colors.border}`,
};
const layout: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 380px",
  flex: 1,
  minHeight: 0,
};
const desktopPane: CSSProperties = { minWidth: 0, minHeight: 0, background: "#111" };
const side: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 16,
  borderLeft: `1px solid ${colors.border}`,
  minHeight: 0,
  background: colors.panel,
};
const textarea: CSSProperties = {
  font: "inherit",
  padding: 8,
  borderRadius: 6,
  border: `1px solid ${colors.border}`,
  resize: "vertical",
};
const primary: CSSProperties = {
  background: colors.accent,
  color: "#fff",
  border: 0,
  borderRadius: 6,
  padding: "6px 16px",
  cursor: "pointer",
};
const logBox: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  background: "#fff",
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  padding: 10,
  fontSize: 13,
};
const line: CSSProperties = { padding: "2px 0", wordBreak: "break-word" };
const answer: CSSProperties = {
  margin: "8px 0",
  padding: 8,
  borderRadius: 6,
  background: "#e8f0fe",
  whiteSpace: "pre-wrap",
};
const banner: CSSProperties = {
  margin: 0,
  padding: 8,
  borderRadius: 6,
  background: "#fff4d6",
  border: "1px solid #e8c766",
};

createRoot(document.getElementById("root") as HTMLElement).render(<App />);

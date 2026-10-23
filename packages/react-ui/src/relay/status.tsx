import type { CSSProperties } from "react";

import type { RelayStatus } from "./connection";

const statusStyle: CSSProperties = {
  position: "absolute",
  top: 8,
  right: 8,
  padding: "2px 8px",
  borderRadius: 4,
  fontSize: 12,
  background: "rgba(0, 0, 0, 0.7)",
  color: "#fff",
};

export function DefaultStatus({ status, retry }: { status: RelayStatus; retry: () => void }) {
  if (status.state === "open") return null;
  return (
    <div role="status" data-relay-status={status.state} style={statusStyle}>
      {describe(status)}
      {status.state === "failed" ? (
        <>
          {" "}
          <button type="button" onClick={retry}>
            Retry
          </button>
        </>
      ) : null}
    </div>
  );
}

function describe(status: RelayStatus): string {
  switch (status.state) {
    case "loading":
    case "connecting":
      return "Connecting…";
    case "reconnecting":
      return `Reconnecting in ${Math.max(1, Math.round((status.retryInMs ?? 0) / 1_000))}s…`;
    case "ended":
      return status.exitCode === undefined
        ? "Session ended"
        : `Session ended (exit ${status.exitCode})`;
    case "failed":
      return status.message ?? "Disconnected";
    case "open":
      return "";
  }
}

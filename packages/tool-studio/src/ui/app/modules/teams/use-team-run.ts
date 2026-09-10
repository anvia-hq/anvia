import type { AgentInteractionResponse } from "@anvia/core/agent/interactions";
import { readJsonlStream } from "@anvia/client/transport";
import { useEffect, useReducer, useRef, useState } from "react";
import type { StudioTeamRunEvent } from "../../../../team-types";
import { responseErrorMessage } from "../../app-errors";
import { errorMessage } from "../shared/format";
import { requestJson } from "../shared/request";
import { initialTeamState, teamReducer, type TeamAction } from "./team-state";

type ActiveTeamRun = {
  controller: AbortController;
  base: string;
  runId: string | undefined;
  pending: Set<string>;
  epoch: number;
};

function cancelTeamRun(run: ActiveTeamRun | undefined) {
  if (!run || run.controller.signal.aborted) return;
  if (run.runId) {
    // Keep server cancellation independent of stream teardown, including page navigation.
    void fetch(`${run.base}/${encodeURIComponent(run.runId)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      keepalive: true,
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {
      // Teardown cannot wait for the server; disconnect remains the fallback on network failure.
    });
  }
  run.controller.abort();
}

export function useTeamRun(teamId: string) {
  const [state, dispatch] = useReducer(teamReducer, initialTeamState);
  const [controlError, setControlError] = useState("");
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const active = useRef<ActiveTeamRun | undefined>(undefined);
  const epoch = useRef(0);
  const base = `/teams/${encodeURIComponent(teamId)}/runs`;
  useEffect(
    () => () => {
      cancelTeamRun(active.current);
      active.current = undefined;
      epoch.current++;
    },
    [teamId],
  );

  async function start(prompt: string) {
    if (active.current) return;
    const run: ActiveTeamRun = {
      controller: new AbortController(),
      base,
      runId: undefined,
      pending: new Set(),
      epoch: ++epoch.current,
    };
    active.current = run;
    setBusy(new Set());
    setControlError("");
    dispatch({ type: "start", prompt });
    try {
      const response = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: run.controller.signal,
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response, "Start team"));
      if (!response.body) throw new Error("Team response has no stream");
      run.runId = response.headers.get("x-anvia-team-run-id") ?? undefined;
      for await (const event of readJsonlStream<StudioTeamRunEvent>(response.body)) {
        if (active.current !== run || run.controller.signal.aborted) break;
        if (event.type === "team_run_started") run.runId = event.runId;
        const terminal =
          event.type === "response" || event.type === "blocked" || event.type === "error";
        // Finish before rendering the result; closing the response body may still be pending.
        if (terminal) active.current = undefined;
        dispatch({ type: "event", event });
        if (terminal) return;
      }
      if (!run.controller.signal.aborted)
        throw new Error("Team stream ended before a result arrived");
    } catch (error) {
      if (active.current === run) {
        const action: TeamAction = { type: "stop" };
        if (!run.controller.signal.aborted) action.error = errorMessage(error);
        dispatch(action);
      }
    } finally {
      if (active.current === run) active.current = undefined;
    }
  }

  async function control(key: string, path: string, body: unknown, onSuccess: () => void) {
    const run = active.current;
    if (!run?.runId || run.pending.has(key)) return false;
    run.pending.add(key);
    setBusy(new Set(run.pending));
    setControlError("");
    try {
      await requestJson(
        `${base}/${encodeURIComponent(run.runId)}${path}`,
        "Update team",
        run.controller.signal,
        "default",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (epoch.current === run.epoch && !run.controller.signal.aborted) onSuccess();
      return true;
    } catch (error) {
      if (active.current === run && !run.controller.signal.aborted)
        setControlError(errorMessage(error));
      return false;
    } finally {
      run.pending.delete(key);
      if (epoch.current === run.epoch) setBusy(new Set(run.pending));
    }
  }

  function stop() {
    if (!active.current) return;
    cancelTeamRun(active.current);
    dispatch({ type: "stop" });
  }
  return {
    state,
    busy,
    controlError,
    start,
    stop,
    reset: () => {
      if (!active.current) {
        epoch.current++;
        dispatch({ type: "reset" });
        setControlError("");
      }
    },
    steer: (prompt: string) =>
      control("steer", "/steer", { prompt }, () => dispatch({ type: "prompt", prompt })),
    respond: (id: string, response: AgentInteractionResponse) =>
      control(id, `/interactions/${encodeURIComponent(id)}`, response, () =>
        dispatch({ type: "answered", id }),
      ),
  };
}

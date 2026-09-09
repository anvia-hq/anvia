import type { AgentInteractionResponse } from "@anvia/core/agent/interactions";
import { readJsonlStream } from "@anvia/client/transport";
import { useEffect, useReducer, useRef, useState } from "react";
import type { StudioTeamRunEvent } from "../../../../team-types";
import { responseErrorMessage } from "../../app-errors";
import { errorMessage } from "../shared/format";
import { requestJson } from "../shared/request";
import { initialTeamState, teamReducer } from "./team-state";

type ActiveTeamRun = {
  controller: AbortController;
  runId: string | undefined;
  pending: Set<string>;
  epoch: number;
};

export function useTeamRun(teamId: string) {
  const [state, dispatch] = useReducer(teamReducer, initialTeamState);
  const [controlError, setControlError] = useState("");
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const active = useRef<ActiveTeamRun | undefined>(undefined);
  const epoch = useRef(0);
  const base = `/teams/${encodeURIComponent(teamId)}/runs`;
  useEffect(
    () => () => {
      active.current?.controller.abort();
      active.current = undefined;
      epoch.current++;
    },
    [teamId],
  );

  async function start(prompt: string) {
    if (active.current) return;
    const run: ActiveTeamRun = {
      controller: new AbortController(),
      runId: undefined,
      pending: new Set(),
      epoch: ++epoch.current,
    };
    active.current = run;
    setBusy(new Set());
    setControlError("");
    dispatch({ type: "start", prompt });
    let terminal = false;
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
        terminal ||=
          event.type === "response" || event.type === "blocked" || event.type === "error";
        dispatch({ type: "event", event });
      }
      if (!terminal && !run.controller.signal.aborted)
        throw new Error("Team stream ended before a result arrived");
    } catch (error) {
      if (active.current === run)
        dispatch({
          type: "stop",
          ...(run.controller.signal.aborted ? {} : { error: errorMessage(error) }),
        });
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
    active.current?.controller.abort();
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

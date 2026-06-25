import { useCallback, useEffect, useRef, useState } from "react";
import type {
  StudioConfig,
  StudioPipelineDetail,
  StudioPipelineLogEntry,
  StudioPipelineRunRecord,
} from "../../../../types";
import { responseErrorMessage } from "../../app-errors";
import { isErrorStreamEvent, isPipelineFinalEvent, isPipelineLogEvent } from "../../app-helpers";
import { errorMessage } from "../shared/format";
import { nextPaint, readJsonl } from "../shared/transcript";
import type { RunState } from "../shared/types";

export function usePipelines(props: {
  active: boolean;
  enabled: boolean;
  pipelines: StudioConfig["pipelines"];
  onError: (message: string) => void;
  onStatus: (status: string) => void;
}) {
  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  const [pipelineDetail, setPipelineDetail] = useState<StudioPipelineDetail | undefined>();
  const [pipelineLogs, setPipelineLogs] = useState<StudioPipelineLogEntry[]>([]);
  const [pipelineRuns, setPipelineRuns] = useState<StudioPipelineRunRecord[]>([]);
  const [pipelineRunInput, setPipelineRunInput] = useState('"Hello from Studio"');
  const [pipelineRunOutput, setPipelineRunOutput] = useState("");
  const [activePipelineRunId, setActivePipelineRunId] = useState("");
  const [pipelineDetailLoadState, setPipelineDetailLoadState] = useState<"idle" | "loading">(
    "idle",
  );
  const [pipelineLogLoadState, setPipelineLogLoadState] = useState<"idle" | "loading">("idle");
  const [pipelineRunLoadState, setPipelineRunLoadState] = useState<"idle" | "loading">("idle");
  const [pipelineRunState, setPipelineRunState] = useState<RunState>("idle");
  const pipelineDetailRequestRef = useRef(0);
  const pipelineLogRequestRef = useRef(0);

  const loadPipelineLogs = useCallback(
    async (pipelineId: string): Promise<StudioPipelineLogEntry[]> => {
      if (!props.enabled || pipelineId.length === 0) {
        pipelineLogRequestRef.current += 1;
        setPipelineLogs([]);
        return [];
      }

      const requestId = pipelineLogRequestRef.current + 1;
      pipelineLogRequestRef.current = requestId;
      setPipelineLogLoadState("loading");
      try {
        const params = new URLSearchParams({ limit: "1000" });
        const response = await fetch(`/pipelines/${encodeURIComponent(pipelineId)}/logs?${params}`);
        if (!response.ok) {
          throw new Error(`Pipeline logs failed with HTTP ${response.status}`);
        }
        const body = (await response.json()) as { logs: StudioPipelineLogEntry[] };
        if (pipelineLogRequestRef.current === requestId) {
          setPipelineLogs(body.logs);
        }
        return body.logs;
      } catch (loadError) {
        if (pipelineLogRequestRef.current === requestId) {
          props.onError(errorMessage(loadError));
          setPipelineLogs([]);
        }
        return [];
      } finally {
        if (pipelineLogRequestRef.current === requestId) {
          setPipelineLogLoadState("idle");
        }
      }
    },
    [props.enabled, props.onError],
  );

  const loadPipelineRuns = useCallback(
    async (pipelineId: string): Promise<StudioPipelineRunRecord[]> => {
      if (!props.enabled || pipelineId.length === 0) {
        setPipelineRuns([]);
        return [];
      }

      setPipelineRunLoadState("loading");
      try {
        const params = new URLSearchParams({ limit: "50" });
        const response = await fetch(`/pipelines/${encodeURIComponent(pipelineId)}/runs?${params}`);
        if (!response.ok) {
          throw new Error(`Pipeline runs failed with HTTP ${response.status}`);
        }
        const body = (await response.json()) as { runs: StudioPipelineRunRecord[] };
        setPipelineRuns(body.runs);
        return body.runs;
      } catch (loadError) {
        props.onError(errorMessage(loadError));
        setPipelineRuns([]);
        return [];
      } finally {
        setPipelineRunLoadState("idle");
      }
    },
    [props.enabled, props.onError],
  );

  const loadPipeline = useCallback(
    async (pipelineId: string) => {
      if (!props.enabled || pipelineId.length === 0) {
        pipelineDetailRequestRef.current += 1;
        setPipelineDetail(undefined);
        setPipelineLogs([]);
        setPipelineRuns([]);
        return;
      }

      const requestId = pipelineDetailRequestRef.current + 1;
      pipelineDetailRequestRef.current = requestId;
      setPipelineDetailLoadState("loading");
      props.onError("");
      try {
        const response = await fetch(`/pipelines/${encodeURIComponent(pipelineId)}`);
        if (!response.ok) {
          throw new Error(`Pipeline load failed with HTTP ${response.status}`);
        }
        const detail = (await response.json()) as StudioPipelineDetail;
        if (pipelineDetailRequestRef.current !== requestId) {
          return;
        }
        setSelectedPipelineId(pipelineId);
        setPipelineDetail(detail);
        await Promise.all([loadPipelineLogs(pipelineId), loadPipelineRuns(pipelineId)]);
      } catch (loadError) {
        if (pipelineDetailRequestRef.current === requestId) {
          props.onError(errorMessage(loadError));
          setPipelineDetail(undefined);
        }
      } finally {
        if (pipelineDetailRequestRef.current === requestId) {
          setPipelineDetailLoadState("idle");
        }
      }
    },
    [loadPipelineLogs, loadPipelineRuns, props.enabled, props.onError],
  );

  useEffect(() => {
    if (!props.active) {
      return;
    }
    const pipelineId = selectedPipelineId || props.pipelines[0]?.id || "";
    if (pipelineId.length > 0) {
      void loadPipeline(pipelineId);
    }
  }, [props.active, props.pipelines, loadPipeline, selectedPipelineId]);

  async function consumePipelineRunStream(body: ReadableStream<Uint8Array>) {
    await readJsonl(body, async (event) => {
      if (isPipelineLogEvent(event)) {
        if (event.log.runId !== undefined) {
          setActivePipelineRunId((current) => current || event.log.runId || "");
        }
        appendPipelineLogEntry(event.log);
        await nextPaint();
        return;
      }
      if (isPipelineFinalEvent(event)) {
        setPipelineRunOutput(formatPipelineOutput(event.output));
        await nextPaint();
        return;
      }
      if (isErrorStreamEvent(event)) {
        throw new Error(JSON.stringify(event.error));
      }
    });
  }

  async function runPipeline() {
    const pipelineId = selectedPipelineId || props.pipelines[0]?.id || "";
    if (pipelineId.length === 0 || pipelineRunState === "running") {
      return;
    }

    let input: unknown;
    try {
      input = JSON.parse(pipelineRunInput);
    } catch {
      props.onError("Pipeline input must be valid JSON");
      return;
    }

    setPipelineRunState("running");
    setPipelineRunOutput("");
    setActivePipelineRunId("");
    props.onError("");
    try {
      const response = await fetch(`/pipelines/${encodeURIComponent(pipelineId)}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input,
          stream: true,
          metadata: { source: "anvia-studio" },
        }),
      });

      if (!response.ok || response.body === null) {
        throw new Error(await responseErrorMessage(response, "Pipeline run failed"));
      }

      await consumePipelineRunStream(response.body);
      await Promise.all([loadPipelineLogs(pipelineId), loadPipelineRuns(pipelineId)]);
      props.onStatus("Connected");
    } catch (runError) {
      props.onError(errorMessage(runError));
    } finally {
      setPipelineRunState("idle");
    }
  }

  async function replayPipelineRun(runId: string) {
    const pipelineId = selectedPipelineId || props.pipelines[0]?.id || "";
    if (pipelineId.length === 0 || runId.length === 0 || pipelineRunState === "running") {
      return;
    }

    setPipelineRunState("running");
    setPipelineRunOutput("");
    setActivePipelineRunId("");
    props.onError("");
    try {
      const response = await fetch(
        `/pipelines/${encodeURIComponent(pipelineId)}/runs/${encodeURIComponent(runId)}/replay`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            stream: true,
            metadata: { source: "anvia-studio" },
          }),
        },
      );

      if (!response.ok || response.body === null) {
        throw new Error(await responseErrorMessage(response, "Pipeline replay failed"));
      }

      await consumePipelineRunStream(response.body);
      await Promise.all([loadPipelineLogs(pipelineId), loadPipelineRuns(pipelineId)]);
      props.onStatus("Connected");
    } catch (runError) {
      props.onError(errorMessage(runError));
    } finally {
      setPipelineRunState("idle");
    }
  }

  function selectPipeline(pipelineId: string) {
    setSelectedPipelineId(pipelineId);
    setPipelineRunOutput("");
    setActivePipelineRunId("");
    void loadPipeline(pipelineId);
  }

  function appendPipelineLogEntry(log: StudioPipelineLogEntry) {
    setPipelineLogs((current) => {
      if (current.some((item) => item.id === log.id)) {
        return current;
      }
      return [...current, log].sort((left, right) => left.sequence - right.sequence);
    });
  }

  return {
    selectedPipelineId,
    pipelineDetail,
    pipelineLogs,
    pipelineRuns,
    activePipelineRunId,
    pipelineRunInput,
    pipelineRunOutput,
    pipelineDetailLoadState,
    pipelineLogLoadState,
    pipelineRunLoadState,
    pipelineRunState,
    setPipelineRunInput,
    selectPipeline,
    runPipeline,
    replayPipelineRun,
  };
}

function formatPipelineOutput(output: unknown): string {
  return typeof output === "string" ? output : JSON.stringify(output, null, 2);
}

import { useEffect, useState } from "react";
import type { StudioAgentModelsSummary, StudioModelSummary } from "../../../../types";
import { modelRefAvailable } from "../../app-helpers";
import { errorMessage } from "../shared/format";

export function useAgentModels(props: {
  enabled: boolean;
  selectedAgentId: string | undefined;
  onError: (message: string) => void;
}): {
  selectedAgentModels: StudioModelSummary[];
  selectedModelRef: string;
  setSelectedModelRef: (modelRef: string) => void;
} {
  const { enabled, onError, selectedAgentId } = props;
  const [agentModels, setAgentModels] = useState<StudioAgentModelsSummary | undefined>();
  const [selectedModelRef, setSelectedModelRef] = useState("");

  useEffect(() => {
    if (!enabled || selectedAgentId === undefined) {
      setAgentModels(undefined);
      setSelectedModelRef("");
      return;
    }

    const agentId = selectedAgentId;
    let cancelled = false;
    async function loadAgentModels() {
      try {
        const response = await fetch(`/agents/${encodeURIComponent(agentId)}/models`);
        if (!response.ok) {
          throw new Error(`Agent models failed with HTTP ${response.status}`);
        }
        const body = (await response.json()) as StudioAgentModelsSummary;
        if (cancelled) {
          return;
        }
        setAgentModels(body);
        setSelectedModelRef((current) =>
          modelRefAvailable(body.models, current)
            ? current
            : (body.defaultModel ?? body.models[0]?.ref ?? ""),
        );
      } catch (loadError) {
        if (!cancelled) {
          setAgentModels(undefined);
          setSelectedModelRef("");
          onError(errorMessage(loadError));
        }
      }
    }

    void loadAgentModels();
    return () => {
      cancelled = true;
    };
  }, [enabled, onError, selectedAgentId]);

  return {
    selectedAgentModels:
      agentModels !== undefined && agentModels.agentId === selectedAgentId
        ? agentModels.models
        : [],
    selectedModelRef,
    setSelectedModelRef,
  };
}

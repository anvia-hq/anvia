import { useCallback, useEffect, useState } from "react";
import type {
  StudioAgentMcpsSummary,
  StudioAgentToolsSummary,
  StudioConfig,
  StudioKnowledgeSummary,
} from "../../../../types";
import { KnowledgePage, McpsPage, ToolsPage } from "../../app-pages";
import { errorMessage } from "../shared/format";
import type { KnowledgeTab } from "../shared/types";

export function ToolsContainer(props: {
  active: boolean;
  agents: StudioConfig["agents"];
  enabled: boolean;
  selectedAgentId: string;
  onError: (message: string) => void;
}) {
  const [toolsAgentId, setToolsAgentId] = useState("");
  const [tools, setTools] = useState<StudioAgentToolsSummary | undefined>();
  const [toolsLoadState, setToolsLoadState] = useState<"idle" | "loading">("idle");

  const loadTools = useCallback(
    async (agentId: string) => {
      if (!props.enabled || agentId.length === 0) {
        setTools(undefined);
        return;
      }

      setToolsLoadState("loading");
      try {
        const response = await fetch(`/agents/${encodeURIComponent(agentId)}/tools`);
        if (!response.ok) {
          throw new Error(`Tools failed with HTTP ${response.status}`);
        }
        setTools((await response.json()) as StudioAgentToolsSummary);
      } catch (loadError) {
        props.onError(errorMessage(loadError));
        setTools(undefined);
      } finally {
        setToolsLoadState("idle");
      }
    },
    [props.enabled, props.onError],
  );

  useEffect(() => {
    if (props.active) {
      void loadTools(toolsAgentId || props.selectedAgentId);
    }
  }, [props.active, loadTools, props.selectedAgentId, toolsAgentId]);

  return (
    <ToolsPage
      agents={props.agents}
      selectedAgentId={toolsAgentId || props.selectedAgentId}
      summary={tools}
      enabled={props.enabled}
      loading={toolsLoadState === "loading"}
      onSelectAgent={(agentId) => {
        setToolsAgentId(agentId);
        void loadTools(agentId);
      }}
    />
  );
}

export function McpsContainer(props: {
  active: boolean;
  agents: StudioConfig["agents"];
  enabled: boolean;
  selectedAgentId: string;
  onError: (message: string) => void;
}) {
  const [mcpsAgentId, setMcpsAgentId] = useState("");
  const [mcps, setMcps] = useState<StudioAgentMcpsSummary | undefined>();
  const [mcpsLoadState, setMcpsLoadState] = useState<"idle" | "loading">("idle");

  const loadMcps = useCallback(
    async (agentId: string) => {
      if (!props.enabled || agentId.length === 0) {
        setMcps(undefined);
        return;
      }

      setMcpsLoadState("loading");
      try {
        const response = await fetch(`/agents/${encodeURIComponent(agentId)}/mcps`);
        if (!response.ok) {
          throw new Error(`MCPs failed with HTTP ${response.status}`);
        }
        setMcps((await response.json()) as StudioAgentMcpsSummary);
      } catch (loadError) {
        props.onError(errorMessage(loadError));
        setMcps(undefined);
      } finally {
        setMcpsLoadState("idle");
      }
    },
    [props.enabled, props.onError],
  );

  useEffect(() => {
    if (props.active) {
      void loadMcps(mcpsAgentId || props.selectedAgentId);
    }
  }, [props.active, loadMcps, mcpsAgentId, props.selectedAgentId]);

  return (
    <McpsPage
      agents={props.agents}
      selectedAgentId={mcpsAgentId || props.selectedAgentId}
      summary={mcps}
      enabled={props.enabled}
      loading={mcpsLoadState === "loading"}
      onSelectAgent={(agentId) => {
        setMcpsAgentId(agentId);
        void loadMcps(agentId);
      }}
    />
  );
}

export function KnowledgeContainer(props: {
  active: boolean;
  activeTab: KnowledgeTab;
  enabled: boolean;
  onError: (message: string) => void;
  onOpenTrace: (traceId: string) => void;
}) {
  const [knowledge, setKnowledge] = useState<StudioKnowledgeSummary | undefined>();
  const [knowledgeLoadState, setKnowledgeLoadState] = useState<"idle" | "loading">("idle");

  const loadKnowledge = useCallback(async () => {
    if (!props.enabled) {
      setKnowledge(undefined);
      return;
    }

    setKnowledgeLoadState("loading");
    try {
      const response = await fetch("/knowledge?limit=25");
      if (!response.ok) {
        throw new Error(`Knowledge failed with HTTP ${response.status}`);
      }
      setKnowledge((await response.json()) as StudioKnowledgeSummary);
    } catch (loadError) {
      props.onError(errorMessage(loadError));
    } finally {
      setKnowledgeLoadState("idle");
    }
  }, [props.enabled, props.onError]);

  useEffect(() => {
    if (props.active) {
      void loadKnowledge();
    }
  }, [props.active, loadKnowledge]);

  return (
    <KnowledgePage
      activeTab={props.activeTab}
      enabled={props.enabled}
      summary={knowledge}
      loading={knowledgeLoadState === "loading"}
      onOpenTrace={props.onOpenTrace}
      onRefresh={() => void loadKnowledge()}
    />
  );
}

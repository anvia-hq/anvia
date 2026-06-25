import type { StudioConfig } from "../../../../types";
import { PipelinesPage } from "../../app-pages";
import type { StudioTheme } from "../../app-theme";
import type { PipelineSidebarTab } from "./pipelines-page";
import { usePipelines } from "./use-pipelines";

export function PipelinesContainer(props: {
  active: boolean;
  enabled: boolean;
  pipelines: StudioConfig["pipelines"];
  theme: StudioTheme;
  activeTab: PipelineSidebarTab;
  onError: (message: string) => void;
  onStatus: (status: string) => void;
  onTabChange: (tab: PipelineSidebarTab) => void;
}) {
  const pipelines = usePipelines({
    active: props.active,
    enabled: props.enabled,
    pipelines: props.pipelines,
    onError: props.onError,
    onStatus: props.onStatus,
  });

  return (
    <PipelinesPage
      pipelines={props.pipelines}
      selectedPipelineId={pipelines.selectedPipelineId}
      detail={pipelines.pipelineDetail}
      logs={pipelines.pipelineLogs}
      activeRunId={pipelines.activePipelineRunId}
      runs={pipelines.pipelineRuns}
      enabled={props.enabled}
      detailLoading={pipelines.pipelineDetailLoadState === "loading"}
      logsLoading={pipelines.pipelineLogLoadState === "loading"}
      runsLoading={pipelines.pipelineRunLoadState === "loading"}
      runState={pipelines.pipelineRunState}
      runInput={pipelines.pipelineRunInput}
      runOutput={pipelines.pipelineRunOutput}
      theme={props.theme}
      activeTab={props.activeTab}
      onSelectPipeline={pipelines.selectPipeline}
      onRunInputChange={pipelines.setPipelineRunInput}
      onRun={() => void pipelines.runPipeline()}
      onTabChange={props.onTabChange}
      onReplayRun={(runId) => void pipelines.replayPipelineRun(runId)}
    />
  );
}

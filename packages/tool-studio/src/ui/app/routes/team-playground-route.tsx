import { useNavigate, useParams } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PlaygroundTargetSelect } from "../modules/playground/playground-target-select";
import { useActivatedRoute } from "./route-helpers";

const TeamPlayground = lazy(() =>
  import("../modules/teams/team-playground").then((module) => ({ default: module.TeamPlayground })),
);

export function TeamPlaygroundRoute() {
  const studio = useActivatedRoute("playground");
  const { teamId } = useParams({ strict: false });
  const navigate = useNavigate();
  const team = studio.teams?.find((item) => item.id === teamId);
  if (!team)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {studio.teams === undefined ? "Loading team…" : "This team is not registered in Studio."}
      </p>
    );
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading team…</p>}>
      <TeamPlayground
        key={team.id}
        team={team}
        targetSelector={(running) => (
          <PlaygroundTargetSelect
            agents={studio.agents}
            teams={studio.teams ?? []}
            value={`team:${team.id}`}
            disabled={running}
            onSelect={(kind, id) => {
              if (kind === "team")
                void navigate({ to: "/playground/teams/$teamId", params: { teamId: id } });
              else {
                studio.selectPlaygroundAgent(id);
                void navigate({ to: "/playground" });
              }
            }}
          />
        )}
      />
    </Suspense>
  );
}

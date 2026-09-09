import type { StudioConfig } from "../../../../types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";

export function PlaygroundTargetSelect(props: {
  agents: StudioConfig["agents"];
  teams: NonNullable<StudioConfig["teams"]>;
  value: string;
  disabled: boolean;
  onSelect: (kind: "agent" | "team", id: string) => void;
}) {
  return (
    <Select
      value={props.value}
      disabled={props.disabled}
      onValueChange={(value) => {
        const separator = value.indexOf(":");
        props.onSelect(
          value.slice(0, separator) === "team" ? "team" : "agent",
          value.slice(separator + 1),
        );
      }}
    >
      <SelectTrigger
        aria-label="Select agent or team"
        className="h-8 w-auto min-w-32 max-w-64 text-sm"
      >
        <SelectValue placeholder="Agent or team" />
      </SelectTrigger>
      <SelectContent>
        {props.agents.map((agent) => (
          <SelectItem key={`agent:${agent.id}`} value={`agent:${agent.id}`}>
            {agent.name ?? agent.id}
          </SelectItem>
        ))}
        {props.teams.map((team) => (
          <SelectItem key={`team:${team.id}`} value={`team:${team.id}`}>
            {team.id} · Team
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

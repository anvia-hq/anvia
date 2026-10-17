// Model SDKs may retain connection pools or timers after an agent module is imported.
setInterval(() => {}, 60_000);
export { default } from "../../examples/sample-agent.mjs";

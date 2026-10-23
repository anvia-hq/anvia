export { SandboxDesktop } from "./desktop";
export type {
  SandboxDesktopControlsState,
  SandboxDesktopHandle,
  SandboxDesktopNotice,
  SandboxDesktopProps,
} from "./desktop";
export type { SandboxDesktopControl } from "./connection";
export { desktopSubprotocol } from "./connection";
export type {
  RelayReconnectOptions as SandboxDesktopReconnectOptions,
  RelayState as SandboxDesktopState,
  RelayStatus as SandboxDesktopStatus,
} from "../relay/connection";
export { ticketSubprotocolPrefix } from "../relay/connection";

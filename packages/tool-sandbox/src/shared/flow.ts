/**
 * Flow-control bounds for one tunnel, which both ends of it must agree on. A window can carry at
 * most its own size per round trip, so a tunnel that moves a lot over a slow link needs a bigger one
 * than a terminal does.
 */
export interface FlowProfile {
  /** Coalescing window for the service's output, in ms. */
  batchMs: number;
  /** Largest `tunnel.data` frame, in raw bytes. */
  frameBytes: number;
  /** Unacked plus unsent output above which the service is paused. */
  highWaterBytes: number;
  /** Socket send buffer above which no more output is queued. */
  socketBufferBytes: number;
  /** The reader acknowledges output in steps of this many bytes (and whenever it runs dry). */
  ackStepBytes: number;
  /** Bytes the hub may have in flight toward the service before its writes wait. */
  writeWindowBytes: number;
}

/**
 * For a tunnel a person is watching and driving, such as a desktop's VNC stream: frames go out as
 * soon as they exist, and the window is large enough to keep a long link busy (2 MiB over 100 ms is
 * about 20 MB/s, where the default 256 KiB allows 2.6).
 */
export const interactiveFlow: FlowProfile = {
  batchMs: 0,
  frameBytes: 64 * 1024,
  highWaterBytes: 2 * 1024 * 1024,
  socketBufferBytes: 4 * 1024 * 1024,
  ackStepBytes: 128 * 1024,
  writeWindowBytes: 1024 * 1024,
};

/** The profiles a hub may ask for in `tunnel.open`. */
export const flowProfiles = { interactive: interactiveFlow } as const;
export type FlowProfileName = keyof typeof flowProfiles;

/** The profile for a name from the wire, or undefined for one this version does not know. */
export function flowProfile(name: string | undefined): FlowProfile | undefined {
  return name !== undefined && Object.hasOwn(flowProfiles, name)
    ? flowProfiles[name as FlowProfileName]
    : undefined;
}

# @anvia/browser

## 1.0.12

### Patch Changes

- Updated dependencies [2277090]
  - @anvia/core@1.0.10
  - @anvia/sandbox@1.0.10

## 1.0.11

### Patch Changes

- ba5a6ac: Isolate automation-worker IPC from Node watch dependency messages and preserve bounded protocol and readiness failure diagnostics.

## 1.0.10

### Patch Changes

- 5482e40: Add supervised Playwright process isolation, capability readiness, bounded lifecycle cancellation,
  per-tab concurrent tool scheduling, explicit tab targeting, race-safe human control, and structured
  recovery errors while preserving serial selected-tab compatibility.

  This patch hardens the existing browser runtime while preserving the default serial selected-tab
  workflow. Consumers with structural `BrowserControlSnapshot` test doubles should add the documented
  arbitration and availability fields.

## 1.0.9

### Patch Changes

- Updated dependencies [68953da]
  - @anvia/core@1.0.9
  - @anvia/sandbox@1.0.9

## 1.0.8

### Patch Changes

- Updated dependencies [18344a2]
  - @anvia/core@1.0.8
  - @anvia/sandbox@1.0.8

## 1.0.7

### Patch Changes

- Updated dependencies [9e5e068]
  - @anvia/core@1.0.7
  - @anvia/sandbox@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [32cffc0]
  - @anvia/core@1.0.6
  - @anvia/sandbox@1.0.6

## 1.0.5

### Patch Changes

- Updated dependencies [c7fb0f8]
  - @anvia/core@1.0.5
  - @anvia/sandbox@1.0.5

## 1.0.4

### Patch Changes

- Updated dependencies [7973ddc]
  - @anvia/core@1.0.4
  - @anvia/sandbox@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [3113e9a]
  - @anvia/core@1.0.3
  - @anvia/sandbox@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [c7c45a9]
  - @anvia/core@1.0.2
  - @anvia/sandbox@1.0.2

## 1.0.1

### Patch Changes

- f29f2f6: Refresh upstream SDK and runtime dependencies to their latest supported releases.
  - @anvia/core@1.0.1
  - @anvia/sandbox@1.0.1

## 1.0.0

### Patch Changes

- f0ffa43: Add the explicit Docker-backed Chromium browser runtime, semantic browser tools, noVNC desktop,
  Studio's clean resizable Playground viewer, and a human-control lease. Add the shared-memory and seccomp
  options required to keep Chromium's process sandbox enabled, including explicit capability additions
  for its namespace sandbox.
- Updated dependencies [f0ffa43]
- Updated dependencies [4564d2f]
- Updated dependencies [9ae0893]
- Updated dependencies [07a1e6c]
- Updated dependencies [0292ede]
- Updated dependencies [007b132]
- Updated dependencies [c0c6cb8]
- Updated dependencies [a90416c]
- Updated dependencies [1dfb4f3]
- Updated dependencies [07a1e6c]
- Updated dependencies [8dc2dfb]
- Updated dependencies [6354116]
- Updated dependencies [475ae22]
- Updated dependencies [c7f4bbc]
- Updated dependencies [45882ab]
- Updated dependencies [eaecb75]
- Updated dependencies [9cb661c]
- Updated dependencies [1f6db5c]
- Updated dependencies [5ec61e3]
- Updated dependencies [5476f98]
- Updated dependencies [45882ab]
- Updated dependencies [640dd3c]
- Updated dependencies [593c725]
- Updated dependencies [a4bf9d2]
- Updated dependencies [3d2fd23]
- Updated dependencies [927f81b]
- Updated dependencies [0292ede]
- Updated dependencies [4ab25bb]
- Updated dependencies [809d3b0]
- Updated dependencies [b363c93]
  - @anvia/sandbox@1.0.0
  - @anvia/core@1.0.0

## 1.0.0-rc.11

### Patch Changes

- Updated dependencies [995add8]
- Updated dependencies [9e6df68]
  - @anvia/core@1.0.0-rc.11
  - @anvia/sandbox@1.0.0-rc.11

## 1.0.0-rc.10

### Patch Changes

- Updated dependencies [ef7ad39]
- Updated dependencies [9b9fe04]
  - @anvia/core@1.0.0-rc.10
  - @anvia/sandbox@1.0.0-rc.10

## 1.0.0-rc.9

### Patch Changes

- Updated dependencies [c0c6cb8]
  - @anvia/core@1.0.0-rc.9
  - @anvia/sandbox@1.0.0-rc.9

## 1.0.0-rc.8

### Patch Changes

- Updated dependencies [8dc2dfb]
  - @anvia/core@1.0.0-rc.8
  - @anvia/sandbox@1.0.0-rc.8

## 1.0.0-rc.7

### Patch Changes

- Updated dependencies [6341fd8]
  - @anvia/core@1.0.0-rc.7
  - @anvia/sandbox@1.0.0-rc.7

## 1.0.0-rc.6

### Patch Changes

- Updated dependencies [706b321]
  - @anvia/core@1.0.0-rc.6
  - @anvia/sandbox@1.0.0-rc.6

## 1.0.0-rc.5

### Patch Changes

- Updated dependencies [e96d038]
- Updated dependencies [e96d038]
  - @anvia/core@1.0.0-rc.5
  - @anvia/sandbox@1.0.0-rc.5

## 1.0.0-rc.4

### Patch Changes

- Updated dependencies [007b132]
  - @anvia/core@1.0.0-rc.4
  - @anvia/sandbox@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- f0ffa43: Add the explicit Docker-backed Chromium browser runtime, semantic browser tools, noVNC desktop,
  Studio's clean resizable Playground viewer, and a human-control lease. Add the shared-memory and seccomp
  options required to keep Chromium's process sandbox enabled, including explicit capability additions
  for its namespace sandbox.
- Updated dependencies [f0ffa43]
- Updated dependencies [475ae22]
- Updated dependencies [eaecb75]
- Updated dependencies [9cb661c]
- Updated dependencies [5ec61e3]
  - @anvia/sandbox@1.0.0-rc.3
  - @anvia/core@1.0.0-rc.3

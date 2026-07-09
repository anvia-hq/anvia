# @anvia/sandbox

## 0.3.6

### Patch Changes

- 25388db: Publish the widened `@anvia/core` peer dependency range so current 0.x core releases satisfy the sandbox peer requirement.

## 0.3.5

### Patch Changes

- 94362c9: Move @anvia/core to peer dependencies for packages that expose or consume core types, preventing duplicate private-type incompatibilities in consumer apps.

## 0.3.4

### Patch Changes

- Updated dependencies [ef5e727]
  - @anvia/core@0.7.0

## 0.3.3

### Patch Changes

- Updated dependencies [369b6c4]
  - @anvia/core@0.6.3

## 0.3.2

### Patch Changes

- Updated dependencies [4806f3e]
  - @anvia/core@0.6.2

## 0.3.1

### Patch Changes

- 3572881: Flatten package folders to the top-level `packages/*` workspace layout. This only updates repository layout metadata and does not change package behavior.

## 0.3.0

### Minor Changes

- 18403b7: Add sandbox V2 controls for persistent workspaces, lifecycle cleanup, streaming command execution, file-size limits, observability hooks, language presets, and model-facing tool policies.

## 0.2.2

### Patch Changes

- Updated dependencies [2d039f6]
  - @anvia/core@0.6.1

## 0.2.1

### Patch Changes

- Updated dependencies [e54aece]
  - @anvia/core@0.6.0

## 0.2.0

### Minor Changes

- 74797ba: Add a Docker-backed sandbox package for ephemeral agent workspaces.

import { describe, expect, expectTypeOf, it } from "vitest";
import { DockerSandboxClient } from "../src/docker-sandbox";
import type {
  DockerSandbox,
  DockerSandboxExecOptions,
  DockerSandboxExecResult,
  DockerSandboxExecStreamEvent,
  DockerSandboxFileEntry,
  DockerSandboxFileType,
  DockerSandboxListFilesOptions,
  DockerSandboxListProcessesOptions,
  DockerSandboxProcessInfo,
  DockerSandboxProcessLogs,
  DockerSandboxProcessStartOptions,
  DockerSandboxProcessStatus,
  DockerSandboxPublishedPort,
  DockerSandboxReadFileOptions,
  DockerSandboxReadProcessLogsOptions,
  DockerSandboxReadTextFilePageOptions,
  DockerSandboxResources,
  DockerSandboxRuntime,
  DockerSandboxRuntimeLimits,
  DockerSandboxState,
  DockerSandboxStopProcessOptions,
  DockerSandboxTextFilePage,
  DockerSandboxWaitForPortOptions,
  DockerSandboxWriteFileOptions,
  DockerSandboxWriteTextFileOptions,
} from "../src/types";
import type {
  SandboxExecOptions,
  SandboxExecResult,
  SandboxExecStreamEvent,
  SandboxFileEntry,
  SandboxFileType,
  SandboxListFilesOptions,
  SandboxListProcessesOptions,
  SandboxProcessInfo,
  SandboxProcessLogs,
  SandboxProcessStartOptions,
  SandboxProcessStatus,
  SandboxPublishedPort,
  SandboxReadFileOptions,
  SandboxReadProcessLogsOptions,
  SandboxReadTextFilePageOptions,
  SandboxResources,
  SandboxRuntime,
  SandboxRuntimeLimits,
  SandboxState,
  SandboxStopProcessOptions,
  SandboxTextFilePage,
  SandboxWaitForPortOptions,
  SandboxWriteFileOptions,
  SandboxWriteTextFileOptions,
} from "../src/engine/types";

describe("engine types", () => {
  it("DockerSandboxRuntime is assignable to SandboxRuntime", () => {
    expectTypeOf<DockerSandboxRuntime>().toMatchTypeOf<SandboxRuntime>();
    expectTypeOf<SandboxRuntime["provider"]>().toEqualTypeOf<string>();
    expect(true).toBe(true);
  });

  it("Docker aliases are structurally identical to engine types", () => {
    expectTypeOf<DockerSandboxExecOptions>().toEqualTypeOf<SandboxExecOptions>();
    expectTypeOf<DockerSandboxExecResult>().toEqualTypeOf<SandboxExecResult>();
    expectTypeOf<DockerSandboxExecStreamEvent>().toEqualTypeOf<SandboxExecStreamEvent>();
    expectTypeOf<DockerSandboxReadFileOptions>().toEqualTypeOf<SandboxReadFileOptions>();
    expectTypeOf<DockerSandboxReadTextFilePageOptions>().toEqualTypeOf<SandboxReadTextFilePageOptions>();
    expectTypeOf<DockerSandboxTextFilePage>().toEqualTypeOf<SandboxTextFilePage>();
    expectTypeOf<DockerSandboxWriteFileOptions>().toEqualTypeOf<SandboxWriteFileOptions>();
    expectTypeOf<DockerSandboxWriteTextFileOptions>().toEqualTypeOf<SandboxWriteTextFileOptions>();
    expectTypeOf<DockerSandboxListFilesOptions>().toEqualTypeOf<SandboxListFilesOptions>();
    expectTypeOf<DockerSandboxFileEntry>().toEqualTypeOf<SandboxFileEntry>();
    expectTypeOf<DockerSandboxFileType>().toEqualTypeOf<SandboxFileType>();
    expectTypeOf<DockerSandboxProcessStartOptions>().toEqualTypeOf<SandboxProcessStartOptions>();
    expectTypeOf<DockerSandboxProcessInfo>().toEqualTypeOf<SandboxProcessInfo>();
    expectTypeOf<DockerSandboxProcessStatus>().toEqualTypeOf<SandboxProcessStatus>();
    expectTypeOf<DockerSandboxListProcessesOptions>().toEqualTypeOf<SandboxListProcessesOptions>();
    expectTypeOf<DockerSandboxReadProcessLogsOptions>().toEqualTypeOf<SandboxReadProcessLogsOptions>();
    expectTypeOf<DockerSandboxProcessLogs>().toEqualTypeOf<SandboxProcessLogs>();
    expectTypeOf<DockerSandboxStopProcessOptions>().toEqualTypeOf<SandboxStopProcessOptions>();
    expectTypeOf<DockerSandboxWaitForPortOptions>().toEqualTypeOf<SandboxWaitForPortOptions>();
    expectTypeOf<DockerSandboxPublishedPort>().toEqualTypeOf<SandboxPublishedPort>();
    expectTypeOf<DockerSandboxState>().toEqualTypeOf<SandboxState>();
    expectTypeOf<DockerSandboxResources>().toEqualTypeOf<SandboxResources>();
    expectTypeOf<DockerSandboxRuntimeLimits>().toEqualTypeOf<SandboxRuntimeLimits>();
    expectTypeOf<DockerSandboxRuntime["provider"]>().toEqualTypeOf<"docker">();
    expect(true).toBe(true);
  });

  it("root public names still resolve", () => {
    expectTypeOf<DockerSandbox>().not.toBeNever();
    expectTypeOf<DockerSandboxClient>().not.toBeNever();
    expectTypeOf<DockerSandboxRuntime>().not.toBeNever();
    expect(true).toBe(true);
  });
});

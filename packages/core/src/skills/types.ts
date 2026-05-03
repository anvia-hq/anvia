import type { AnyTool } from "../tool";

export type Skill = {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly directory: string;
  readonly references: string[];
  readonly scripts: string[];
  readonly license?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
};

export type SkillLoader = {
  load(): Promise<Skill[]>;
};

export type SkillSet = {
  readonly skills: Skill[];
  readonly tools: AnyTool[];
  readonly instructions: string;
};

export type SkillValidationIssue = {
  path: string;
  message: string;
};

export class SkillValidationError extends Error {
  readonly issues: SkillValidationIssue[];

  constructor(message: string, issues: SkillValidationIssue[]) {
    super(message);
    this.name = "SkillValidationError";
    this.issues = issues;
  }
}

import type { UIMessagePart } from "@anvia/client";
import type { ComposerEntity } from "./contexts/composer";
import { isComposerEntityData } from "./strict-json";

export type MessageTextSegment = {
  part: Extract<UIMessagePart, { type: "text" }>;
  from: number;
  to: number;
};

export type MessageTextLayout = {
  text: string;
  segments: MessageTextSegment[];
};

export function messageTextLayout(parts: readonly UIMessagePart[]): MessageTextLayout {
  const textParts = parts.filter(
    (part): part is Extract<UIMessagePart, { type: "text" }> => part.type === "text",
  );
  const segments: MessageTextSegment[] = [];
  let offset = 0;

  for (const [index, part] of textParts.entries()) {
    const from = offset;
    const to = from + part.text.length;
    segments.push({ part, from, to });
    offset = to + (index === textParts.length - 1 ? 0 : 2);
  }

  return {
    text: textParts.map((part) => part.text).join("\n\n"),
    segments,
  };
}

export function validComposerEntities(text: string, metadata: unknown): ComposerEntity[] {
  const candidates = composerEntityCandidates(metadata);
  const individuallyValid = candidates.flatMap((candidate, index) => {
    const entity = parseComposerEntity(candidate, text);
    return entity === undefined ? [] : [{ entity, index }];
  });
  individuallyValid.sort(
    (left, right) =>
      left.entity.range.from - right.entity.range.from ||
      left.entity.range.to - right.entity.range.to ||
      left.index - right.index,
  );

  const overlapping = new Set<number>();
  let groupStart = 0;
  let groupEnd = individuallyValid[0]?.entity.range.to ?? 0;
  let groupHasOverlap = false;
  for (let index = 1; index <= individuallyValid.length; index += 1) {
    const current = individuallyValid[index];
    if (current !== undefined && current.entity.range.from < groupEnd) {
      groupHasOverlap = true;
      groupEnd = Math.max(groupEnd, current.entity.range.to);
      continue;
    }
    if (groupHasOverlap) {
      for (let groupIndex = groupStart; groupIndex < index; groupIndex += 1) {
        const candidate = individuallyValid[groupIndex];
        if (candidate !== undefined) {
          overlapping.add(candidate.index);
        }
      }
    }
    groupStart = index;
    groupEnd = current?.entity.range.to ?? 0;
    groupHasOverlap = false;
  }

  return individuallyValid
    .filter((candidate) => !overlapping.has(candidate.index))
    .map((candidate) => candidate.entity);
}

export function entitiesForTextSegment(
  entities: ComposerEntity[],
  segment: MessageTextSegment,
): ComposerEntity[] {
  return entities.flatMap((entity) => {
    if (entity.range.from < segment.from || entity.range.to > segment.to) {
      return [];
    }
    return [
      {
        ...entity,
        range: {
          from: entity.range.from - segment.from,
          to: entity.range.to - segment.from,
        },
      },
    ];
  });
}

export function shiftComposerEntityRanges(
  entities: ComposerEntity[],
  offset: number,
): ComposerEntity[] {
  if (offset === 0) {
    return entities;
  }
  return entities.map((entity) => ({
    ...entity,
    range: {
      from: entity.range.from + offset,
      to: entity.range.to + offset,
    },
  }));
}

function composerEntityCandidates(metadata: unknown): unknown[] {
  if (!isRecord(metadata) || !isRecord(metadata.composer)) {
    return [];
  }
  return Array.isArray(metadata.composer.entities) ? metadata.composer.entities : [];
}

function parseComposerEntity(value: unknown, text: string): ComposerEntity | undefined {
  if (!isRecord(value) || !isRecord(value.range)) {
    return undefined;
  }
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.triggerId) ||
    !isNonEmptyString(value.trigger) ||
    !isNonEmptyString(value.label) ||
    !isNonEmptyString(value.text)
  ) {
    return undefined;
  }
  const { from, to } = value.range;
  if (
    typeof from !== "number" ||
    typeof to !== "number" ||
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to <= from ||
    to > text.length ||
    text.slice(from, to) !== value.text
  ) {
    return undefined;
  }
  if (value.data !== undefined && !isComposerEntityData(value.data)) return undefined;
  const entity: ComposerEntity = {
    id: value.id,
    triggerId: value.triggerId,
    trigger: value.trigger,
    label: value.label,
    text: value.text,
    range: { from, to },
  };
  if (value.data !== undefined) entity.data = value.data;
  return entity;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

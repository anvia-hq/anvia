import type { Options as ReactMarkdownOptions } from "react-markdown";
import type { ComposerEntity } from "../contexts";

type MarkdownPoint = {
  offset?: number | undefined;
};

type MarkdownPosition = {
  start: MarkdownPoint;
  end: MarkdownPoint;
};

type MarkdownNode = {
  type: string;
  value?: string | undefined;
  children?: MarkdownNode[] | undefined;
  position?: MarkdownPosition | undefined;
  entityIndex?: number | undefined;
};

const phrasingParentTypes = new Set([
  "paragraph",
  "heading",
  "emphasis",
  "strong",
  "delete",
  "link",
  "linkReference",
  "tableCell",
]);
const literalNodeTypes = new Set(["code", "inlineCode", "html", "yaml"]);

export function createMessageEntityRemarkPlugin(markdown: string, entities: ComposerEntity[]) {
  return function messageEntityRemarkPlugin() {
    return (tree: MarkdownNode): void => {
      const rendered = new Set<number>();
      transformNode(tree, markdown, entities, rendered);
    };
  };
}

export function messageEntityRehypeOptions(): ReactMarkdownOptions["remarkRehypeOptions"] {
  return {
    handlers: {
      messageEntity(_state: unknown, node: MarkdownNode) {
        const entityIndex = node.entityIndex;
        return {
          type: "element",
          tagName: "span",
          properties: {
            dataAnviaMessageEntity: "",
            dataAnviaEntityIndex: entityIndex === undefined ? "" : String(entityIndex),
          },
          children: [{ type: "text", value: node.value ?? "" }],
        };
      },
    } as never,
  };
}

function transformNode(
  node: MarkdownNode,
  markdown: string,
  entities: ComposerEntity[],
  rendered: Set<number>,
): void {
  if (literalNodeTypes.has(node.type) || node.children === undefined) {
    return;
  }

  for (const child of node.children) {
    transformNode(child, markdown, entities, rendered);
  }
  if (!phrasingParentTypes.has(node.type)) {
    return;
  }

  for (let entityIndex = entities.length - 1; entityIndex >= 0; entityIndex -= 1) {
    if (rendered.has(entityIndex)) {
      continue;
    }
    const entity = entities[entityIndex];
    if (entity !== undefined && replaceEntity(node, markdown, entity, entityIndex)) {
      rendered.add(entityIndex);
    }
  }
}

function replaceEntity(
  parent: MarkdownNode,
  markdown: string,
  entity: ComposerEntity,
  entityIndex: number,
): boolean {
  const children = parent.children;
  if (children === undefined) {
    return false;
  }
  const firstIndex = children.findIndex((child) => containsStart(child, entity.range.from));
  const lastIndex = findLastIndex(children, (child) => containsEnd(child, entity.range.to));
  if (firstIndex < 0 || lastIndex < firstIndex) {
    return false;
  }

  const first = children[firstIndex];
  const last = children[lastIndex];
  const firstPosition = offsets(first);
  const lastPosition = offsets(last);
  if (
    first === undefined ||
    last === undefined ||
    firstPosition === undefined ||
    lastPosition === undefined ||
    entity.range.from < firstPosition.from ||
    entity.range.to > lastPosition.to
  ) {
    return false;
  }

  if (firstIndex === lastIndex && literalNodeTypes.has(first.type)) {
    return false;
  }
  const before = contentBefore(first, markdown, entity);
  const after = contentAfter(last, markdown, entity);
  if (before === undefined || after === undefined) {
    return false;
  }

  const replacement: MarkdownNode[] = [];
  replacement.push(...before);
  replacement.push({
    type: "messageEntity",
    value: entity.text,
    entityIndex,
    position: {
      start: { offset: entity.range.from },
      end: { offset: entity.range.to },
    },
  });
  replacement.push(...after);
  children.splice(firstIndex, lastIndex - firstIndex + 1, ...replacement);
  return true;
}

function contentBefore(
  node: MarkdownNode,
  markdown: string,
  entity: ComposerEntity,
): MarkdownNode[] | undefined {
  const position = offsets(node);
  if (position === undefined) {
    return undefined;
  }
  if (entity.range.from === position.from) {
    return [];
  }
  if (node.type !== "text" || node.value === undefined) {
    if (node.children === undefined || literalNodeTypes.has(node.type)) {
      return undefined;
    }
    const childIndex = node.children.findIndex((child) => containsStart(child, entity.range.from));
    const child = node.children[childIndex];
    if (child === undefined) {
      return undefined;
    }
    const childContent = contentBefore(child, markdown, entity);
    return childContent === undefined
      ? undefined
      : [...node.children.slice(0, childIndex), ...childContent];
  }
  const split = textValueRange(node, markdown, entity);
  if (split === undefined) {
    return undefined;
  }
  return [
    {
      ...node,
      value: node.value.slice(0, split.from),
      position: {
        start: node.position?.start ?? {},
        end: { offset: entity.range.from },
      },
    },
  ];
}

function contentAfter(
  node: MarkdownNode,
  markdown: string,
  entity: ComposerEntity,
): MarkdownNode[] | undefined {
  const position = offsets(node);
  if (position === undefined) {
    return undefined;
  }
  if (entity.range.to === position.to) {
    return [];
  }
  if (node.type !== "text" || node.value === undefined) {
    if (node.children === undefined || literalNodeTypes.has(node.type)) {
      return undefined;
    }
    const childIndex = findLastIndex(node.children, (child) => containsEnd(child, entity.range.to));
    const child = node.children[childIndex];
    if (child === undefined) {
      return undefined;
    }
    const childContent = contentAfter(child, markdown, entity);
    return childContent === undefined
      ? undefined
      : [...childContent, ...node.children.slice(childIndex + 1)];
  }
  const split = textValueRange(node, markdown, entity);
  if (split === undefined) {
    return undefined;
  }
  return [
    {
      ...node,
      value: node.value.slice(split.to),
      position: {
        start: { offset: entity.range.to },
        end: node.position?.end ?? {},
      },
    },
  ];
}

function textValueRange(
  node: MarkdownNode,
  markdown: string,
  entity: ComposerEntity,
): { from: number; to: number } | undefined {
  const position = offsets(node);
  const value = node.value;
  if (position === undefined || value === undefined) {
    return undefined;
  }
  const raw = markdown.slice(position.from, position.to);
  const relativeFrom = entity.range.from - position.from;
  const relativeTo = entity.range.to - position.from;
  if (raw === value) {
    return { from: relativeFrom, to: relativeTo };
  }

  const occurrence = countOccurrences(raw.slice(0, relativeFrom), entity.text);
  const valueFrom = occurrenceIndex(value, entity.text, occurrence);
  return valueFrom === undefined
    ? undefined
    : { from: valueFrom, to: valueFrom + entity.text.length };
}

function countOccurrences(value: string, search: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= value.length - search.length) {
    const index = value.indexOf(search, offset);
    if (index < 0) {
      break;
    }
    count += 1;
    offset = index + search.length;
  }
  return count;
}

function occurrenceIndex(value: string, search: string, occurrence: number): number | undefined {
  let offset = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    const found = value.indexOf(search, offset);
    if (found < 0) {
      return undefined;
    }
    if (index === occurrence) {
      return found;
    }
    offset = found + search.length;
  }
  return undefined;
}

function containsStart(node: MarkdownNode, offset: number): boolean {
  const position = offsets(node);
  return position !== undefined && offset >= position.from && offset < position.to;
}

function containsEnd(node: MarkdownNode, offset: number): boolean {
  const position = offsets(node);
  return position !== undefined && offset > position.from && offset <= position.to;
}

function offsets(node: MarkdownNode | undefined): { from: number; to: number } | undefined {
  const from = node?.position?.start.offset;
  const to = node?.position?.end.offset;
  return typeof from === "number" && typeof to === "number" ? { from, to } : undefined;
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && predicate(item)) {
      return index;
    }
  }
  return -1;
}

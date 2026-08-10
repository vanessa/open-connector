import type { BlockContent, DefinitionContent, List, ListItem, Nodes, PhrasingContent, RootContent } from "mdast";

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";
import {
  optionalBoolean,
  optionalObjectArray,
  optionalRawString,
  optionalRecord,
  optionalString,
} from "../../core/cast.ts";

/**
 * One mark applied to a text node in a mymind prose document.
 */
export interface MymindProseMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/**
 * One node in a mymind prose document.
 */
export interface MymindProseNode {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: MymindProseMark[];
  text?: string;
  content?: MymindProseNode[];
}

/**
 * A mymind prose document, used for note bodies and clipped card prose.
 */
export interface MymindProseDocument {
  type: "doc";
  content: MymindProseNode[];
}

/**
 * Convert Markdown into the prose document mymind stores on a card.
 *
 * mymind's editor keeps rich text as a nested node document (`heading`,
 * `paragraph`, `bulletList`/`orderedList`/`taskList`, `codeBlock`,
 * `blockquote`, `horizontalRule`, with `bold`, `italic`, `strike`, `code`,
 * `highlight`, and `link` text marks). Actions take Markdown so agents never
 * have to build that tree, and structures mymind has no node for are kept as
 * their Markdown source instead of being dropped.
 */
export function markdownToProseDocument(markdown: string): MymindProseDocument {
  const root = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  return { type: "doc", content: root.children.flatMap(proseFromMdastBlock) };
}

/**
 * Render a mymind prose document as Markdown.
 *
 * Card prose and notes are read far more often than they are written, so
 * unknown node types fall back to their text content rather than failing the
 * whole card.
 */
export function proseToMarkdown(prose: unknown): string {
  const nodes = proseDocumentNodes(prose);
  if (nodes.length === 0) {
    return "";
  }

  const children = nodes.flatMap(mdastFromProseBlock);
  if (children.length === 0) {
    return "";
  }

  return toMarkdown(
    { type: "root", children },
    {
      bullet: "-",
      fences: true,
      extensions: [gfmToMarkdown()],
    },
  ).trim();
}

function proseDocumentNodes(prose: unknown): Array<Record<string, unknown>> {
  const document = optionalRecord(prose);
  if (!document) {
    return [];
  }

  const nested = optionalRecord(document.prose);
  return optionalObjectArray(document.content ?? nested?.content);
}

function proseFromMdastBlock(node: RootContent): MymindProseNode[] {
  switch (node.type) {
    case "heading":
      return [
        {
          type: "heading",
          attrs: { level: node.depth },
          content: proseFromMdastInline(node.children, []),
        },
      ];
    case "paragraph":
      return [proseParagraph(proseFromMdastInline(node.children, []))];
    case "list":
      return [proseFromMdastList(node)];
    case "code":
      return [
        {
          type: "codeBlock",
          attrs: { language: node.lang ?? "" },
          ...(node.value ? { content: [{ type: "text", text: node.value }] } : {}),
        },
      ];
    case "blockquote":
      return [{ type: "blockquote", content: node.children.flatMap(proseFromMdastBlock) }];
    case "thematicBreak":
      return [{ type: "horizontalRule" }];
    default:
      return [proseParagraph([{ type: "text", text: mdastNodeToMarkdown(node) }])];
  }
}

function proseFromMdastList(node: List): MymindProseNode {
  if (node.children.some((item) => item.checked != null)) {
    return {
      type: "taskList",
      content: node.children.map((item) => ({
        type: "taskItem",
        attrs: { checked: item.checked === true },
        content: proseFromMdastListItem(item),
      })),
    };
  }

  const content = node.children.map((item) => ({
    type: "listItem",
    content: proseFromMdastListItem(item),
  }));
  return node.ordered === true
    ? { type: "orderedList", attrs: { start: node.start ?? 1 }, content }
    : { type: "bulletList", content };
}

function proseFromMdastListItem(item: ListItem): MymindProseNode[] {
  const blocks = item.children.flatMap(proseFromMdastBlock);
  return blocks.length > 0 ? blocks : [{ type: "paragraph" }];
}

function proseFromMdastInline(nodes: readonly PhrasingContent[], marks: MymindProseMark[]): MymindProseNode[] {
  return nodes.flatMap((node) => proseFromMdastInlineNode(node, marks));
}

function proseFromMdastInlineNode(node: PhrasingContent, marks: MymindProseMark[]): MymindProseNode[] {
  switch (node.type) {
    case "text":
    case "html":
      return node.value ? [proseText(node.value, marks)] : [];
    case "inlineCode":
      return [proseText(node.value, withProseMark(marks, "code"))];
    case "strong":
      return proseFromMdastInline(node.children, withProseMark(marks, "bold"));
    case "emphasis":
      return proseFromMdastInline(node.children, withProseMark(marks, "italic"));
    case "delete":
      return proseFromMdastInline(node.children, withProseMark(marks, "strike"));
    case "link":
      return proseFromMdastInline(node.children, withProseMark(marks, "link", { href: node.url }));
    case "image":
      return [proseText(node.alt || node.url, withProseMark(marks, "link", { href: node.url }))];
    case "break":
      return [{ type: "hardBreak" }];
    default:
      return "children" in node ? proseFromMdastInline(node.children, marks) : [];
  }
}

function proseParagraph(content: MymindProseNode[]): MymindProseNode {
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
}

function proseText(text: string, marks: MymindProseMark[]): MymindProseNode {
  return marks.length > 0 ? { type: "text", text, marks } : { type: "text", text };
}

function withProseMark(marks: MymindProseMark[], type: string, attrs?: Record<string, unknown>): MymindProseMark[] {
  return [...marks, attrs ? { type, attrs } : { type }];
}

function mdastFromProseBlock(node: Record<string, unknown>): BlockContent[] {
  const content = optionalObjectArray(node.content);
  switch (optionalString(node.type)) {
    case "heading":
      return [
        {
          type: "heading",
          depth: proseHeadingDepth(node),
          children: mdastFromProseInline(content),
        },
      ];
    case "paragraph":
      return [{ type: "paragraph", children: mdastFromProseInline(content) }];
    case "bulletList":
      return [{ type: "list", ordered: false, spread: false, children: mdastFromProseListItems(content, false) }];
    case "orderedList":
      return [
        {
          type: "list",
          ordered: true,
          start: proseListStart(node),
          spread: false,
          children: mdastFromProseListItems(content, false),
        },
      ];
    case "taskList":
      return [{ type: "list", ordered: false, spread: false, children: mdastFromProseListItems(content, true) }];
    case "codeBlock":
      return [
        {
          type: "code",
          lang: optionalString(proseAttrs(node).language) ?? null,
          value: proseTextContent(content),
        },
      ];
    case "blockquote":
      return [{ type: "blockquote", children: content.flatMap(mdastFromProseBlock) }];
    case "horizontalRule":
      return [{ type: "thematicBreak" }];
    default:
      return content.length > 0 && content.every(isProseInlineNode)
        ? [{ type: "paragraph", children: mdastFromProseInline(content) }]
        : content.flatMap(mdastFromProseBlock);
  }
}

function mdastFromProseListItems(items: Array<Record<string, unknown>>, task: boolean): ListItem[] {
  return items.map((item) => ({
    type: "listItem",
    spread: false,
    ...(task ? { checked: optionalBoolean(proseAttrs(item).checked) ?? false } : {}),
    children: mdastFromProseListItemContent(item),
  }));
}

function mdastFromProseListItemContent(item: Record<string, unknown>): Array<BlockContent | DefinitionContent> {
  const children = optionalObjectArray(item.content).flatMap(mdastFromProseBlock);
  return children.length > 0 ? children : [{ type: "paragraph", children: [] }];
}

function mdastFromProseInline(nodes: Array<Record<string, unknown>>): PhrasingContent[] {
  const output: PhrasingContent[] = [];
  for (const node of nodes) {
    if (optionalString(node.type) === "hardBreak") {
      output.push({ type: "break" });
      continue;
    }

    const text = optionalRawString(node.text);
    if (text != null) {
      if (text) {
        output.push(mdastFromProseText(text, optionalObjectArray(node.marks)));
      }
      continue;
    }

    output.push(...mdastFromProseInline(optionalObjectArray(node.content)));
  }
  return output;
}

function mdastFromProseText(text: string, marks: Array<Record<string, unknown>>): PhrasingContent {
  const markTypes = new Set(marks.map((mark) => optionalString(mark.type)));
  // Markdown has no highlight syntax; `==text==` is the common extension and is
  // what mymind's own editor shows for highlighted text.
  let node: PhrasingContent = markTypes.has("code")
    ? { type: "inlineCode", value: text }
    : { type: "text", value: markTypes.has("highlight") ? `==${text}==` : text };
  if (markTypes.has("strike")) node = { type: "delete", children: [node] };
  if (markTypes.has("italic")) node = { type: "emphasis", children: [node] };
  if (markTypes.has("bold")) node = { type: "strong", children: [node] };

  const href = optionalString(optionalRecord(marks.find((mark) => optionalString(mark.type) === "link")?.attrs)?.href);
  return href ? { type: "link", url: href, children: [node] } : node;
}

function isProseInlineNode(node: Record<string, unknown>): boolean {
  const type = optionalString(node.type);
  return type === "text" || type === "hardBreak";
}

function proseTextContent(nodes: Array<Record<string, unknown>>): string {
  return nodes
    .map((node) => optionalRawString(node.text) ?? proseTextContent(optionalObjectArray(node.content)))
    .join("");
}

function proseAttrs(node: Record<string, unknown>): Record<string, unknown> {
  return optionalRecord(node.attrs) ?? {};
}

function proseHeadingDepth(node: Record<string, unknown>): 1 | 2 | 3 | 4 | 5 | 6 {
  const level = optionalString(proseAttrs(node).level) ?? proseAttrs(node).level;
  const depth = typeof level === "number" ? level : Number(level);
  if (!Number.isInteger(depth) || depth < 1) return 1;
  return (depth > 6 ? 6 : depth) as 1 | 2 | 3 | 4 | 5 | 6;
}

function proseListStart(node: Record<string, unknown>): number {
  const start = proseAttrs(node).start;
  return typeof start === "number" && Number.isInteger(start) && start > 0 ? start : 1;
}

function mdastNodeToMarkdown(node: Nodes): string {
  return toMarkdown(node, { bullet: "-", fences: true, extensions: [gfmToMarkdown()] }).trim();
}

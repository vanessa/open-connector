import { describe, expect, it } from "vitest";
import { markdownToProseDocument, proseToMarkdown } from "./runtime-prose.ts";

describe("markdownToProseDocument", () => {
  it("maps Markdown blocks onto mymind prose nodes", () => {
    expect(markdownToProseDocument("# Title\n\nHello **there**\n\n---\n")).toEqual({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "there", marks: [{ type: "bold" }] },
          ],
        },
        { type: "horizontalRule" },
      ],
    });
  });

  it("maps task lists, bullet lists, and ordered lists", () => {
    const document = markdownToProseDocument("- [x] done\n- [ ] todo\n");
    expect(document.content).toEqual([
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }],
          },
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [{ type: "paragraph", content: [{ type: "text", text: "todo" }] }],
          },
        ],
      },
    ]);
    expect(markdownToProseDocument("- one\n").content[0]).toMatchObject({ type: "bulletList" });
    expect(markdownToProseDocument("3. three\n").content[0]).toMatchObject({
      type: "orderedList",
      attrs: { start: 3 },
    });
  });

  it("keeps code block language and body", () => {
    expect(markdownToProseDocument("```ts\nconst x = 1;\n```\n").content).toEqual([
      {
        type: "codeBlock",
        attrs: { language: "ts" },
        content: [{ type: "text", text: "const x = 1;" }],
      },
    ]);
  });

  it("carries links as a text mark", () => {
    expect(markdownToProseDocument("[docs](https://mymind.com)").content).toEqual([
      {
        type: "paragraph",
        content: [{ type: "text", text: "docs", marks: [{ type: "link", attrs: { href: "https://mymind.com" } }] }],
      },
    ]);
  });

  it("keeps structures mymind has no node for as their Markdown source", () => {
    expect(markdownToProseDocument("| a | b |\n| - | - |\n| 1 | 2 |\n").content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "| a | b |\n| - | - |\n| 1 | 2 |" }] },
    ]);
  });
});

describe("proseToMarkdown", () => {
  it("renders nested prose back to Markdown", () => {
    const markdown = proseToMarkdown({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Notes" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "call " },
                    { type: "text", text: "run()", marks: [{ type: "code" }] },
                  ],
                },
              ],
            },
          ],
        },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "quoted" }] }] },
      ],
    });

    expect(markdown).toBe("### Notes\n\n- call `run()`\n\n> quoted");
  });

  it("renders highlighted text with the mark mymind shows", () => {
    expect(
      proseToMarkdown({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "key idea", marks: [{ type: "highlight" }] }] }],
      }),
    ).toBe("\\==key idea==");
  });

  it("returns an empty string for a missing or empty document", () => {
    expect(proseToMarkdown(undefined)).toBe("");
    expect(proseToMarkdown({ type: "doc", content: [] })).toBe("");
  });

  it("keeps the text of node types it does not know", () => {
    expect(
      proseToMarkdown({
        type: "doc",
        content: [{ type: "callout", content: [{ type: "text", text: "kept" }] }],
      }),
    ).toBe("kept");
  });
});

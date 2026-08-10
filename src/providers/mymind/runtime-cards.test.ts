import type { MymindCard } from "./runtime-cards.ts";

import { describe, expect, it } from "vitest";
import { decodeMymindCards, filterMymindCards } from "./runtime-cards.ts";
import { decodeMymindMsgpackStream } from "./runtime-msgpack.ts";

describe("decodeMymindMsgpackStream", () => {
  it("decodes the value types the card stream uses", () => {
    const bytes = concat([
      msgpackMap([
        ["nil", [0xc0]],
        ["yes", [0xc3]],
        ["small", [0x2a]],
        ["negative", [0xff]],
        ["wide", [0xcd, 0x01, 0x00]],
        ["float", [0xcb, 0x3f, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]],
        ["list", [0x92, ...msgpackString("a"), ...msgpackString("b")]],
      ]),
      msgpackMap([["second", msgpackString("value")]]),
    ]);

    expect(decodeMymindMsgpackStream(bytes)).toEqual([
      { nil: null, yes: true, small: 42, negative: -1, wide: 256, float: 1, list: ["a", "b"] },
      { second: "value" },
    ]);
  });

  it("decodes strings longer than a fixstr", () => {
    const long = "x".repeat(300);
    expect(decodeMymindMsgpackStream(concat([msgpackMap([["long", msgpackString(long)]])]))).toEqual([{ long }]);
  });

  it("rejects a truncated stream", () => {
    expect(() => decodeMymindMsgpackStream(new Uint8Array([0xa4, 0x6a, 0x73]))).toThrow(
      /response ended before a complete value was read/u,
    );
  });

  it("rejects value types mymind does not send", () => {
    expect(() => decodeMymindMsgpackStream(new Uint8Array([0xd4, 0x00, 0x00]))).toThrow(/unsupported value type 0xd4/u);
  });
});

describe("decodeMymindCards", () => {
  it("normalizes cards and renders their prose as Markdown", () => {
    const cards = decodeMymindCards(
      concat([
        msgpackCard({
          id: "card-1",
          title: "Launch plan",
          description: "How we ship",
          type: "Note",
          created: "2026-08-01T10:00:00Z",
          modified: "2026-08-02T10:00:00Z",
          tags: [{ name: "productlaunch" }, { name: "Draft" }],
          prose: {
            type: "doc",
            content: [
              { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Plan" }] },
              {
                type: "paragraph",
                content: [{ type: "text", text: "ship it", marks: [{ type: "bold" }] }],
              },
            ],
          },
          note: { prose: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "mine" }] }] } },
        }),
        msgpackCard({
          title: "Saved tweet",
          domain: "x.com",
          type: "XPost",
          source: { url: "https://x.com/example/status/1" },
        }),
      ]),
    );

    expect(cards[0]).toEqual({
      id: "card-1",
      title: "Launch plan",
      description: "How we ship",
      type: "Note",
      domain: "",
      sourceUrl: "",
      tags: ["productlaunch", "Draft"],
      createdAt: "2026-08-01T10:00:00Z",
      modifiedAt: "2026-08-02T10:00:00Z",
      content: "## Plan\n\n**ship it**",
      note: "mine",
    });
    expect(cards[1]).toMatchObject({
      id: "html-fallback-id",
      title: "Saved tweet",
      domain: "x.com",
      sourceUrl: "https://x.com/example/status/1",
      tags: [],
      content: "",
    });
  });
});

describe("filterMymindCards", () => {
  const cards: MymindCard[] = [
    card({ id: "a", title: "Design systems", type: "WebPage", domain: "figma.com", tags: ["Design", "tools"] }),
    card({ id: "b", title: "Clipped quote", type: "Content", tags: ["design"], content: "grid systems" }),
    card({ id: "c", title: "Reel", type: "InstagramReel", sourceUrl: "https://youtube.com/watch?v=1" }),
  ];

  it("requires every tag, ignoring case", () => {
    expect(ids(filterMymindCards(cards, { tags: ["design"], limit: 10 }))).toEqual(["a", "b"]);
    expect(ids(filterMymindCards(cards, { tags: ["design", "TOOLS"], limit: 10 }))).toEqual(["a"]);
  });

  it("matches the card type mymind shows under a different name", () => {
    expect(ids(filterMymindCards(cards, { cardType: "Snippet", limit: 10 }))).toEqual(["b"]);
  });

  it("matches a domain in either the domain or the source URL", () => {
    expect(ids(filterMymindCards(cards, { domain: "figma.com", limit: 10 }))).toEqual(["a"]);
    expect(ids(filterMymindCards(cards, { domain: "youtube.com", limit: 10 }))).toEqual(["c"]);
  });

  it("matches text against the title, description, and body", () => {
    expect(ids(filterMymindCards(cards, { text: "systems", limit: 10 }))).toEqual(["a", "b"]);
  });

  it("stops at the limit", () => {
    expect(ids(filterMymindCards(cards, { tags: ["design"], limit: 1 }))).toEqual(["a"]);
  });
});

function card(overrides: Partial<MymindCard>): MymindCard {
  return {
    id: "",
    title: "",
    description: "",
    type: "",
    domain: "",
    sourceUrl: "",
    tags: [],
    createdAt: "",
    modifiedAt: "",
    content: "",
    note: "",
    ...overrides,
  };
}

function ids(cards: readonly MymindCard[]): string[] {
  return cards.map((entry) => entry.id);
}

function msgpackCard(raw: Record<string, unknown>): number[] {
  return msgpackMap([
    ["json", msgpackString(JSON.stringify(raw))],
    ["html", msgpackString('<div class="card" data-id="html-fallback-id"></div>')],
  ]);
}

function msgpackMap(entries: Array<[string, number[]]>): number[] {
  return [0x80 | entries.length, ...entries.flatMap(([key, value]) => [...msgpackString(key), ...value])];
}

function msgpackString(value: string): number[] {
  const bytes = [...new TextEncoder().encode(value)];
  if (bytes.length < 32) {
    return [0xa0 | bytes.length, ...bytes];
  }
  if (bytes.length < 256) {
    return [0xd9, bytes.length, ...bytes];
  }
  return [
    0xdb,
    bytes.length >>> 24,
    (bytes.length >>> 16) & 0xff,
    (bytes.length >>> 8) & 0xff,
    bytes.length & 0xff,
    ...bytes,
  ];
}

function concat(chunks: number[][]): Uint8Array {
  return Uint8Array.from(chunks.flat());
}

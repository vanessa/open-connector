import { optionalObjectArray, optionalRecord, optionalString } from "../../core/cast.ts";
import { ProviderRequestError } from "../provider-runtime.ts";
import { decodeMymindMsgpackStream } from "./runtime-msgpack.ts";
import { proseToMarkdown } from "./runtime-prose.ts";

/**
 * One normalized mymind card.
 *
 * mymind calls every saved item a card, whatever it was saved from: a note, a
 * bookmark, an image, a highlight, or a social post.
 */
export interface MymindCard {
  /** Card id, used by every card-scoped mymind action. */
  id: string;
  title: string;
  description: string;
  /** Card type mymind assigned while saving, such as `WebPage`, `Image`, or `Note`. */
  type: string;
  /** Source domain the card was saved from, empty for cards created inside mymind. */
  domain: string;
  /** Original URL the card was saved from. */
  sourceUrl: string;
  tags: string[];
  createdAt: string;
  modifiedAt: string;
  /** Card body rendered as Markdown: note text, clipped prose, or a quote. */
  content: string;
  /** The user's own note attached to the card, rendered as Markdown. */
  note: string;
}

/**
 * Filters applied to a fetched mymind card list.
 *
 * mymind's search endpoint only matches text, so tag, domain, and type filters
 * are applied to the card list the same way the mymind web client does.
 */
export interface MymindCardFilter {
  /** Tag names the card must all carry, matched case-insensitively. */
  tags?: readonly string[];
  /** Source domain substring, such as `youtube.com`. */
  domain?: string;
  /** Card type, matched case-insensitively. */
  cardType?: string;
  /** Text matched against title, description, and card body. */
  text?: string;
  limit: number;
}

/**
 * Card types mymind shows under a different name than it stores.
 */
const cardTypeAliases: Record<string, string> = {
  snippet: "content",
  snippets: "content",
};

const cardIdFromHtmlPattern = /data-id="([^"]+)"/u;

/**
 * Decode the msgpack card stream returned by `GET /cards` into normalized cards.
 *
 * Each streamed value carries the card as a JSON string plus the pre-rendered
 * HTML the web client displays; only the JSON is used here, falling back to the
 * HTML for the card id on cards whose JSON omits it.
 */
export function decodeMymindCards(bytes: Uint8Array): MymindCard[] {
  return decodeMymindMsgpackStream(bytes).map((value) => {
    const item = optionalRecord(value);
    if (!item) {
      throw new ProviderRequestError(502, "mymind returned an unreadable card stream: card was not an object");
    }
    return normalizeMymindCard(item);
  });
}

/**
 * Return the cards matching every provided filter, newest first.
 */
export function filterMymindCards(cards: readonly MymindCard[], filter: MymindCardFilter): MymindCard[] {
  const tags = filter.tags?.map((tag) => tag.toLowerCase()) ?? [];
  const domain = filter.domain?.toLowerCase();
  const cardType = normalizeCardType(filter.cardType);
  const text = filter.text?.toLowerCase();

  const matches: MymindCard[] = [];
  for (const card of cards) {
    if (matches.length >= filter.limit) break;
    if (tags.length > 0) {
      const cardTags = card.tags.map((tag) => tag.toLowerCase());
      if (!tags.every((tag) => cardTags.includes(tag))) continue;
    }
    if (domain && !card.domain.toLowerCase().includes(domain) && !card.sourceUrl.toLowerCase().includes(domain)) {
      continue;
    }
    if (cardType && normalizeCardType(card.type) !== cardType) continue;
    if (text && !`${card.title} ${card.description} ${card.content}`.toLowerCase().includes(text)) continue;
    matches.push(card);
  }
  return matches;
}

/**
 * Normalize one card object from the card stream or a card detail response.
 */
export function normalizeMymindCard(item: Record<string, unknown>): MymindCard {
  const raw = readCardJson(item);
  const source = optionalRecord(raw.source);
  const note = optionalRecord(raw.note);
  return {
    id: readCardId(raw, item),
    title: optionalString(raw.title) ?? "",
    description: optionalString(raw.description) ?? "",
    type: optionalString(raw.type) ?? "",
    domain: optionalString(raw.domain) ?? "",
    sourceUrl: optionalString(source?.url) ?? "",
    tags: optionalObjectArray(raw.tags)
      .map((tag) => optionalString(tag.name))
      .filter((name): name is string => name != null),
    createdAt: optionalString(raw.created) ?? "",
    modifiedAt: optionalString(raw.modified) ?? "",
    content: proseToMarkdown(raw.prose),
    note: proseToMarkdown(note?.prose),
  };
}

function readCardJson(item: Record<string, unknown>): Record<string, unknown> {
  const json = item.json;
  if (typeof json !== "string") {
    return optionalRecord(json) ?? item;
  }

  try {
    return optionalRecord(JSON.parse(json)) ?? {};
  } catch (error) {
    throw new ProviderRequestError(502, "mymind returned a card with unreadable JSON", error);
  }
}

function readCardId(raw: Record<string, unknown>, item: Record<string, unknown>): string {
  const id = optionalString(raw.id) ?? optionalString(item.id);
  if (id) {
    return id;
  }

  const html = optionalString(item.html);
  return (html ? cardIdFromHtmlPattern.exec(html)?.[1] : undefined) ?? "";
}

function normalizeCardType(cardType: string | undefined): string | undefined {
  const normalized = cardType?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return cardTypeAliases[normalized] ?? normalized;
}

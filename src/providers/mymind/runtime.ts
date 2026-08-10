import type { CredentialValidationResult, TransitFileWriter } from "../../core/types.ts";
import type { ProviderFetch, ProviderRuntimeHandler } from "../provider-runtime.ts";
import type { MymindCard } from "./runtime-cards.ts";

import { createHash } from "node:crypto";
import {
  objectArray,
  optionalBoolean,
  optionalIntegerLike,
  optionalNumber,
  optionalRecord,
  optionalString,
  optionalStringArray,
  requiredRecord,
  requiredString,
  requiredStringArray,
} from "../../core/cast.ts";
import { readBoundedResponseBytes } from "../../core/request.ts";
import {
  createProviderTimeout,
  isAbortSignalError,
  ProviderRequestError,
  providerUserAgent,
  readProviderJsonBody,
  readProviderTextBody,
  setSearchParams,
} from "../provider-runtime.ts";
import { decodeMymindCards, filterMymindCards } from "./runtime-cards.ts";
import { markdownToProseDocument, proseToMarkdown } from "./runtime-prose.ts";

/**
 * Host serving the mymind app API used by the web and browser-extension clients.
 */
export const mymindApiBaseUrl = "https://access.mymind.com";

/**
 * Endpoint prefixes the mymind proxy accepts.
 */
export const mymindProxyEndpointPrefixes: readonly string[] = [
  "/cards",
  "/media",
  "/objects",
  "/search",
  "/spaces",
  "/tags",
];

const mymindRequestTimeoutMs = 30_000;
/** mymind streams the whole collection in one `GET /cards` response, so this bound is generous. */
const mymindCardStreamMaxBytes = 64 * 1024 * 1024;
/** Flag mymind sets on tags the user created, as opposed to the ones it generated. */
const mymindCustomTagFlag = 8;
const mymindDefaultSpaceColor = "#fdf06f";
const mymindDefaultImageWidth = 1024;
const mymindMaxImageWidth = 4096;
const mymindMediaPathPattern = /^[A-Za-z0-9._/-]+$/u;

/**
 * Session credential copied out of a signed-in mymind browser session.
 */
export interface MymindCredential {
  /** `_jwt` cookie value. */
  jwt: string;
  /** `_cid` cookie value. */
  cid: string;
  /** `x-authenticity-token` request header value. */
  authenticityToken: string;
}

/**
 * Runtime context shared by every mymind action handler.
 */
export interface MymindActionContext {
  credential: MymindCredential;
  fetcher: ProviderFetch;
  transitFiles?: TransitFileWriter;
  signal?: AbortSignal;
}

interface MymindRequestInput {
  method: string;
  path: string;
  query?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
  accept?: string;
  context: MymindActionContext;
}

/**
 * Read the stored mymind session values into a credential.
 */
export function readMymindCredential(values: Record<string, string>): MymindCredential {
  return {
    jwt: readSessionToken(values, "jwt", "_jwt cookie"),
    cid: readSessionToken(values, "cid", "_cid cookie"),
    authenticityToken: readSessionToken(values, "authenticityToken", "x-authenticity-token header"),
  };
}

/**
 * Apply the mymind session headers to an outgoing request.
 */
export function applyMymindRequestHeaders(credential: MymindCredential, headers: Headers): void {
  headers.set("x-authenticity-token", credential.authenticityToken);
  headers.set("cookie", `_cid=${credential.cid}; _jwt=${credential.jwt}`);
}

/**
 * Confirm the stored session still works and describe the connected collection.
 */
export async function validateMymindCredential(
  values: Record<string, string>,
  fetcher: ProviderFetch,
  signal?: AbortSignal,
): Promise<CredentialValidationResult> {
  const credential = readMymindCredential(values);
  const tags = await requestMymindArray({
    method: "GET",
    path: "/tags",
    context: { credential, fetcher, signal },
  });
  const accountKey = createHash("sha256").update(credential.cid).digest("hex").slice(0, 16);

  return {
    profile: {
      accountId: `mymind:${accountKey}`,
      displayName: `mymind · ${accountKey.slice(-6)}`,
    },
    grantedScopes: [],
    metadata: { tagCount: tags.length },
  };
}

export const mymindActionHandlers: Record<string, ProviderRuntimeHandler<MymindActionContext>> = {
  async search_cards(input, context) {
    const limit = readBoundedCount(input.limit, "limit", 50);
    const tags = readTagList(input.tags);
    const domain = optionalString(input.domain);
    const cardType = optionalString(input.cardType);
    const query = optionalString(input.query);

    if (tags.length > 0 || domain || cardType) {
      const cards = filterMymindCards(await fetchMymindCards(context), {
        tags,
        domain,
        cardType,
        text: query,
        limit,
      });
      return { cards, count: cards.length };
    }

    if (query) {
      const matchedIds = await searchMymindCardIds(query, context);
      const cards = (await fetchMymindCards(context)).filter((card) => matchedIds.has(card.id)).slice(0, limit);
      return { cards, count: cards.length, matchCount: matchedIds.size };
    }

    const cards = (await fetchMymindCards(context)).slice(0, limit);
    return { cards, count: cards.length };
  },

  async list_recent_cards(input, context) {
    const cards = (await fetchMymindCards(context)).slice(0, readBoundedCount(input.limit, "limit", 20));
    return { cards, count: cards.length };
  },

  async get_card(input, context) {
    const cardId = readCardId(input);
    return {
      cardId,
      card: await requestMymindRecord({ method: "GET", path: objectPath(cardId), context }),
    };
  },

  async get_cards(input, context) {
    const cardIds = uniqueValues(requiredStringArray(input.cardIds, "cardIds", mymindInputError));
    const cards: Array<Record<string, unknown>> = [];
    const missingCardIds: string[] = [];
    for (const cardId of cardIds) {
      try {
        cards.push(await requestMymindRecord({ method: "GET", path: objectPath(cardId), context }));
      } catch (error) {
        if (error instanceof ProviderRequestError && error.status === 404) {
          missingCardIds.push(cardId);
          continue;
        }
        throw error;
      }
    }
    return { cards, count: cards.length, missingCardIds };
  },

  async get_card_content(input, context) {
    const cardId = readCardId(input);
    const card = await requestMymindRecord({ method: "GET", path: cardPath(cardId), context });
    const object = optionalRecord(card.object) ?? card;
    return {
      cardId,
      card,
      content: proseToMarkdown(object.prose),
      note: proseToMarkdown(optionalRecord(object.note)?.prose),
    };
  },

  async download_card_image(input, context) {
    const transitFiles = context.transitFiles;
    if (!transitFiles) {
      throw new ProviderRequestError(400, "mymind download_card_image requires local transit file storage.");
    }

    const cardId = readCardId(input);
    const maxWidth = readBoundedCount(input.maxWidth, "maxWidth", mymindDefaultImageWidth, mymindMaxImageWidth);
    const card = await requestMymindRecord({ method: "GET", path: cardPath(cardId), context });
    const object = optionalRecord(card.object) ?? card;
    const mediaPath = optionalString(object.path);
    if (!mediaPath) {
      throw new ProviderRequestError(404, `mymind card ${cardId} has no image.`);
    }
    if (!mymindMediaPathPattern.test(mediaPath)) {
      throw new ProviderRequestError(502, `mymind card ${cardId} returned an unusable image path.`);
    }

    const { width, height } = scaleCardImage(object, maxWidth);
    const response = await requestMymind({
      method: "GET",
      path: `/media/${mediaPath};${width}x${height}.webp`,
      accept: "image/webp",
      context,
    });
    const mimeType = response.headers.get("content-type") ?? "image/webp";
    const bytes = await readBoundedResponseBytes(response, {
      maxBytes: transitFiles.maxBytes,
      fieldName: "mymind card image",
      createError: (message) => new ProviderRequestError(413, message),
    });
    const upload = await transitFiles.create(
      new File([Uint8Array.from(bytes)], `mymind-${cardId}.webp`, { type: mimeType }),
    );

    return {
      cardId,
      width,
      height,
      file: {
        fileId: upload.fileId,
        downloadUrl: upload.downloadUrl,
        sizeBytes: upload.sizeBytes,
        name: upload.name,
        mimeType: upload.mimeType,
      },
    };
  },

  async create_note(input, context) {
    const created = await requestMymindRecord({
      method: "POST",
      path: "/objects",
      body: {
        type: "Note",
        title: optionalString(input.title) ?? "",
        prose: markdownToProseDocument(requiredString(input.content, "content", mymindInputError)),
      },
      context,
    });
    return finishCardCreation(created, readTagList(input.tags), context);
  },

  async save_url(input, context) {
    const created = await requestMymindRecord({
      method: "POST",
      path: "/objects",
      body: {
        type: "WebPage",
        url: requiredString(input.url, "url", mymindInputError),
      },
      context,
    });
    return finishCardCreation(created, readTagList(input.tags), context);
  },

  async update_card(input, context) {
    const cardId = readCardId(input);
    return {
      cardId,
      card: await requestMymindRecord({
        method: "PATCH",
        path: objectPath(cardId),
        body: { title: requiredString(input.title, "title", mymindInputError) },
        context,
      }),
    };
  },

  async delete_card(input, context) {
    const cardId = readCardId(input);
    await requestMymind({ method: "DELETE", path: objectPath(cardId), context });
    return { cardId, deleted: true };
  },

  async list_tags(input, context) {
    const limit = readBoundedCount(input.limit, "limit", 50);
    const allTags = await requestMymindArray({ method: "GET", path: "/tags", context });
    const tags = optionalBoolean(input.customOnly) === true ? allTags.filter(isCustomMymindTag) : allTags;
    const page = tags.slice(0, limit);
    return { tags: page, count: page.length, totalCount: tags.length };
  },

  async get_card_tags(input, context) {
    const cardId = readCardId(input);
    const tags = await requestMymindArray({ method: "GET", path: `${objectPath(cardId)}/tags`, context });
    return { cardId, tags, count: tags.length };
  },

  async add_card_tag(input, context) {
    const cardId = readCardId(input);
    const tag = requiredString(input.tag, "tag", mymindInputError);
    await requestMymind({ method: "POST", path: `${objectPath(cardId)}/tags`, body: { name: tag }, context });
    return { cardId, tag, added: true };
  },

  async remove_card_tag(input, context) {
    const cardId = readCardId(input);
    const tag = requiredString(input.tag, "tag", mymindInputError);
    await requestMymind({ method: "DELETE", path: `${objectPath(cardId)}/tags`, body: { name: tag }, context });
    return { cardId, tag, removed: true };
  },

  async list_spaces(_input, context) {
    const spaces = (await requestMymindArray({ method: "GET", path: "/spaces", context })).map(normalizeMymindSpace);
    return { spaces, count: spaces.length };
  },

  async get_space_cards(input, context) {
    const spaceId = requiredString(input.spaceId, "spaceId", mymindInputError);
    const limit = readBoundedCount(input.limit, "limit", 50);
    const space = await requestMymindRecord({ method: "GET", path: spacePath(spaceId), context });
    const cardIds = objectArray(space.objects ?? [], "space objects", mymindProviderError)
      .map((object) => optionalString(object.id))
      .filter((id): id is string => id != null);
    if (cardIds.length === 0) {
      return { spaceId, name: optionalString(space.name) ?? "", cards: [], count: 0 };
    }

    const cardsById = new Map((await fetchMymindCards(context)).map((card) => [card.id, card]));
    const cards = cardIds
      .map((cardId) => cardsById.get(cardId))
      .filter((card): card is MymindCard => card != null)
      .slice(0, limit);
    return { spaceId, name: optionalString(space.name) ?? "", cards, count: cards.length };
  },

  async create_space(input, context) {
    const name = requiredString(input.name, "name", mymindInputError);
    const color = optionalString(input.color) ?? mymindDefaultSpaceColor;
    const filters = readTagList(input.filters);
    const created = await requestMymindRecord({
      method: "POST",
      path: "/spaces",
      body: filters.length > 0 ? { name, color, query: { filters } } : { name, color },
      context,
    });
    return { space: normalizeMymindSpace(created) };
  },

  async delete_space(input, context) {
    const spaceId = requiredString(input.spaceId, "spaceId", mymindInputError);
    await requestMymind({ method: "DELETE", path: spacePath(spaceId), context });
    return { spaceId, deleted: true };
  },
};

async function fetchMymindCards(context: MymindActionContext): Promise<MymindCard[]> {
  const response = await requestMymind({
    method: "GET",
    path: "/cards",
    accept: "application/msgpack",
    context,
  });
  const bytes = await readBoundedResponseBytes(response, {
    maxBytes: mymindCardStreamMaxBytes,
    fieldName: "mymind card stream",
    createError: (message) => new ProviderRequestError(413, message),
  });
  return decodeMymindCards(Uint8Array.from(bytes));
}

async function searchMymindCardIds(query: string, context: MymindActionContext): Promise<Set<string>> {
  const result = await requestMymindRecord({
    method: "GET",
    path: "/search",
    query: { q: query },
    context,
  });
  const matches = objectArray(result.matches ?? [], "search matches", mymindProviderError);
  return new Set(matches.map((match) => optionalString(match.id)).filter((id): id is string => id != null));
}

async function finishCardCreation(
  created: Record<string, unknown>,
  tags: string[],
  context: MymindActionContext,
): Promise<Record<string, unknown>> {
  const cardId = optionalString(created.id);
  if (tags.length === 0) {
    return { cardId: cardId ?? "", card: created, tags };
  }
  if (!cardId) {
    throw new ProviderRequestError(502, "mymind created the card without returning an id, so tags were not applied.");
  }

  // mymind tags one card at a time; keep the order the caller asked for.
  for (const tag of tags) {
    await requestMymind({ method: "POST", path: `${objectPath(cardId)}/tags`, body: { name: tag }, context });
  }
  return { cardId, card: created, tags };
}

async function requestMymind(input: MymindRequestInput): Promise<Response> {
  const url = new URL(mymindApiBaseUrl);
  url.pathname = input.path;
  if (input.query) {
    setSearchParams(url, input.query);
  }

  const headers = new Headers({
    accept: input.accept ?? "application/json",
    "user-agent": providerUserAgent,
  });
  applyMymindRequestHeaders(input.context.credential, headers);

  const timeout = createProviderTimeout(input.context.signal, mymindRequestTimeoutMs);
  const init: RequestInit = {
    method: input.method,
    headers,
    // mymind answers an expired session with a redirect to its sign-in page;
    // keep it as a response so it maps to an authorization error.
    redirect: "manual",
    signal: timeout.signal,
  };
  if (input.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(input.body);
  }

  try {
    const response = await input.context.fetcher(url, init);
    if (!response.ok) {
      throw await createMymindResponseError(response);
    }
    return response;
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      throw error;
    }
    if (timeout.didTimeout()) {
      throw new ProviderRequestError(504, "mymind request timed out");
    }
    if (isAbortSignalError(input.context.signal, error)) {
      throw error;
    }
    throw new ProviderRequestError(
      502,
      error instanceof Error ? `mymind request failed: ${error.message}` : "mymind request failed",
      error,
    );
  } finally {
    timeout.cleanup();
  }
}

async function requestMymindJson(input: MymindRequestInput): Promise<unknown> {
  return readProviderJsonBody(await requestMymind(input), {
    emptyBody: null,
    invalidJsonMessage: "mymind returned a non-JSON response",
  });
}

async function requestMymindRecord(input: MymindRequestInput): Promise<Record<string, unknown>> {
  return requiredRecord(await requestMymindJson(input), "mymind response", mymindProviderError);
}

async function requestMymindArray(input: MymindRequestInput): Promise<Array<Record<string, unknown>>> {
  return objectArray((await requestMymindJson(input)) ?? [], "mymind response", mymindProviderError);
}

async function createMymindResponseError(response: Response): Promise<ProviderRequestError> {
  if (response.status === 302 || response.status === 401 || response.status === 403) {
    return new ProviderRequestError(
      401,
      "mymind rejected the stored session. Copy fresh _jwt, _cid, and x-authenticity-token values from a signed-in mymind request and update the connection.",
    );
  }

  const body = await readProviderTextBody(response, "mymind error response", 4096).catch(() => "");
  const detail = body.trim().slice(0, 200);
  return new ProviderRequestError(
    response.status >= 500 ? 502 : response.status,
    `mymind request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
  );
}

function normalizeMymindSpace(space: Record<string, unknown>): Record<string, unknown> {
  const query = optionalRecord(space.query);
  return {
    id: optionalString(space.id) ?? "",
    name: optionalString(space.name) ?? "",
    color: optionalString(space.color) ?? "",
    smart: query != null,
    filters: optionalStringArray(query?.filters) ?? [],
    cardCount: Array.isArray(space.objects) ? space.objects.length : 0,
  };
}

function isCustomMymindTag(tag: Record<string, unknown>): boolean {
  return optionalNumber(tag.flags) === mymindCustomTagFlag;
}

function scaleCardImage(object: Record<string, unknown>, maxWidth: number): { width: number; height: number } {
  const width = optionalNumber(object.width);
  const height = optionalNumber(object.height);
  if (!width || !height || width <= maxWidth) {
    return { width: Math.round(width ?? maxWidth), height: Math.round(height ?? maxWidth) };
  }
  return { width: maxWidth, height: Math.round(height * (maxWidth / width)) };
}

function readCardId(input: Record<string, unknown>): string {
  return requiredString(input.cardId, "cardId", mymindInputError);
}

function objectPath(cardId: string): string {
  return `/objects/${encodeURIComponent(cardId)}`;
}

function cardPath(cardId: string): string {
  return `/cards/${encodeURIComponent(cardId)}`;
}

function spacePath(spaceId: string): string {
  return `/spaces/${encodeURIComponent(spaceId)}`;
}

function readTagList(value: unknown): string[] {
  const values = optionalStringArray(value);
  if (!values) {
    return [];
  }
  return uniqueValues(values.map((item) => item.trim()).filter((item) => item.length > 0));
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function readBoundedCount(value: unknown, field: string, fallback: number, maximum = 500): number {
  const count = optionalIntegerLike(value, field, mymindInputError) ?? fallback;
  if (count < 1) {
    throw mymindInputError(`${field} must be a positive integer`);
  }
  return Math.min(count, maximum);
}

function readSessionToken(values: Record<string, string>, field: string, source: string): string {
  const value = requiredString(values[field], field, mymindInputError);
  if (/[\s;,"\\]/u.test(value) || /[^\u0020-\u007E]/u.test(value)) {
    throw mymindInputError(`${field} must be the raw ${source} value, without quotes, spaces, or separators`);
  }
  return value;
}

function mymindInputError(message: string): ProviderRequestError {
  return new ProviderRequestError(400, message);
}

function mymindProviderError(message: string): ProviderRequestError {
  return new ProviderRequestError(502, message);
}

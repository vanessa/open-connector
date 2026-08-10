import type { ActionDefinition } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "mymind";

const cardIdSchema = s.nonEmptyString("The mymind card id, as returned in the `id` field of a card.");
const cardTagsSchema = s.stringArray("Tag names to apply to the new card, added after it is saved.", {
  itemDescription: "One mymind tag name.",
});
const cardTypeSchema = s.nonEmptyString(
  "Card type to filter by, matched case-insensitively. mymind assigns types while saving, such as `WebPage`, `Article`, `Image`, `XPost`, `YouTubeVideo`, `Video`, `Note`, `Snippet`, `Quotation`, `RedditPost`, `Product`, `Recipe`, `Book`, `Movie`, or `Document`. Tags are usually a better filter because the same subject is saved in many forms.",
);

const cardSchema = s.requiredObject("A card saved in mymind.", {
  id: s.string("The card id, used by every card-scoped mymind action."),
  title: s.string("The card title. Cards saved from social posts often use the first line of the post."),
  description: s.string("The card description mymind extracted from the source."),
  type: s.string("The card type mymind assigned while saving, such as `WebPage`, `Image`, or `Note`."),
  domain: s.string("The source domain, empty for cards created inside mymind."),
  sourceUrl: s.string("The original URL the card was saved from, empty for notes."),
  tags: s.stringArray("Tag names on the card, both user-created and mymind-generated."),
  createdAt: s.string("When mymind saved the card."),
  modifiedAt: s.string("When the card was last modified."),
  content: s.string("The card body as Markdown: note text, clipped prose, or a quotation."),
  note: s.string("The user's own note attached to the card, as Markdown."),
});

const cardObjectSchema = s.unknownObject(
  "The raw mymind card object. mymind has no published API, so the fields it returns are not a stable contract; `id`, `title`, `type`, `tags`, `created`, and `modified` are the ones it consistently includes.",
);
const tagSchema = s.looseObject("A tag in the mymind collection.", {
  id: s.optional(s.unknown("The tag id.")),
  name: s.optional(s.string("The tag name.")),
  flags: s.optional(s.integer("Tag flags. `8` marks a tag the user created rather than one mymind generated.")),
});
const spaceSchema = s.requiredObject("A mymind space, the collection mymind uses to group cards.", {
  id: s.string("The space id."),
  name: s.string("The space name."),
  color: s.string("The space color as a hex value."),
  smart: s.boolean("Whether the space auto-populates from filters instead of holding cards manually."),
  filters: s.stringArray("Filters that populate a smart space, empty for a manual space."),
  cardCount: s.nonNegativeInteger("How many cards the space holds. Always `0` for a smart space."),
});
const cardListOutputSchema = s.actionOutput(
  {
    cards: s.array("The matching cards, newest first.", cardSchema),
    count: s.nonNegativeInteger("How many cards were returned."),
  },
  "Cards from the mymind collection.",
);

/**
 * Actions for reading, saving, tagging, and organizing cards in a personal
 * mymind collection.
 */
export const mymindActions: readonly ActionDefinition[] = [
  defineProviderAction(service, {
    name: "search_cards",
    description:
      "Search a mymind collection. Text search runs on mymind's search index, while tag, domain, and card-type filters are applied to the collection; all provided filters are combined. Search tags first: call `mymind.list_tags` to see the real tag names, since mymind often stores them joined together such as `productlaunch`. Titles are unreliable for discovery because cards saved from social posts keep the first line of the post as the title, so judge each result by title and description together and return only cards that actually match.",
    inputSchema: s.object(
      {
        query: s.nonEmptyString(
          "Text matched against card titles, descriptions, and bodies. Prefer several short queries with different wording over one long phrase.",
        ),
        tags: s.stringArray("Tag names the card must all have, matched case-insensitively.", {
          itemDescription: "One mymind tag name.",
        }),
        domain: s.nonEmptyString("Source domain the card was saved from, such as `x.com` or `youtube.com`."),
        cardType: cardTypeSchema,
        limit: s.integer("Maximum cards to return.", { minimum: 1, maximum: 500, default: 50 }),
      },
      {
        required: [],
        description: "Search and filter criteria. With no criteria this returns the most recent cards.",
      },
    ),
    outputSchema: s.object(
      "Cards matching the search criteria.",
      {
        cards: s.array("The matching cards, newest first.", cardSchema),
        count: s.nonNegativeInteger("How many cards were returned."),
        matchCount: s.optional(
          s.nonNegativeInteger("How many cards mymind's text index matched, before the limit was applied."),
        ),
      },
      { optional: ["matchCount"] },
    ),
    followUpActions: ["mymind.get_card_content", "mymind.download_card_image"],
  }),

  defineProviderAction(service, {
    name: "list_recent_cards",
    description: "List the most recently saved or modified cards in a mymind collection.",
    inputSchema: s.object(
      { limit: s.integer("Maximum cards to return.", { minimum: 1, maximum: 500, default: 20 }) },
      { required: [], description: "How many recent cards to list." },
    ),
    outputSchema: cardListOutputSchema,
    followUpActions: ["mymind.get_card_content"],
  }),

  defineProviderAction(service, {
    name: "get_card",
    description:
      "Get one card by id, including its tags, spaces, and timestamps. Use this instead of searching again when a card id was stored earlier.",
    inputSchema: s.object({ cardId: cardIdSchema }, { description: "The card to read." }),
    outputSchema: s.actionOutput(
      { cardId: s.string("The card id that was read."), card: cardObjectSchema },
      "One mymind card object.",
    ),
  }),

  defineProviderAction(service, {
    name: "get_cards",
    description:
      "Get several cards by id in one call. Use this when card ids were stored elsewhere and their details are needed without searching.",
    inputSchema: s.object(
      {
        cardIds: s.stringArray("Card ids to read. Duplicates are ignored.", {
          minItems: 1,
          maxItems: 100,
          itemDescription: "One mymind card id.",
        }),
      },
      { description: "The cards to read." },
    ),
    outputSchema: s.actionOutput(
      {
        cards: s.array("The card objects that were found, in the requested order.", cardObjectSchema),
        count: s.nonNegativeInteger("How many cards were found."),
        missingCardIds: s.stringArray("Requested card ids that no longer exist in the collection."),
      },
      "mymind card objects resolved by id.",
    ),
  }),

  defineProviderAction(service, {
    name: "get_card_content",
    description:
      "Get the full content of one card: its title, description, body, and attached note, with the rich-text body rendered as Markdown.",
    inputSchema: s.object({ cardId: cardIdSchema }, { description: "The card to read." }),
    outputSchema: s.actionOutput(
      {
        cardId: s.string("The card id that was read."),
        card: cardObjectSchema,
        content: s.string("The card body as Markdown, empty when the card has no body."),
        note: s.string("The user's own note on the card as Markdown, empty when there is none."),
      },
      "The full content of one mymind card.",
    ),
  }),

  defineProviderAction(service, {
    name: "download_card_image",
    description:
      "Download a card's image into local transit file storage. mymind serves card images only to an authenticated session, so they cannot be linked to directly; link cards by their `sourceUrl` instead and use this action when the image itself is needed.",
    inputSchema: s.object(
      {
        cardId: cardIdSchema,
        maxWidth: s.integer("Maximum image width in pixels. The height scales with it.", {
          minimum: 1,
          maximum: 4096,
          default: 1024,
        }),
      },
      { optional: ["maxWidth"], description: "The card image to download." },
    ),
    outputSchema: s.actionOutput(
      {
        cardId: s.string("The card the image belongs to."),
        width: s.positiveInteger("The delivered image width in pixels."),
        height: s.positiveInteger("The delivered image height in pixels."),
        file: s.requiredObject("The image stored in local transit file storage.", {
          fileId: s.string("The transit file id for the local file API."),
          downloadUrl: s.string("The local URL for downloading the stored image."),
          sizeBytes: s.nonNegativeInteger("The stored image size in bytes."),
          name: s.string("The stored file name."),
          mimeType: s.string("The stored file MIME type."),
        }),
      },
      "A card image stored locally for download.",
    ),
  }),

  defineProviderAction(service, {
    name: "create_note",
    description:
      "Create a note card in mymind from Markdown. Headings, lists, task lists, quotes, code blocks, and inline formatting are converted to mymind's rich text.",
    inputSchema: s.object(
      {
        content: s.nonWhitespaceString("The note body as Markdown."),
        title: s.nonEmptyString("The note title. mymind shows the body when this is omitted."),
        tags: cardTagsSchema,
      },
      { optional: ["title", "tags"], description: "The note to create." },
    ),
    outputSchema: s.actionOutput(
      {
        cardId: s.string("The id of the created card."),
        card: cardObjectSchema,
        tags: s.stringArray("Tags that were applied to the new card."),
      },
      "The card mymind created.",
    ),
  }),

  defineProviderAction(service, {
    name: "save_url",
    description:
      "Save a URL to mymind as a bookmark card. mymind fetches the page and fills in the title, description, image, and its own tags.",
    inputSchema: s.object(
      {
        url: s.url("The URL to save."),
        tags: cardTagsSchema,
      },
      { optional: ["tags"], description: "The URL to save." },
    ),
    outputSchema: s.actionOutput(
      {
        cardId: s.string("The id of the created card."),
        card: cardObjectSchema,
        tags: s.stringArray("Tags that were applied to the new card."),
      },
      "The card mymind created.",
    ),
  }),

  defineProviderAction(service, {
    name: "update_card",
    description: "Rename a card.",
    inputSchema: s.object(
      { cardId: cardIdSchema, title: s.nonWhitespaceString("The new card title.") },
      { description: "The card title to set." },
    ),
    outputSchema: s.actionOutput(
      { cardId: s.string("The card that was updated."), card: cardObjectSchema },
      "The updated mymind card object.",
    ),
  }),

  defineProviderAction(service, {
    name: "delete_card",
    description: "Delete a card from mymind.",
    inputSchema: s.object({ cardId: cardIdSchema }, { description: "The card to delete." }),
    outputSchema: s.actionOutput(
      { cardId: s.string("The card that was deleted."), deleted: s.literal(true, { description: "Always `true`." }) },
      "Confirmation that the card was deleted.",
    ),
  }),

  defineProviderAction(service, {
    name: "list_tags",
    description:
      "List the tags in a mymind collection, most used first. Call this before searching by tag: mymind often stores multi-word tags joined together, such as `productlaunch`. User-created tags describe how the user actually organizes their collection, while mymind-generated tags are broader and noisier.",
    inputSchema: s.object(
      {
        customOnly: s.boolean({
          description: "Return only tags the user created, excluding the ones mymind generated.",
          default: false,
        }),
        limit: s.integer("Maximum tags to return.", { minimum: 1, maximum: 500, default: 50 }),
      },
      { required: [], description: "Which tags to list." },
    ),
    outputSchema: s.actionOutput(
      {
        tags: s.array("The tags, most used first.", tagSchema),
        count: s.nonNegativeInteger("How many tags were returned."),
        totalCount: s.nonNegativeInteger("How many tags matched before the limit was applied."),
      },
      "Tags in the mymind collection.",
    ),
    followUpActions: ["mymind.search_cards"],
  }),

  defineProviderAction(service, {
    name: "get_card_tags",
    description: "List the tags on one card.",
    inputSchema: s.object({ cardId: cardIdSchema }, { description: "The card to read tags from." }),
    outputSchema: s.actionOutput(
      {
        cardId: s.string("The card the tags belong to."),
        tags: s.array("The tags on the card.", tagSchema),
        count: s.nonNegativeInteger("How many tags the card has."),
      },
      "Tags on one mymind card.",
    ),
  }),

  defineProviderAction(service, {
    name: "add_card_tag",
    description: "Add a tag to a card. mymind creates the tag when it does not exist yet.",
    inputSchema: s.object(
      { cardId: cardIdSchema, tag: s.nonWhitespaceString("The tag name to add.") },
      { description: "The tag to add." },
    ),
    outputSchema: s.actionOutput(
      {
        cardId: s.string("The card that was tagged."),
        tag: s.string("The tag that was added."),
        added: s.literal(true, { description: "Always `true`." }),
      },
      "Confirmation that the tag was added.",
    ),
  }),

  defineProviderAction(service, {
    name: "remove_card_tag",
    description: "Remove a tag from a card. The tag itself stays in the collection.",
    inputSchema: s.object(
      { cardId: cardIdSchema, tag: s.nonWhitespaceString("The tag name to remove.") },
      { description: "The tag to remove." },
    ),
    outputSchema: s.actionOutput(
      {
        cardId: s.string("The card the tag was removed from."),
        tag: s.string("The tag that was removed."),
        removed: s.literal(true, { description: "Always `true`." }),
      },
      "Confirmation that the tag was removed.",
    ),
  }),

  defineProviderAction(service, {
    name: "list_spaces",
    description: "List the spaces in a mymind collection, both the manual ones and the smart ones built from filters.",
    inputSchema: s.object({}, { required: [], description: "This action takes no input." }),
    outputSchema: s.actionOutput(
      {
        spaces: s.array("The spaces in the collection.", spaceSchema),
        count: s.nonNegativeInteger("How many spaces the collection has."),
      },
      "Spaces in the mymind collection.",
    ),
    followUpActions: ["mymind.get_space_cards"],
  }),

  defineProviderAction(service, {
    name: "get_space_cards",
    description:
      "List the cards held in one space. Smart spaces return no cards here because mymind resolves their filters when the space is opened; use `mymind.search_cards` with the space filters instead.",
    inputSchema: s.object(
      {
        spaceId: s.nonEmptyString("The space id, as returned by `mymind.list_spaces`."),
        limit: s.integer("Maximum cards to return.", { minimum: 1, maximum: 500, default: 50 }),
      },
      { optional: ["limit"], description: "The space to read." },
    ),
    outputSchema: s.actionOutput(
      {
        spaceId: s.string("The space that was read."),
        name: s.string("The space name."),
        cards: s.array("The cards in the space.", cardSchema),
        count: s.nonNegativeInteger("How many cards were returned."),
      },
      "Cards held in one mymind space.",
    ),
  }),

  defineProviderAction(service, {
    name: "create_space",
    description:
      "Create a space. Without filters this creates a manual space that cards are added to by hand. With filters it creates a smart space that mymind keeps populated: each filter is a text query such as `design`, a type query such as `type:webpage`, or alternatives joined with `||` such as `design || branding`, and multiple filters are combined.",
    inputSchema: s.object(
      {
        name: s.nonWhitespaceString("The space name."),
        color: s.string("The space color as a hex value.", { pattern: "^#[0-9A-Fa-f]{6}$", default: "#fdf06f" }),
        filters: s.stringArray("Filters that populate a smart space. Omit this for a manual space.", {
          itemDescription: "One mymind filter query, such as `design` or `type:webpage`.",
        }),
      },
      { optional: ["color", "filters"], description: "The space to create." },
    ),
    outputSchema: s.actionOutput({ space: spaceSchema }, "The space mymind created."),
  }),

  defineProviderAction(service, {
    name: "delete_space",
    description: "Delete a space. The cards it held stay in the collection.",
    inputSchema: s.object(
      { spaceId: s.nonEmptyString("The space id to delete.") },
      { description: "The space to delete." },
    ),
    outputSchema: s.actionOutput(
      {
        spaceId: s.string("The space that was deleted."),
        deleted: s.literal(true, { description: "Always `true`." }),
      },
      "Confirmation that the space was deleted.",
    ),
  }),
];

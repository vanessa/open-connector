import type { ProviderDefinition } from "../../core/types.ts";

import { mymindActions } from "./actions.ts";

const service = "mymind";

const sessionSetupSteps =
  "mymind has no public API or token page, so this comes from a signed-in browser session: sign in at https://mymind.com, open the browser network inspector, reload, select the request to `access.mymind.com/cards`, and copy the value from that request.";

/**
 * mymind provider backed by the app API behind the mymind web client.
 */
export const provider: ProviderDefinition = {
  service,
  displayName: "mymind",
  description:
    "Search, read, save, and organize cards in a personal mymind collection, including notes, bookmarks, images, highlights, tags, and spaces.",
  categories: ["Productivity"],
  authTypes: ["custom_credential"],
  auth: [
    {
      type: "custom_credential",
      fields: [
        {
          key: "jwt",
          label: "Session JWT (_jwt cookie)",
          inputType: "password",
          required: true,
          secret: true,
          placeholder: "eyJhbGciOi...",
          description: `The \`_jwt\` cookie value of a signed-in mymind session. ${sessionSetupSteps} mymind expires the session periodically, and it then has to be copied again.`,
        },
        {
          key: "cid",
          label: "Client ID (_cid cookie)",
          inputType: "password",
          required: true,
          secret: true,
          description: `The \`_cid\` cookie value from the same signed-in mymind request as the session JWT.`,
        },
        {
          key: "authenticityToken",
          label: "Authenticity Token",
          inputType: "password",
          required: true,
          secret: true,
          description: `The \`x-authenticity-token\` request header value from the same signed-in mymind request. mymind rejects write requests without it.`,
        },
      ],
    },
  ],
  homepageUrl: "https://mymind.com",
  actions: mymindActions,
};

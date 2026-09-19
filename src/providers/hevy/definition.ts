import type { ProviderDefinition } from "../../core/types.ts";

import { hevyActions } from "./actions.ts";

const service = "hevy";

export const provider: ProviderDefinition = {
  service,
  displayName: "Hevy",
  description:
    "Read and write Hevy workouts, routines, routine folders, exercise templates, exercise history, and body measurements through the Hevy public API.",
  categories: ["Data"],
  authTypes: ["api_key"],
  auth: [
    {
      type: "api_key",
      label: "API Key",
      placeholder: "HEVY_API_KEY",
      description:
        "Hevy API key sent with the api-key header. Generate it in the Hevy web app under Settings > Developer (https://hevy.com/settings?developer). The public API is only available to Hevy Pro accounts: https://api.hevyapp.com/docs/",
    },
  ],
  homepageUrl: "https://www.hevyapp.com",
  actions: hevyActions,
};

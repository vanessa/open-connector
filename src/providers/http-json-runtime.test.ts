import type { ProviderFetch } from "./provider-runtime.ts";

import { describe, expect, it } from "vitest";
import { requestJson } from "./http-json-runtime.ts";
import { ProviderRequestError } from "./provider-runtime.ts";

describe("requestJson error responses", () => {
  it("keeps the status and message of a failure that answers in plain text", async () => {
    // Hevy answers some 404s with a bare "Workout not found" body. Parsing the
    // body before checking the status would report that as a 502 parse failure
    // and lose both the real status and the reason.
    const error = await requestJson(options(new Response("Workout not found", { status: 404 }))).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(ProviderRequestError);
    expect(error).toMatchObject({ status: 400, message: "Workout not found" });
  });

  it("still reports an unparseable success body as an upstream failure", async () => {
    const error = await requestJson(options(new Response("<html>", { status: 200 }))).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toMatchObject({ status: 502, message: "Test returned invalid JSON" });
  });

  it("reads the error field out of a JSON failure body", async () => {
    const response = new Response(JSON.stringify({ error: "Routine not found" }), { status: 404 });
    const error = await requestJson(options(response)).catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ status: 400, message: "Routine not found" });
  });
});

function options(response: Response): Parameters<typeof requestJson>[0] {
  const fetcher: ProviderFetch = async () => response;
  return { providerName: "Test", baseUrl: "https://example.test", path: "/thing", fetcher };
}

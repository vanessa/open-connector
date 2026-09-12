import type { QueryValue } from "../../core/request.ts";
import type { CredentialValidators, ProviderExecutors, ProviderProxyExecutor } from "../../core/types.ts";
import type { ProviderRequestPhase } from "../http-json-runtime.ts";
import type { ApiKeyProviderContext, ProviderActionHandlers, ProviderRuntimeHandler } from "../provider-runtime.ts";

import {
  compactObject,
  integer,
  looseArray,
  optionalInteger,
  optionalRecord,
  optionalString,
} from "../../core/cast.ts";
import { encodePathSegment } from "../../core/request.ts";
import { objectPayload, requestJson } from "../http-json-runtime.ts";
import {
  defineApiKeyProviderExecutors,
  defineProviderProxy,
  providerInputError,
  providerResponseError,
  requiredInputString,
  requiredResponseRecord,
} from "../provider-runtime.ts";
import {
  bodyMeasurementValues,
  customExerciseRequestBody,
  routineRequestBody,
  workoutRequestBody,
} from "./payloads.ts";

const service = "hevy";
const hevyApiBaseUrl = "https://api.hevyapp.com/v1";
const hevyApiKeyHeader = "api-key";
const hevyUserInfoPath = "/user/info";

type HevyContext = Pick<ApiKeyProviderContext, "apiKey" | "fetcher" | "signal">;
type HevyActionHandler = ProviderRuntimeHandler<ApiKeyProviderContext>;

interface HevyRequestOptions {
  path: string;
  method?: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  phase?: ProviderRequestPhase;
  acceptText?: boolean;
}

export const hevyActionHandlers: ProviderActionHandlers<"hevy", HevyActionHandler> = {
  async list_workouts(input, context) {
    return pagedOutput(
      "workouts",
      "workouts",
      await hevyRequest({ path: "/workouts", query: pageQuery(input) }, context),
    );
  },
  async get_workout(input, context) {
    const path = `/workouts/${pathSegment(input.workoutId, "workoutId")}`;
    return { workout: hevyEntity(await hevyRequest({ path }, context), "workout") };
  },
  async create_workout(input, context) {
    const raw = await hevyRequest(
      { path: "/workouts", method: "POST", body: workoutRequestBody(input.workout) },
      context,
    );
    return { workout: hevyEntity(raw, "workout") };
  },
  async update_workout(input, context) {
    const raw = await hevyRequest(
      {
        path: `/workouts/${pathSegment(input.workoutId, "workoutId")}`,
        method: "PUT",
        body: workoutRequestBody(input.workout),
      },
      context,
    );
    return { workout: hevyEntity(raw, "workout") };
  },
  async get_workout_count(_input, context) {
    const payload = objectPayload(await hevyRequest({ path: "/workouts/count" }, context), "workout count");
    const workoutCount = optionalInteger(payload.workout_count);
    if (workoutCount === undefined) {
      throw providerResponseError("Hevy returned a workout count response without a workout_count field");
    }
    return { workoutCount };
  },
  async list_workout_events(input, context) {
    const raw = await hevyRequest(
      { path: "/workouts/events", query: { ...pageQuery(input), since: optionalString(input.since) } },
      context,
    );
    return pagedOutput("events", "events", raw);
  },
  async get_user_info(_input, context) {
    const payload = objectPayload(await hevyRequest({ path: hevyUserInfoPath }, context), "user info");
    return { user: hevyUser(payload) };
  },
  async list_routines(input, context) {
    return pagedOutput(
      "routines",
      "routines",
      await hevyRequest({ path: "/routines", query: pageQuery(input) }, context),
    );
  },
  async get_routine(input, context) {
    const path = `/routines/${pathSegment(input.routineId, "routineId")}`;
    return { routine: hevyEntity(await hevyRequest({ path }, context), "routine") };
  },
  async create_routine(input, context) {
    const raw = await hevyRequest(
      { path: "/routines", method: "POST", body: routineRequestBody(input.routine) },
      context,
    );
    return { routine: hevyEntity(raw, "routine") };
  },
  async update_routine(input, context) {
    const raw = await hevyRequest(
      {
        path: `/routines/${pathSegment(input.routineId, "routineId")}`,
        method: "PUT",
        body: routineRequestBody(input.routine),
      },
      context,
    );
    return { routine: hevyEntity(raw, "routine") };
  },
  async list_routine_folders(input, context) {
    const raw = await hevyRequest({ path: "/routine_folders", query: pageQuery(input) }, context);
    return pagedOutput("routine_folders", "routineFolders", raw);
  },
  async get_routine_folder(input, context) {
    const path = `/routine_folders/${integer(input.folderId, "folderId", providerInputError)}`;
    return { routineFolder: hevyEntity(await hevyRequest({ path }, context), "routine_folder") };
  },
  async create_routine_folder(input, context) {
    const raw = await hevyRequest(
      {
        path: "/routine_folders",
        method: "POST",
        body: { routine_folder: { title: requiredInputString(input.title, "title") } },
      },
      context,
    );
    return { routineFolder: hevyEntity(raw, "routine_folder") };
  },
  async list_exercise_templates(input, context) {
    const raw = await hevyRequest({ path: "/exercise_templates", query: pageQuery(input) }, context);
    return pagedOutput("exercise_templates", "exerciseTemplates", raw);
  },
  async get_exercise_template(input, context) {
    const path = `/exercise_templates/${pathSegment(input.exerciseTemplateId, "exerciseTemplateId")}`;
    return { exerciseTemplate: objectPayload(await hevyRequest({ path }, context), "exercise template") };
  },
  async create_exercise_template(input, context) {
    const raw = await hevyRequest(
      {
        path: "/exercise_templates",
        method: "POST",
        body: customExerciseRequestBody(input.exercise),
        acceptText: true,
      },
      context,
    );
    return { exerciseTemplateId: createdExerciseTemplateId(raw) };
  },
  async get_exercise_history(input, context) {
    const raw = await hevyRequest(
      {
        path: `/exercise_history/${pathSegment(input.exerciseTemplateId, "exerciseTemplateId")}`,
        query: { start_date: optionalString(input.startDate), end_date: optionalString(input.endDate) },
      },
      context,
    );
    return { exerciseHistory: looseArray(objectPayload(raw, "exercise history").exercise_history) };
  },
  async list_body_measurements(input, context) {
    const raw = await hevyRequest({ path: "/body_measurements", query: pageQuery(input) }, context);
    return pagedOutput("body_measurements", "bodyMeasurements", raw);
  },
  async get_body_measurement(input, context) {
    const path = `/body_measurements/${pathSegment(input.date, "date")}`;
    return { bodyMeasurement: objectPayload(await hevyRequest({ path }, context), "body measurement") };
  },
  async create_body_measurement(input, context) {
    const date = requiredInputString(input.date, "date");
    await hevyRequest(
      { path: "/body_measurements", method: "POST", body: { date, ...bodyMeasurementValues(input.measurement) } },
      context,
    );
    return { date };
  },
  async update_body_measurement(input, context) {
    const date = requiredInputString(input.date, "date");
    await hevyRequest(
      {
        path: `/body_measurements/${encodePathSegment(date)}`,
        method: "PUT",
        body: bodyMeasurementValues(input.measurement),
      },
      context,
    );
    return { date };
  },
};

export const executors: ProviderExecutors = defineApiKeyProviderExecutors(service, hevyActionHandlers, {
  skipDnsValidation: true,
});

export const proxy: ProviderProxyExecutor = defineProviderProxy({
  service,
  baseUrl: hevyApiBaseUrl,
  auth: { type: "api_key_header", name: hevyApiKeyHeader },
  skipDnsValidation: true,
});

export const credentialValidators: CredentialValidators = {
  async apiKey(input, { fetcher, signal }) {
    const payload = objectPayload(
      await hevyRequest({ path: hevyUserInfoPath, phase: "validate" }, { apiKey: input.apiKey, fetcher, signal }),
      "user info",
    );
    const user = hevyUser(payload);
    return {
      profile: {
        accountId: optionalString(user.id),
        displayName: optionalString(user.name) ?? "Hevy account",
      },
      grantedScopes: [],
      metadata: compactObject({
        apiBaseUrl: hevyApiBaseUrl,
        validationEndpoint: hevyUserInfoPath,
        profileUrl: optionalString(user.url),
      }),
    };
  },
};

function hevyRequest(options: HevyRequestOptions, context: HevyContext): Promise<unknown> {
  return requestJson({
    providerName: "Hevy",
    baseUrl: hevyApiBaseUrl,
    path: options.path,
    method: options.method,
    query: options.query,
    body: options.body,
    phase: options.phase,
    acceptText: options.acceptText,
    fetcher: context.fetcher,
    signal: context.signal,
    headers: { [hevyApiKeyHeader]: context.apiKey },
  });
}

/**
 * Shape one Hevy paged listing, whose items live under a snake_case response
 * key, into the camelCase envelope the action output schema declares.
 */
function pagedOutput(responseKey: string, outputKey: string, raw: unknown): Record<string, unknown> {
  const payload = objectPayload(raw, responseKey);
  return {
    page: optionalInteger(payload.page),
    pageCount: optionalInteger(payload.page_count),
    [outputKey]: looseArray(payload[responseKey]),
  };
}

/**
 * Read one entity out of a Hevy response.
 *
 * Hevy documents every single-entity endpoint as returning the bare entity,
 * and then does something different per endpoint: `GET /workouts/{id}` and
 * `GET /routine_folders/{id}` are bare, `POST /routines` wraps the routine in
 * `routine`, `POST /routine_folders` wraps in `routine_folder`, and both
 * `POST /workouts` and the two PUTs wrap a single entity in a one-element
 * array. Unwrapping the documented key and then the array covers every shape
 * without the caller having to know which endpoint answered.
 */
function hevyEntity(raw: unknown, key: string): Record<string, unknown> {
  const payload = requiredResponseRecord(raw, key);
  const wrapped = key in payload ? payload[key] : payload;
  const entity = Array.isArray(wrapped) ? wrapped[0] : wrapped;
  return requiredResponseRecord(entity, key);
}

/**
 * Read the id of a newly created custom exercise template. Hevy documents this
 * response as `{ id: number }` and actually answers with the bare id as text.
 */
function createdExerciseTemplateId(raw: unknown): string {
  const id = optionalString(raw) ?? optionalString(requiredResponseRecord(raw, "exercise template").id);
  if (!id) {
    throw providerResponseError("Hevy created an exercise template without returning its id");
  }
  return id;
}

/**
 * Read the account out of a Hevy user info response. Hevy documents the
 * response as `{ data: UserInfo }`; the flat fallback keeps the action and the
 * credential validator working when the envelope is absent.
 */
function hevyUser(payload: Record<string, unknown>): Record<string, unknown> {
  return optionalRecord(payload.data) ?? payload;
}

function pageQuery(input: Record<string, unknown>): Record<string, QueryValue> {
  return { page: optionalInteger(input.page), pageSize: optionalInteger(input.pageSize) };
}

function pathSegment(value: unknown, fieldName: string): string {
  return encodePathSegment(requiredInputString(value, fieldName));
}

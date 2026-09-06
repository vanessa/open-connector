import type { JsonSchema } from "../../core/types.ts";
import type { ApiKeyProviderContext, ProviderFetch } from "../provider-runtime.ts";

import { describe, expect, it } from "vitest";
import { ProviderRequestError } from "../provider-runtime.ts";
import { hevyActions } from "./actions.ts";
import { hevyActionHandlers } from "./executors.ts";

interface RecordedRequest {
  url: string;
  method: string;
  apiKey: string | undefined;
  body: unknown;
}

describe("Hevy action catalog", () => {
  it("caps each listing at the page size its endpoint accepts", () => {
    // Hevy allows 100 exercise templates per page and 10 items everywhere else.
    expect(inputProperty("list_exercise_templates", "pageSize").maximum).toBe(100);
    expect(inputProperty("list_workouts", "pageSize").maximum).toBe(10);
    expect(inputProperty("list_body_measurements", "pageSize").maximum).toBe(10);
  });

  it("models workout sets and routine sets as the different shapes Hevy accepts", () => {
    // A logged set carries an RPE; a planned routine set carries a rep range.
    expect(setProperties("create_workout", "workout")).toContain("rpe");
    expect(setProperties("create_workout", "workout")).not.toContain("repRange");
    expect(setProperties("create_routine", "routine")).toContain("repRange");
    expect(setProperties("create_routine", "routine")).not.toContain("rpe");
  });
});

describe("Hevy workout requests", () => {
  it("lists a page of workouts through the camelCase page envelope", async () => {
    const requests: RecordedRequest[] = [];
    const output = await hevyActionHandlers.list_workouts(
      { page: 2, pageSize: 10 },
      jsonContext({ page: 2, page_count: 7, workouts: [{ id: "workout-1" }] }, requests),
    );

    expect(requests[0]?.url).toBe("https://api.hevyapp.com/v1/workouts?page=2&pageSize=10");
    expect(requests[0]?.apiKey).toBe("test-api-key");
    expect(output).toEqual({ page: 2, pageCount: 7, workouts: [{ id: "workout-1" }] });
  });

  it("writes a workout in the snake_case shape Hevy expects", async () => {
    const requests: RecordedRequest[] = [];
    await hevyActionHandlers.create_workout(
      {
        workout: {
          title: "Friday Leg Day",
          startTime: "2024-08-14T12:00:00Z",
          endTime: "2024-08-14T12:30:00Z",
          isPrivate: true,
          exercises: [
            {
              exerciseTemplateId: "D04AC939",
              notes: "Form was on point.",
              sets: [{ type: "normal", weightKg: 100, reps: 10, rpe: 9.5 }],
            },
          ],
        },
      },
      jsonContext({ id: "workout-1" }, requests),
    );

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.body).toEqual({
      workout: {
        title: "Friday Leg Day",
        start_time: "2024-08-14T12:00:00Z",
        end_time: "2024-08-14T12:30:00Z",
        is_private: true,
        exercises: [
          {
            exercise_template_id: "D04AC939",
            notes: "Form was on point.",
            sets: [{ type: "normal", weight_kg: 100, reps: 10, rpe: 9.5 }],
          },
        ],
      },
    });
  });

  it("reads the workout out of the one-element array a write answers with", async () => {
    // Hevy documents POST /v1/workouts as returning the bare workout and
    // actually wraps it in `workout` as a one-element array.
    const created = { id: "workout-1", title: "Friday Leg Day" };

    await expect(
      hevyActionHandlers.create_workout(
        { workout: { title: "Friday Leg Day", startTime: "t", endTime: "t", exercises: [] } },
        jsonContext({ workout: [created] }, []),
      ),
    ).resolves.toEqual({ workout: created });
  });

  it("reads the workout a read answers with unwrapped", async () => {
    // The matching GET is bare, so both shapes have to work.
    const workout = { id: "workout-1", title: "Friday Leg Day" };

    await expect(hevyActionHandlers.get_workout({ workoutId: "workout-1" }, jsonContext(workout, []))).resolves.toEqual(
      { workout },
    );
  });

  it("reports a workout count response without a count as an upstream failure", async () => {
    await expect(hevyActionHandlers.get_workout_count({}, jsonContext({ count: 42 }, []))).rejects.toThrow(
      ProviderRequestError,
    );
  });
});

describe("Hevy routine requests", () => {
  it('keeps an explicit null folder id, which Hevy reads as the default "My Routines" folder', async () => {
    const requests: RecordedRequest[] = [];
    await hevyActionHandlers.create_routine(
      {
        routine: {
          title: "April Leg Day",
          folderId: null,
          exercises: [
            {
              exerciseTemplateId: "D04AC939",
              restSeconds: 90,
              sets: [{ type: "normal", repRange: { start: 8, end: 12 } }],
            },
          ],
        },
      },
      jsonContext({ id: "routine-1" }, requests),
    );

    expect(requests[0]?.body).toEqual({
      routine: {
        title: "April Leg Day",
        folder_id: null,
        exercises: [
          {
            exercise_template_id: "D04AC939",
            rest_seconds: 90,
            sets: [{ type: "normal", rep_range: { start: 8, end: 12 } }],
          },
        ],
      },
    });
  });

  it("omits a folder id that was not provided", async () => {
    const requests: RecordedRequest[] = [];
    await hevyActionHandlers.create_routine(
      { routine: { title: "April Leg Day", exercises: [] } },
      jsonContext({ id: "routine-1" }, requests),
    );

    expect(requests[0]?.body).toEqual({ routine: { title: "April Leg Day", exercises: [] } });
  });
});

describe("Hevy routine folder and exercise template writes", () => {
  it("reads the folder out of the snake_case envelope a write answers with", async () => {
    const folder = { id: 12, title: "Push Pull" };

    await expect(
      hevyActionHandlers.create_routine_folder({ title: "Push Pull" }, jsonContext({ routine_folder: folder }, [])),
    ).resolves.toEqual({ routineFolder: folder });
  });

  it("reads the bare template id Hevy answers a custom exercise write with", async () => {
    // Hevy documents this response as `{ id: number }` and answers with the
    // id alone, as text/html.
    const requests: RecordedRequest[] = [];
    const output = await hevyActionHandlers.create_exercise_template(
      {
        exercise: {
          title: "Bench Press",
          exerciseType: "weight_reps",
          equipmentCategory: "barbell",
          muscleGroup: "chest",
        },
      },
      providerContext(requests, () => new Response("7daae8b1-3995-40dc-a999-91d1d4bbc709", { status: 200 })),
    );

    expect(requests[0]?.body).toEqual({
      exercise: {
        title: "Bench Press",
        exercise_type: "weight_reps",
        equipment_category: "barbell",
        muscle_group: "chest",
      },
    });
    expect(output).toEqual({ exerciseTemplateId: "7daae8b1-3995-40dc-a999-91d1d4bbc709" });
  });
});

describe("Hevy body measurement requests", () => {
  it("updates the entry for one date and returns the date it wrote", async () => {
    const requests: RecordedRequest[] = [];
    const output = await hevyActionHandlers.update_body_measurement(
      { date: "2024-08-14", measurement: { weightKg: 80.5, leftBicepCm: 35 } },
      emptyContext(requests),
    );

    expect(requests[0]?.method).toBe("PUT");
    expect(requests[0]?.url).toBe("https://api.hevyapp.com/v1/body_measurements/2024-08-14");
    expect(requests[0]?.body).toEqual({ weight_kg: 80.5, left_bicep_cm: 35 });
    expect(output).toEqual({ date: "2024-08-14" });
  });
});

describe("Hevy account and history requests", () => {
  it("unwraps the documented user info envelope", async () => {
    const user = { id: "9c465af3", name: "John Doe", url: "https://hevy.com/user/john" };

    await expect(hevyActionHandlers.get_user_info({}, jsonContext({ data: user }, []))).resolves.toEqual({ user });
  });

  it("filters exercise history with the snake_case date range Hevy documents", async () => {
    const requests: RecordedRequest[] = [];
    const output = await hevyActionHandlers.get_exercise_history(
      { exerciseTemplateId: "D04AC939", startDate: "2024-01-01T00:00:00Z", endDate: "2024-02-01T00:00:00Z" },
      jsonContext({ exercise_history: [{ workout_id: "workout-1" }] }, requests),
    );

    expect(requests[0]?.url).toBe(
      "https://api.hevyapp.com/v1/exercise_history/D04AC939?start_date=2024-01-01T00%3A00%3A00Z&end_date=2024-02-01T00%3A00%3A00Z",
    );
    expect(output).toEqual({ exerciseHistory: [{ workout_id: "workout-1" }] });
  });
});

function jsonContext(payload: unknown, requests: RecordedRequest[]): ApiKeyProviderContext {
  return providerContext(
    requests,
    () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }),
  );
}

function emptyContext(requests: RecordedRequest[]): ApiKeyProviderContext {
  return providerContext(requests, () => new Response(null, { status: 200 }));
}

function providerContext(requests: RecordedRequest[], createResponse: () => Response): ApiKeyProviderContext {
  const fetcher: ProviderFetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      apiKey: headers.get("api-key") ?? undefined,
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    });
    return createResponse();
  };
  return { apiKey: "test-api-key", fetcher };
}

function inputProperty(actionName: string, propertyName: string): JsonSchema {
  const properties = actionInputSchema(actionName).properties as Record<string, JsonSchema>;
  return properties[propertyName] as JsonSchema;
}

function setProperties(actionName: string, entityName: string): string[] {
  const entity = inputProperty(actionName, entityName);
  const exercises = (entity.properties as Record<string, JsonSchema>).exercises as JsonSchema;
  const exercise = exercises.items as JsonSchema;
  const sets = (exercise.properties as Record<string, JsonSchema>).sets as JsonSchema;
  return Object.keys((sets.items as JsonSchema).properties as Record<string, JsonSchema>);
}

function actionInputSchema(actionName: string): JsonSchema {
  const action = hevyActions.find(({ name }) => name === actionName);
  if (!action) {
    throw new Error(`unknown Hevy action: ${actionName}`);
  }
  return action.inputSchema;
}

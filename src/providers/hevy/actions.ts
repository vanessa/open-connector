import type { ProviderActionDefinition } from "../../core/provider-definition.ts";
import type { JsonSchema } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "hevy" as const;

/** Set types Hevy logs for a workout or routine set. */
const setTypes = ["warmup", "normal", "failure", "dropset"];

/** Rating of Perceived Exertion values Hevy accepts on a logged set. */
const rpeValues = [6, 7, 7.5, 8, 8.5, 9, 9.5, 10];

/** Set-tracking modes Hevy supports for a custom exercise template. */
const customExerciseTypes = [
  "weight_reps",
  "reps_only",
  "bodyweight_reps",
  "bodyweight_assisted_reps",
  "duration",
  "weight_duration",
  "distance_duration",
  "short_distance_weight",
];

/** Muscle groups Hevy assigns to an exercise template. */
const muscleGroups = [
  "abdominals",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "quadriceps",
  "hamstrings",
  "calves",
  "glutes",
  "abductors",
  "adductors",
  "lats",
  "upper_back",
  "traps",
  "lower_back",
  "chest",
  "cardio",
  "neck",
  "full_body",
  "other",
];

/** Equipment categories Hevy assigns to an exercise template. */
const equipmentCategories = [
  "none",
  "barbell",
  "dumbbell",
  "kettlebell",
  "machine",
  "plate",
  "resistance_band",
  "suspension",
  "other",
];

const pageField = s.positiveInteger("Page number to request. Hevy pages start at 1.");
const smallPageSizeField = s.integer({
  minimum: 1,
  maximum: 10,
  description: "Number of items on the requested page. Hevy allows at most 10 for this endpoint.",
});
const largePageSizeField = s.integer({
  minimum: 1,
  maximum: 100,
  description: "Number of items on the requested page. Hevy allows at most 100 for this endpoint.",
});
const workoutIdField = s.nonEmptyString("The Hevy workout ID.");
const routineIdField = s.nonEmptyString("The Hevy routine ID.");
const exerciseTemplateIdField = s.nonEmptyString("The Hevy exercise template ID.");
const measurementDateField = s.date("The body measurement date in YYYY-MM-DD form.");
const pageOutputField = s.integer("The page number Hevy returned.");
const pageCountOutputField = s.integer("The total number of pages available for this listing.");

const rpeField: JsonSchema = {
  type: "number",
  enum: rpeValues,
  description: "Rating of Perceived Exertion logged for the set. Hevy accepts 6, 7, 7.5, 8, 8.5, 9, 9.5, and 10.",
};

const repRangeField = s.object("Target rep range for the set.", {
  start: s.nonNegativeInteger("Lowest rep count in the range."),
  end: s.nonNegativeInteger("Highest rep count in the range."),
});

const workoutSetInputSchema = s.object(
  "A single set to log inside a Hevy workout exercise.",
  {
    type: s.stringEnum("The type of the set.", setTypes),
    weightKg: s.number("Weight lifted in kilograms."),
    reps: s.nonNegativeInteger("Number of repetitions performed."),
    distanceMeters: s.nonNegativeInteger("Distance covered in meters."),
    durationSeconds: s.nonNegativeInteger("Duration of the set in seconds."),
    customMetric: s.number("Custom metric for the set. Hevy currently uses it for steps and floors."),
    rpe: rpeField,
  },
  { optional: ["weightKg", "reps", "distanceMeters", "durationSeconds", "customMetric", "rpe"] },
);

const workoutExerciseInputSchema = s.object(
  "An exercise to log inside a Hevy workout.",
  {
    exerciseTemplateId: exerciseTemplateIdField,
    supersetId: s.integer("The superset the exercise belongs to. Omit for an exercise outside a superset."),
    notes: s.string("Notes recorded for this exercise."),
    sets: s.array("The sets performed for this exercise, in order.", workoutSetInputSchema),
  },
  { optional: ["supersetId", "notes"] },
);

const workoutInputSchema = s.object(
  "The Hevy workout to write.",
  {
    title: s.nonEmptyString("The workout title."),
    startTime: s.dateTime("ISO 8601 timestamp of when the workout started."),
    endTime: s.dateTime("ISO 8601 timestamp of when the workout ended."),
    description: s.string("The workout description."),
    isPrivate: s.boolean("Whether the workout is private. Hevy treats an omitted value as false."),
    exercises: s.array("The exercises performed in the workout, in order.", workoutExerciseInputSchema),
  },
  { optional: ["description", "isPrivate"] },
);

const routineSetInputSchema = s.object(
  "A single planned set inside a Hevy routine exercise.",
  {
    type: s.stringEnum("The type of the set.", setTypes),
    weightKg: s.number("Target weight in kilograms."),
    reps: s.nonNegativeInteger("Target number of repetitions."),
    distanceMeters: s.nonNegativeInteger("Target distance in meters."),
    durationSeconds: s.nonNegativeInteger("Target duration in seconds."),
    customMetric: s.number("Custom metric for the set. Hevy currently uses it for steps and floors."),
    repRange: repRangeField,
  },
  { optional: ["weightKg", "reps", "distanceMeters", "durationSeconds", "customMetric", "repRange"] },
);

const routineExerciseInputSchema = s.object(
  "An exercise to plan inside a Hevy routine.",
  {
    exerciseTemplateId: exerciseTemplateIdField,
    supersetId: s.integer("The superset the exercise belongs to. Omit for an exercise outside a superset."),
    restSeconds: s.nonNegativeInteger("Rest time between sets, in seconds."),
    notes: s.string("Notes recorded for this exercise."),
    sets: s.array("The planned sets for this exercise, in order.", routineSetInputSchema),
  },
  { optional: ["supersetId", "restSeconds", "notes"] },
);

const routineInputSchema = s.object(
  "The Hevy routine to write.",
  {
    title: s.nonEmptyString("The routine title."),
    folderId: s.nullableInteger(
      'The routine folder ID the routine belongs to. Pass null to place the routine in the default "My Routines" folder.',
    ),
    notes: s.string("Notes for the routine."),
    exercises: s.array("The exercises in the routine, in order.", routineExerciseInputSchema),
  },
  { optional: ["folderId", "notes"] },
);

const customExerciseInputSchema = s.object(
  "The custom Hevy exercise template to create.",
  {
    title: s.nonEmptyString("The exercise title."),
    exerciseType: s.stringEnum("How Hevy tracks the sets of this exercise.", customExerciseTypes),
    equipmentCategory: s.stringEnum("The equipment the exercise uses.", equipmentCategories),
    muscleGroup: s.stringEnum("The primary muscle group the exercise trains.", muscleGroups),
    otherMuscles: s.array(
      "Secondary muscle groups the exercise trains.",
      s.stringEnum("A Hevy muscle group.", muscleGroups),
    ),
  },
  { optional: ["otherMuscles"] },
);

const bodyMeasurementValuesSchema = s.object(
  "Body measurement values for one date. Every value is optional; Hevy stores an omitted value as null.",
  {
    weightKg: s.number("Body weight in kilograms."),
    leanMassKg: s.number("Lean mass in kilograms."),
    fatPercent: s.number("Body fat percentage."),
    neckCm: s.number("Neck circumference in centimeters."),
    shoulderCm: s.number("Shoulder circumference in centimeters."),
    chestCm: s.number("Chest circumference in centimeters."),
    leftBicepCm: s.number("Left bicep circumference in centimeters."),
    rightBicepCm: s.number("Right bicep circumference in centimeters."),
    leftForearmCm: s.number("Left forearm circumference in centimeters."),
    rightForearmCm: s.number("Right forearm circumference in centimeters."),
    abdomen: s.number("Abdomen circumference in centimeters."),
    waist: s.number("Waist circumference in centimeters."),
    hips: s.number("Hip circumference in centimeters."),
    leftThigh: s.number("Left thigh circumference in centimeters."),
    rightThigh: s.number("Right thigh circumference in centimeters."),
    leftCalf: s.number("Left calf circumference in centimeters."),
    rightCalf: s.number("Right calf circumference in centimeters."),
  },
  { required: [] },
);

const workoutSetSchema = s.looseObject("A set logged in a Hevy workout.", {
  index: s.integer("Position of the set within the exercise."),
  type: s.string("The type of the set."),
  weight_kg: s.nullableNumber("Weight lifted in kilograms."),
  reps: s.nullableNumber("Number of repetitions logged."),
  distance_meters: s.nullableNumber("Distance logged in meters."),
  duration_seconds: s.nullableNumber("Duration logged in seconds."),
  rpe: s.nullableNumber("Rating of Perceived Exertion logged for the set."),
  custom_metric: s.nullableNumber("Custom metric logged for the set."),
});

const workoutExerciseSchema = s.looseObject("An exercise logged in a Hevy workout.", {
  index: s.integer("Position of the exercise within the workout."),
  title: s.string("Title of the exercise."),
  notes: s.nullableString("Notes recorded for the exercise."),
  exercise_template_id: s.string("The exercise template this exercise was logged against."),
  superset_id: s.nullableNumber("The superset the exercise belongs to, or null."),
  sets: s.array("The sets logged for the exercise.", workoutSetSchema),
});

const workoutSchema = s.looseObject("A Hevy workout.", {
  id: s.string("The workout ID."),
  title: s.string("The workout title."),
  description: s.nullableString("The workout description."),
  routine_id: s.nullableString("The routine this workout was started from, when any."),
  start_time: s.string("ISO 8601 timestamp of when the workout started."),
  end_time: s.string("ISO 8601 timestamp of when the workout ended."),
  created_at: s.string("ISO 8601 timestamp of when the workout was created."),
  updated_at: s.string("ISO 8601 timestamp of when the workout was last updated."),
  exercises: s.array("The exercises logged in the workout.", workoutExerciseSchema),
});

const routineSchema = s.looseObject("A Hevy routine.", {
  id: s.string("The routine ID."),
  title: s.string("The routine title."),
  folder_id: s.nullableNumber("The routine folder the routine belongs to, or null."),
  created_at: s.string("ISO 8601 timestamp of when the routine was created."),
  updated_at: s.string("ISO 8601 timestamp of when the routine was last updated."),
  exercises: s.array("The exercises planned in the routine.", s.looseObject("A Hevy routine exercise.")),
});

const routineFolderSchema = s.looseObject("A Hevy routine folder.", {
  id: s.integer("The routine folder ID."),
  index: s.integer("Position of the folder in the routine folder list."),
  title: s.string("The routine folder title."),
  created_at: s.string("ISO 8601 timestamp of when the folder was created."),
  updated_at: s.string("ISO 8601 timestamp of when the folder was last updated."),
});

const exerciseTemplateSchema = s.looseObject("A Hevy exercise template.", {
  id: s.string("The exercise template ID."),
  title: s.string("The exercise title."),
  type: s.string("How Hevy tracks the sets of this exercise."),
  primary_muscle_group: s.string("The primary muscle group of the exercise."),
  secondary_muscle_groups: s.array("The secondary muscle groups of the exercise.", s.string("A Hevy muscle group.")),
  equipment: s.string("The equipment category of the exercise."),
  is_custom: s.boolean("Whether the exercise template is a custom exercise on this account."),
});

const exerciseHistoryEntrySchema = s.looseObject("One set of a Hevy exercise as logged in a past workout.", {
  workout_id: s.string("The workout the set belongs to."),
  workout_title: s.string("The title of that workout."),
  workout_start_time: s.string("ISO 8601 timestamp of when that workout started."),
  workout_end_time: s.string("ISO 8601 timestamp of when that workout ended."),
  exercise_template_id: s.string("The exercise template the set was logged against."),
  weight_kg: s.nullableNumber("Weight lifted in kilograms."),
  reps: s.nullableInteger("Number of repetitions logged."),
  distance_meters: s.nullableInteger("Distance logged in meters."),
  duration_seconds: s.nullableInteger("Duration logged in seconds."),
  rpe: s.nullableNumber("Rating of Perceived Exertion logged for the set."),
  custom_metric: s.nullableNumber("Custom metric logged for the set."),
  set_type: s.string("The type of the set."),
});

const bodyMeasurementSchema = s.looseObject("A Hevy body measurement entry.", {
  date: s.string("The measurement date in YYYY-MM-DD form."),
  weight_kg: s.nullableNumber("Body weight in kilograms."),
  lean_mass_kg: s.nullableNumber("Lean mass in kilograms."),
  fat_percent: s.nullableNumber("Body fat percentage."),
});

const workoutEventSchema = s.looseObject(
  'A Hevy workout event. An "updated" event carries the full workout; a "deleted" event carries the removed workout id.',
  {
    type: s.string('The event type, either "updated" or "deleted".'),
    workout: s.optional(workoutSchema),
    id: s.optional(s.string("The ID of the deleted workout, on a deleted event.")),
    deleted_at: s.optional(s.string("ISO 8601 timestamp of when the workout was deleted, on a deleted event.")),
  },
);

const userSchema = s.looseObject("The authenticated Hevy user.", {
  id: s.string("The user ID."),
  name: s.string("The user's display name."),
  url: s.string("The user's public profile URL."),
});

const workoutOutputSchema = s.object("A single Hevy workout.", { workout: workoutSchema });
const routineOutputSchema = s.object("A single Hevy routine.", { routine: routineSchema });
const routineFolderOutputSchema = s.object("A single Hevy routine folder.", { routineFolder: routineFolderSchema });
const bodyMeasurementWriteOutputSchema = s.object("The Hevy body measurement entry that was written.", {
  date: s.string("The date of the body measurement entry Hevy stored, in YYYY-MM-DD form."),
});

const pagedListInputSchema = s.object(
  "Pagination parameters for a Hevy listing.",
  { page: pageField, pageSize: smallPageSizeField },
  { required: [] },
);

export const hevyActions: ProviderActionDefinition[] = [
  defineProviderAction(service, {
    name: "list_workouts",
    description: "List logged Hevy workouts, newest first, with their exercises and sets.",
    inputSchema: pagedListInputSchema,
    outputSchema: s.object("A page of Hevy workouts.", {
      page: pageOutputField,
      pageCount: pageCountOutputField,
      workouts: s.array("The workouts on this page.", workoutSchema),
    }),
  }),
  defineProviderAction(service, {
    name: "get_workout",
    description: "Get one Hevy workout by ID, including every exercise and set it contains.",
    inputSchema: s.object("Identifies the Hevy workout to read.", { workoutId: workoutIdField }),
    outputSchema: workoutOutputSchema,
  }),
  defineProviderAction(service, {
    name: "create_workout",
    description: "Log a new Hevy workout with its exercises and sets.",
    inputSchema: s.object("The Hevy workout to create.", { workout: workoutInputSchema }),
    outputSchema: workoutOutputSchema,
  }),
  defineProviderAction(service, {
    name: "update_workout",
    description:
      "Replace an existing Hevy workout. The submitted exercises and sets overwrite the ones currently stored.",
    inputSchema: s.object("The Hevy workout to update.", {
      workoutId: workoutIdField,
      workout: workoutInputSchema,
    }),
    outputSchema: workoutOutputSchema,
  }),
  defineProviderAction(service, {
    name: "get_workout_count",
    description: "Get the total number of workouts logged on the authenticated Hevy account.",
    inputSchema: s.object("This action takes no parameters.", {}, { required: [] }),
    outputSchema: s.object("The Hevy workout count.", {
      workoutCount: s.nonNegativeInteger("The total number of workouts on the account."),
    }),
  }),
  defineProviderAction(service, {
    name: "list_workout_events",
    description:
      "List Hevy workout updates and deletions since a given time, newest first, so a local copy of the workouts can be kept in sync without refetching every workout.",
    inputSchema: s.object(
      "Filters the Hevy workout event feed.",
      {
        page: pageField,
        pageSize: smallPageSizeField,
        since: s.dateTime("Only return events after this ISO 8601 timestamp. Hevy defaults to the Unix epoch."),
      },
      { required: [] },
    ),
    outputSchema: s.object("A page of Hevy workout events.", {
      page: pageOutputField,
      pageCount: pageCountOutputField,
      events: s.array("The workout events on this page, newest first.", workoutEventSchema),
    }),
  }),
  defineProviderAction(service, {
    name: "get_user_info",
    description: "Get the Hevy account the API key belongs to.",
    inputSchema: s.object("This action takes no parameters.", {}, { required: [] }),
    outputSchema: s.object("The authenticated Hevy account.", { user: userSchema }),
  }),
  defineProviderAction(service, {
    name: "list_routines",
    description: "List the Hevy routines on the account with their planned exercises and sets.",
    inputSchema: pagedListInputSchema,
    outputSchema: s.object("A page of Hevy routines.", {
      page: pageOutputField,
      pageCount: pageCountOutputField,
      routines: s.array("The routines on this page.", routineSchema),
    }),
  }),
  defineProviderAction(service, {
    name: "get_routine",
    description: "Get one Hevy routine by ID, including its planned exercises and sets.",
    inputSchema: s.object("Identifies the Hevy routine to read.", { routineId: routineIdField }),
    outputSchema: routineOutputSchema,
  }),
  defineProviderAction(service, {
    name: "create_routine",
    description: "Create a new Hevy routine, optionally inside a routine folder.",
    inputSchema: s.object("The Hevy routine to create.", { routine: routineInputSchema }),
    outputSchema: routineOutputSchema,
  }),
  defineProviderAction(service, {
    name: "update_routine",
    description:
      "Replace an existing Hevy routine. The submitted exercises and sets overwrite the ones currently stored.",
    inputSchema: s.object("The Hevy routine to update.", {
      routineId: routineIdField,
      routine: routineInputSchema,
    }),
    outputSchema: routineOutputSchema,
  }),
  defineProviderAction(service, {
    name: "list_routine_folders",
    description: "List the Hevy routine folders on the account, ordered by their position in the app.",
    inputSchema: pagedListInputSchema,
    outputSchema: s.object("A page of Hevy routine folders.", {
      page: pageOutputField,
      pageCount: pageCountOutputField,
      routineFolders: s.array("The routine folders on this page.", routineFolderSchema),
    }),
  }),
  defineProviderAction(service, {
    name: "get_routine_folder",
    description: "Get one Hevy routine folder by ID.",
    inputSchema: s.object("Identifies the Hevy routine folder to read.", {
      folderId: s.integer("The Hevy routine folder ID."),
    }),
    outputSchema: routineFolderOutputSchema,
  }),
  defineProviderAction(service, {
    name: "create_routine_folder",
    description:
      "Create a Hevy routine folder. Hevy inserts the new folder at index 0 and shifts the existing folders down.",
    inputSchema: s.object("The Hevy routine folder to create.", {
      title: s.nonEmptyString("The routine folder title."),
    }),
    outputSchema: routineFolderOutputSchema,
  }),
  defineProviderAction(service, {
    name: "list_exercise_templates",
    description:
      "List the Hevy exercise templates available on the account, covering both the built-in exercise library and custom exercises.",
    inputSchema: s.object(
      "Pagination parameters for the Hevy exercise template listing.",
      { page: pageField, pageSize: largePageSizeField },
      { required: [] },
    ),
    outputSchema: s.object("A page of Hevy exercise templates.", {
      page: pageOutputField,
      pageCount: pageCountOutputField,
      exerciseTemplates: s.array("The exercise templates on this page.", exerciseTemplateSchema),
    }),
  }),
  defineProviderAction(service, {
    name: "get_exercise_template",
    description: "Get one Hevy exercise template by ID.",
    inputSchema: s.object("Identifies the Hevy exercise template to read.", {
      exerciseTemplateId: exerciseTemplateIdField,
    }),
    outputSchema: s.object("A single Hevy exercise template.", { exerciseTemplate: exerciseTemplateSchema }),
  }),
  defineProviderAction(service, {
    name: "create_exercise_template",
    description: "Create a custom Hevy exercise template on the account.",
    inputSchema: s.object("The custom Hevy exercise to create.", { exercise: customExerciseInputSchema }),
    outputSchema: s.object("The created custom Hevy exercise template.", {
      exerciseTemplateId: s.string(
        "The ID of the created exercise template. Pass it to get_exercise_template to read the stored template back.",
      ),
    }),
  }),
  defineProviderAction(service, {
    name: "get_exercise_history",
    description:
      "Get every set logged against one Hevy exercise template across past workouts, optionally limited to a date range.",
    inputSchema: s.object(
      "Identifies the Hevy exercise template and the history window to read.",
      {
        exerciseTemplateId: exerciseTemplateIdField,
        startDate: s.dateTime("Only return sets logged at or after this ISO 8601 timestamp."),
        endDate: s.dateTime("Only return sets logged at or before this ISO 8601 timestamp."),
      },
      { optional: ["startDate", "endDate"] },
    ),
    outputSchema: s.object("The Hevy history of one exercise.", {
      exerciseHistory: s.array("The sets logged against this exercise template.", exerciseHistoryEntrySchema),
    }),
  }),
  defineProviderAction(service, {
    name: "list_body_measurements",
    description: "List the body measurement entries recorded on the authenticated Hevy account.",
    inputSchema: pagedListInputSchema,
    outputSchema: s.object("A page of Hevy body measurements.", {
      page: pageOutputField,
      pageCount: pageCountOutputField,
      bodyMeasurements: s.array("The body measurement entries on this page.", bodyMeasurementSchema),
    }),
  }),
  defineProviderAction(service, {
    name: "get_body_measurement",
    description: "Get the Hevy body measurement entry recorded for one date.",
    inputSchema: s.object("Identifies the Hevy body measurement to read.", { date: measurementDateField }),
    outputSchema: s.object("A single Hevy body measurement entry.", { bodyMeasurement: bodyMeasurementSchema }),
  }),
  defineProviderAction(service, {
    name: "create_body_measurement",
    description:
      "Record a Hevy body measurement entry for one date. Hevy rejects the request when an entry already exists for that date; update it instead.",
    inputSchema: s.object("The Hevy body measurement entry to create.", {
      date: measurementDateField,
      measurement: bodyMeasurementValuesSchema,
    }),
    outputSchema: bodyMeasurementWriteOutputSchema,
  }),
  defineProviderAction(service, {
    name: "update_body_measurement",
    description:
      "Replace the Hevy body measurement entry recorded for one date. Hevy overwrites every field, storing omitted values as null.",
    inputSchema: s.object("The Hevy body measurement entry to update.", {
      date: measurementDateField,
      measurement: bodyMeasurementValuesSchema,
    }),
    outputSchema: bodyMeasurementWriteOutputSchema,
  }),
];

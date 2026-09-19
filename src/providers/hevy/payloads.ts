import {
  compactObject,
  nullableInteger,
  objectArray,
  optionalBoolean,
  optionalInteger,
  optionalNumber,
  optionalRecord,
  optionalString,
  optionalStringArray,
  requiredRecord,
} from "../../core/cast.ts";
import { providerInputError, requiredInputString } from "../provider-runtime.ts";

/**
 * Build the `POST /v1/workouts` and `PUT /v1/workouts/{workoutId}` body from a
 * workout action input. Both endpoints take the same wrapped workout shape.
 */
export function workoutRequestBody(value: unknown): Record<string, unknown> {
  const workout = requiredRecord(value, "workout", providerInputError);
  return {
    workout: compactObject({
      title: requiredInputString(workout.title, "title"),
      description: optionalString(workout.description),
      start_time: requiredInputString(workout.startTime, "startTime"),
      end_time: requiredInputString(workout.endTime, "endTime"),
      is_private: optionalBoolean(workout.isPrivate),
      exercises: workoutExercises(workout.exercises),
    }),
  };
}

/**
 * Build the `POST /v1/routines` and `PUT /v1/routines/{routineId}` body from a
 * routine action input. A null `folderId` reaches Hevy as the default
 * "My Routines" folder, so it is preserved rather than dropped.
 */
export function routineRequestBody(value: unknown): Record<string, unknown> {
  const routine = requiredRecord(value, "routine", providerInputError);
  return {
    routine: compactObject({
      title: requiredInputString(routine.title, "title"),
      folder_id: nullableInteger(routine.folderId),
      notes: optionalString(routine.notes),
      exercises: routineExercises(routine.exercises),
    }),
  };
}

/** Build the `POST /v1/exercise_templates` body from a custom exercise action input. */
export function customExerciseRequestBody(value: unknown): Record<string, unknown> {
  const exercise = requiredRecord(value, "exercise", providerInputError);
  return {
    exercise: compactObject({
      title: requiredInputString(exercise.title, "title"),
      exercise_type: requiredInputString(exercise.exerciseType, "exerciseType"),
      equipment_category: requiredInputString(exercise.equipmentCategory, "equipmentCategory"),
      muscle_group: requiredInputString(exercise.muscleGroup, "muscleGroup"),
      other_muscles: optionalStringArray(exercise.otherMuscles),
    }),
  };
}

/**
 * Build the body measurement fields shared by `POST /v1/body_measurements` and
 * `PUT /v1/body_measurements/{date}`. Hevy stores an omitted field as null on
 * both endpoints, so undefined values are dropped rather than sent explicitly.
 */
export function bodyMeasurementValues(value: unknown): Record<string, unknown> {
  const measurement = requiredRecord(value, "measurement", providerInputError);
  return compactObject({
    weight_kg: optionalNumber(measurement.weightKg),
    lean_mass_kg: optionalNumber(measurement.leanMassKg),
    fat_percent: optionalNumber(measurement.fatPercent),
    neck_cm: optionalNumber(measurement.neckCm),
    shoulder_cm: optionalNumber(measurement.shoulderCm),
    chest_cm: optionalNumber(measurement.chestCm),
    left_bicep_cm: optionalNumber(measurement.leftBicepCm),
    right_bicep_cm: optionalNumber(measurement.rightBicepCm),
    left_forearm_cm: optionalNumber(measurement.leftForearmCm),
    right_forearm_cm: optionalNumber(measurement.rightForearmCm),
    abdomen: optionalNumber(measurement.abdomen),
    waist: optionalNumber(measurement.waist),
    hips: optionalNumber(measurement.hips),
    left_thigh: optionalNumber(measurement.leftThigh),
    right_thigh: optionalNumber(measurement.rightThigh),
    left_calf: optionalNumber(measurement.leftCalf),
    right_calf: optionalNumber(measurement.rightCalf),
  });
}

function workoutExercises(value: unknown): Record<string, unknown>[] {
  return objectArray(value, "exercises", providerInputError).map((exercise) =>
    compactObject({
      exercise_template_id: requiredInputString(exercise.exerciseTemplateId, "exerciseTemplateId"),
      superset_id: optionalInteger(exercise.supersetId),
      notes: optionalString(exercise.notes),
      sets: workoutSets(exercise.sets),
    }),
  );
}

function workoutSets(value: unknown): Record<string, unknown>[] {
  return objectArray(value, "sets", providerInputError).map((set) =>
    compactObject({
      type: requiredInputString(set.type, "type"),
      weight_kg: optionalNumber(set.weightKg),
      reps: optionalInteger(set.reps),
      distance_meters: optionalInteger(set.distanceMeters),
      duration_seconds: optionalInteger(set.durationSeconds),
      custom_metric: optionalNumber(set.customMetric),
      rpe: optionalNumber(set.rpe),
    }),
  );
}

function routineExercises(value: unknown): Record<string, unknown>[] {
  return objectArray(value, "exercises", providerInputError).map((exercise) =>
    compactObject({
      exercise_template_id: requiredInputString(exercise.exerciseTemplateId, "exerciseTemplateId"),
      superset_id: optionalInteger(exercise.supersetId),
      rest_seconds: optionalInteger(exercise.restSeconds),
      notes: optionalString(exercise.notes),
      sets: routineSets(exercise.sets),
    }),
  );
}

function routineSets(value: unknown): Record<string, unknown>[] {
  return objectArray(value, "sets", providerInputError).map((set) =>
    compactObject({
      type: requiredInputString(set.type, "type"),
      weight_kg: optionalNumber(set.weightKg),
      reps: optionalInteger(set.reps),
      distance_meters: optionalInteger(set.distanceMeters),
      duration_seconds: optionalInteger(set.durationSeconds),
      custom_metric: optionalNumber(set.customMetric),
      rep_range: repRange(set.repRange),
    }),
  );
}

function repRange(value: unknown): Record<string, unknown> | undefined {
  const range = optionalRecord(value);
  if (!range) {
    return undefined;
  }
  return compactObject({
    start: optionalInteger(range.start),
    end: optionalInteger(range.end),
  });
}

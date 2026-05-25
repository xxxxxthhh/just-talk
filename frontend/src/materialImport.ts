import type { MaterialPackImportPayload } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalText(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalLessonMeta(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string" || typeof value === "number";
}

export function validateMaterialPackImportPayload(
  payload: unknown
): MaterialPackImportPayload {
  if (!isRecord(payload) || payload.schema_version !== 1) {
    throw new Error("Material JSON must use schema_version 1.");
  }

  const { pack, lessons } = payload;
  if (!isRecord(pack) || !hasText(pack.id) || !hasText(pack.title)) {
    throw new Error("Material pack id and title are required.");
  }
  if (!isOptionalText(pack.source) || !isOptionalText(pack.license)) {
    throw new Error("Material pack source and license must be strings.");
  }

  if (!Array.isArray(lessons) || lessons.length === 0) {
    throw new Error("Material JSON must include at least one lesson.");
  }

  for (const lesson of lessons) {
    if (!isRecord(lesson) || !hasText(lesson.id) || !hasText(lesson.title) || !hasText(lesson.text)) {
      throw new Error("Each lesson needs id, title, and text.");
    }
    if (!isOptionalLessonMeta(lesson.book) || !isOptionalLessonMeta(lesson.lesson)) {
      throw new Error("Lesson book and lesson fields must be strings, numbers, or null.");
    }
    if (
      lesson.tags !== undefined &&
      (!Array.isArray(lesson.tags) || lesson.tags.some((tag) => typeof tag !== "string"))
    ) {
      throw new Error("Lesson tags must be an array of strings.");
    }
  }

  return payload as MaterialPackImportPayload;
}

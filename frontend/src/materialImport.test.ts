import { describe, expect, test } from "vitest";

import { validateMaterialPackImportPayload } from "./materialImport";

describe("material import validation", () => {
  test("accepts a valid material import payload", () => {
    const payload = {
      schema_version: 1,
      pack: {
        id: "new-concept-one",
        title: "New Concept English 1",
        source: "user-imported"
      },
      lessons: [
        {
          id: "lesson-1",
          title: "A private conversation",
          text: "Last week I went to the theatre.",
          book: 1,
          lesson: 1,
          tags: ["new-concept", "book-1"]
        }
      ]
    };

    expect(validateMaterialPackImportPayload(payload)).toBe(payload);
  });

  test("requires schema_version 1", () => {
    expect(() =>
      validateMaterialPackImportPayload({
        schema_version: 2,
        pack: { id: "custom", title: "Custom" },
        lessons: [{ id: "lesson-1", title: "Lesson 1", text: "Practice clearly." }]
      })
    ).toThrow("Material JSON must use schema_version 1.");
  });

  test("requires pack id and title", () => {
    expect(() =>
      validateMaterialPackImportPayload({
        schema_version: 1,
        pack: { id: "custom" },
        lessons: [{ id: "lesson-1", title: "Lesson 1", text: "Practice clearly." }]
      })
    ).toThrow("Material pack id and title are required.");
  });

  test("requires at least one lesson", () => {
    expect(() =>
      validateMaterialPackImportPayload({
        schema_version: 1,
        pack: { id: "custom", title: "Custom" },
        lessons: []
      })
    ).toThrow("Material JSON must include at least one lesson.");
  });

  test("requires lesson id, title, and text", () => {
    expect(() =>
      validateMaterialPackImportPayload({
        schema_version: 1,
        pack: { id: "custom", title: "Custom" },
        lessons: [{ id: "lesson-1", title: "Lesson 1", text: " " }]
      })
    ).toThrow("Each lesson needs id, title, and text.");
  });

  test("requires tags to be strings when provided", () => {
    expect(() =>
      validateMaterialPackImportPayload({
        schema_version: 1,
        pack: { id: "custom", title: "Custom" },
        lessons: [
          {
            id: "lesson-1",
            title: "Lesson 1",
            text: "Practice clearly.",
            tags: ["ok", 42]
          }
        ]
      })
    ).toThrow("Lesson tags must be an array of strings.");
  });
});

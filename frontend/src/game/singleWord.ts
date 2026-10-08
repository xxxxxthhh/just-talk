const BOUNDARY_PUNCTUATION = /^[.,!?;:"'()[\]{}]+|[.,!?;:"'()[\]{}]+$/g;

// Mirrors the backend's _single_word_reference: the scoring target of a word
// prompt, or "" when the text is not one word. Used lowercased as the dedupe key.
// Kept free of other imports so the reducer's START check can share it.
export function singleWordKey(text: string): string {
  const stripped = text.trim().replace(BOUNDARY_PUNCTUATION, "").trim();
  return stripped && stripped.split(/\s+/).length === 1 ? stripped.toLowerCase() : "";
}

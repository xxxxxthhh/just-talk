import starterPackData from "./starterPack.json";

// Project-original practice items (see docs/CONTENT-PROVENANCE.md). The
// backend keeps the same texts in GAME_STARTER_TEXTS so their TTS audio is
// shared between public visitors; a backend test compares the two lists.
export type StarterItem = {
  id: string;
  group: "theta" | "eth" | "r" | "l" | "v";
  stage: "warmup" | "focus" | "context";
  text: string;
  phoneme: "θ" | "ð" | "ɹ" | "l" | "v";
  targetWord: string;
};

export type StarterPhoneme = StarterItem["phoneme"];

export const STARTER_PACK = starterPackData as readonly StarterItem[];

export const DEFAULT_STARTER_PHONEME: StarterPhoneme = "θ";

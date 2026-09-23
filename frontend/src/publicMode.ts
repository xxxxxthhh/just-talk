// Build-time switch for the hosted public trial. Personal (local/iOS) builds
// leave it unset, so none of the visitor/quota UI is rendered for them.
export const PUBLIC_MODE = import.meta.env.VITE_PUBLIC_MODE === "1";

export const USAGE_CHANGED_EVENT = "just-talk:usage-changed";
export const VISITOR_REQUIRED_EVENT = "just-talk:visitor-required";

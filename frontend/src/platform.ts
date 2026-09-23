import { Capacitor } from "@capacitor/core";

const PHONE_WIDTH_QUERY = "(max-width: 720px)";

export function isMobileUI(): boolean {
  if (typeof window !== "undefined") {
    const forced = new URLSearchParams(window.location.search).get("mobile");
    if (forced === "1") return true;
    if (forced === "0") return false;
  }
  if (Capacitor.isNativePlatform()) return true;
  // Phone browsers get the same touch layout as the iOS app.
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(PHONE_WIDTH_QUERY).matches
  );
}

import { Capacitor } from "@capacitor/core";

export function isMobileUI(): boolean {
  if (typeof window !== "undefined") {
    const forced = new URLSearchParams(window.location.search).get("mobile");
    if (forced === "1") return true;
    if (forced === "0") return false;
  }
  return Capacitor.isNativePlatform();
}

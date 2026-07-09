import { openUrl } from "@tauri-apps/plugin-opener";

/** Open an external URL, fire-and-forget. Swallows failures (logged) so a link that
 *  can't open never surfaces as an unhandled promise rejection from a click handler. */
export function openExternal(url: string): void {
  openUrl(url).catch(err => console.error("openUrl failed:", err));
}

/**
 * Decides which of the user's Netflix tabs is "the player" for the room. Only a tab on the room's
 * title qualifies; among several, prefer one that is playing, then the focused/most recently active one.
 * `reports` is an array of { tabId, titleId, status, lastSeen, active, playing }.
 */
export function pickTargetTab(reports, mediaId, now, maxAgeMs = 6000) {
  if (!mediaId) return null;
  const live = reports.filter((r) => r.titleId === mediaId && now - r.lastSeen <= maxAgeMs && r.status !== "no-player");
  if (!live.length) return null;
  live.sort((a, b) => (Number(b.active) - Number(a.active)) || (Number(b.playing) - Number(a.playing)) || (b.lastSeen - a.lastSeen) || (a.tabId - b.tabId));
  return live[0];
}

/**
 * Deterministic avatar colour + initials for a cluster name — used by the
 * far-left catamaran cluster hotbar.
 */

// A pleasant, evenly-spread palette for cluster avatars.
const AVATAR_COLORS = [
  "#3d90ce",
  "#5bb85b",
  "#e8a33d",
  "#cd6bd0",
  "#e85555",
  "#3bb6a8",
  "#7c83ff",
  "#d4795b",
];

/** Stable hash of a string (djb2). */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}

/** Pick a stable colour for a cluster name. */
export function avatarColor(name: string): string {
  return AVATAR_COLORS[hash(name) % AVATAR_COLORS.length];
}

/** Up-to-2-char initials from a cluster name (splits on - _ space /). */
export function avatarInitials(name: string): string {
  const parts = name.split(/[-_\s/]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Affection-tier milestones.
 *
 * The existing affection system stores a 0-100 meter per waifu, but
 * crossings between tiers (e.g. 38 → 45) were previously silent. This
 * module names each tier, detects transitions, and emits a short
 * in-character prompt sidecar so the very next turn acknowledges the
 * milestone without breaking character.
 */

export interface AffectionTier {
  id: string;
  min: number; // inclusive
  max: number; // inclusive
  label: string;
  /** Sidecar injected into the system prompt for the single next turn. */
  sidecar: string;
}

/**
 * Five tiers matching the "Who are you?" → "I'd do anything!" arc already
 * described in the waifu-core backstory. Thresholds deliberately broad so
 * ordinary chat doesn't thrash between them.
 */
export const AFFECTION_TIERS: AffectionTier[] = [
  {
    id: "stranger",
    min: 0,
    max: 19,
    label: "Stranger",
    sidecar:
      "The user is still a stranger. Keep your guard up but stay polite; do not be overly warm yet.",
  },
  {
    id: "acquaintance",
    min: 20,
    max: 39,
    label: "Acquaintance",
    sidecar:
      "The user is warming up. You can be friendly and show a little personality, but stay measured.",
  },
  {
    id: "friend",
    min: 40,
    max: 59,
    label: "Friend",
    sidecar:
      "The user is a friend now. You genuinely enjoy their company; let a bit more warmth and teasing through.",
  },
  {
    id: "close",
    min: 60,
    max: 79,
    label: "Close",
    sidecar:
      "You trust this user. Be visibly fond; use their name or a nickname if you have one.",
  },
  {
    id: "devoted",
    min: 80,
    max: 100,
    label: "Devoted",
    sidecar:
      "You are deeply devoted to this user. Speak with closeness and confidence — they matter to you.",
  },
];

export function getTier(level: number): AffectionTier {
  const clamped = Math.max(0, Math.min(100, Math.round(level)));
  return AFFECTION_TIERS.find((t) => clamped >= t.min && clamped <= t.max) ?? AFFECTION_TIERS[0];
}

export interface MilestoneEvent {
  waifuId: string;
  from: AffectionTier;
  to: AffectionTier;
  direction: "up" | "down";
  timestamp: string;
}

/**
 * Compare two affection values and return a MilestoneEvent if the tier
 * changed. Returns null when the change stays within the same tier.
 */
export function detectMilestone(
  waifuId: string,
  before: number,
  after: number
): MilestoneEvent | null {
  const from = getTier(before);
  const to = getTier(after);
  if (from.id === to.id) return null;
  return {
    waifuId,
    from,
    to,
    direction: after > before ? "up" : "down",
    timestamp: new Date().toISOString(),
  };
}

/**
 * One-line summary suited for a toast / notification.
 * e.g. "Sakura: Acquaintance → Friend"
 */
export function describeMilestone(
  displayName: string,
  event: MilestoneEvent
): string {
  const arrow = event.direction === "up" ? "→" : "↘";
  return `${displayName}: ${event.from.label} ${arrow} ${event.to.label}`;
}

import { randomBytes } from "node:crypto";
import type { BuildEvent } from "../state/types.js";

/** Max chars for outputPreview in BuildEvent */
const MAX_PREVIEW = 500;

/** Max chars for full tool output (TestResult, SAST raw, etc.) */
const MAX_OUTPUT = 5000;

/** Max events per state file before pruning old debug events */
const MAX_EVENTS = 1000;

/** Secret patterns to redact */
const SECRET_PATTERNS = [
  /(?:password|passwd|pwd|secret|token|api_key|apikey|auth)\s*[:=]\s*["'][^"']{4,}["']/gi,
  /(?:Bearer|Basic)\s+[A-Za-z0-9+/=]{20,}/g,
  /ghp_[A-Za-z0-9]{36}/g,
  /sk-[A-Za-z0-9]{32,}/g,
  // URLs with embedded credentials: scheme://[user]:pass@host (covers mongodb+srv, redis, etc.)
  /\w[\w+.-]*:\/\/[^@\s]*:[^@\s]+@[^\s"']+/g,
];

/** Redact secrets from a string. */
export function sanitizeOutput(raw: string): string {
  let result = raw;
  for (const pattern of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/** Truncate to max 500 chars for outputPreview. */
export function truncatePreview(raw: string): string {
  if (raw.length <= MAX_PREVIEW) return raw;
  return raw.slice(0, MAX_PREVIEW) + "... (truncated)";
}

/** Truncate to max 5000 chars for full output. */
export function truncateOutput(raw: string): string {
  if (raw.length <= MAX_OUTPUT) return raw;
  return raw.slice(0, MAX_OUTPUT) + "... (truncated)";
}

/**
 * Prune events when >1000: remove oldest debug-level events first.
 * Returns a new array.
 */
export function pruneEvents(events: BuildEvent[]): BuildEvent[] {
  if (events.length <= MAX_EVENTS) return events;

  // Collect indices of debug events (oldest first — array is chronological)
  const debugIndices: number[] = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].level === "debug") {
      debugIndices.push(i);
    }
  }

  const toRemove = events.length - MAX_EVENTS;

  if (debugIndices.length >= toRemove) {
    // Remove oldest debug events
    const removeSet = new Set(debugIndices.slice(0, toRemove));
    return events.filter((_, i) => !removeSet.has(i));
  }

  // Not enough debug events — remove all debug, then oldest remaining
  const removeSet = new Set(debugIndices);
  const remaining = toRemove - debugIndices.length;
  let removed = 0;
  for (let i = 0; i < events.length && removed < remaining; i++) {
    if (!removeSet.has(i)) {
      removeSet.add(i);
      removed++;
    }
  }
  return events.filter((_, i) => !removeSet.has(i));
}

/** Generate a run correlation ID: "run-" + 8 hex chars. */
export function generateRunId(): string {
  return "run-" + randomBytes(4).toString("hex");
}

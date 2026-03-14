import { z } from "zod";
import { requireProject } from "../utils/tool-helpers.js";
import type { LogLevel } from "../state/types.js";

export const getBuildLogSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  phase: z.string().optional().describe("Filter by phase"),
  sliceId: z.string().optional().describe("Filter by slice ID"),
  level: z.enum(["debug", "info", "warn", "error"]).optional().describe("Minimum log level (shows events >= this level)"),
  action: z.string().optional().describe("Filter by action type"),
  runId: z.string().optional().describe("Filter by run correlation ID"),
  errorsOnly: z.boolean().optional().describe("Show only error/failure events"),
  since: z.string().optional().describe("ISO timestamp — only events after this time"),
  hasOutput: z.boolean().optional().describe("Only events with outputSummary"),
  limit: z.number().default(50).describe("Max events to return (default 50)"),
  // Legacy compat: filter param still accepted but mapped to individual fields
  filter: z
    .enum(["all", "errors", "phase", "slice", "level", "run"])
    .optional()
    .describe("Legacy filter mode (prefer individual filter params)"),
});

export type GetBuildLogInput = z.infer<typeof getBuildLogSchema>;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function handleGetBuildLog(input: GetBuildLogInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();
  let events = [...state.buildHistory];

  // Legacy filter compat: map to individual fields
  if (input.filter) {
    switch (input.filter) {
      case "errors":
        input.errorsOnly = true;
        break;
      case "phase":
        // phase already set via input.phase
        break;
      case "slice":
        // sliceId already set via input.sliceId
        break;
      case "level":
        // level already set via input.level
        break;
      case "run":
        // runId already set via input.runId
        break;
    }
  }

  // Apply composable filters
  if (input.errorsOnly) {
    events = events.filter(
      (e) => e.status === "failure" || e.level === "error"
    );
  }

  if (input.phase) {
    events = events.filter((e) => e.phase === input.phase);
  }

  if (input.sliceId) {
    events = events.filter((e) => e.sliceId === input.sliceId);
  }

  if (input.level) {
    const minLevel = LEVEL_ORDER[input.level];
    events = events.filter((e) => {
      const eventLevel = e.level ?? "info";
      return LEVEL_ORDER[eventLevel] >= minLevel;
    });
  }

  if (input.action) {
    events = events.filter((e) => e.action === input.action);
  }

  if (input.runId) {
    events = events.filter((e) => e.runId === input.runId);
  }

  if (input.since) {
    events = events.filter((e) => e.timestamp >= input.since!);
  }

  if (input.hasOutput) {
    events = events.filter((e) => !!e.outputSummary);
  }

  const totalEvents = events.length;

  // Newest first, apply limit
  events.reverse();
  const limited = events.slice(0, input.limit);

  return JSON.stringify({
    events: limited,
    totalEvents,
    showing: limited.length,
  });
}

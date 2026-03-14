import { z } from "zod";
import { StateManager } from "../state/state-manager.js";

export const getBuildLogSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  filter: z
    .enum(["all", "errors", "phase", "slice"])
    .default("all")
    .describe("Filter type: all events, errors only, by phase, or by slice"),
  sliceId: z.string().optional().describe("Slice ID to filter by (when filter='slice')"),
  phase: z.string().optional().describe("Phase to filter by (when filter='phase')"),
  limit: z.number().default(50).describe("Max events to return (default 50)"),
});

export type GetBuildLogInput = z.infer<typeof getBuildLogSchema>;

const ERROR_ACTIONS = new Set([
  "sast_finding",
  "quality_issue",
]);

export function handleGetBuildLog(input: GetBuildLogInput): string {
  const sm = new StateManager(input.projectPath);

  if (!sm.exists()) {
    return JSON.stringify({
      error: "No project found",
      hint: "Use a2p_init_project to initialize a new project first.",
    });
  }

  const state = sm.read();
  let events = [...state.buildHistory];

  // Apply filter
  switch (input.filter) {
    case "errors":
      events = events.filter(
        (e) =>
          ERROR_ACTIONS.has(e.action) ||
          e.details.includes("FAIL") ||
          e.details.includes("error")
      );
      break;
    case "phase":
      if (input.phase) {
        events = events.filter((e) => e.phase === input.phase);
      }
      break;
    case "slice":
      if (input.sliceId) {
        events = events.filter((e) => e.sliceId === input.sliceId);
      }
      break;
    // "all" — no filter
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

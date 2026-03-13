import { z } from "zod";
import { StateManager } from "../state/state-manager.js";

export const runE2eSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  baseUrl: z.string().describe("Base URL of the running app (e.g. http://localhost:3000)"),
  scenarios: z
    .array(
      z.object({
        name: z.string().describe("Scenario name (e.g. 'Login flow')"),
        steps: z.array(z.string()).describe("Steps performed"),
        passed: z.boolean().describe("Did the scenario pass?"),
        screenshotPath: z.string().optional().describe("Path to screenshot if taken"),
        notes: z.string().optional().describe("Any observations or issues"),
      })
    )
    .describe("E2E test scenarios executed via Playwright MCP"),
});

export type RunE2eInput = z.infer<typeof runE2eSchema>;

/**
 * Records E2E test results run via Playwright MCP.
 *
 * The actual E2E testing is orchestrated by Claude using Playwright MCP tools:
 * 1. browser_navigate → visit each page
 * 2. browser_click → interact with buttons/links
 * 3. browser_fill_form → fill forms
 * 4. browser_take_screenshot → capture visual state
 * 5. browser_snapshot → get accessibility tree
 *
 * This tool records the results in project state.
 */
export function handleRunE2e(input: RunE2eInput): string {
  const sm = new StateManager(input.projectPath);

  if (!sm.exists()) {
    return JSON.stringify({ error: "No project found." });
  }

  const passed = input.scenarios.filter((s) => s.passed).length;
  const failed = input.scenarios.filter((s) => !s.passed).length;

  // Record as build events via proper StateManager API
  const state = sm.read();
  sm.addBuildEvents(
    input.scenarios.map((scenario) => ({
      phase: state.phase,
      sliceId: null,
      action: "e2e_test",
      details: `${scenario.passed ? "PASS" : "FAIL"}: ${scenario.name}`,
    }))
  );

  return JSON.stringify({
    success: failed === 0,
    totalScenarios: input.scenarios.length,
    passed,
    failed,
    scenarios: input.scenarios.map((s) => ({
      name: s.name,
      passed: s.passed,
      screenshot: s.screenshotPath ?? null,
      notes: s.notes ?? null,
    })),
    hint: failed > 0
      ? `${failed} scenario(s) failed. Fix the issues and re-run.`
      : "All E2E scenarios passed!",
  });
}

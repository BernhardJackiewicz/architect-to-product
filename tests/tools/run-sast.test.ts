import { describe, it, expect } from "vitest";
import { runSastSchema } from "../../src/tools/run-sast.js";

describe("run-sast", () => {
  describe("semgrep command excludes framework build artifacts", () => {
    it("schema accepts valid input", () => {
      const input = runSastSchema.parse({
        projectPath: "/tmp/test",
        sliceId: null,
        mode: "full",
      });
      expect(input.mode).toBe("full");
    });
  });

  describe("framework build directory excludes", () => {
    // We test the exclude patterns by importing and inspecting the source
    // The actual semgrep command is built in runSemgrep which we can verify structurally

    it("semgrep command string includes .next exclude", async () => {
      // Read the source to verify the exclude is present
      const { readFileSync } = await import("node:fs");
      const source = readFileSync(
        new URL("../../src/tools/run-sast.ts", import.meta.url),
        "utf-8",
      );
      expect(source).toContain("--exclude=.next");
      expect(source).toContain("--exclude=.turbopack");
      expect(source).toContain("--exclude=.nuxt");
      expect(source).toContain("--exclude=.svelte-kit");
      expect(source).toContain("--exclude=.output");
      expect(source).toContain("--exclude=build");
      expect(source).toContain("--exclude=.vercel");
      expect(source).toContain("--exclude=.angular");
    });

    it("bandit command string includes .next exclude", async () => {
      const { readFileSync } = await import("node:fs");
      const source = readFileSync(
        new URL("../../src/tools/run-sast.ts", import.meta.url),
        "utf-8",
      );
      // Bandit uses comma-separated excludes
      expect(source).toContain("./.next");
      expect(source).toContain("./.turbopack");
      expect(source).toContain("./.nuxt");
      expect(source).toContain("./.svelte-kit");
      expect(source).toContain("./.output");
      expect(source).toContain("./build");
    });
  });

  describe("dedup includes projectFindings", () => {
    it("dedup code concats projectFindings", async () => {
      const { readFileSync } = await import("node:fs");
      const source = readFileSync(
        new URL("../../src/tools/run-sast.ts", import.meta.url),
        "utf-8",
      );
      // Verify projectFindings is included in dedup
      expect(source).toContain(".concat(freshState.projectFindings)");
    });
  });
});

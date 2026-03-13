import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runProcess } from "../src/utils/process-runner.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "a2p-proc-"));
}

describe("runProcess", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("successful command returns exitCode 0", () => {
    const result = runProcess("echo hello", cwd);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello");
    expect(result.stderr).toBe("");
  });

  it("failed command returns exitCode != 0", () => {
    const result = runProcess("false", cwd);
    expect(result.exitCode).not.toBe(0);
  });

  it("stdout is correctly captured", () => {
    const result = runProcess("echo test123", cwd);
    expect(result.stdout).toContain("test123");
  });

  it("stderr is correctly captured", () => {
    // execSync only returns stderr on non-zero exit, so use a command that fails
    const result = runProcess("echo err >&2 && exit 1", cwd);
    expect(result.stderr).toContain("err");
  });

  it("timeout is respected", () => {
    const start = Date.now();
    const result = runProcess("sleep 10", cwd, 500);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(3000);
    expect(result.exitCode).not.toBe(0);
  });

  it("unknown command returns exitCode 1 and non-empty stderr", () => {
    const result = runProcess("nonexistent_cmd_xyz_99", cwd);
    expect(result.exitCode).not.toBe(0);
    // stderr should contain something about the command not being found
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("never throws an exception — always returns structured result", () => {
    // All of these should return a result, not throw
    const cases = [
      () => runProcess("echo ok", cwd),
      () => runProcess("false", cwd),
      () => runProcess("nonexistent_cmd_xyz_99", cwd),
      () => runProcess("sleep 10", cwd, 100),
    ];

    for (const fn of cases) {
      const result = fn();
      expect(result).toHaveProperty("exitCode");
      expect(result).toHaveProperty("stdout");
      expect(result).toHaveProperty("stderr");
      expect(typeof result.exitCode).toBe("number");
      expect(typeof result.stdout).toBe("string");
      expect(typeof result.stderr).toBe("string");
    }
  });

  it("multiline stdout is fully captured", () => {
    const result = runProcess("printf 'line1\\nline2\\nline3'", cwd);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("line1");
    expect(result.stdout).toContain("line2");
    expect(result.stdout).toContain("line3");
  });
});

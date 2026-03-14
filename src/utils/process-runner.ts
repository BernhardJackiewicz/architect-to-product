import { execSync } from "node:child_process";

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Run a shell command synchronously with timeout.
 * Returns structured result instead of throwing on non-zero exit.
 */
export function runProcess(
  command: string,
  cwd: string,
  timeoutMs: number = 120_000
): ProcessResult {
  const start = Date.now();
  try {
    const stdout = execSync(command, {
      cwd,
      timeout: timeoutMs,
      stdio: "pipe",
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return { exitCode: 0, stdout: stdout ?? "", stderr: "", durationMs: Date.now() - start };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    if (err && typeof err === "object" && "status" in err) {
      const e = err as { status: number; stdout?: string; stderr?: string };
      return {
        exitCode: e.status ?? 1,
        stdout: String(e.stdout ?? ""),
        stderr: String(e.stderr ?? ""),
        durationMs,
      };
    }
    return { exitCode: 1, stdout: "", stderr: String(err), durationMs };
  }
}

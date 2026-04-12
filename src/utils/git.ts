import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** True when the given directory (or an ancestor) is inside a git working tree. */
export function isGitRepo(cwd: string): boolean {
  if (!existsSync(cwd)) return false;
  const res = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.error) return false;
  if (res.status !== 0) return false;
  return res.stdout.trim() === "true";
}

/** Current git HEAD commit hash, or null if not a git repo / git unavailable. */
export function getGitHead(cwd: string): string | null {
  if (!isGitRepo(cwd)) return null;
  const res = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.error || res.status !== 0) return null;
  const head = res.stdout.trim();
  return head.length > 0 ? head : null;
}

/**
 * Return the list of files that differ in the current working tree
 * (unstaged + staged + untracked). The `commit` parameter is retained for
 * backward compatibility and audit logging but is NO LONGER used for diffing.
 *
 * Previously this function ran `git diff --name-only commit HEAD` to include
 * committed changes between the baseline and HEAD. This caused Bug #2 in the
 * dogfood run: when slice 1 commits its work and slice 2 starts, slice 2's
 * verify_test_first saw slice 1's committed files as "production drift"
 * because the baseline predated slice 1's commit. Committed changes from
 * prior slices are settled history and must not count as current-slice drift.
 */
export function getGitChangedFilesSince(cwd: string, _commit: string): string[] {
  if (!isGitRepo(cwd)) return [];
  const all = new Set<string>();

  // NOTE: the `git diff commit HEAD` step was removed — only working-tree
  // changes (unstaged, staged, untracked) are reported. See Bug #2 in
  // observations/bugs-found.md for full rationale.

  const unstaged = spawnSync("git", ["diff", "--name-only"], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (unstaged.status === 0 && unstaged.stdout) {
    for (const line of unstaged.stdout.split("\n")) {
      const p = line.trim();
      if (p) all.add(p);
    }
  }

  const staged = spawnSync("git", ["diff", "--name-only", "--cached"], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (staged.status === 0 && staged.stdout) {
    for (const line of staged.stdout.split("\n")) {
      const p = line.trim();
      if (p) all.add(p);
    }
  }

  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (untracked.status === 0 && untracked.stdout) {
    for (const line of untracked.stdout.split("\n")) {
      const p = line.trim();
      if (p) all.add(p);
    }
  }

  return Array.from(all).sort();
}

/** Helper: check that a file exists at `join(cwd, path)`. */
export function fileExistsIn(cwd: string, path: string): boolean {
  return existsSync(join(cwd, path));
}

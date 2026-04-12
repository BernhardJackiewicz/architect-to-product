import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanTmpDir } from "../helpers/setup.js";
import { isGitRepo, getGitHead, getGitChangedFilesSince } from "../../src/utils/git.js";

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

describe("src/utils/git", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-git");
  });

  afterEach(() => {
    cleanTmpDir(dir);
  });

  describe("isGitRepo", () => {
    it("returns false for a non-git directory", () => {
      expect(isGitRepo(dir)).toBe(false);
    });

    it("returns true for a git repo", () => {
      git(dir, ["init", "-q"]);
      expect(isGitRepo(dir)).toBe(true);
    });

    it("returns false for a non-existent directory", () => {
      expect(isGitRepo(join(dir, "does-not-exist"))).toBe(false);
    });
  });

  describe("getGitHead", () => {
    it("returns null for a non-git directory", () => {
      expect(getGitHead(dir)).toBeNull();
    });

    it("returns a commit hash for a repo with a commit", () => {
      git(dir, ["init", "-q"]);
      git(dir, ["config", "user.email", "t@e.com"]);
      git(dir, ["config", "user.name", "T"]);
      git(dir, ["commit", "--allow-empty", "-m", "init", "-q"]);
      const head = getGitHead(dir);
      expect(head).not.toBeNull();
      expect(head).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe("getGitChangedFilesSince", () => {
    beforeEach(() => {
      git(dir, ["init", "-q"]);
      git(dir, ["config", "user.email", "t@e.com"]);
      git(dir, ["config", "user.name", "T"]);
      writeFileSync(join(dir, "baseline.txt"), "baseline\n");
      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-m", "baseline", "-q"]);
    });

    // Bug #2 dogfood fix: committed changes between baseline and HEAD are
    // intentionally EXCLUDED now. The function only reports uncommitted
    // working-tree changes (unstaged, staged, untracked). Committed changes
    // from prior slices are settled history and must not count as drift.
    it("does NOT report committed changes since baseline (Bug #2 fix)", () => {
      const baseline = getGitHead(dir)!;
      writeFileSync(join(dir, "a.txt"), "hello\n");
      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-m", "add a", "-q"]);
      const changed = getGitChangedFilesSince(dir, baseline);
      // a.txt is committed → invisible to the working-tree diff
      expect(changed).not.toContain("a.txt");
    });

    it("detects an uncommitted (staged) change", () => {
      const baseline = getGitHead(dir)!;
      writeFileSync(join(dir, "b.txt"), "staged\n");
      git(dir, ["add", "-A"]);
      const changed = getGitChangedFilesSince(dir, baseline);
      expect(changed).toContain("b.txt");
    });

    it("detects an untracked file", () => {
      const baseline = getGitHead(dir)!;
      writeFileSync(join(dir, "c.txt"), "untracked\n");
      const changed = getGitChangedFilesSince(dir, baseline);
      expect(changed).toContain("c.txt");
    });

    it("detects a modification to a tracked file", () => {
      const baseline = getGitHead(dir)!;
      writeFileSync(join(dir, "baseline.txt"), "changed\n");
      const changed = getGitChangedFilesSince(dir, baseline);
      expect(changed).toContain("baseline.txt");
    });

    it("returns empty for an unchanged worktree", () => {
      const baseline = getGitHead(dir)!;
      const changed = getGitChangedFilesSince(dir, baseline);
      expect(changed).toEqual([]);
    });

    it("returns empty for a non-git directory", () => {
      const notRepo = makeTmpDir("a2p-notrepo");
      try {
        expect(getGitChangedFilesSince(notRepo, "abc123")).toEqual([]);
      } finally {
        cleanTmpDir(notRepo);
      }
    });
  });
});

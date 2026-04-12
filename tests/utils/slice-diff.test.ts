import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanTmpDir } from "../helpers/setup.js";
import {
  classifyFiles,
  DEFAULT_TEST_PATTERNS,
  snapshotFileHashes,
  getSliceDiffSinceBaseline,
  captureBaselineSnapshot,
  matchesGlob,
  parseGitignore,
  isIgnoredByGitignore,
} from "../../src/utils/slice-diff.js";

describe("src/utils/slice-diff", () => {
  let dir: string;

  beforeEach(() => { dir = makeTmpDir("a2p-slicediff"); });
  afterEach(() => { cleanTmpDir(dir); });

  describe("matchesGlob", () => {
    it("matches a single-segment wildcard", () => {
      expect(matchesGlob("foo.test.ts", "*.test.ts")).toBe(true);
      expect(matchesGlob("src/foo.test.ts", "*.test.ts")).toBe(false);
    });

    it("matches a double-star wildcard across segments", () => {
      expect(matchesGlob("src/foo.test.ts", "**/*.test.ts")).toBe(true);
      expect(matchesGlob("a/b/c/foo.test.ts", "**/*.test.ts")).toBe(true);
    });

    it("matches a tests/** pattern", () => {
      expect(matchesGlob("tests/a/b.ts", "**/tests/**")).toBe(true);
      expect(matchesGlob("src/tests/b.ts", "**/tests/**")).toBe(true);
    });

    it("does not match unrelated paths", () => {
      expect(matchesGlob("src/foo.ts", "**/*.test.ts")).toBe(false);
    });
  });

  describe("classifyFiles", () => {
    it("classifies a typical TS project against defaults", () => {
      const { test, production } = classifyFiles(
        [
          "src/foo.ts",
          "src/bar.ts",
          "tests/foo.test.ts",
          "__tests__/baz.ts",
          "src/bar.spec.ts",
        ],
        DEFAULT_TEST_PATTERNS,
      );
      expect(test).toEqual(expect.arrayContaining(["tests/foo.test.ts", "__tests__/baz.ts", "src/bar.spec.ts"]));
      expect(production).toEqual(expect.arrayContaining(["src/foo.ts", "src/bar.ts"]));
    });

    it("classifies Python files against defaults", () => {
      const { test, production } = classifyFiles(
        ["app/main.py", "tests/test_main.py", "app/test_helpers.py"],
        DEFAULT_TEST_PATTERNS,
      );
      expect(test).toContain("tests/test_main.py");
      expect(test).toContain("app/test_helpers.py");
      expect(production).toContain("app/main.py");
    });

    it("honors a custom pattern override", () => {
      const patterns = ["**/*.custom-test.ts"];
      const { test, production } = classifyFiles(
        ["src/foo.custom-test.ts", "src/bar.ts", "tests/baz.test.ts"],
        patterns,
      );
      expect(test).toEqual(["src/foo.custom-test.ts"]);
      // The baseline defaults aren't used; tests/baz.test.ts falls in production.
      expect(production).toEqual(expect.arrayContaining(["src/bar.ts", "tests/baz.test.ts"]));
    });

    it("uses the default patterns when called without an override", () => {
      const { test } = classifyFiles(["tests/a.test.ts"]);
      expect(test).toEqual(["tests/a.test.ts"]);
    });
  });

  describe("snapshotFileHashes", () => {
    it("hashes every file under the root", () => {
      writeFileSync(join(dir, "a.txt"), "hello\n");
      mkdirSync(join(dir, "sub"), { recursive: true });
      writeFileSync(join(dir, "sub", "b.txt"), "world\n");
      const snap = snapshotFileHashes(dir);
      expect(Object.keys(snap).sort()).toEqual(["a.txt", "sub/b.txt"]);
      expect(snap["a.txt"]).toMatch(/^[0-9a-f]{64}$/);
    });

    it("excludes node_modules / dist / .a2p / .git", () => {
      mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
      writeFileSync(join(dir, "node_modules", "pkg", "x.js"), "junk\n");
      mkdirSync(join(dir, "dist"), { recursive: true });
      writeFileSync(join(dir, "dist", "y.js"), "built\n");
      mkdirSync(join(dir, ".a2p"), { recursive: true });
      writeFileSync(join(dir, ".a2p", "state.json"), "{}");
      writeFileSync(join(dir, "keep.ts"), "keep\n");
      const snap = snapshotFileHashes(dir);
      expect(Object.keys(snap)).toContain("keep.ts");
      expect(Object.keys(snap).some((p) => p.startsWith("node_modules/"))).toBe(false);
      expect(Object.keys(snap).some((p) => p.startsWith("dist/"))).toBe(false);
      expect(Object.keys(snap).some((p) => p.startsWith(".a2p/"))).toBe(false);
    });
  });

  describe("captureBaselineSnapshot + getSliceDiffSinceBaseline (file-hash fallback)", () => {
    it("reports a modified file as changed", () => {
      writeFileSync(join(dir, "a.txt"), "original\n");
      const baseline = captureBaselineSnapshot(dir);
      expect(baseline.commit).toBeNull(); // not a git repo
      expect(baseline.fileHashes).toBeDefined();

      writeFileSync(join(dir, "a.txt"), "modified\n");
      const changed = getSliceDiffSinceBaseline(dir, baseline);
      expect(changed).toContain("a.txt");
    });

    it("reports a newly added file as changed", () => {
      writeFileSync(join(dir, "a.txt"), "a\n");
      const baseline = captureBaselineSnapshot(dir);

      writeFileSync(join(dir, "new.txt"), "fresh\n");
      const changed = getSliceDiffSinceBaseline(dir, baseline);
      expect(changed).toContain("new.txt");
    });

    it("reports a deleted file as changed", () => {
      writeFileSync(join(dir, "a.txt"), "a\n");
      writeFileSync(join(dir, "b.txt"), "b\n");
      const baseline = captureBaselineSnapshot(dir);
      // Delete b.txt
      const { rmSync } = require("node:fs") as typeof import("node:fs");
      rmSync(join(dir, "b.txt"));
      const changed = getSliceDiffSinceBaseline(dir, baseline);
      expect(changed).toContain("b.txt");
    });

    it("returns empty for an unchanged worktree", () => {
      writeFileSync(join(dir, "a.txt"), "a\n");
      const baseline = captureBaselineSnapshot(dir);
      const changed = getSliceDiffSinceBaseline(dir, baseline);
      expect(changed).toEqual([]);
    });

    it("excludes .a2p state file from the diff", () => {
      writeFileSync(join(dir, "a.txt"), "a\n");
      const baseline = captureBaselineSnapshot(dir);
      mkdirSync(join(dir, ".a2p"), { recursive: true });
      writeFileSync(join(dir, ".a2p", "state.json"), "{}");
      const changed = getSliceDiffSinceBaseline(dir, baseline);
      expect(changed.some((p) => p.startsWith(".a2p/"))).toBe(false);
    });

    // Bug #2 regression: A2P-generated metadata files must not show up as
    // "production files changed" in the test-first guard. Every first-time
    // /dogfood run hits this on scenario 1 unless the user manually commits
    // the init state before ready_for_red.
    it("excludes A2P metadata (.claude/, CLAUDE.md, .mcp.json, .gitignore) from the diff", () => {
      writeFileSync(join(dir, "a.txt"), "a\n");
      const baseline = captureBaselineSnapshot(dir);

      // Simulate a2p_init_project writing its scaffolding after baseline capture
      mkdirSync(join(dir, ".claude", "agents"), { recursive: true });
      writeFileSync(join(dir, ".claude", "settings.json"), "{}");
      writeFileSync(join(dir, ".claude", "agents", "security-reviewer.md"), "# agent\n");
      writeFileSync(join(dir, "CLAUDE.md"), "# project instructions\n");
      writeFileSync(join(dir, ".mcp.json"), "{}");
      writeFileSync(join(dir, ".gitignore"), "node_modules\n");
      // And a real test file that SHOULD still show up
      mkdirSync(join(dir, "tests"), { recursive: true });
      writeFileSync(join(dir, "tests", "foo.test.ts"), "it('x', () => {});");

      const changed = getSliceDiffSinceBaseline(dir, baseline);
      // A2P metadata must be filtered out
      expect(changed.some((p) => p === "CLAUDE.md")).toBe(false);
      expect(changed.some((p) => p === ".mcp.json")).toBe(false);
      expect(changed.some((p) => p === ".gitignore")).toBe(false);
      expect(changed.some((p) => p.startsWith(".claude/"))).toBe(false);
      // But real test file additions still get reported
      expect(changed).toContain("tests/foo.test.ts");
    });

    it("does NOT exclude a CLAUDE.md that is nested under src/", () => {
      // Only top-level CLAUDE.md is A2P metadata. A same-named file nested
      // inside the user's source tree is legitimate production source.
      writeFileSync(join(dir, "a.txt"), "a\n");
      const baseline = captureBaselineSnapshot(dir);
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "CLAUDE.md"), "# inner\n");
      const changed = getSliceDiffSinceBaseline(dir, baseline);
      expect(changed).toContain("src/CLAUDE.md");
    });
  });

  describe("parseGitignore + isIgnoredByGitignore", () => {
    it("returns empty patterns when .gitignore is missing", () => {
      expect(parseGitignore(dir)).toEqual([]);
    });

    it("parses simple patterns, strips blanks and comments", () => {
      writeFileSync(
        join(dir, ".gitignore"),
        "# comment\nsecret.txt\n\nbuild/\n  trailing.log  \n",
      );
      const patterns = parseGitignore(dir);
      expect(patterns).toEqual(["secret.txt", "build/", "trailing.log"]);
    });

    it("does not include negation patterns", () => {
      writeFileSync(join(dir, ".gitignore"), "foo.txt\n!important.txt\n");
      const patterns = parseGitignore(dir);
      expect(patterns).toEqual(["foo.txt"]);
    });

    it("matches bare filenames anywhere in the tree", () => {
      expect(isIgnoredByGitignore("secret.txt", ["secret.txt"])).toBe(true);
      expect(isIgnoredByGitignore("sub/secret.txt", ["secret.txt"])).toBe(true);
      expect(isIgnoredByGitignore("other.txt", ["secret.txt"])).toBe(false);
    });

    it("handles trailing-slash directory patterns", () => {
      expect(isIgnoredByGitignore("build/out.js", ["build/"])).toBe(true);
      expect(isIgnoredByGitignore("src/build/out.js", ["build/"])).toBe(true);
    });
  });

  describe("snapshotFileHashes respects .gitignore", () => {
    it("excludes files matched by .gitignore", () => {
      writeFileSync(join(dir, ".gitignore"), "secret.txt\n");
      writeFileSync(join(dir, "public.txt"), "public\n");
      writeFileSync(join(dir, "secret.txt"), "secret\n");
      const snap = snapshotFileHashes(dir);
      expect(Object.keys(snap)).toContain("public.txt");
      // .gitignore itself is now excluded as top-level A2P metadata
      // (Bug #2 fix) — the file is not production source and changes to it
      // must not trigger the verify_test_first "production files changed"
      // gate. The gitignore RULES it declares still apply to everything else.
      expect(Object.keys(snap)).not.toContain(".gitignore");
      expect(Object.keys(snap)).not.toContain("secret.txt");
    });

    it("excludes entire directories matched by .gitignore", () => {
      writeFileSync(join(dir, ".gitignore"), "build/\n");
      writeFileSync(join(dir, "keep.ts"), "keep\n");
      mkdirSync(join(dir, "build"), { recursive: true });
      writeFileSync(join(dir, "build", "out.js"), "built\n");
      const snap = snapshotFileHashes(dir);
      expect(Object.keys(snap)).toContain("keep.ts");
      expect(Object.keys(snap).some((p) => p.startsWith("build/"))).toBe(false);
    });
  });

  describe("getSliceDiffSinceBaseline respects .gitignore (file-hash mode)", () => {
    it("filters gitignored files out of the diff", () => {
      writeFileSync(join(dir, ".gitignore"), "ignored.log\n");
      writeFileSync(join(dir, "tracked.ts"), "original\n");
      const baseline = captureBaselineSnapshot(dir);

      // Modify both a tracked and an ignored file
      writeFileSync(join(dir, "tracked.ts"), "modified\n");
      writeFileSync(join(dir, "ignored.log"), "noise\n");

      const changed = getSliceDiffSinceBaseline(dir, baseline);
      expect(changed).toContain("tracked.ts");
      expect(changed).not.toContain("ignored.log");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Symlink handling — snapshotFileHashes must NEVER follow symlinks.
  // Previously the function used statSync (which follows symlinks) with no
  // isSymbolicLink() guard, which allowed:
  //   1. Symlink loops (symlink → parent) to hang the traversal until the
  //      50k-file cap was hit.
  //   2. Information leak: symlinks pointing outside the project tree would
  //      have their target file contents hashed and stored in the baseline.
  //   3. TOCTOU / sandbox escape vectors.
  //
  // The fix is to use readdirSync({ withFileTypes: true }) and skip any
  // Dirent where isSymbolicLink() is true — neither hashing nor traversing.
  // ─────────────────────────────────────────────────────────────────────
  describe("snapshotFileHashes — symlink handling", () => {
    // Helper: try to create a symlink; skip the test gracefully on systems
    // where it fails (permissions / Windows without dev mode / etc).
    function trySymlink(target: string, path: string): boolean {
      try {
        symlinkSync(target, path);
        return true;
      } catch {
        return false;
      }
    }

    it("ignores a valid symlink to a file inside the project (not in snapshot)", () => {
      writeFileSync(join(dir, "real.txt"), "real-content\n");
      const ok = trySymlink("real.txt", join(dir, "link-to-real.txt"));
      if (!ok) return; // skip on platforms without symlink support

      const snap = snapshotFileHashes(dir);
      expect(Object.keys(snap)).toContain("real.txt");
      expect(Object.keys(snap)).not.toContain("link-to-real.txt");
    });

    it("ignores a broken symlink (dangling target) without crashing", () => {
      const ok = trySymlink("does-not-exist.txt", join(dir, "broken-link"));
      if (!ok) return;
      writeFileSync(join(dir, "keep.txt"), "keep\n");

      const snap = snapshotFileHashes(dir);
      expect(Object.keys(snap)).toContain("keep.txt");
      expect(Object.keys(snap)).not.toContain("broken-link");
    });

    it("ignores a symlink pointing OUTSIDE the project root (security-relevant)", () => {
      // /etc/passwd is a common target for sandbox-escape attempts. On any
      // real system it exists; we link to it and assert the snapshot does
      // NOT contain its content (or any reference to it).
      const ok = trySymlink("/etc/passwd", join(dir, "external-link"));
      if (!ok) return;
      writeFileSync(join(dir, "keep.txt"), "keep\n");

      const snap = snapshotFileHashes(dir);
      expect(Object.keys(snap)).toContain("keep.txt");
      expect(Object.keys(snap)).not.toContain("external-link");
    });

    it("does NOT loop on a symlink that points to its own parent directory", () => {
      // Create: dir/sub/loop -> ../  (self-referencing cycle)
      mkdirSync(join(dir, "sub"), { recursive: true });
      writeFileSync(join(dir, "sub", "real.txt"), "real\n");
      const ok = trySymlink("..", join(dir, "sub", "loop"));
      if (!ok) return;

      // Timeout assertion — if the function loops, vitest's default 5s test
      // timeout would kill it. We assert completion + correct content.
      const snap = snapshotFileHashes(dir);
      expect(Object.keys(snap)).toContain("sub/real.txt");
      expect(Object.keys(snap).some((p) => p.includes("sub/loop"))).toBe(false);
    }, 5000);

    it("does NOT traverse into a symlinked directory", () => {
      // Create a sibling dir with content, then symlink it INTO the project.
      // If symlinks were followed, the inner contents would appear under
      // "linked-dir/*" in the snapshot. They must not.
      const sibling = makeTmpDir("a2p-sibling");
      try {
        writeFileSync(join(sibling, "inner.txt"), "should-not-appear\n");
        const ok = trySymlink(sibling, join(dir, "linked-dir"));
        if (!ok) return;
        writeFileSync(join(dir, "own.txt"), "own\n");

        const snap = snapshotFileHashes(dir);
        expect(Object.keys(snap)).toContain("own.txt");
        expect(Object.keys(snap).some((p) => p.startsWith("linked-dir/"))).toBe(false);
      } finally {
        cleanTmpDir(sibling);
      }
    });

    it("file-hash diff is stable when a symlink is added or removed", () => {
      writeFileSync(join(dir, "a.txt"), "a\n");
      const baseline = captureBaselineSnapshot(dir);

      // Add a symlink after the baseline — diff should NOT contain it.
      const ok = trySymlink("a.txt", join(dir, "a-link.txt"));
      if (!ok) return;

      const changed = getSliceDiffSinceBaseline(dir, baseline);
      expect(changed).not.toContain("a-link.txt");
      // The existing a.txt is untouched → no diff at all
      expect(changed).toEqual([]);
    });
  });
});

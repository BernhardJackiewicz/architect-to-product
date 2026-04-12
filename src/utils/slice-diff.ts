import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join, relative, sep } from "node:path";
import type { SliceBaseline } from "../state/types.js";
import { getGitChangedFilesSince, getGitHead, isGitRepo } from "./git.js";

/**
 * Default test-file glob-ish patterns. Each entry is a simple extended-pattern
 * matched via {@link matchesGlob} below. Projects may override this list via
 * architecture config (Slice 2 adds the project-level override surface; here
 * we ship the defaults only).
 */
export const DEFAULT_TEST_PATTERNS: readonly string[] = [
  "**/tests/**",
  "**/__tests__/**",
  "**/test/**",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.test.js",
  "**/*.test.jsx",
  "**/*.test.mjs",
  "**/*.test.cjs",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/*.spec.js",
  "**/*.spec.jsx",
  "**/*.spec.mjs",
  "**/*.spec.cjs",
  "**/test_*.py",
  "**/*_test.py",
  "**/*_test.go",
  "**/test_*.rs",
  "**/*.test.rs",
  "**/*Test.java",
  "**/*Spec.java",
  "**/*Tests.swift",
  "**/*Spec.kt",
  "**/*Test.kt",
] as const;

/** Directories always excluded from file-hash baseline scans and diffs. */
const EXCLUDED_DIRS = new Set<string>([
  "node_modules",
  "dist",
  ".a2p",
  ".git",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  // A2P's own metadata directory (agents, settings). Not user production
  // source — changes here must not count as "production file changes"
  // in the test-first guard (Bug #2 fix).
  ".claude",
]);

/**
 * Top-level files always excluded from file-hash baseline scans and diffs.
 * These are A2P / project metadata files that `a2p_init_project` writes into
 * the project root; they are not production source and must not trigger the
 * verify_test_first "production files changed" gate (Bug #2 fix).
 *
 * Matched against the bare basename ONLY at the top level — a user-authored
 * file inside `src/` that happens to share a name is not excluded.
 */
const EXCLUDED_TOP_LEVEL_FILES = new Set<string>([
  "CLAUDE.md",
  ".mcp.json",
  ".gitignore",
]);

/**
 * A very small glob matcher that handles the subset we need:
 * `**` matches any path segment sequence, `*` matches one segment (no `/`),
 * literal text matches literal text. No brace expansion — callers must list
 * each extension explicitly (see DEFAULT_TEST_PATTERNS).
 */
export function matchesGlob(path: string, pattern: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  const re = globToRegex(pattern);
  return re.test(normalized);
}

function globToRegex(pattern: string): RegExp {
  let src = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // ** — any number of path segments including zero
        src += ".*";
        i += 2;
        if (pattern[i] === "/") i += 1;
      } else {
        // * — one segment (no /)
        src += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      src += "[^/]";
      i += 1;
    } else if (ch === "." || ch === "+" || ch === "(" || ch === ")" || ch === "|" || ch === "^" || ch === "$" || ch === "{" || ch === "}") {
      src += "\\" + ch;
      i += 1;
    } else {
      src += ch;
      i += 1;
    }
  }
  return new RegExp("^" + src + "$");
}

/** Classify a list of relative paths into test vs production buckets. */
export function classifyFiles(
  paths: string[],
  patterns: readonly string[] = DEFAULT_TEST_PATTERNS,
): { test: string[]; production: string[] } {
  const test: string[] = [];
  const production: string[] = [];
  for (const p of paths) {
    if (patterns.some((pat) => matchesGlob(p, pat))) {
      test.push(p);
    } else {
      production.push(p);
    }
  }
  return { test, production };
}

/**
 * Parse a .gitignore file into a list of patterns (glob-style).
 * Supports: literal paths, directory prefixes (`name/`), simple wildcards
 * (`*.ext`, `**`), blank lines + `#` comments. Does NOT support negation
 * (`!pattern`), nested .gitignore, or `.gitattributes`-style rules.
 *
 * Returns an empty array if the file doesn't exist or can't be read.
 */
export function parseGitignore(projectPath: string): string[] {
  const gitignorePath = join(projectPath, ".gitignore");
  if (!existsSync(gitignorePath)) return [];
  let content: string;
  try {
    content = readFileSync(gitignorePath, "utf-8");
  } catch {
    return [];
  }
  // Strip UTF-8 BOM if present.
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const patterns: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue; // blank
    if (line.startsWith("#")) continue; // comment
    if (line.startsWith("!")) continue; // negation — not supported
    patterns.push(line);
  }
  return patterns;
}

/**
 * Test whether a relative path is ignored by the given .gitignore patterns.
 * `path` should be forward-slash separated and relative to the project root.
 */
export function isIgnoredByGitignore(path: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return false;
  const normalized = path.replace(/\\/g, "/");
  for (const raw of patterns) {
    let pat = raw;
    // Leading slash anchors to project root — strip it and treat as root-anchored.
    const rootAnchored = pat.startsWith("/");
    if (rootAnchored) pat = pat.slice(1);
    // Trailing slash means directory-only — match that path or anything under it.
    const dirOnly = pat.endsWith("/");
    if (dirOnly) pat = pat.slice(0, -1);
    // A pattern without any wildcard + without a slash matches anywhere in the tree.
    const hasWildcard = pat.includes("*") || pat.includes("?");
    const hasSlash = pat.includes("/");

    if (!hasWildcard && !hasSlash) {
      // Bare filename — match if any path segment equals it, or as a directory.
      const segments = normalized.split("/");
      if (segments.includes(pat)) {
        return true;
      }
      continue;
    }

    // Otherwise treat as a glob anchored per semantics.
    const glob = hasSlash && !rootAnchored ? pat : pat;
    if (matchesGlob(normalized, glob)) return true;
    if (matchesGlob(normalized, `${glob}/**`)) return true;
    if (dirOnly && matchesGlob(normalized, `**/${glob}/**`)) return true;
    if (!hasSlash && matchesGlob(normalized, `**/${glob}`)) return true;
  }
  return false;
}

/** sha256 the contents of a file, or return null on read error. */
export function hashFile(absolutePath: string): string | null {
  try {
    const data = readFileSync(absolutePath);
    return createHash("sha256").update(data).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Walk a directory recursively and return a map of relative-path → sha256,
 * skipping excluded directories AND paths matching .gitignore patterns
 * (simple, non-negation subset — see {@link parseGitignore}). Hard-capped at
 * {@link maxFiles} entries to guarantee bounded cost. Relative paths use
 * forward slashes.
 *
 * Symlinks are ALWAYS ignored — neither hashed nor traversed — for three
 * reasons:
 *   1. Loop safety: a symlink that points to an ancestor creates an
 *      infinite descent that would only stop at the maxFiles cap.
 *   2. Security: a symlink pointing outside the project tree (e.g. to
 *      `/etc/passwd`) would cause that file's contents to be hashed into
 *      the baseline — a sandbox-escape / information-leak vector.
 *   3. Determinism: symlink targets can change without the symlink itself
 *      changing, so hashing the target would produce unstable baselines.
 *
 * Callers that need symlink-aware diffing should use the git-backed path
 * ({@link getSliceDiffSinceBaseline} with a baseline.commit), which delegates
 * to `git diff` and handles symlinks as git sees fit (typically by tracking
 * the target path text, not the dereferenced contents).
 */
export function snapshotFileHashes(
  root: string,
  maxFiles = 50_000,
): Record<string, string> {
  const out: Record<string, string> = {};
  const stack: string[] = [root];
  let scanned = 0;
  const gitignorePatterns = parseGitignore(root);

  while (stack.length > 0 && scanned < maxFiles) {
    const current = stack.pop();
    if (!current) break;

    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const name = entry.name;
      if (EXCLUDED_DIRS.has(name)) continue;
      if (scanned >= maxFiles) break;
      // Skip symlinks unconditionally — see the security/loop/determinism
      // rationale above. `entry.isSymbolicLink()` comes straight from the
      // readdir Dirent, so we never need an extra stat/lstat call.
      if (entry.isSymbolicLink()) continue;
      const abs = join(current, name);
      const rel = relative(root, abs).split(sep).join("/");
      // Skip top-level A2P metadata files (Bug #2 fix).
      if (!rel.includes("/") && EXCLUDED_TOP_LEVEL_FILES.has(rel)) continue;
      if (isIgnoredByGitignore(rel, gitignorePatterns)) continue;
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        const h = hashFile(abs);
        if (h) {
          out[rel] = h;
          scanned += 1;
        }
      }
    }
  }

  return out;
}

function isExcludedPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  for (const dir of EXCLUDED_DIRS) {
    if (normalized === dir || normalized.startsWith(`${dir}/`)) {
      return true;
    }
  }
  // Top-level A2P metadata files. Only bare basenames at the project root —
  // a same-named file nested under `src/` or similar is NOT excluded.
  if (!normalized.includes("/") && EXCLUDED_TOP_LEVEL_FILES.has(normalized)) {
    return true;
  }
  return false;
}

/**
 * Return the list of files that differ from the given baseline. Uses git when
 * the baseline has a commit (and the project is still a git repo), otherwise
 * re-hashes the working tree and compares to the baseline hash map. `.a2p/`,
 * `node_modules/`, `dist/`, `.git/` and similar are always filtered out, and
 * paths matching `.gitignore` patterns are also excluded.
 *
 * Note: the git path already honors .gitignore natively (git diff respects
 * ignore rules), but a defensive filter is still applied so both paths return
 * the same contract.
 */
export function getSliceDiffSinceBaseline(
  projectPath: string,
  baseline: SliceBaseline,
): string[] {
  let changed: string[];
  if (baseline.commit && isGitRepo(projectPath)) {
    changed = getGitChangedFilesSince(projectPath, baseline.commit);
  } else {
    const current = snapshotFileHashes(projectPath);
    const previous = baseline.fileHashes ?? {};
    const set = new Set<string>();
    for (const [path, hash] of Object.entries(current)) {
      if (previous[path] !== hash) set.add(path);
    }
    for (const path of Object.keys(previous)) {
      if (!(path in current)) set.add(path);
    }
    changed = Array.from(set);
  }

  const gitignorePatterns = parseGitignore(projectPath);
  return changed
    .filter((p) => !isExcludedPath(p))
    .filter((p) => !isIgnoredByGitignore(p, gitignorePatterns))
    .sort();
}

/** Capture a fresh baseline for a slice. Prefers a git commit; otherwise hashes. */
export function captureBaselineSnapshot(projectPath: string): SliceBaseline {
  const now = new Date().toISOString();
  if (isGitRepo(projectPath)) {
    const commit = getGitHead(projectPath);
    if (commit) {
      return { commit, capturedAt: now };
    }
  }
  const fileHashes = snapshotFileHashes(projectPath);
  return { commit: null, fileHashes, capturedAt: now };
}

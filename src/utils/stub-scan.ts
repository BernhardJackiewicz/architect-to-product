import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AutomatedStubSignal } from "../state/types.js";
import { classifyFiles, DEFAULT_TEST_PATTERNS } from "./slice-diff.js";

/**
 * Conservative stub/TODO pattern list. Each entry is matched line-by-line.
 * Patterns that are prone to false positives on natural-language strings are
 * narrowed with extra guards (e.g. must be inside a comment or a
 * `throw new Error("...todo...")` call).
 */
const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "TODO", re: /(?:^|\s)(?:\/\/|#|\/\*|<!--)\s*TODO\b/ },
  { name: "FIXME", re: /(?:^|\s)(?:\/\/|#|\/\*|<!--)\s*FIXME\b/ },
  { name: "XXX", re: /(?:^|\s)(?:\/\/|#|\/\*|<!--)\s*XXX\b/ },
  { name: "HACK", re: /(?:^|\s)(?:\/\/|#|\/\*|<!--)\s*HACK\b/ },
  { name: "NotImplementedError", re: /NotImplementedError\b/ },
  { name: "raise NotImplementedError", re: /raise\s+NotImplementedError/ },
  {
    name: 'throw new Error("todo")',
    re: /throw\s+new\s+Error\s*\(\s*["'`][^"'`]*(?:todo|not\s*implemented|unimplemented)[^"'`]*["'`]/i,
  },
  {
    name: 'return null // todo',
    re: /return\s+(?:null|undefined|None)\s*;?\s*(?:\/\/|#)\s*(?:todo|stub)/i,
  },
  { name: "console.warn stub", re: /console\.warn\s*\(\s*["'`][^"'`]*stub/i },
];

/**
 * Regex for the start of a Python def signature. Matches single-line signatures
 * only (multi-line signatures like `def foo(\n    a,\n    b\n):` are NOT matched
 * — acceptable conservative limitation).
 */
const PYTHON_DEF_RE = /^(\s*)def\s+\w+\s*\([^)]*\)\s*(?:->[^:]+)?:\s*$/;

/**
 * Detect "placeholder" Python functions whose entire body is a single `pass`.
 * Plan requirement (§Stub scan helper): "Python function body of a single
 * `pass` where the function has a non-trivial signature."
 *
 * Conservative rules to avoid false positives:
 * 1. The def line must match {@link PYTHON_DEF_RE} (one-line signature).
 * 2. The signature must contain at least one parameter OR the function name
 *    must be longer than 3 characters (filters out trivial `def a()`).
 * 3. The very next non-empty, non-comment line must be `pass` alone.
 * 4. The body must not contain any other statements — the line after `pass`
 *    must be EOF, blank, a comment, or dedented to ≤ def indent.
 *
 * Returns one signal per placeholder function, keyed to the 1-based line of
 * the `pass` statement.
 */
function scanPythonPassPlaceholders(
  rel: string,
  lines: string[],
): AutomatedStubSignal[] {
  const out: AutomatedStubSignal[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(PYTHON_DEF_RE);
    if (!match) continue;
    // Skip trivial signatures where the plan's "non-trivial" rule clearly
    // doesn't apply. A def with no parameters AND a very short name
    // (`def a():`) is likely not a real placeholder.
    const nameMatch = lines[i].match(/def\s+(\w+)\s*\(([^)]*)\)/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const params = nameMatch[2].trim();
    if (name.length <= 3 && params.length === 0) continue;

    const defIndent = match[1].length;
    // Find the next non-empty, non-comment line.
    let j = i + 1;
    while (
      j < lines.length &&
      (lines[j].trim() === "" || lines[j].trim().startsWith("#"))
    ) {
      j += 1;
    }
    if (j >= lines.length) continue;
    const bodyLine = lines[j];
    const bodyIndent = (bodyLine.match(/^(\s*)/)?.[1] ?? "").length;
    if (bodyIndent <= defIndent) continue; // dedented — empty body
    if (bodyLine.trim() !== "pass") continue;

    // Check the next meaningful line after `pass` — must be EOF, blank,
    // comment, or dedented.
    let k = j + 1;
    while (k < lines.length && lines[k].trim() === "") k += 1;
    if (k < lines.length) {
      const nextTrim = lines[k].trim();
      if (!nextTrim.startsWith("#")) {
        const nextIndent = (lines[k].match(/^(\s*)/)?.[1] ?? "").length;
        if (nextIndent > defIndent) continue; // more body after pass
      }
    }

    out.push({
      file: rel,
      line: j + 1,
      pattern: "python pass-only function",
      snippet: bodyLine.trim().slice(0, 200),
    });
  }
  return out;
}

/**
 * Scan the given files (relative paths under projectPath) for stub/shortcut
 * signals. Test files are skipped by default. Each signal carries the file,
 * 1-based line number, the matching pattern name, and a short snippet.
 */
export function scanForStubSignals(
  projectPath: string,
  files: string[],
  testPatterns: readonly string[] = DEFAULT_TEST_PATTERNS,
): AutomatedStubSignal[] {
  const { production } = classifyFiles(files, testPatterns);
  const signals: AutomatedStubSignal[] = [];

  for (const rel of production) {
    const abs = join(projectPath, rel);
    let content: string;
    try {
      content = readFileSync(abs, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);

    // Line-by-line pattern scan (TODO, FIXME, NotImplementedError, etc.).
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { name, re } of PATTERNS) {
        if (re.test(line)) {
          signals.push({
            file: rel,
            line: i + 1,
            pattern: name,
            snippet: line.trim().slice(0, 200),
          });
          break; // one signal per line is enough
        }
      }
    }

    // Multi-line Python pass-only placeholder scan (Python files only).
    if (/\.py$/i.test(rel)) {
      signals.push(...scanPythonPassPlaceholders(rel, lines));
    }
  }

  return signals;
}

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanTmpDir } from "../helpers/setup.js";
import { scanForStubSignals } from "../../src/utils/stub-scan.js";

describe("stub scan", () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir("a2p-stub"); });
  afterEach(() => { cleanTmpDir(dir); });

  it("detects TODO comments", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "a.ts"), "// TODO: implement this\nexport const x = 1;\n");
    const signals = scanForStubSignals(dir, ["src/a.ts"]);
    expect(signals.length).toBe(1);
    expect(signals[0].pattern).toBe("TODO");
  });

  it("detects FIXME comments", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "b.ts"), "// FIXME: broken\n");
    const signals = scanForStubSignals(dir, ["src/b.ts"]);
    expect(signals[0].pattern).toBe("FIXME");
  });

  it("detects throw new Error('todo')", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "c.ts"), 'throw new Error("todo: finish me");\n');
    const signals = scanForStubSignals(dir, ["src/c.ts"]);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0].pattern).toContain("todo");
  });

  it("detects NotImplementedError", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "d.py"), "raise NotImplementedError()\n");
    const signals = scanForStubSignals(dir, ["src/d.py"]);
    expect(signals.length).toBeGreaterThan(0);
  });

  it("skips test files", () => {
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(
      join(dir, "tests", "foo.test.ts"),
      "// TODO: testing is fine\n",
    );
    const signals = scanForStubSignals(dir, ["tests/foo.test.ts"]);
    expect(signals).toEqual([]);
  });

  it("does not flag the word 'todo' inside an unrelated string", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src", "e.ts"),
      'const msg = "write your todo list here";\n',
    );
    const signals = scanForStubSignals(dir, ["src/e.ts"]);
    expect(signals).toEqual([]);
  });

  // ─── Python pass-only placeholder detection ─────────────────────────────

  it("detects a Python function with only `pass` as its body", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src", "stub.py"),
      "def important_function(x, y):\n    pass\n",
    );
    const signals = scanForStubSignals(dir, ["src/stub.py"]);
    expect(signals.some((s) => s.pattern === "python pass-only function")).toBe(true);
  });

  it("detects python pass-only even with a blank line between def and pass", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src", "stub.py"),
      "def process_payment(amount):\n\n    pass\n",
    );
    const signals = scanForStubSignals(dir, ["src/stub.py"]);
    expect(signals.some((s) => s.pattern === "python pass-only function")).toBe(true);
  });

  it("does NOT flag a Python function with pass followed by more statements", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src", "real.py"),
      "def real_function(x):\n    pass\n    return x + 1\n",
    );
    const signals = scanForStubSignals(dir, ["src/real.py"]);
    // Should not detect the python pass pattern (body has more than just pass)
    expect(signals.filter((s) => s.pattern === "python pass-only function")).toEqual([]);
  });

  it("does NOT flag a Python function with real body followed by pass", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src", "real2.py"),
      "def action(x):\n    x += 1\n    pass\n",
    );
    const signals = scanForStubSignals(dir, ["src/real2.py"]);
    expect(signals.filter((s) => s.pattern === "python pass-only function")).toEqual([]);
  });

  it("does NOT flag pass inside try/except or other constructs", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src", "try.py"),
      "def safe_op(x):\n    try:\n        return x / 0\n    except Exception:\n        pass\n",
    );
    const signals = scanForStubSignals(dir, ["src/try.py"]);
    expect(signals.filter((s) => s.pattern === "python pass-only function")).toEqual([]);
  });

  it("still detects pass-only function when a comment precedes pass", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src", "commented.py"),
      "def handler(request):\n    # implement later\n    pass\n",
    );
    const signals = scanForStubSignals(dir, ["src/commented.py"]);
    expect(signals.some((s) => s.pattern === "python pass-only function")).toBe(true);
  });
});

// Vitest global setup. Runs once before any test file is imported.
//
// Default: all tests run under the NATIVE slice flow. Tests that exercise
// legacy state-machine semantics (e.g. tests/state-manager.test.ts, most
// e2e/*.test.ts files) set StateManager.forceLegacyFlowForTests = true in
// their own beforeAll hook. Bootstrap slices always use the legacy flow
// regardless of this flag.
export {};

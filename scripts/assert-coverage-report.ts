/**
 * Post-coverage assertion: `vitest run --coverage` can exit 0 while silently
 * producing an empty coverage report (e.g. if the coverage-provider merge
 * step throws and is swallowed, or non-Vitest spec files get swept into the
 * run). An empty report makes the configured thresholds meaningless, since
 * 0-of-0 files "passes" any percentage gate. Fail the build explicitly in
 * that case instead of trusting the exit code alone.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const COVERAGE_DIR = join(process.cwd(), "coverage");
const FINAL_JSON = join(COVERAGE_DIR, "coverage-final.json");
const LCOV_INFO = join(COVERAGE_DIR, "lcov.info");

// A handful of source files that should always appear in an instrumented
// report; used as a sanity check that real app code — not just test files —
// was covered.
const EXPECTED_SOURCE_HINTS = ["components/", "utils/"];

function fail(msg: string): never {
  console.error(`assert-coverage-report: ${msg}`);
  process.exit(1);
}

function main() {
  if (!existsSync(FINAL_JSON)) {
    fail(`${FINAL_JSON} is missing — coverage did not run or was misconfigured`);
  }

  const raw = readFileSync(FINAL_JSON, "utf8");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(`${FINAL_JSON} is not valid JSON: ${(err as Error).message}`);
  }

  const filePaths = Object.keys(parsed!);
  if (filePaths.length === 0) {
    fail(
      "coverage-final.json contains no instrumented files (empty report). " +
        "The coverage gate is not protecting anything — check that Vitest's " +
        "`test.include`/`test.exclude` only match real Vitest specs.",
    );
  }

  const hasExpectedSource = filePaths.some((f) =>
    EXPECTED_SOURCE_HINTS.some((hint) => f.includes(hint)),
  );
  if (!hasExpectedSource) {
    fail(
      `coverage-final.json has ${filePaths.length} file(s) but none live under ` +
        `${EXPECTED_SOURCE_HINTS.join(" or ")} — instrumentation likely covered the wrong sources.`,
    );
  }

  if (!existsSync(LCOV_INFO) || statSync(LCOV_INFO).size === 0) {
    fail(`${LCOV_INFO} is missing or empty even though ${filePaths.length} files were covered`);
  }

  console.log(`assert-coverage-report: ok (${filePaths.length} instrumented files)`);
}

main();

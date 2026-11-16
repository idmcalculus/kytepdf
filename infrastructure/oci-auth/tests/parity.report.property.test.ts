// Feature: auth-server-deployment-parity, Property 6: Failure reports use only allowed labels and partition every detail

/**
 * Property-based tests for report labelling and partition.
 *
 * **Validates: Requirements 8.1, 8.5, 8.6, 8.7**
 *
 * Property 6: Failure reports use only allowed labels and partition every detail.
 *
 * The report-assembly invariants must hold for EVERY possible combination of
 * per-category findings — not just the single report produced by the live repo.
 * We therefore drive the real, exported `assembleParityReport` (the exact
 * production assembly used by `runParityCheck`) and the real
 * `sesFindingToEnvVarFinding` fold over thousands of fast-check-generated
 * finding sets, asserting the labelling/partition/attribution invariants for all
 * of them. A final deterministic check runs `runParityCheck()` once against the
 * live repository as an integration smoke.
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  assembleParityReport,
  runParityCheck,
  sesFindingToEnvVarFinding,
} from "../parity/runParityCheck.js";
import type {
  DirectReferenceFinding,
  DocumentationFinding,
  EnvVarFinding,
  MechanismFinding,
  SesFinding,
} from "../parity/types.js";

// ---------------------------------------------------------------------------
// The three allowed drift-category labels (R8.1)
// ---------------------------------------------------------------------------
const ALLOWED_LABELS = ["direct-reference", "environment-variable", "documentation"] as const;

// ---------------------------------------------------------------------------
// Arbitrary finding generators
// ---------------------------------------------------------------------------

const directReferenceFindingArb: fc.Arbitrary<DirectReferenceFinding> = fc.record(
  {
    file: fc.string({ minLength: 1, maxLength: 30 }),
    matchedText: fc.string({ minLength: 1, maxLength: 30 }),
    line: fc.option(fc.nat({ max: 10000 }), { nil: undefined }),
  },
  { requiredKeys: ["file", "matchedText"] },
);

const mechanismFindingArb: fc.Arbitrary<MechanismFinding> = fc.record({
  aspect: fc.constantFrom(
    "npm-ci",
    "ci-failure-message",
    "start-script",
    "embedded-package-json",
    "embedded-lockfile",
    "unreadable-source",
  ),
  detail: fc.string({ minLength: 1, maxLength: 40 }),
});

/** direct-reference category input: a mix of DirectReferenceFinding and MechanismFinding. */
const directRefCategoryArb: fc.Arbitrary<Array<DirectReferenceFinding | MechanismFinding>> =
  fc.array(fc.oneof(directReferenceFindingArb, mechanismFindingArb), { maxLength: 8 });

const envVarFindingArb: fc.Arbitrary<EnvVarFinding> = fc.record(
  {
    kind: fc.constantFrom(
      "missing-required",
      "stale-exemption",
      "ses-in-contract",
      "ses-in-deployment",
    ),
    name: fc.string({ minLength: 1, maxLength: 25 }),
    source: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  },
  { requiredKeys: ["kind", "name"] },
);

const sesFindingArb: fc.Arbitrary<SesFinding> = fc.record({
  origin: fc.constantFrom("contract", "deployment"),
  name: fc.string({ minLength: 1, maxLength: 25 }),
  source: fc.string({ minLength: 1, maxLength: 30 }),
});

/** environment-variable category input: EnvVarFindings plus folded SesFindings. */
const envCategoryArb: fc.Arbitrary<Array<EnvVarFinding | SesFinding>> = fc
  .tuple(fc.array(envVarFindingArb, { maxLength: 6 }), fc.array(sesFindingArb, { maxLength: 4 }))
  .map(([envFindings, sesFindings]) => [
    ...envFindings,
    ...sesFindings.map(sesFindingToEnvVarFinding),
  ]);

const documentationFindingArb: fc.Arbitrary<DocumentationFinding> = fc.record({
  location: fc.string({ minLength: 1, maxLength: 30 }),
  detail: fc.string({ minLength: 1, maxLength: 40 }),
});

const docCategoryArb: fc.Arbitrary<DocumentationFinding[]> = fc.array(documentationFindingArb, {
  maxLength: 6,
});

// ---------------------------------------------------------------------------
// Property 6 — invariants over ALL generated finding sets
// ---------------------------------------------------------------------------

describe("Property 6: Failure reports use only allowed labels and partition every detail", () => {
  it("details carries exactly the three allowed DriftCategory labels — no more, no fewer (R8.1)", () => {
    fc.assert(
      fc.property(directRefCategoryArb, envCategoryArb, docCategoryArb, (dr, ev, doc) => {
        const report = assembleParityReport(dr, ev, doc);
        const keys = Object.keys(report.details);

        expect(keys).toHaveLength(3);
        for (const label of ALLOWED_LABELS) {
          expect(keys).toContain(label);
        }
        for (const key of keys) {
          expect(ALLOWED_LABELS as readonly string[]).toContain(key);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("each category ok equals (findings.length === 0), and report.ok iff every category ok (R8.5, R8.6)", () => {
    fc.assert(
      fc.property(directRefCategoryArb, envCategoryArb, docCategoryArb, (dr, ev, doc) => {
        const report = assembleParityReport(dr, ev, doc);

        expect(report.details["direct-reference"].ok).toBe(dr.length === 0);
        expect(report.details["environment-variable"].ok).toBe(ev.length === 0);
        expect(report.details.documentation.ok).toBe(doc.length === 0);

        const everyOk =
          report.details["direct-reference"].ok &&
          report.details["environment-variable"].ok &&
          report.details.documentation.ok;
        expect(report.ok).toBe(everyOk);

        // R8.5: whenever the report fails, at least one category surfaces findings.
        if (!report.ok) {
          const total =
            report.details["direct-reference"].findings.length +
            report.details["environment-variable"].findings.length +
            report.details.documentation.findings.length;
          expect(total).toBeGreaterThan(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("every detail is partitioned into exactly one category — no loss, no duplication (R8.6)", () => {
    fc.assert(
      fc.property(directRefCategoryArb, envCategoryArb, docCategoryArb, (dr, ev, doc) => {
        const report = assembleParityReport(dr, ev, doc);

        // Each category holds exactly its own input findings, in order.
        expect(report.details["direct-reference"].findings).toEqual(dr);
        expect(report.details["environment-variable"].findings).toEqual(ev);
        expect(report.details.documentation.findings).toEqual(doc);

        // Total count across categories equals the sum of inputs (partition: no
        // finding is dropped or duplicated across labels).
        const total =
          report.details["direct-reference"].findings.length +
          report.details["environment-variable"].findings.length +
          report.details.documentation.findings.length;
        expect(total).toBe(dr.length + ev.length + doc.length);
      }),
      { numRuns: 200 },
    );
  });

  it("every SES finding is attributed to the environment-variable category, never elsewhere (R8.7)", () => {
    fc.assert(
      fc.property(
        directRefCategoryArb,
        docCategoryArb,
        fc.array(sesFindingArb, { minLength: 1, maxLength: 6 }),
        // Non-SES env findings only, so the sole SES-kind findings come from folding.
        fc.array(
          fc.record(
            {
              kind: fc.constantFrom("missing-required", "stale-exemption"),
              name: fc.string({ minLength: 1, maxLength: 25 }),
              source: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
            },
            { requiredKeys: ["kind", "name"] },
          ) as fc.Arbitrary<EnvVarFinding>,
          { maxLength: 4 },
        ),
        (dr, doc, sesFindings, plainEnvFindings) => {
          // Fold SES findings the way runParityCheck does, then assemble.
          const folded = sesFindings.map(sesFindingToEnvVarFinding);
          const envFindings: Array<EnvVarFinding | SesFinding> = [...plainEnvFindings, ...folded];
          const report = assembleParityReport(dr, envFindings, doc);

          const isSesKind = (f: unknown): boolean =>
            typeof f === "object" &&
            f !== null &&
            "kind" in f &&
            ((f as { kind: string }).kind === "ses-in-contract" ||
              (f as { kind: string }).kind === "ses-in-deployment");

          // Folding always yields a SES-kind EnvVarFinding (R8.7 precondition).
          for (const f of folded) {
            expect(isSesKind(f)).toBe(true);
          }

          // Every folded SES finding lands in environment-variable...
          const envSes = report.details["environment-variable"].findings.filter(isSesKind);
          expect(envSes).toHaveLength(folded.length);

          // ...and none leak into direct-reference or documentation.
          expect(report.details["direct-reference"].findings.filter(isSesKind)).toHaveLength(0);
          expect(report.details.documentation.findings.filter(isSesKind)).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  // -------------------------------------------------------------------------
  // Integration smoke: the live-repo report is structurally valid and passing.
  // -------------------------------------------------------------------------
  it("runParityCheck() returns a structurally valid, passing report against the live repository", () => {
    const report = runParityCheck();

    expect(typeof report.ok).toBe("boolean");
    expect(Object.keys(report.details)).toHaveLength(3);
    for (const label of ALLOWED_LABELS) {
      const result = report.details[label];
      expect(typeof result.ok).toBe("boolean");
      expect(Array.isArray(result.findings)).toBe(true);
      expect(result.ok).toBe(result.findings.length === 0);
    }
    expect(report.ok, JSON.stringify(report.details, null, 2)).toBe(true);
  });
});

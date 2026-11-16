// Feature: auth-server-deployment-parity, Property 2: Env-var contract parser classifies required vs optional correctly

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseEnvContract } from "../parity/envContract.js";

/**
 * Property-based tests for the env-var contract parser.
 *
 * **Validates: Requirements 4.1, 4.2, 5.1**
 *
 * Property 2: Env-var contract parser classifies required vs optional correctly
 */

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Valid env-var NAME: [A-Za-z_][A-Za-z0-9_]* */
const envVarNameArb = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]*$/);

/**
 * Value for the right-hand side of an assignment.
 * Exclude newlines so a single line stays a single line.
 */
const envVarValueArb = fc.string().filter((s) => !s.includes("\n") && !s.includes("\r"));

/**
 * A pure prose comment line that contains NO `NAME=` shape — should produce no entry.
 * Examples: `# This is a comment`, `# Server config`, `# Use PostgreSQL in prod`.
 * We build lines that either have no `=` at all, or have an `=` but not preceded by a
 * valid NAME immediately after any leading `#`.
 */
const proseCommentArb = fc
  .string({ minLength: 1 })
  .filter((s) => !s.includes("\n") && !s.includes("\r"))
  .map((s) => `# ${s}`)
  .filter((line) => !/^#\s*[A-Za-z_][A-Za-z0-9_]*=/.test(line.trim()));

// ---------------------------------------------------------------------------
// Describe block
// ---------------------------------------------------------------------------

describe("Property 2: Env-var contract parser classifies required vs optional correctly", () => {
  // -------------------------------------------------------------------------
  // Property 2a: Active assignment lines are classified as required
  // -------------------------------------------------------------------------
  it("active assignment lines are classified as required (R4.1, R4.2)", () => {
    fc.assert(
      fc.property(envVarNameArb, envVarValueArb, (name, value) => {
        const line = `${name}=${value}`;
        const entries = parseEnvContract(line);

        // Must produce exactly one entry
        expect(entries).toHaveLength(1);

        const entry = entries[0];
        // Name must match exactly
        expect(entry.name).toBe(name);
        // Active line → required: true
        expect(entry.required).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 2b: Commented assignment lines (# NAME=...) are classified as optional
  // -------------------------------------------------------------------------
  it("commented assignment lines are classified as optional (R4.2)", () => {
    fc.assert(
      fc.property(envVarNameArb, envVarValueArb, (name, value) => {
        // Both `# NAME=value` and `#NAME=value` forms
        const lineWithSpace = `# ${name}=${value}`;
        const lineNoSpace = `#${name}=${value}`;

        for (const line of [lineWithSpace, lineNoSpace]) {
          const entries = parseEnvContract(line);

          // Must produce exactly one entry
          expect(entries).toHaveLength(1);

          const entry = entries[0];
          // Name must match exactly
          expect(entry.name).toBe(name);
          // Commented line → required: false
          expect(entry.required).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 2c: Parsed entry name matches exactly the NAME on the left of `=`
  // -------------------------------------------------------------------------
  it("entry name matches exactly the NAME from the left side of `=` (R4.1, R5.1)", () => {
    fc.assert(
      fc.property(
        envVarNameArb,
        envVarValueArb,
        fc.boolean(), // whether to comment it out
        (name, value, commented) => {
          const line = commented ? `# ${name}=${value}` : `${name}=${value}`;
          const entries = parseEnvContract(line);

          expect(entries).toHaveLength(1);
          // The name stored must be exactly the name we put in — case-sensitive, exact
          expect(entries[0].name).toBe(name);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 2d: Pure prose/comment lines (no NAME= shape) produce no entry
  // -------------------------------------------------------------------------
  it("pure prose/comment lines without NAME= shape produce no entry (R4.1)", () => {
    fc.assert(
      fc.property(proseCommentArb, (line) => {
        const entries = parseEnvContract(line);
        expect(entries).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 2e: Blank lines produce no entry
  // -------------------------------------------------------------------------
  it("blank lines produce no entry", () => {
    const entries = parseEnvContract("\n\n\n   \n\t\n");
    expect(entries).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Property 2f: A multi-line document preserves active vs commented classification for each line
  // -------------------------------------------------------------------------
  it("multi-line text classifies each line independently (R4.1, R4.2)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: envVarNameArb,
            value: envVarValueArb,
            commented: fc.boolean(),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        (entries) => {
          const text = entries
            .map(({ name, value, commented }) =>
              commented ? `# ${name}=${value}` : `${name}=${value}`,
            )
            .join("\n");

          const parsed = parseEnvContract(text);

          // Expect the same number of entries (one per assignment line)
          expect(parsed).toHaveLength(entries.length);

          for (let i = 0; i < entries.length; i++) {
            expect(parsed[i].name).toBe(entries[i].name);
            expect(parsed[i].required).toBe(!entries[i].commented);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 2g: No false positives — lines with numbers/special chars at start of name
  //              don't match (the NAME pattern starts with [A-Za-z_])
  // -------------------------------------------------------------------------
  it("lines starting with a digit or special char before `=` produce no entry (no false positives)", () => {
    // Lines like `0NAME=value` or `123=value` should NOT match
    const invalidNameLineArb = fc
      .tuple(
        fc.integer({ min: 0, max: 9 }).map(String), // leading digit
        envVarNameArb,
        envVarValueArb,
      )
      .map(([digit, rest, value]) => `${digit}${rest}=${value}`);

    fc.assert(
      fc.property(invalidNameLineArb, (line) => {
        const entries = parseEnvContract(line);
        expect(entries).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 2h: Names are case-sensitive — NAME and name are distinct entries
  // -------------------------------------------------------------------------
  it("names are treated case-sensitively (R5.1)", () => {
    const text = ["MY_VAR=foo", "my_var=bar", "My_Var=baz"].join("\n");
    const entries = parseEnvContract(text);

    expect(entries).toHaveLength(3);
    expect(entries[0].name).toBe("MY_VAR");
    expect(entries[1].name).toBe("my_var");
    expect(entries[2].name).toBe("My_Var");
    // All are active lines → all required
    for (const e of entries) {
      expect(e.required).toBe(true);
    }
  });
});

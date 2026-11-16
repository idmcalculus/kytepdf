/**
 * Example / edge-case tests for the email-provider restriction.
 *
 * index.ts calls validateEmailProvider() from validation.ts, so these tests
 * exercise the deployed check, not a copy of it. tests/pulumi.loader.test.ts
 * runs index.ts itself and checks that it rejects 'ses'.
 *
 * **Validates: Requirements 9.1, 9.4, 9.5**
 */

import { describe, expect, it } from "vitest";
import { SUPPORTED_EMAIL_PROVIDERS, validateEmailProvider } from "../validation.js";

describe("Email-provider restriction (R9.1, R9.4, R9.5)", () => {
  // ── Accepted providers ──────────────────────────────────────────────────

  it.each(["console", "resend"])("accepts '%s' as a valid email provider", (provider) => {
    expect(() => validateEmailProvider(provider)).not.toThrow();
  });

  // ── Rejected providers ──────────────────────────────────────────────────

  it.each([
    "ses",
    "SES",
    "Console",
    "",
    "smtp",
    "sendgrid",
    "null",
  ])("rejects '%s' and throws an error naming the rejected value and supported set", (provider) => {
    // Must throw
    expect(() => validateEmailProvider(provider)).toThrow();

    // Error message must mention the rejected value (or 'emailProvider' for
    // the empty-string case where there is nothing printable to match on).
    const pattern =
      provider === ""
        ? /emailProvider/
        : new RegExp(provider.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    expect(() => validateEmailProvider(provider)).toThrow(pattern);

    // Error message must also name the supported set
    expect(() => validateEmailProvider(provider)).toThrow(/console/);
    expect(() => validateEmailProvider(provider)).toThrow(/resend/);
  });

  // ── Supported set is exactly ["console", "resend"] ──────────────────────

  it("supported provider set is exactly [console, resend] — no more, no less", () => {
    expect([...SUPPORTED_EMAIL_PROVIDERS].sort()).toEqual(["console", "resend"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_ERROR_MESSAGE,
  describeFailure,
  mapError,
  UserFacingError,
} from "../../utils/errorMapper";

describe("errorMapper", () => {
  it("should map PDFs without passwords", () => {
    const error = "This PDF is not password-protected.";
    const mapped = mapError(error);
    expect(mapped).toBe("This PDF does not currently have a password.");
  });

  it("should map already protected PDFs", () => {
    const error = "This PDF is already password-protected.";
    const mapped = mapError(error);
    expect(mapped).toBe(
      "This PDF is already protected. Remove the current password before applying a new one.",
    );
  });

  it("should map incorrect password errors", () => {
    const error = "Password incorrect";
    const mapped = mapError(error);
    expect(mapped).toBe("The password is incorrect. Enter the current PDF password and try again.");
  });

  it("should map password-required errors", () => {
    const error = "NEEDS PASSWORD";
    const mapped = mapError(error);
    expect(mapped).toBe("This PDF requires its current password before Kyte can unlock it.");
  });

  it("should map password-protected errors", () => {
    const error = "The document is password protected";
    const mapped = mapError(error);
    expect(mapped).toBe(
      "This PDF is password-protected. Please remove the password and try again.",
    );
  });

  it("should map invalid PDF errors", () => {
    const error = new Error("Not a valid PDF file");
    const mapped = mapError(error);
    expect(mapped).toContain("corrupted, damaged, or contains non-standard security headers");
    expect(mapped).toContain("re-exporting");
  });

  it.each([
    "Bad xref entry",
    "Stream error in object",
    "Malformed content stream",
    "Damaged file structure",
    "File has no pdf header",
    "Invalid cross-reference table",
    "Object stream parse error",
    "Non-standard security header detected",
    "Missing startxref pointer",
    "File is corrupt",
    "Malicious content detected in stream",
    "Bad PDF header found",
    "Unexpected data after trailer",
    "Unexpected EOF while parsing",
    "Missing eof marker in trailer",
    // pdf-lib's own wording for unreadable files and encryption it can't handle
    "Failed to parse PDF document (line:3 col:0 offset=17): No PDF header found",
    "Parser stalled at offset 1024",
    "Missing catalog (ref=1 0 R)",
    "Unknown encryption method: AESV4",
    "Unsupported encryption algorithm",
    "Invalid key length",
    "Invalid crypt filter",
    "Unknown crypto method",
  ])("should map structural error: %s", (message) => {
    const mapped = mapError(new Error(message));
    expect(mapped).toContain("corrupted, damaged, or contains non-standard security headers");
    expect(mapped).toContain("re-exporting");
  });

  it("should map out of memory errors", () => {
    const error = "out of memory error";
    const mapped = mapError(error);
    expect(mapped).toBe(
      "The file is too large or complex for your browser's memory. Try a smaller file.",
    );
  });

  it("should map network errors", () => {
    const error = "Failed to fetch CDN resource";
    const mapped = mapError(error);
    expect(mapped).toBe(
      "A network error occurred while loading a component. Please check your connection and refresh.",
    );
  });

  it("should return fallback for unknown errors", () => {
    const error = "Unknown technical glitch";
    const mapped = mapError(error, "Custom fallback");
    expect(mapped).toBe("Custom fallback");
  });

  it("should return original message if no fallback and no mapping", () => {
    const error = "Something went wrong";
    const mapped = mapError(error, "");
    expect(mapped).toBe("Something went wrong");
  });

  it("passes the message of a UserFacingError through unchanged", () => {
    // Would match the password pattern if it were treated as a technical error.
    const message = "Enter a password of at least 8 characters.";
    expect(mapError(new UserFacingError(message))).toBe(message);
  });

  it("recognises browser errors by name when the message alone is vague", () => {
    const error = new DOMException(
      "The requested file could not be read, typically due to permission problems.",
      "NotReadableError",
    );
    expect(mapError(error)).toBe(
      "Kyte could not read this file. It may have been moved, renamed or changed since you selected it. Select it again and retry.",
    );
  });

  it("explains a save the browser refused to write", () => {
    const error = new DOMException(
      "Failed to execute 'createWritable' on 'FileSystemFileHandle': The request is not allowed by the user agent or the platform in the current context.",
      "NotAllowedError",
    );
    expect(mapError(error)).toBe(
      "Your browser blocked the save request or doesn't support direct saving. Check your permissions.",
    );
  });

  it("handles values that are not errors", () => {
    expect(mapError(undefined)).toBe(DEFAULT_ERROR_MESSAGE);
    expect(mapError({ message: "Out of memory" })).toBe(
      "The file is too large or complex for your browser's memory. Try a smaller file.",
    );
  });

  describe("describeFailure", () => {
    it("adds the known cause to the failed action", () => {
      expect(
        describeFailure("Compression failed.", new RangeError("Array buffer allocation failed")),
      ).toBe(
        "Compression failed. The file is too large or complex for your browser's memory. Try a smaller file.",
      );
    });

    it("keeps a user-facing reason", () => {
      expect(describeFailure("Compression failed.", new UserFacingError("Page 3 is empty."))).toBe(
        "Compression failed. Page 3 is empty.",
      );
    });

    it("asks the user to retry when the cause is unknown", () => {
      expect(describeFailure("Compression failed.", new Error("x is undefined"))).toBe(
        "Compression failed. Please try again.",
      );
    });
  });
});

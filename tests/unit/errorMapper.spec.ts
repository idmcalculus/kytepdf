import { describe, expect, it } from "vitest";
import { mapError } from "../../utils/errorMapper";

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
    expect(mapped).toBe("The file appears to be corrupted or is not a valid PDF document.");
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
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const pdfConfigMock = vi.hoisted(() => ({
  load: vi.fn(),
  getDocument: vi.fn(),
}));

vi.mock("../../utils/pdfConfig", () => ({
  PDFDocument: pdfConfigMock,
  pdfjsLib: {
    getDocument: pdfConfigMock.getDocument,
  },
}));

import {
  ALREADY_PROTECTED_ERROR,
  getPdfSecurityState,
  INCORRECT_PASSWORD_ERROR,
  INVALID_PDF_ERROR,
  isPdfEncrypted,
  isPdfStructureError,
  KNOWN_PASSWORD_REQUIRED_ERROR,
  loadProcessablePdf,
  loadProcessablePdfJsDocument,
  NOT_PROTECTED_ERROR,
  protectPdf,
  unprotectPdf,
} from "../../utils/pdfSecurity";

describe("pdfSecurity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects when a PDF is encrypted", async () => {
    pdfConfigMock.load.mockRejectedValueOnce(new Error("Input document is encrypted"));

    const result = await isPdfEncrypted(new Uint8Array([1, 2, 3]));

    expect(result).toBe(true);
  });

  it("detects when a PDF needs a password", async () => {
    pdfConfigMock.load.mockRejectedValueOnce(new Error("NEEDS PASSWORD"));

    const result = await isPdfEncrypted(new Uint8Array([1, 2, 3]));

    expect(result).toBe(true);
  });

  it("protects a PDF with viewer permissions", async () => {
    const encrypt = vi.fn().mockResolvedValue(undefined);
    const save = vi.fn().mockResolvedValue(new Uint8Array([9, 8, 7]));
    pdfConfigMock.load.mockResolvedValueOnce({ encrypt, save });

    const result = await protectPdf(new Uint8Array([1, 2, 3]), {
      userPassword: "secret123",
      permissions: {
        allowPrinting: true,
        allowCopying: false,
        allowModifying: false,
        allowAnnotating: true,
      },
    });

    expect(result).toEqual(new Uint8Array([9, 8, 7]));
    expect(encrypt).toHaveBeenCalledWith(
      expect.objectContaining({
        userPassword: "secret123",
        permissions: expect.objectContaining({
          printing: "highResolution",
          copying: false,
          modifying: false,
          annotating: true,
        }),
      }),
    );
  });

  it("detects restriction-only PDFs", async () => {
    pdfConfigMock.load
      .mockRejectedValueOnce(new Error("Input document is encrypted"))
      .mockResolvedValueOnce({ save: vi.fn() });

    const result = await getPdfSecurityState(new Uint8Array([1, 2, 3]));

    expect(result).toBe("restriction-only");
    expect(pdfConfigMock.load).toHaveBeenNthCalledWith(2, new Uint8Array([1, 2, 3]), {
      password: "",
    });
  });

  it("detects password-required PDFs when the loader reports NEEDS PASSWORD", async () => {
    pdfConfigMock.load
      .mockRejectedValueOnce(new Error("NEEDS PASSWORD"))
      .mockRejectedValueOnce(new Error("NEEDS PASSWORD"));

    const result = await getPdfSecurityState(new Uint8Array([1, 2, 3]));

    expect(result).toBe("password-required");
  });

  it("rejects protecting an already protected PDF", async () => {
    pdfConfigMock.load.mockRejectedValueOnce(new Error("Input document is encrypted"));

    await expect(
      protectPdf(new Uint8Array([1]), {
        userPassword: "secret123",
        permissions: {
          allowPrinting: true,
          allowCopying: false,
          allowModifying: false,
          allowAnnotating: false,
        },
      }),
    ).rejects.toThrow(ALREADY_PROTECTED_ERROR);
  });

  it("unprotects an encrypted PDF with the current password", async () => {
    const save = vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6]));
    pdfConfigMock.load
      .mockRejectedValueOnce(new Error("Input document is encrypted"))
      .mockRejectedValueOnce(new Error("Password incorrect"))
      .mockResolvedValueOnce({ save });

    const result = await unprotectPdf(new Uint8Array([1, 2, 3]), "secret123");

    expect(result).toEqual(new Uint8Array([4, 5, 6]));
    expect(pdfConfigMock.load).toHaveBeenNthCalledWith(3, new Uint8Array([1, 2, 3]), {
      password: "secret123",
    });
  });

  it("removes owner restrictions without a password when the PDF already opens", async () => {
    const save = vi.fn().mockResolvedValue(new Uint8Array([7, 7, 7]));
    pdfConfigMock.load
      .mockRejectedValueOnce(new Error("Input document is encrypted"))
      .mockResolvedValueOnce({ save })
      .mockResolvedValueOnce({ save });

    const result = await unprotectPdf(new Uint8Array([1, 2, 3]), "");

    expect(result).toEqual(new Uint8Array([7, 7, 7]));
    expect(pdfConfigMock.load).toHaveBeenNthCalledWith(3, new Uint8Array([1, 2, 3]), {
      password: "",
    });
  });

  it("rejects unprotect when the PDF has no password", async () => {
    pdfConfigMock.load.mockResolvedValueOnce({ save: vi.fn() });

    await expect(unprotectPdf(new Uint8Array([1, 2, 3]), "secret123")).rejects.toThrow(
      NOT_PROTECTED_ERROR,
    );
  });

  it("surfaces incorrect password errors while unprotecting", async () => {
    pdfConfigMock.load
      .mockRejectedValueOnce(new Error("Input document is encrypted"))
      .mockRejectedValueOnce(new Error("Password incorrect"))
      .mockRejectedValueOnce(new Error("Password incorrect"));

    await expect(unprotectPdf(new Uint8Array([1, 2, 3]), "wrong-pass")).rejects.toThrow(
      INCORRECT_PASSWORD_ERROR,
    );
  });

  it("treats NEEDS PASSWORD after a supplied unlock password as incorrect", async () => {
    pdfConfigMock.load
      .mockRejectedValueOnce(new Error("NEEDS PASSWORD"))
      .mockRejectedValueOnce(new Error("NEEDS PASSWORD"))
      .mockRejectedValueOnce(new Error("NEEDS PASSWORD"));

    await expect(unprotectPdf(new Uint8Array([1, 2, 3]), "wrong-pass")).rejects.toThrow(
      INCORRECT_PASSWORD_ERROR,
    );
  });

  it("requires a known password when the PDF does not open without one", async () => {
    pdfConfigMock.load
      .mockRejectedValueOnce(new Error("Input document is encrypted"))
      .mockRejectedValueOnce(new Error("Password incorrect"));

    await expect(unprotectPdf(new Uint8Array([1, 2, 3]), "")).rejects.toThrow(
      KNOWN_PASSWORD_REQUIRED_ERROR,
    );
  });

  it("throws when generating owner password and crypto is unavailable", async () => {
    pdfConfigMock.load.mockResolvedValueOnce({ encrypt: vi.fn(), save: vi.fn() });
    const cryptoOriginal = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });

    await expect(
      protectPdf(new Uint8Array([1]), {
        userPassword: "pass",
        permissions: {
          allowPrinting: true,
          allowCopying: true,
          allowModifying: true,
          allowAnnotating: true,
        },
      }),
    ).rejects.toThrow("crypto.getRandomValues is not available");

    Object.defineProperty(globalThis, "crypto", { value: cryptoOriginal, configurable: true });
  });

  it("throws immediately on non-encrypted load errors during isPdfEncrypted", async () => {
    pdfConfigMock.load.mockRejectedValueOnce(new Error("File corrupted"));
    await expect(isPdfEncrypted(new Uint8Array([1]))).rejects.toThrow("File corrupted");
  });

  it("returns 'invalid' for structural/corruption errors during getPdfSecurityState", async () => {
    pdfConfigMock.load.mockRejectedValueOnce(new Error("File corrupted"));
    const result = await getPdfSecurityState(new Uint8Array([1]));
    expect(result).toBe("invalid");
  });

  it("returns 'invalid' when blank-password attempt hits a structural error", async () => {
    pdfConfigMock.load
      .mockRejectedValueOnce(new Error("NEEDS PASSWORD"))
      .mockRejectedValueOnce(new Error("Damaged PDF structure"));
    const result = await getPdfSecurityState(new Uint8Array([1]));
    expect(result).toBe("invalid");
  });

  it("still throws non-structural, non-encrypted errors during getPdfSecurityState", async () => {
    pdfConfigMock.load
      .mockRejectedValueOnce(new Error("NEEDS PASSWORD"))
      .mockRejectedValueOnce(new Error("Random inner failure"));
    await expect(getPdfSecurityState(new Uint8Array([1]))).rejects.toThrow("Random inner failure");
  });

  it("rejects protecting when user password is empty", async () => {
    await expect(
      protectPdf(new Uint8Array([1]), {
        userPassword: "",
        permissions: {
          allowPrinting: true,
          allowCopying: true,
          allowModifying: true,
          allowAnnotating: true,
        },
      }),
    ).rejects.toThrow("Enter a password to protect this PDF.");
  });

  it("rejects protecting when owner password equals user password", async () => {
    await expect(
      protectPdf(new Uint8Array([1]), {
        userPassword: "same",
        ownerPassword: "same",
        permissions: {
          allowPrinting: true,
          allowCopying: true,
          allowModifying: true,
          allowAnnotating: true,
        },
      }),
    ).rejects.toThrow("Owner password must be different");
  });

  it("throws immediately on non-encrypted load errors during protectPdf", async () => {
    pdfConfigMock.load.mockRejectedValueOnce(new Error("Corrupt stream"));
    await expect(
      protectPdf(new Uint8Array([1]), {
        userPassword: "pass",
        permissions: {
          allowPrinting: true,
          allowCopying: true,
          allowModifying: true,
          allowAnnotating: true,
        },
      }),
    ).rejects.toThrow("Corrupt stream");
  });

  it("throws immediately on non-password errors during unprotectPdf", async () => {
    // Return restriction-only
    pdfConfigMock.load
      .mockRejectedValueOnce(new Error("Input document is encrypted"))
      .mockResolvedValueOnce({ save: vi.fn() });

    // The inner attempt throws unknown error
    pdfConfigMock.load.mockRejectedValueOnce(new Error("System error"));
    await expect(unprotectPdf(new Uint8Array([1]), "pass")).rejects.toThrow("System error");
  });

  it("throws INVALID_PDF_ERROR when unprotectPdf encounters an invalid file", async () => {
    pdfConfigMock.load.mockRejectedValueOnce(new Error("Bad xref table"));
    await expect(unprotectPdf(new Uint8Array([1]), "pass")).rejects.toThrow(INVALID_PDF_ERROR);
  });

  describe("loadProcessablePdfJsDocument", () => {
    const pdfDoc = { numPages: 1 };

    it("hands pdf.js a fresh read of a file for each attempt instead of a copy", async () => {
      const file = new File(["%PDF-1.7"], "locked.pdf", { type: "application/pdf" });
      const reads = [new Uint8Array([1, 2]).buffer, new Uint8Array([3, 4]).buffer];
      const arrayBuffer = vi.fn(() => Promise.resolve(reads.shift() as ArrayBuffer));
      Object.defineProperty(file, "arrayBuffer", { value: arrayBuffer });
      pdfConfigMock.getDocument
        .mockReturnValueOnce({ promise: Promise.reject(new Error("No password given")) })
        .mockReturnValueOnce({ promise: Promise.resolve(pdfDoc) });

      const result = await loadProcessablePdfJsDocument(file);

      expect(result).toEqual({ pdfDoc, restrictionOnly: true });
      expect(arrayBuffer).toHaveBeenCalledTimes(2);
      const [first, retry] = pdfConfigMock.getDocument.mock.calls.map(([params]) => params);
      expect(first.data).toEqual(new Uint8Array([1, 2]));
      expect(retry).toEqual({ data: new Uint8Array([3, 4]), password: "" });
    });

    it("gives pdf.js its own copy of bytes the caller still holds", async () => {
      const bytes = new Uint8Array([5, 6, 7]);
      pdfConfigMock.getDocument.mockReturnValueOnce({ promise: Promise.resolve(pdfDoc) });

      await loadProcessablePdfJsDocument(bytes);

      const [{ data }] = pdfConfigMock.getDocument.mock.calls[0];
      expect(data).toEqual(bytes);
      expect(data).not.toBe(bytes);
    });
  });

  describe("input sources and loader edge cases", () => {
    it("reports an openable PDF as not encrypted and accepts ArrayBuffer and File sources", async () => {
      pdfConfigMock.load.mockResolvedValueOnce({}).mockResolvedValueOnce({});

      await expect(isPdfEncrypted(new Uint8Array([1, 2]).buffer)).resolves.toBe(false);
      const file = new File([new Uint8Array([3, 4])], "plain.pdf", { type: "application/pdf" });
      Object.defineProperty(file, "arrayBuffer", {
        value: () => Promise.resolve(new Uint8Array([3, 4]).buffer),
      });
      await expect(isPdfEncrypted(file)).resolves.toBe(false);

      expect(pdfConfigMock.load).toHaveBeenNthCalledWith(1, new Uint8Array([1, 2]));
      expect(pdfConfigMock.load).toHaveBeenNthCalledWith(2, new Uint8Array([3, 4]));
    });

    it("recognises encryption errors thrown as plain strings", async () => {
      pdfConfigMock.load
        .mockRejectedValueOnce("Input document is encrypted")
        .mockResolvedValueOnce({});

      await expect(getPdfSecurityState(new Uint8Array([1]))).resolves.toBe("restriction-only");
    });

    it.each([
      "Failed to parse PDF document (line:0 col:6 offset=6): Expected next byte to be 46 but it was actually 32",
      "Parser stalled",
    ])("reports pdf-lib's parse failure %j as an invalid file", async (message) => {
      pdfConfigMock.load.mockRejectedValueOnce(new Error(message));
      await expect(getPdfSecurityState(new Uint8Array([1]))).resolves.toBe("invalid");
    });

    it("reports an unsupported security handler as an invalid file, not a password", async () => {
      pdfConfigMock.load
        .mockRejectedValueOnce(new Error("Input document is encrypted"))
        .mockRejectedValueOnce(new Error("unknown encryption method"));

      await expect(getPdfSecurityState(new Uint8Array([1]))).resolves.toBe("invalid");
    });

    it("rethrows a first-load error that is neither structural nor about encryption", async () => {
      pdfConfigMock.load.mockRejectedValueOnce(new Error("Out of memory"));

      await expect(getPdfSecurityState(new Uint8Array([1]))).rejects.toThrow("Out of memory");
      expect(pdfConfigMock.load).toHaveBeenCalledTimes(1);
    });

    it("reports password-required when the blank password is rejected as incorrect", async () => {
      pdfConfigMock.load
        .mockRejectedValueOnce(new Error("Input document is encrypted"))
        .mockRejectedValueOnce(new Error("Password incorrect"));

      await expect(getPdfSecurityState(new Uint8Array([1]))).resolves.toBe("password-required");
    });

    it("turns off printing and form filling when both are disallowed", async () => {
      const encrypt = vi.fn().mockResolvedValue(undefined);
      pdfConfigMock.load.mockResolvedValueOnce({
        encrypt,
        save: vi.fn().mockResolvedValue(new Uint8Array([1])),
      });

      await protectPdf(new Uint8Array([1]), {
        userPassword: "secret",
        ownerPassword: "owner-secret",
        permissions: {
          allowPrinting: false,
          allowCopying: true,
          allowModifying: false,
          allowAnnotating: false,
        },
      });

      expect(encrypt).toHaveBeenCalledWith({
        userPassword: "secret",
        ownerPassword: "owner-secret",
        permissions: expect.objectContaining({
          printing: false,
          copying: true,
          fillingForms: false,
          documentAssembly: false,
        }),
      });
    });
  });

  describe("loadProcessablePdf", () => {
    it("loads an unprotected PDF directly", async () => {
      const pdfDoc = { id: "plain" };
      pdfConfigMock.load.mockResolvedValueOnce(pdfDoc);

      await expect(loadProcessablePdf(new Uint8Array([1]))).resolves.toEqual({
        pdfDoc,
        restrictionOnly: false,
      });
    });

    it("opens a restriction-only PDF with a blank password", async () => {
      const pdfDoc = { id: "restricted" };
      pdfConfigMock.load
        .mockRejectedValueOnce(new Error("Input document is encrypted"))
        .mockResolvedValueOnce(pdfDoc);

      await expect(loadProcessablePdf(new Uint8Array([1]))).resolves.toEqual({
        pdfDoc,
        restrictionOnly: true,
      });
      expect(pdfConfigMock.load).toHaveBeenLastCalledWith(new Uint8Array([1]), { password: "" });
    });

    it("rethrows the original encryption error when the PDF needs a real password", async () => {
      const original = new Error("Input document is encrypted");
      pdfConfigMock.load
        .mockRejectedValueOnce(original)
        .mockRejectedValueOnce(new Error("Password incorrect"));

      await expect(loadProcessablePdf(new Uint8Array([1]))).rejects.toBe(original);
    });

    it("surfaces other errors from either load attempt", async () => {
      pdfConfigMock.load.mockRejectedValueOnce(new Error("Parser stalled"));
      await expect(loadProcessablePdf(new Uint8Array([1]))).rejects.toThrow("Parser stalled");

      pdfConfigMock.load
        .mockRejectedValueOnce(new Error("Input document is encrypted"))
        .mockRejectedValueOnce(new Error("Unsupported filter"));
      await expect(loadProcessablePdf(new Uint8Array([1]))).rejects.toThrow("Unsupported filter");
    });
  });

  describe("loadProcessablePdfJsDocument error handling", () => {
    it("rethrows non-password errors without retrying", async () => {
      pdfConfigMock.getDocument.mockReturnValueOnce({
        promise: Promise.reject(new Error("Invalid PDF structure")),
      });

      await expect(loadProcessablePdfJsDocument(new Uint8Array([1]))).rejects.toThrow(
        "Invalid PDF structure",
      );
      expect(pdfConfigMock.getDocument).toHaveBeenCalledTimes(1);
    });

    it("rethrows the first password error when the blank password is refused", async () => {
      const original = new Error("No password given");
      pdfConfigMock.getDocument
        .mockReturnValueOnce({ promise: Promise.reject(original) })
        .mockReturnValueOnce({ promise: Promise.reject(new Error("Incorrect Password")) });

      await expect(loadProcessablePdfJsDocument(new Uint8Array([1]))).rejects.toBe(original);
    });

    it("surfaces a non-password failure from the blank-password retry", async () => {
      pdfConfigMock.getDocument
        .mockReturnValueOnce({ promise: Promise.reject(new Error("PasswordException")) })
        .mockReturnValueOnce({ promise: Promise.reject(new Error("Worker crashed")) });

      await expect(loadProcessablePdfJsDocument(new Uint8Array([1]))).rejects.toThrow(
        "Worker crashed",
      );
    });
  });

  describe("isPdfStructureError", () => {
    it.each([
      "Invalid PDF structure",
      "Not a valid PDF file",
      "Corrupt stream data",
      "Bad xref table",
      "Stream error in object",
      "No PDF header found",
      "Unexpected EOF",
      "Unexpected data after trailer",
      "Malformed content stream",
      "Invalid object number",
      "Missing startxref",
      "Missing eof marker",
      "End-of-file marker not found",
      "Invalid cross-reference table",
      "Object stream parse failure",
      "Attempt to repair PDF",
      "Damaged file structure",
    ])("detects structural error: %s", (message) => {
      expect(isPdfStructureError(new Error(message))).toBe(true);
    });

    it.each([
      "Input document is encrypted",
      "NEEDS PASSWORD",
      "Password incorrect",
      "Some completely unknown error",
    ])("rejects non-structural error: %s", (message) => {
      expect(isPdfStructureError(new Error(message))).toBe(false);
    });
  });
});

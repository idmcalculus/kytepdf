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
  isPdfEncrypted,
  KNOWN_PASSWORD_REQUIRED_ERROR,
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
        permissions: { allowPrinting: true, allowCopying: true, allowModifying: true, allowAnnotating: true },
      })
    ).rejects.toThrow("crypto.getRandomValues is not available");

    Object.defineProperty(globalThis, "crypto", { value: cryptoOriginal, configurable: true });
  });

  it("throws immediately on non-encrypted load errors during isPdfEncrypted", async () => {
    pdfConfigMock.load.mockRejectedValueOnce(new Error("File corrupted"));
    await expect(isPdfEncrypted(new Uint8Array([1]))).rejects.toThrow("File corrupted");
  });

  it("throws immediately on non-encrypted load errors during getPdfSecurityState", async () => {
    pdfConfigMock.load.mockRejectedValueOnce(new Error("File corrupted"));
    await expect(getPdfSecurityState(new Uint8Array([1]))).rejects.toThrow("File corrupted");
    
    // Also test throwing from the second blank-password attempt
    pdfConfigMock.load
      .mockRejectedValueOnce(new Error("NEEDS PASSWORD"))
      .mockRejectedValueOnce(new Error("Random inner failure"));
    await expect(getPdfSecurityState(new Uint8Array([1]))).rejects.toThrow("Random inner failure");
  });

  it("rejects protecting when user password is empty", async () => {
    await expect(
      protectPdf(new Uint8Array([1]), {
        userPassword: "",
        permissions: { allowPrinting: true, allowCopying: true, allowModifying: true, allowAnnotating: true },
      })
    ).rejects.toThrow("Enter a password to protect this PDF.");
  });

  it("rejects protecting when owner password equals user password", async () => {
    await expect(
      protectPdf(new Uint8Array([1]), {
        userPassword: "same",
        ownerPassword: "same",
        permissions: { allowPrinting: true, allowCopying: true, allowModifying: true, allowAnnotating: true },
      })
    ).rejects.toThrow("Owner password must be different");
  });

  it("throws immediately on non-encrypted load errors during protectPdf", async () => {
    pdfConfigMock.load.mockRejectedValueOnce(new Error("Corrupt stream"));
    await expect(
      protectPdf(new Uint8Array([1]), {
        userPassword: "pass",
        permissions: { allowPrinting: true, allowCopying: true, allowModifying: true, allowAnnotating: true },
      })
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
});

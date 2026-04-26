import { PDFDocument, pdfjsLib } from "./pdfConfig.ts";

type PdfSource = File | Uint8Array | ArrayBuffer;
export type PdfSecurityState = "unprotected" | "restriction-only" | "password-required";

export interface PdfProtectionPermissions {
  allowPrinting: boolean;
  allowCopying: boolean;
  allowModifying: boolean;
  allowAnnotating: boolean;
}

export interface ProtectPdfOptions {
  userPassword: string;
  ownerPassword?: string;
  permissions: PdfProtectionPermissions;
}

export const ALREADY_PROTECTED_ERROR =
  "This PDF is already password-protected. Remove the current password before adding a new one.";
export const NOT_PROTECTED_ERROR = "This PDF is not password-protected.";
export const INCORRECT_PASSWORD_ERROR =
  "The current password is incorrect. Enter the password that opens this PDF and try again.";
export const KNOWN_PASSWORD_REQUIRED_ERROR =
  "This PDF requires its current password before Kyte can unlock it.";

const toUint8Array = async (source: PdfSource): Promise<Uint8Array> => {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return new Uint8Array(await source.arrayBuffer());
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const isEncryptedPdfLoadError = (error: unknown) =>
  /needs password|password required|encrypted|password-protected|password protected/i.test(
    getErrorMessage(error),
  );

const isIncorrectPasswordError = (error: unknown) =>
  /password incorrect|incorrect password|invalid password|wrong password/i.test(
    getErrorMessage(error),
  );

const isPdfJsPasswordError = (error: unknown) =>
  /password|PasswordException/i.test(getErrorMessage(error));

const generateOwnerPassword = () => {
  const bytes = new Uint8Array(16);

  if (!globalThis.crypto?.getRandomValues) {
    throw new Error(
      "crypto.getRandomValues is not available. Cannot generate a secure owner password.",
    );
  }
  globalThis.crypto.getRandomValues(bytes);

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export async function isPdfEncrypted(source: PdfSource): Promise<boolean> {
  const bytes = await toUint8Array(source);

  try {
    await PDFDocument.load(bytes);
    return false;
  } catch (error) {
    if (isEncryptedPdfLoadError(error)) {
      return true;
    }

    throw error;
  }
}

export async function getPdfSecurityState(source: PdfSource): Promise<PdfSecurityState> {
  const bytes = await toUint8Array(source);

  try {
    await PDFDocument.load(bytes);
    return "unprotected";
  } catch (error) {
    if (!isEncryptedPdfLoadError(error)) {
      throw error;
    }

    try {
      await PDFDocument.load(bytes, { password: "" });
      return "restriction-only";
    } catch (blankPasswordError) {
      if (
        isIncorrectPasswordError(blankPasswordError) ||
        isEncryptedPdfLoadError(blankPasswordError)
      ) {
        return "password-required";
      }

      throw blankPasswordError;
    }
  }
}

export async function loadProcessablePdf(source: PdfSource) {
  const bytes = await toUint8Array(source);

  try {
    return {
      pdfDoc: await PDFDocument.load(bytes),
      restrictionOnly: false,
    };
  } catch (error) {
    if (!isEncryptedPdfLoadError(error)) {
      throw error;
    }

    try {
      return {
        pdfDoc: await PDFDocument.load(bytes, { password: "" }),
        restrictionOnly: true,
      };
    } catch (blankPasswordError) {
      if (
        isIncorrectPasswordError(blankPasswordError) ||
        isEncryptedPdfLoadError(blankPasswordError)
      ) {
        throw error;
      }

      throw blankPasswordError;
    }
  }
}

export async function loadProcessablePdfJsDocument(source: PdfSource) {
  const bytes = await toUint8Array(source);
  const getPdfJsBytes = () => bytes.slice();

  try {
    return {
      pdfDoc: await pdfjsLib.getDocument({ data: getPdfJsBytes() }).promise,
      restrictionOnly: false,
    };
  } catch (error) {
    if (!isPdfJsPasswordError(error)) {
      throw error;
    }

    try {
      return {
        pdfDoc: await pdfjsLib.getDocument({ data: getPdfJsBytes(), password: "" }).promise,
        restrictionOnly: true,
      };
    } catch (blankPasswordError) {
      if (isPdfJsPasswordError(blankPasswordError)) {
        throw error;
      }

      throw blankPasswordError;
    }
  }
}

export async function protectPdf(
  source: PdfSource,
  { userPassword, ownerPassword, permissions }: ProtectPdfOptions,
): Promise<Uint8Array> {
  const normalizedUserPassword = userPassword;
  const normalizedOwnerPassword = ownerPassword || undefined;

  if (normalizedUserPassword.length === 0) {
    throw new Error("Enter a password to protect this PDF.");
  }

  if (normalizedOwnerPassword && normalizedOwnerPassword === normalizedUserPassword) {
    throw new Error(
      "Owner password must be different from the open password. Leave it blank to auto-generate one.",
    );
  }

  const bytes = await toUint8Array(source);

  try {
    const pdfDoc = await PDFDocument.load(bytes);

    await pdfDoc.encrypt({
      userPassword: normalizedUserPassword,
      ownerPassword: normalizedOwnerPassword || generateOwnerPassword(),
      permissions: {
        printing: permissions.allowPrinting ? "highResolution" : false,
        copying: permissions.allowCopying,
        modifying: permissions.allowModifying,
        annotating: permissions.allowAnnotating,
        fillingForms: permissions.allowAnnotating || permissions.allowModifying,
        contentAccessibility: true,
        documentAssembly: permissions.allowModifying,
      },
    });

    return await pdfDoc.save();
  } catch (error) {
    if (isEncryptedPdfLoadError(error)) {
      throw new Error(ALREADY_PROTECTED_ERROR);
    }

    throw error;
  }
}

export async function unprotectPdf(source: PdfSource, password: string): Promise<Uint8Array> {
  const bytes = await toUint8Array(source);
  const securityState = await getPdfSecurityState(bytes);

  if (securityState === "unprotected") {
    throw new Error(NOT_PROTECTED_ERROR);
  }

  try {
    if (securityState === "restriction-only") {
      const pdfDoc = await PDFDocument.load(bytes, { password: "" });
      return await pdfDoc.save();
    }

    if (password.length === 0) {
      throw new Error(KNOWN_PASSWORD_REQUIRED_ERROR);
    }

    const pdfDoc = await PDFDocument.load(bytes, { password });
    return await pdfDoc.save();
  } catch (error) {
    if (
      isIncorrectPasswordError(error) ||
      (password.length > 0 && isEncryptedPdfLoadError(error))
    ) {
      throw new Error(INCORRECT_PASSWORD_ERROR);
    }

    throw error;
  }
}

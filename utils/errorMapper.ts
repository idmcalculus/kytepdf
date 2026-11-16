/**
 * KytePDF Error Mapper
 * Translates technical error messages into human-friendly instructions.
 */

export const DEFAULT_ERROR_MESSAGE = "An unexpected error occurred.";

/**
 * An error whose message was written for the user. `mapError` shows its
 * message as is, so code deep in the stack can explain a failure in plain
 * words without the message being replaced by a generic one.
 */
export class UserFacingError extends Error {
  override name = "UserFacingError";
}

interface ErrorEntry {
  pattern: RegExp;
  userMessage: string;
}

const ERROR_MAP: ErrorEntry[] = [
  {
    pattern: /not password-protected/i,
    userMessage: "This PDF does not currently have a password.",
  },
  {
    pattern: /already password-protected/i,
    userMessage:
      "This PDF is already protected. Remove the current password before applying a new one.",
  },
  {
    pattern: /password incorrect|incorrect password/i,
    userMessage: "The password is incorrect. Enter the current PDF password and try again.",
  },
  {
    pattern: /requires its current password|needs password|password required/i,
    userMessage: "This PDF requires its current password before Kyte can unlock it.",
  },
  {
    pattern: /password|protected|encrypted/i,
    userMessage: "This PDF is password-protected. Please remove the password and try again.",
  },
  {
    pattern: /not a valid PDF|invalid PDF|corrupt/i,
    userMessage: "The file appears to be corrupted or is not a valid PDF document.",
  },
  {
    // Browsers raise these when a selected file is moved, renamed or changed
    // on disk before the app has finished reading it.
    pattern: /NotReadableError|NotFoundError: A requested file/i,
    userMessage:
      "Kyte could not read this file. It may have been moved, renamed or changed since you selected it. Select it again and retry.",
  },
  {
    pattern: /out of memory|OOM|buffer/i,
    userMessage: "The file is too large or complex for your browser's memory. Try a smaller file.",
  },
  {
    pattern: /File System Access API|showSaveFilePicker|createWritable|FileSystemFileHandle/i,
    userMessage:
      "Your browser blocked the save request or doesn't support direct saving. Check your permissions.",
  },
  {
    pattern: /fetch|network|CDN/i,
    userMessage:
      "A network error occurred while loading a component. Please check your connection and refresh.",
  },
  {
    pattern: /AbortError/i,
    userMessage: "The operation was cancelled by the user.",
  },
  {
    pattern: /quota|full|storage/i,
    userMessage: "Your browser's storage is full. Please clear some space and try again.",
  },
];

/**
 * Returns the text the patterns are matched against. The error's name is
 * included when it is more specific than "Error", because browser errors such
 * as `NotReadableError` or `QuotaExceededError` carry their meaning in the
 * name rather than the message.
 */
function getErrorText(error: unknown): string {
  if (error !== null && typeof error === "object" && "message" in error) {
    const { name, message } = error as { name?: unknown; message?: unknown };
    const text = typeof message === "string" ? message : String(message);
    return typeof name === "string" && name !== "" && name !== "Error" ? `${name}: ${text}` : text;
  }
  return String(error);
}

/**
 * Translates a technical error into a user-friendly message.
 * @param error A caught error, or the message of one.
 * @param fallback Shown when the error matches no known pattern. Pass an
 *   empty string to fall back to the error's own text.
 * @returns
 */
export function mapError(error: unknown, fallback: string = DEFAULT_ERROR_MESSAGE): string {
  if (error instanceof UserFacingError) {
    return error.message;
  }

  const text = getErrorText(error);

  for (const entry of ERROR_MAP) {
    if (entry.pattern.test(text)) {
      return entry.userMessage;
    }
  }

  return fallback || text;
}

/**
 * Builds a message that says what failed and, where the cause is known, why.
 * @example describeFailure("Compression failed.", error)
 * // "Compression failed. The file is too large or complex for your browser's memory. ..."
 */
export function describeFailure(action: string, error: unknown): string {
  return `${action} ${mapError(error, "Please try again.")}`;
}

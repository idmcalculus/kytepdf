/**
 * KytePDF Error Mapper
 * Translates technical error messages into human-friendly instructions.
 */

interface ErrorEntry {
  pattern: RegExp;
  userMessage: string;
}

const ERROR_MAP: ErrorEntry[] = [
  {
    pattern: /password|protected|encrypted/i,
    userMessage: "This PDF is password-protected. Please remove the password and try again.",
  },
  {
    pattern: /not a valid PDF|invalid PDF|corrupt/i,
    userMessage: "The file appears to be corrupted or is not a valid PDF document.",
  },
  {
    pattern: /out of memory|OOM|buffer/i,
    userMessage: "The file is too large or complex for your browser's memory. Try a smaller file.",
  },
  {
    pattern: /File System Access API|showSaveFilePicker/i,
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
 * Translates a technical error into a user-friendly message.
 * @param error
 * @param fallback
 * @returns
 */
export function mapError(
  error: Error | string,
  fallback: string = "An unexpected error occurred.",
): string {
  const message = error instanceof Error ? error.message : String(error);

  for (const entry of ERROR_MAP) {
    if (entry.pattern.test(message)) {
      return entry.userMessage;
    }
  }

  return fallback || message;
}

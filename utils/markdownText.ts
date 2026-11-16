/**
 * Turns Markdown into plain text for the "PDF to Text" plain-text output.
 *
 * Only real Markdown syntax is removed. Text that merely contains Markdown
 * characters ("f(x)", "snake_case", "2 * 3", "[draft]") is left alone, links
 * and images keep their visible text, and code is kept exactly as written.
 */

/** `<!-- Page N -->` markers that pdf-inspector inserts between pages. */
const PAGE_MARKER_RE = /<!--\s*Page\s*\d+\s*-->/gi;

/** Characters Markdown lets you escape with a backslash. */
const ESCAPABLE = "\\`*_{}[]()#+-.!|>~<";
const ESCAPABLE_RE = /\\([\\`*_{}[\]()#+\-.!|>~<])/g;

// While syntax is stripped, escaped characters and code are swapped for
// Unicode noncharacters (U+FDD0 to U+FDEF). Those are reserved for internal
// use, so any already in the input are dropped first and every placeholder
// that remains is one this function made.
const NONCHARACTER_RE = /[\ufdd0-\ufdef]/g;
const ESCAPE_BASE = 0xfdd0;
const hideEscaped = (char: string) => String.fromCharCode(ESCAPE_BASE + ESCAPABLE.indexOf(char));
const ESCAPED_PLACEHOLDER_RE = /[\ufdd0-\ufde2]/g;
const restoreEscaped = (char: string) => ESCAPABLE[char.charCodeAt(0) - ESCAPE_BASE];
const LITERAL_PLACEHOLDER_RE = /\ufdee(\d+)\ufdef/g;

/** A fenced code block, closed by the same fence or by the end of the text. */
const CODE_FENCE_RE =
  /^[ \t]*(`{3,}|~{3,})[^\n]*(?:\n|$)([\s\S]*?)(?:^[ \t]*\1[ \t]*(?:\n|$)|(?![\s\S]))/gm;

/** A GFM table delimiter row, such as `|---|:---:|` or `--- | ---`. */
const TABLE_DELIMITER_RE =
  /^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+(?:[ \t]*:?-{3,}:?[ \t]*)?[ \t]*(?:\n|$)/gm;

export function markdownToPlainText(markdown: string): string {
  const literals: string[] = [];
  const setAside = (text: string) => `\ufdee${literals.push(text) - 1}\ufdef`;

  return (
    markdown
      .replace(/\r\n?/g, "\n")
      .replace(NONCHARACTER_RE, "")
      // Code is literal: no rule below may touch it.
      .replace(CODE_FENCE_RE, (_m, _fence: string, body: string) => {
        return `${setAside(body.replace(/\n$/, ""))}\n`;
      })
      .replace(/`([^`\n]+)`/g, (_m, code: string) => setAside(code))
      .replace(ESCAPABLE_RE, (_m, char: string) => hideEscaped(char))
      .replace(PAGE_MARKER_RE, "\n")
      // Horizontal rules (before list markers, since "- - -" is a rule).
      .replace(/^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*(?:\n|$)/gm, "")
      .replace(TABLE_DELIMITER_RE, "")
      // Headings, blockquotes and list markers at the start of a line. Table
      // rows still start with "|" here, so their cells are never mistaken
      // for these markers.
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
      .replace(/^(?:[ \t]{0,3}>[ \t]?)+/gm, "")
      .replace(/^([ \t]*)[-*+][ \t]+/gm, "$1")
      .replace(/^([ \t]*)(\d+)[.)][ \t]+/gm, "$1$2. ")
      // Table rows: one line per row, cells separated by tabs.
      .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_m, cells: string) =>
        cells
          .split("|")
          .map((cell) => cell.trim())
          .join("\t"),
      )
      // Images and links keep their text.
      .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
      .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, "$1")
      // Emphasis only where it opens and closes at a word edge, so
      // "snake_case", "2*3*4" and "2 * 3" are not touched.
      .replace(/(?<![\w*])\*\*(?=\S)([^\n]*?\S)\*\*(?![\w*])/g, "$1")
      .replace(/(?<![\w_])__(?=\S)([^\n]*?\S)__(?![\w_])/g, "$1")
      .replace(/(?<![\w*])\*([^\s*](?:[^\n*]*?[^\s*])?)\*(?![\w*])/g, "$1")
      .replace(/(?<![\w_])_([^\s_](?:[^\n_]*?[^\s_])?)_(?![\w_])/g, "$1")
      .replace(/(?<![\w~])~~(?=\S)([^\n]*?\S)~~(?![\w~])/g, "$1")
      .replace(ESCAPED_PLACEHOLDER_RE, restoreEscaped)
      .replace(LITERAL_PLACEHOLDER_RE, (_m, index: string) => literals[Number(index)])
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

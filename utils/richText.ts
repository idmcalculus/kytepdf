/**
 * Allowlist sanitizer for editor rich-text (`richContent`).
 *
 * Text-block annotations round-trip through `innerHTML`: the editor reads a
 * contentEditable's markup, persists it to IndexedDB, and later re-renders it
 * with `innerHTML`. Anything a user pastes into that field is therefore stored
 * and replayed as live markup. Browsers strip `<script>` on paste, but
 * `<img onerror>`, `<svg onload>`, `<iframe>`, and `javascript:` hrefs survive
 * — enough for stored script execution in the app's own origin.
 *
 * Rather than blocklisting, rebuild the fragment from an allowlist of the
 * formatting the editor actually produces (bold/italic/underline/strike/line
 * breaks plus a narrow set of inline styles). Anything else keeps its text and
 * loses its markup.
 */

/**
 * Tags the editor emits and can round-trip safely. Lists, subscript and
 * superscript come from the formatting toolbar's buttons, so they must
 * survive sanitizing.
 */
const ALLOWED_TAGS = new Set([
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "S",
  "STRIKE",
  "BR",
  "DIV",
  "P",
  "SPAN",
  "UL",
  "OL",
  "LI",
  "SUB",
  "SUP",
]);

/**
 * Elements whose content is not text the user wrote (code, styles, embedded
 * documents, form values). They are dropped together with what they hold.
 */
const DROPPED_WITH_CONTENT = new Set([
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
  "NOSCRIPT",
  "TITLE",
  "HEAD",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "TEXTAREA",
  "SELECT",
]);

/**
 * Block elements outside the allowlist (pasted headings, quotes, tables...).
 * They become a bare <div> so their lines stay apart instead of running into
 * the text around them.
 */
const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "CAPTION",
  "DD",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "MAIN",
  "NAV",
  "PRE",
  "SECTION",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
]);

/**
 * CSS properties the formatting toolbar sets. Left out: font-family (a box
 * has one font, style.font, and the PDF export cannot draw others) and
 * text-align (a box has one alignment, style.textAlign, which the export uses).
 */
const ALLOWED_STYLE_PROPS = new Set([
  "color",
  "font-size",
  "font-weight",
  "font-style",
  "text-decoration",
  "line-height",
  "background-color",
]);

/**
 * Rejects CSS values that can fetch or execute: url(...), expression(...),
 * and any embedded scheme. Plain colors, lengths, and font stacks pass.
 */
function isSafeStyleValue(value: string): boolean {
  const v = value.toLowerCase();
  return !/url\s*\(|expression\s*\(|javascript:|data:|@import|<|\\/.test(v);
}

function sanitizeStyle(style: string): string {
  const out: string[] = [];
  for (const decl of style.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!prop || !value) continue;
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue;
    if (!isSafeStyleValue(value)) continue;
    out.push(`${prop}: ${value}`);
  }
  return out.join("; ");
}

function sanitizeNode(node: Node, target: Node, doc: Document): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(doc.createTextNode(child.textContent ?? ""));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) {
      // Comments, CDATA, processing instructions: drop entirely.
      continue;
    }

    const el = child as Element;
    const tag = el.tagName.toUpperCase();
    if (DROPPED_WITH_CONTENT.has(tag)) continue;
    if (BLOCK_TAGS.has(tag)) {
      const block = doc.createElement("div");
      sanitizeNode(el, block, doc);
      target.appendChild(block);
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      // Keep the readable text, discard the element (and, crucially, any
      // handlers or resource-loading attributes it carried).
      sanitizeNode(el, target, doc);
      continue;
    }

    const clean = doc.createElement(tag.toLowerCase());
    // `style` is the only attribute carried over; every other attribute
    // (including all on* handlers, src, href, srcset) is dropped.
    const style = el.getAttribute("style");
    if (style) {
      const safeStyle = sanitizeStyle(style);
      if (safeStyle) clean.setAttribute("style", safeStyle);
    }
    sanitizeNode(el, clean, doc);
    target.appendChild(clean);
  }
}

/**
 * Returns `html` reduced to the allowlisted formatting subset.
 * Safe to use both when capturing from a contentEditable and when rendering
 * stored content back into the DOM.
 */
export function sanitizeRichText(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const container = doc.createElement("div");
  sanitizeNode(doc.body, container, doc);
  return container.innerHTML;
}

/**
 * Rewrite the inline font sizes in sanitized rich text from editor pixels to
 * PDF units, for export: the toolbar writes sizes in editor pixels, and the
 * PDF export reads a size as points. `pixelsPerUnit` is the page's editor
 * pixels per PDF unit. Points become CSS pixels first (1pt = 4/3px). Sizes in
 * other units (em, %, keywords) are dropped, so the text takes the box's size.
 */
export function toPdfFontSizes(html: string, pixelsPerUnit: number): string {
  if (!html?.includes("font-size")) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>("[style]"))) {
    const size = el.style.fontSize;
    if (!size) continue;
    const match = /^(\d*\.?\d+)(px|pt)$/i.exec(size.trim());
    if (!match) {
      el.style.removeProperty("font-size");
    } else {
      const pixels = parseFloat(match[1]) * (match[2].toLowerCase() === "pt" ? 4 / 3 : 1);
      el.style.fontSize = `${Math.round((pixels / pixelsPerUnit) * 1000) / 1000}px`;
    }
    if (!el.getAttribute("style")) el.removeAttribute("style");
  }
  return doc.body.innerHTML;
}

/** A font the editor offers: one of the three families the PDF export can draw. */
export interface EditorFont {
  /** Stored in an annotation's style.font. */
  value: "Helvetica" | "Times-Roman" | "Courier";
  label: string;
  /** What the editor shows it with, so the page looks like the saved PDF. */
  css: string;
}

export const EDITOR_FONTS: readonly EditorFont[] = [
  { value: "Helvetica", label: "Sans serif", css: "Helvetica, Arial, sans-serif" },
  { value: "Times-Roman", label: "Serif", css: '"Times New Roman", Times, serif' },
  { value: "Courier", label: "Monospace", css: '"Courier New", Courier, monospace' },
];

/**
 * The editor font closest to any font name: monospaced names become
 * Monospace, serif names (Times, Georgia, Garamond...) Serif, and everything
 * else, including no name, Sans serif. Used for stored fonts from older
 * sessions and for fonts read from the PDF.
 */
export function nearestEditorFont(fontName: string | undefined): EditorFont {
  const name = (fontName ?? "").toLowerCase();
  if (/courier|mono|console/.test(name)) return EDITOR_FONTS[2];
  if (/times|georgia|palatino|garamond|bookman|cambria|(?<!sans-)serif/.test(name)) {
    return EDITOR_FONTS[1];
  }
  return EDITOR_FONTS[0];
}

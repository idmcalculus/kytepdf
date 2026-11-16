import { describe, expect, it } from "vitest";
import {
  EDITOR_FONTS,
  nearestEditorFont,
  sanitizeRichText,
  toPdfFontSizes,
} from "../../utils/richText";

describe("sanitizeRichText", () => {
  it("preserves the formatting the editor actually emits", () => {
    const html = "<b>bold</b> and <i>italic</i><br><u>under</u>";
    expect(sanitizeRichText(html)).toBe("<b>bold</b> and <i>italic</i><br><u>under</u>");
  });

  it("strips event-handler attributes but keeps the element's text", () => {
    const out = sanitizeRichText('<b onclick="alert(1)">hi</b>');
    expect(out).toBe("<b>hi</b>");
    expect(out).not.toContain("onclick");
  });

  it("removes img/onerror payloads entirely", () => {
    const out = sanitizeRichText('<img src=x onerror="window.__xss=1">');
    expect(out).not.toContain("img");
    expect(out).not.toContain("onerror");
  });

  it("removes svg/onload payloads", () => {
    const out = sanitizeRichText('<svg onload="window.__xss=1"></svg>');
    expect(out).not.toContain("svg");
    expect(out).not.toContain("onload");
  });

  it("drops script and iframe elements while keeping surrounding text", () => {
    const out = sanitizeRichText(
      'before<script>window.__xss=1</script><iframe src="x"></iframe>after',
    );
    expect(out).toBe("beforeafter");
  });

  it.each([
    ["<style>p.MsoNormal{margin:0}</style><p>Body</p>", "<p>Body</p>"],
    ["<template><b>hidden</b></template>shown", "shown"],
    ["<noscript>enable JS</noscript>text", "text"],
    ["<title>Doc</title>text", "text"],
    ["<object>fallback</object><embed>text", "text"],
    ["<textarea>typed</textarea><select><option>pick</option></select>text", "text"],
  ])("drops code and form values with their contents: %s", (html, expected) => {
    expect(sanitizeRichText(html)).toBe(expected);
  });

  it.each([
    ["<blockquote>Line one</blockquote>Line two", "<div>Line one</div>Line two"],
    ["<h2>Report</h2><h3>Summary</h3>", "<div>Report</div><div>Summary</div>"],
    [
      "<table><tr><td>Revenue</td></tr><tr><td>Costs</td></tr></table>",
      "<div><div><div><div>Revenue</div></div><div><div>Costs</div></div></div></div>",
    ],
    ["<pre>a\nb</pre>tail", "<div>a\nb</div>tail"],
    ['<section class="x" onclick="y()"><p>Kept</p></section>', "<div><p>Kept</p></div>"],
  ])("keeps the lines of other block elements apart as bare divs: %s", (html, expected) => {
    expect(sanitizeRichText(html)).toBe(expected);
  });

  it("drops paragraph alignment, which belongs to the whole box", () => {
    expect(sanitizeRichText('<div style="text-align: right; color: red">x</div>')).toBe(
      '<div style="color: red">x</div>',
    );
  });

  it("unwraps disallowed elements but retains their readable text", () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">click me</a>')).toBe("click me");
  });

  it("keeps allowlisted style properties", () => {
    const out = sanitizeRichText('<span style="color: red; font-size: 14px">x</span>');
    expect(out).toContain("color: red");
    expect(out).toContain("font-size: 14px");
  });

  it("drops style properties that can fetch or execute", () => {
    const out = sanitizeRichText(
      '<span style="color: red; background-image: url(https://evil.test/x.png)">x</span>',
    );
    expect(out).toContain("color: red");
    expect(out).not.toContain("url(");
    expect(out).not.toContain("background-image");
  });

  it("drops url()/expression() even on an allowlisted property", () => {
    const out = sanitizeRichText(
      '<span style="background-color: url(javascript:alert(1))">x</span>',
    );
    expect(out).not.toContain("url(");
    expect(out).not.toContain("javascript:");
  });

  it("strips HTML comments", () => {
    expect(sanitizeRichText("a<!-- sneaky -->b")).toBe("ab");
  });

  it("is idempotent, so re-sanitizing stored content does not degrade it", () => {
    const once = sanitizeRichText('<b style="color: blue">t</b><i>x</i>');
    expect(sanitizeRichText(once)).toBe(once);
  });

  it("handles empty and nullish-ish input", () => {
    expect(sanitizeRichText("")).toBe("");
  });

  it("keeps bullet and numbered lists so the PDF export can draw their markers", () => {
    const html = "<ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>";
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("strips attributes from list markup too", () => {
    expect(sanitizeRichText('<ol start="3" onclick="x()"><li class="a">item</li></ol>')).toBe(
      "<ol><li>item</li></ol>",
    );
  });

  it("drops malformed and empty style declarations", () => {
    const out = sanitizeRichText('<span style="color; : red; font-size: ; color: blue">x</span>');
    expect(out).toBe('<span style="color: blue">x</span>');
  });

  it("omits the style attribute when nothing in it is allowed", () => {
    expect(sanitizeRichText('<b style="position: fixed; top: 0">x</b>')).toBe("<b>x</b>");
  });

  it.each([
    "expression(alert(1))",
    "@import 'x'",
    "#000 \\75 rl(x)",
    "red</style><script>",
    "data:text/html,1",
  ])("rejects the unsafe style value %s", (value) => {
    const out = sanitizeRichText(`<span style="color: ${value}">x</span>`);
    expect(out).toBe("<span>x</span>");
  });

  it("keeps subscript and superscript from the toolbar", () => {
    const html = "H<sub>2</sub>O and x<sup>2</sup>";
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("drops pasted font families, which the PDF export cannot draw", () => {
    expect(sanitizeRichText('<span style="font-family: Impact; color: red">x</span>')).toBe(
      '<span style="color: red">x</span>',
    );
  });
});

describe("editor fonts", () => {
  it("offers only the three families the PDF export can draw, with real CSS stacks", () => {
    expect(EDITOR_FONTS.map(({ value, label }) => [value, label])).toEqual([
      ["Helvetica", "Sans serif"],
      ["Times-Roman", "Serif"],
      ["Courier", "Monospace"],
    ]);
    expect(EDITOR_FONTS.map((font) => font.css)).toEqual([
      "Helvetica, Arial, sans-serif",
      '"Times New Roman", Times, serif',
      '"Courier New", Courier, monospace',
    ]);
  });

  it.each([
    [undefined, "Helvetica"],
    ["", "Helvetica"],
    ["Helvetica", "Helvetica"],
    ["Verdana", "Helvetica"],
    ["sans-serif", "Helvetica"],
    ["g_d0_f1 sans-serif", "Helvetica"],
    ["Times-Roman", "Times-Roman"],
    ["TimesNewRomanPS-BoldMT", "Times-Roman"],
    ["Georgia", "Times-Roman"],
    ["Palatino", "Times-Roman"],
    ["Garamond", "Times-Roman"],
    ["Bookman", "Times-Roman"],
    ["Cambria", "Times-Roman"],
    ["g_d0_f2 serif", "Times-Roman"],
    ["Courier", "Courier"],
    ["Lucida Console", "Courier"],
    ["DejaVuSansMono", "Courier"],
    ["g_d0_f3 monospace", "Courier"],
  ])("maps the font name %s to %s", (name, expected) => {
    expect(nearestEditorFont(name).value).toBe(expected);
  });
});

describe("toPdfFontSizes", () => {
  it("turns editor pixels into PDF units at the page's scale", () => {
    expect(toPdfFontSizes('Hello <span style="font-size: 24px">world</span>', 2)).toBe(
      'Hello <span style="font-size: 12px;">world</span>',
    );
  });

  it("reads points as CSS pixels first (1pt = 4/3px)", () => {
    expect(toPdfFontSizes('<b style="font-size: 18pt">x</b>', 1.5)).toBe(
      '<b style="font-size: 16px;">x</b>',
    );
  });

  it("drops sizes in other units, so the text takes the box's size", () => {
    expect(toPdfFontSizes('<span style="font-size: 2em">a</span>', 2)).toBe("<span>a</span>");
    expect(toPdfFontSizes('<span style="font-size: 2em; color: red">a</span>', 2)).toBe(
      '<span style="color: red;">a</span>',
    );
  });

  it("leaves markup without sizes untouched", () => {
    const html = '<b style="color: red">x</b>';
    expect(toPdfFontSizes(html, 3)).toBe(html);
    expect(toPdfFontSizes('<i style="color: red">a</i>font-size', 2)).toBe(
      '<i style="color: red">a</i>font-size',
    );
    expect(toPdfFontSizes("", 2)).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { markdownToPlainText } from "../../utils/markdownText";

describe("markdownToPlainText", () => {
  it("drops headings, emphasis and quote markers but keeps the words", () => {
    const md = [
      "# Title",
      "### Sub-title",
      "",
      "**Bold**, __strong__, *em*, _it_ and ~~gone~~ words.",
      "",
      "> quoted",
      "> > nested",
    ].join("\n");

    expect(markdownToPlainText(md)).toBe(
      "Title\nSub-title\n\nBold, strong, em, it and gone words.\n\nquoted\nnested",
    );
  });

  it("keeps the text of links and images", () => {
    expect(
      markdownToPlainText("See [the report](https://example.com/r?a=1) and ![chart](c.png)."),
    ).toBe("See the report and chart.");
  });

  it.each([
    ["function calls", "f(x) = g(x) + 1"],
    ["identifiers", "set snake_case_name and __dunder_like or x_1"],
    ["arithmetic", "2 * 3 * 4 = 24, and 2*3*4 too"],
    ["brackets", "[draft] (v2) notes"],
    ["hashes inside a line", "Issue #42 and C# code"],
    ["a dash inside a line", "pre-flight - check"],
  ])("leaves %s alone", (_label, text) => {
    expect(markdownToPlainText(text)).toBe(text);
  });

  it("removes list markers and keeps ordered numbering", () => {
    const md = ["- one", "* two", "+ three", "  - nested", "1.  first", "2) second"].join("\n");

    expect(markdownToPlainText(md)).toBe("one\ntwo\nthree\n  nested\n1. first\n2. second");
  });

  it("turns tables into tab-separated rows", () => {
    // The shape pdf-inspector produces for a table.
    const md = [
      "|SKU|Description|Total|",
      "|---|---|---|",
      "|A-100|Widget, standard|$45.00|",
      "| B-1 | Bracket | $2.25 |",
    ].join("\n");

    expect(markdownToPlainText(md)).toBe(
      "SKU\tDescription\tTotal\nA-100\tWidget, standard\t$45.00\nB-1\tBracket\t$2.25",
    );
  });

  it("removes page markers, rules and code fences", () => {
    const md = [
      "<!-- Page 1 -->",
      "",
      "Intro",
      "",
      "---",
      "",
      "```ts",
      "const total = a * b;",
      "```",
      "Use `npm test` to run.",
      "",
      "<!--Page 2-->",
      "",
      "",
      "",
      "End",
    ].join("\n");

    expect(markdownToPlainText(md)).toBe(
      "Intro\n\nconst total = a * b;\nUse npm test to run.\n\nEnd",
    );
  });

  it("keeps escaped characters literally", () => {
    expect(markdownToPlainText("\\*not em\\* and \\_x\\_ and 5 \\# 3")).toBe(
      "*not em* and _x_ and 5 # 3",
    );
  });

  it("normalises line endings and trims the result", () => {
    expect(markdownToPlainText("\r\n# A  \r\nB\r\n\r\n\r\n\r\nC  \r\n")).toBe("A\nB\n\nC");
  });

  it("returns an empty string for empty input", () => {
    expect(markdownToPlainText("")).toBe("");
  });
});

describe("markdownToPlainText keeps content that only looks like syntax", () => {
  it("keeps table cells that start like a list item, heading or number", () => {
    const md = [
      "|Item|Low|High|",
      "|---|---|---|",
      "|-|-|300|",
      "|# units|5|6|",
      "|1. tier|2|3|",
    ].join("\n");

    expect(markdownToPlainText(md)).toBe(
      "Item\tLow\tHigh\n-\t-\t300\n# units\t5\t6\n1. tier\t2\t3",
    );
  });

  it("keeps fenced code exactly as written", () => {
    const md = [
      "Run:",
      "```sh",
      "# install deps",
      "- not a list",
      "__init__ and *args and \\* and [x](y)",
      "```",
      "Done.",
    ].join("\n");

    expect(markdownToPlainText(md)).toBe(
      "Run:\n# install deps\n- not a list\n__init__ and *args and \\* and [x](y)\nDone.",
    );
  });

  it("keeps an unclosed code fence's content to the end", () => {
    expect(markdownToPlainText("Intro\n~~~\n# still code\n**raw**")).toBe(
      "Intro\n# still code\n**raw**",
    );
  });

  it("keeps inline code literally", () => {
    expect(markdownToPlainText("Call `__init__(*args)` then `a\\_b`.")).toBe(
      "Call __init__(*args) then a\\_b.",
    );
  });

  it("leaves private-use characters such as icon-font glyphs untouched", () => {
    const icons = [0xe000, 0xe00a, 0xe02a, 0xf8ff].map((cp) => String.fromCharCode(cp));
    const text = `Icon ${icons[0]} a${icons[1]}b x${icons[2]}y ${icons[3]}`;

    expect(markdownToPlainText(text)).toBe(text);
  });

  it("drops Unicode noncharacters from the input instead of misreading them", () => {
    const nonchars = [0xfdd0, 0xfde2, 0xfdee, 0xfdef].map((cp) => String.fromCharCode(cp));

    expect(markdownToPlainText(`a${nonchars.join("")}b *c*`)).toBe("ab c");
  });
});

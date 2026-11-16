import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib-with-encrypt";

const OUT_DIR = join(process.cwd(), "tmp", "pdfs");
mkdirSync(OUT_DIR, { recursive: true });

function write(name: string, bytes: Uint8Array) {
  const out = join(OUT_DIR, name);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  console.log(`wrote ${name} (${bytes.length} bytes)`);
}

async function nativeTextReport(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sizes = (s: string, f: typeof font, max: number) => f.widthOfTextAtSize(s, max);

  const page = doc.addPage([595, 842]);
  let y = 800;
  page.drawText("Quarterly Operations Report", {
    x: 56,
    y,
    size: 20,
    font: bold,
    color: rgb(0, 0, 0),
  });
  y -= 28;
  page.drawText("Acme Corporation — FY2026 Q1", {
    x: 56,
    y,
    size: 11,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });
  y -= 36;
  const body = [
    "This document summarizes operational results for the first fiscal quarter.",
    "Revenue grew twelve percent year-over-year, driven by enterprise renewals.",
    "Customer retention reached ninety-four percent, a new high-water mark.",
    "Operating margin expanded by one hundred and fifty basis points.",
    "The engineering organization shipped forty-two releases during the quarter.",
  ];
  for (const line of body) {
    page.drawText(line, { x: 56, y, size: 11, font });
    y -= 18;
  }
  y -= 16;
  page.drawText("Highlights", { x: 56, y, size: 14, font: bold });
  y -= 20;
  const bullets = [
    "- Renewals up 12% YoY across the enterprise segment.",
    "- Net promoter score improved from 41 to 47.",
    "- Mean time to recovery fell to nineteen minutes.",
  ];
  for (const b of bullets) {
    page.drawText(b, { x: 56, y, size: 11, font });
    y -= 16;
  }
  void sizes;
  return doc.save();
}

async function multiColumnPage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);
  const colWidth = 240;
  const leftX = 56;
  const rightX = 56 + colWidth + 24;

  for (const col of [
    {
      x: leftX,
      heading: "Left Column",
      body: [
        "The left column discusses the primary research findings in depth.",
        "Participants reported strong satisfaction with the onboarding flow.",
        "Median time to first value was measured at eleven minutes.",
        "Three themes emerged: clarity, speed, and reliability.",
      ],
    },
    {
      x: rightX,
      heading: "Right Column",
      body: [
        "The right column contains supplementary demographic notes.",
        "Survey respondents skewed toward mid-market accounts.",
        "Eighty-one percent represented teams of fewer than fifty.",
        "Geographic distribution spanned four continents.",
      ],
    },
  ]) {
    let y = 780;
    page.drawText(col.heading, { x: col.x, y, size: 13, font: bold });
    y -= 18;
    for (const line of col.body) {
      const words = line.split(" ");
      const lines: string[] = [];
      let cur = "";
      for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (font.widthOfTextAtSize(test, 10) > colWidth - 8) {
          if (cur) lines.push(cur);
          cur = w;
        } else {
          cur = test;
        }
      }
      if (cur) lines.push(cur);
      for (const l of lines) {
        page.drawText(l, { x: col.x, y, size: 10, font });
        y -= 14;
      }
      y -= 4;
    }
  }
  return doc.save();
}

async function tablePage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);
  let y = 780;
  page.drawText("Invoice 1042", { x: 56, y, size: 16, font: bold });
  y -= 24;

  const rows: string[][] = [
    ["SKU", "Description", "Qty", "Unit Price", "Total"],
    ["A-100", "Widget, standard", "10", "$4.50", "$45.00"],
    ["A-201", "Widget, premium", "4", "$12.00", "$48.00"],
    ["B-014", "Bracket, mounting", "8", "$2.25", "$18.00"],
    ["C-770", "Cable, USB-C 2m", "12", "$3.10", "$37.20"],
  ];
  const colXs = [56, 120, 290, 350, 430];
  const colW = [60, 165, 55, 70, 75];
  for (let r = 0; r < rows.length; r++) {
    const isHeader = r === 0;
    const f = isHeader ? bold : font;
    for (let c = 0; c < rows[r].length; c++) {
      page.drawText(rows[r][c], { x: colXs[c], y, size: 10, font: f });
    }
    y -= 16;
    if (isHeader) {
      page.drawLine({
        start: { x: 56, y: y + 10 },
        end: { x: 505, y: y + 10 },
        thickness: 1,
        color: rgb(0, 0, 0),
      });
    }
    void colW;
  }
  page.drawLine({
    start: { x: 430, y: y + 24 },
    end: { x: 430, y: y + 24 },
    thickness: 0,
    color: rgb(0, 0, 0),
  });
  page.drawText("Subtotal", { x: 350, y: y + 4, size: 10, font: bold });
  page.drawText("$148.20", { x: 430, y: y + 4, size: 10, font: bold });
  return doc.save();
}

async function scannedLikePage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(0.92, 0.92, 0.88) });
  for (let i = 0; i < 30; i++) {
    page.drawRectangle({
      x: 30 + (i % 5) * 110,
      y: 60 + Math.floor(i / 5) * 120,
      width: 100,
      height: 100,
      color: rgb(0.55 + (i % 3) * 0.1, 0.5, 0.45),
    });
  }
  page.drawRectangle({ x: 40, y: 760, width: 300, height: 30, color: rgb(0.3, 0.3, 0.3) });
  return doc.save();
}

async function encryptedDoc(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText("Confidential Personnel Record", { x: 56, y: 800, size: 18, font });
  page.drawText("This content is password-protected for evaluation.", {
    x: 56,
    y: 770,
    size: 11,
    font,
  });
  // pdf-lib-with-encrypt requires encrypt() before save(); save({userPassword}) is a no-op.
  await doc.encrypt({
    userPassword: "kyte-eval",
    ownerPassword: "kyte-owner",
  });
  return doc.save();
}

async function bigDoc(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 25; p++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Page ${p + 1}`, { x: 56, y: 800, size: 12, font });
    let y = 770;
    for (let i = 0; i < 40; i++) {
      page.drawText(
        `Paragraph ${i + 1}: synthetic content block for stress testing the local engine.`,
        {
          x: 56,
          y,
          size: 10,
          font,
        },
      );
      y -= 14;
    }
  }
  return doc.save();
}

async function main() {
  console.log("Building synthetic PDF corpus into tmp/pdfs/");
  const items: Array<[string, () => Promise<Uint8Array>]> = [
    ["01_native_text.pdf", nativeTextReport],
    ["02_multicolumn.pdf", multiColumnPage],
    ["03_table_invoice.pdf", tablePage],
    ["04_scanned_like.pdf", scannedLikePage],
    ["05_encrypted.pdf", encryptedDoc],
    ["06_multi_column_report.pdf", multiColumnPage],
    ["07_large_25pages.pdf", bigDoc],
  ];
  for (const [name, gen] of items) {
    try {
      write(name, await gen());
    } catch (err) {
      console.error(`failed ${name}:`, err);
    }
  }
  console.log("Corpus build complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { PDFDocument, rgb, StandardFonts } from "./pdfConfig.ts";

export type PdfCreatorTemplate = "report" | "letter" | "invoice" | "cv-harvard" | "cv-modern";
export type PdfCreatorPageSize = "letter" | "a4";
export type PdfCreatorOrientation = "portrait" | "landscape";
export type PdfCreatorCurrency = "USD" | "EUR" | "GBP";

export interface CreatorSection {
  id: string;
  heading: string;
  body: string;
}

export interface CreatorParagraph {
  id: string;
  text: string;
}

export interface CreatorInvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface CreatorCvExperience {
  id: string;
  role: string;
  organization: string;
  location: string;
  startDate: string;
  endDate: string;
  achievements: string;
}

export interface CreatorCvEducation {
  id: string;
  qualification: string;
  institution: string;
  location: string;
  startDate: string;
  endDate: string;
  details: string;
}

export interface CreatorCvExtraSection {
  id: string;
  title: string;
  body: string;
}

export interface CreatorReportDraft {
  title: string;
  subtitle: string;
  author: string;
  summary: string;
  sections: CreatorSection[];
}

export interface CreatorLetterDraft {
  senderName: string;
  senderDetails: string;
  recipientName: string;
  recipientDetails: string;
  subject: string;
  date: string;
  greeting: string;
  closing: string;
  signature: string;
  paragraphs: CreatorParagraph[];
}

export interface CreatorInvoiceDraft {
  businessName: string;
  businessDetails: string;
  clientName: string;
  clientDetails: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  currency: PdfCreatorCurrency;
  paymentDetails: string;
  paymentLink: string;
  notes: string;
  lineItems: CreatorInvoiceItem[];
}

export interface CreatorCvDraft {
  fullName: string;
  professionalTitle: string;
  email: string;
  phone: string;
  location: string;
  website: string;
  linkedin: string;
  profileLabel: string;
  profile: string;
  experienceLabel: string;
  experiences: CreatorCvExperience[];
  educationLabel: string;
  education: CreatorCvEducation[];
  skillsLabel: string;
  skills: string;
  additionalSections: CreatorCvExtraSection[];
}

export interface PdfCreatorDraft {
  fileName: string;
  template: PdfCreatorTemplate;
  pageSize: PdfCreatorPageSize;
  orientation: PdfCreatorOrientation;
  accentColor: string;
  includePageNumbers: boolean;
  logoDataUrl: string | null;
  logoFileName: string | null;
  report: CreatorReportDraft;
  letter: CreatorLetterDraft;
  invoice: CreatorInvoiceDraft;
  cv: CreatorCvDraft;
}

export interface CreatePdfResult {
  bytes: Uint8Array;
  pageCount: number;
  outputName: string;
}

type PdfFont = Awaited<ReturnType<PDFDocument["embedFont"]>>;
type PdfPage = ReturnType<PDFDocument["addPage"]>;

type DrawTextOptions = {
  font: PdfFont;
  size: number;
  color?: ReturnType<typeof rgb>;
  x?: number;
  maxWidth?: number;
  lineHeight?: number;
  paragraphSpacing?: number;
};

type InvoiceTableLayout = {
  x: number;
  width: number;
  cellPaddingX: number;
  headerHeight: number;
  baseRowHeight: number;
  rowGap: number;
  description: { x: number; width: number };
  qty: { x: number; width: number };
  rate: { x: number; width: number };
  amount: { x: number; width: number };
};

const PAGE_SIZES: Record<PdfCreatorPageSize, readonly [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

const DEFAULT_ACCENT = "#06b6d4";

const createId = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};

const today = () => new Date().toISOString().slice(0, 10);

export const getTemplateLabel = (template: PdfCreatorTemplate) => {
  switch (template) {
    case "report":
      return "Project Report";
    case "letter":
      return "Business Letter";
    case "invoice":
      return "Invoice";
    case "cv-harvard":
      return "Harvard CV";
    case "cv-modern":
      return "Modern CV";
  }
};

export const createDefaultReportSection = (
  overrides: Partial<CreatorSection> = {},
): CreatorSection => ({
  id: createId(),
  heading: "Section heading",
  body: "Write the main body for this section here. Kyte will wrap long paragraphs and create extra pages automatically when the content exceeds the current page.",
  ...overrides,
});

export const createDefaultLetterParagraph = (
  overrides: Partial<CreatorParagraph> = {},
): CreatorParagraph => ({
  id: createId(),
  text: "Add a clear paragraph that explains the purpose of the letter and any key details the reader needs to act on.",
  ...overrides,
});

export const createDefaultInvoiceItem = (
  overrides: Partial<CreatorInvoiceItem> = {},
): CreatorInvoiceItem => ({
  id: createId(),
  description: "Service or line item",
  quantity: 1,
  unitPrice: 500,
  ...overrides,
});

export const createDefaultCvExperience = (
  overrides: Partial<CreatorCvExperience> = {},
): CreatorCvExperience => ({
  id: createId(),
  role: "Senior Product Designer",
  organization: "Northstar Studio",
  location: "London, UK",
  startDate: "2022",
  endDate: "Present",
  achievements:
    "Led redesign of the flagship client portal, improving task completion and reducing support tickets.\nPartnered with engineering and research to ship an accessible design system across 3 products.",
  ...overrides,
});

export const createDefaultCvEducation = (
  overrides: Partial<CreatorCvEducation> = {},
): CreatorCvEducation => ({
  id: createId(),
  qualification: "BSc (Hons) Computer Science",
  institution: "University of Bristol",
  location: "Bristol, UK",
  startDate: "2016",
  endDate: "2019",
  details:
    "Graduated with First Class honours. Final project focused on human-centred product systems.",
  ...overrides,
});

export const createDefaultCvExtraSection = (
  overrides: Partial<CreatorCvExtraSection> = {},
): CreatorCvExtraSection => ({
  id: createId(),
  title: "Selected Projects",
  body: "Portfolio redesign: Reframed the case-study narrative and improved recruiter conversion.\nMentoring: Supported junior designers through structured critique and portfolio reviews.",
  ...overrides,
});

export const createDefaultCreatorDraft = (): PdfCreatorDraft => ({
  fileName: "kyte-document",
  template: "report",
  pageSize: "letter",
  orientation: "portrait",
  accentColor: DEFAULT_ACCENT,
  includePageNumbers: true,
  logoDataUrl: null,
  logoFileName: null,
  report: {
    title: "Quarterly Product Review",
    subtitle: "Executive summary and delivery highlights",
    author: "Kyte Team",
    summary:
      "Use this template for polished briefs, proposals, or internal updates. Add sections below and Kyte will paginate the finished document automatically.",
    sections: [
      createDefaultReportSection({
        heading: "Highlights",
        body: "Summarize the most important outcomes first. This section works best for the headline metrics, strategic wins, and key product or business developments from the period.",
      }),
      createDefaultReportSection({
        heading: "Next steps",
        body: "Document the follow-up actions, owners, and deadlines so the PDF is ready to share as a standalone deliverable.",
      }),
    ],
  },
  letter: {
    senderName: "Alex Morgan",
    senderDetails: "84 Harbour Road\nLondon\nEC1A 1AA",
    recipientName: "Taylor Brooks",
    recipientDetails: "Northwind Partners\n18 King Street\nManchester M2 4AW",
    subject: "Project kickoff confirmation",
    date: today(),
    greeting: "Dear Taylor,",
    closing: "Sincerely,",
    signature: "Alex Morgan",
    paragraphs: [
      createDefaultLetterParagraph({
        text: "Thank you for the productive kickoff discussion. This letter confirms the agreed scope, timeline, and decision-making approach for the upcoming engagement.",
      }),
      createDefaultLetterParagraph({
        text: "We will share the first milestone package by the agreed date and continue to use the weekly checkpoint to surface risks, dependencies, and any decisions requiring approval.",
      }),
    ],
  },
  invoice: {
    businessName: "Kyte Studio",
    businessDetails: "12 Market Lane\nLondon\nEC2A 4NE\nbilling@kytepdf.com",
    clientName: "Acme Ventures",
    clientDetails: "Finance Team\n23 Broadway\nNew York, NY 10006",
    invoiceNumber: "INV-2026-001",
    issueDate: today(),
    dueDate: today(),
    currency: "USD",
    paymentDetails: "",
    paymentLink: "",
    notes:
      "Thank you for your business. Please remit payment by the due date and include the invoice number with your transfer.",
    lineItems: [
      createDefaultInvoiceItem({
        description: "Design system audit",
        quantity: 1,
        unitPrice: 1400,
      }),
      createDefaultInvoiceItem({
        description: "Implementation support",
        quantity: 8,
        unitPrice: 165,
      }),
    ],
  },
  cv: {
    fullName: "Jordan Taylor",
    professionalTitle: "Product Designer",
    email: "jordan.taylor@example.com",
    phone: "+44 7700 900123",
    location: "London, UK",
    website: "jordantaylor.design",
    linkedin: "linkedin.com/in/jordantaylor",
    profileLabel: "Professional Profile",
    profile:
      "Product designer with experience across SaaS, platform UX, and design systems. Strong record of translating research and business goals into shipped product improvements.",
    experienceLabel: "Experience",
    experiences: [
      createDefaultCvExperience(),
      createDefaultCvExperience({
        role: "Product Designer",
        organization: "Brightlane",
        location: "Manchester, UK",
        startDate: "2019",
        endDate: "2022",
        achievements:
          "Designed onboarding journeys for a B2B analytics platform, lifting trial-to-paid conversion.\nBuilt reusable UI patterns and documentation that reduced design debt across core workflows.",
      }),
    ],
    educationLabel: "Education",
    education: [createDefaultCvEducation()],
    skillsLabel: "Core Skills",
    skills:
      "Product design\nDesign systems\nInteraction design\nPrototyping\nUser research synthesis\nFigma\nCross-functional leadership",
    additionalSections: [createDefaultCvExtraSection()],
  },
});

export const calculateInvoiceTotal = (items: CreatorInvoiceItem[]) =>
  items.reduce(
    (sum, item) =>
      sum + sanitizeCurrencyNumber(item.quantity) * sanitizeCurrencyNumber(item.unitPrice),
    0,
  );

const sanitizeText = (value: string) => value.replace(/\r\n/g, "\n").trim();

const sanitizeCurrencyNumber = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
};

const normalizeFileName = (value: string) => {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\p{Cc}+/gu, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "");

  return cleaned || "kyte-document";
};

const hexToRgb = (hex: string) => {
  const normalized = /^#[\da-f]{6}$/i.test(hex) ? hex : DEFAULT_ACCENT;
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;
  return rgb(r, g, b);
};

const getPageDimensions = (
  size: PdfCreatorPageSize,
  orientation: PdfCreatorOrientation,
): readonly [number, number] => {
  const [width, height] = PAGE_SIZES[size];
  return orientation === "portrait" ? [width, height] : [height, width];
};

const formatCurrency = (value: number, currency: PdfCreatorCurrency) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);

const splitLongWord = (word: string, font: PdfFont, size: number, maxWidth: number) => {
  const chunks: string[] = [];
  let current = "";

  for (const char of word) {
    const test = current + char;
    if (current && font.widthOfTextAtSize(test, size) > maxWidth) {
      chunks.push(current);
      current = char;
    } else {
      current = test;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
};

const wrapText = (text: string, font: PdfFont, size: number, maxWidth: number) => {
  const paragraphs = sanitizeText(text).split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }

    const words = paragraph.trim().split(/\s+/);
    let currentLine = "";

    for (const word of words) {
      const segments =
        font.widthOfTextAtSize(word, size) > maxWidth
          ? splitLongWord(word, font, size, maxWidth)
          : [word];

      for (const segment of segments) {
        const candidate = currentLine ? `${currentLine} ${segment}` : segment;
        if (currentLine && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          lines.push(currentLine);
          currentLine = segment;
        } else {
          currentLine = candidate;
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
};

const dataUrlToBytes = (dataUrl: string) => {
  const [meta, data] = dataUrl.split(",", 2);
  if (!meta || !data) {
    throw new Error("Invalid image data");
  }

  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { meta, bytes };
};

const base64ToUint8Array = (value: string) => {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const parseMultiline = (text: string) =>
  sanitizeText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

class DocumentComposer {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly marginX = 56;
  readonly marginTop = 72;
  readonly marginBottom = 58;
  readonly contentWidth: number;
  readonly accentColor: ReturnType<typeof rgb>;

  private page: PdfPage;
  private pages: PdfPage[] = [];
  private cursorY: number;

  constructor(
    private pdfDoc: PDFDocument,
    private fonts: { regular: PdfFont; bold: PdfFont; mono: PdfFont },
    pageSize: readonly [number, number],
    accentHex: string,
  ) {
    [this.pageWidth, this.pageHeight] = pageSize;
    this.contentWidth = this.pageWidth - this.marginX * 2;
    this.accentColor = hexToRgb(accentHex);
    this.page = this.pdfDoc.addPage([this.pageWidth, this.pageHeight]);
    this.pages.push(this.page);
    this.cursorY = this.pageHeight - this.marginTop;
  }

  get currentPage() {
    return this.page;
  }

  get currentY() {
    return this.cursorY;
  }

  get pageCount() {
    return this.pages.length;
  }

  get allPages() {
    return this.pages;
  }

  setCursor(y: number) {
    this.cursorY = y;
  }

  moveCursor(delta: number) {
    this.cursorY -= delta;
  }

  addPage() {
    this.page = this.pdfDoc.addPage([this.pageWidth, this.pageHeight]);
    this.pages.push(this.page);
    this.cursorY = this.pageHeight - this.marginTop;
    return this.page;
  }

  ensureSpace(height: number) {
    if (this.cursorY - height < this.marginBottom) {
      this.addPage();
      return true;
    }
    return false;
  }

  drawDivider(spacingBefore = 18, spacingAfter = 18) {
    this.ensureSpace(spacingBefore + spacingAfter + 2);
    this.cursorY -= spacingBefore;
    this.page.drawLine({
      start: { x: this.marginX, y: this.cursorY },
      end: { x: this.pageWidth - this.marginX, y: this.cursorY },
      thickness: 1,
      color: rgb(0.84, 0.87, 0.91),
      opacity: 1,
    });
    this.cursorY -= spacingAfter;
  }

  drawLabelValue(label: string, value: string, valueSize = 11) {
    const labelFont = this.fonts.bold;
    const valueFont = this.fonts.regular;
    const size = valueSize;
    const labelWidth = labelFont.widthOfTextAtSize(label, size);
    const maxWidth = this.contentWidth - labelWidth - 12;

    this.ensureSpace(size + 10);
    this.page.drawText(label, {
      x: this.marginX,
      y: this.cursorY,
      size,
      font: labelFont,
      color: rgb(0.11, 0.17, 0.29),
    });

    const lines = wrapText(value, valueFont, size, maxWidth);
    let lineY = this.cursorY;
    for (const line of lines) {
      this.page.drawText(line, {
        x: this.marginX + labelWidth + 12,
        y: lineY,
        size,
        font: valueFont,
        color: rgb(0.24, 0.29, 0.36),
      });
      lineY -= size + 4;
    }

    this.cursorY = lineY - 4;
  }

  drawWrappedText(text: string, options: DrawTextOptions) {
    const x = options.x ?? this.marginX;
    const size = options.size;
    const lineHeight = options.lineHeight ?? size * 1.45;
    const maxWidth = options.maxWidth ?? this.contentWidth;
    const paragraphSpacing = options.paragraphSpacing ?? size * 0.6;
    const lines = wrapText(text, options.font, size, maxWidth);

    let lastBlank = false;
    for (const line of lines) {
      if (line === "") {
        this.cursorY -= paragraphSpacing;
        lastBlank = true;
        continue;
      }

      this.ensureSpace(lineHeight);
      this.page.drawText(line, {
        x,
        y: this.cursorY,
        size,
        font: options.font,
        color: options.color ?? rgb(0.2, 0.25, 0.33),
      });
      this.cursorY -= lineHeight;
      lastBlank = false;
    }

    if (!lastBlank) {
      this.cursorY -= paragraphSpacing;
    }
  }
}

const drawPageNumbers = (
  composer: DocumentComposer,
  font: PdfFont,
  color: ReturnType<typeof rgb>,
) => {
  composer.allPages.forEach((page, index) => {
    const label = `Page ${index + 1} of ${composer.pageCount}`;
    const size = 9;
    const width = font.widthOfTextAtSize(label, size);
    page.drawText(label, {
      x: composer.pageWidth - composer.marginX - width,
      y: 24,
      size,
      font,
      color,
    });
  });
};

const embedLogo = async (pdfDoc: PDFDocument, logoDataUrl: string | null) => {
  if (!logoDataUrl) return null;
  const { meta, bytes } = dataUrlToBytes(logoDataUrl);
  if (meta.includes("image/png")) {
    return await pdfDoc.embedPng(bytes);
  }
  return await pdfDoc.embedJpg(bytes);
};

const drawLogo = (
  page: PdfPage,
  composer: DocumentComposer,
  image: Awaited<ReturnType<typeof PDFDocument.prototype.embedPng>> | null,
  topOffset = 0,
) => {
  if (!image) return { width: 0, height: 0 };
  const maxWidth = 72;
  const maxHeight = 48;
  const imageRatio = image.width / image.height || 1;

  let width = maxWidth;
  let height = width / imageRatio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * imageRatio;
  }

  page.drawImage(image, {
    x: composer.marginX,
    y: composer.pageHeight - composer.marginTop - height + topOffset,
    width,
    height,
  });

  return { width, height };
};

const formatCvDateRange = (startDate: string, endDate: string) => {
  const start = sanitizeText(startDate);
  const end = sanitizeText(endDate);
  if (start && end) {
    return `${start} - ${end}`;
  }
  return start || end;
};

const parseCvBullets = (text: string) =>
  sanitizeText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const parseCvSkills = (text: string) =>
  sanitizeText(text)
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);

const buildCvContactLine = (cv: CreatorCvDraft) =>
  [cv.email, cv.phone, cv.location, cv.website, cv.linkedin]
    .map((item) => sanitizeText(item))
    .filter(Boolean)
    .join(" • ");

const drawCvBullets = (
  composer: DocumentComposer,
  lines: string[],
  options: {
    font: PdfFont;
    bulletFont: PdfFont;
    size: number;
    x: number;
    maxWidth: number;
    color?: ReturnType<typeof rgb>;
    lineHeight?: number;
    paragraphSpacing?: number;
  },
) => {
  const lineHeight = options.lineHeight ?? options.size * 1.4;
  const paragraphSpacing = options.paragraphSpacing ?? 4;
  lines.forEach((line) => {
    composer.ensureSpace(lineHeight + paragraphSpacing);
    composer.currentPage.drawText("•", {
      x: options.x,
      y: composer.currentY,
      size: options.size,
      font: options.bulletFont,
      color: options.color ?? rgb(0.2, 0.25, 0.33),
    });
    composer.drawWrappedText(line, {
      x: options.x + 12,
      maxWidth: options.maxWidth - 12,
      font: options.font,
      size: options.size,
      color: options.color,
      lineHeight,
      paragraphSpacing,
    });
  });
};

const drawCvTopRightLogo = (
  page: PdfPage,
  composer: DocumentComposer,
  image: Awaited<ReturnType<typeof PDFDocument.prototype.embedPng>> | null,
  centerY: number,
  maxHeight: number,
) => {
  if (!image) return { width: 0, height: 0 };
  const ratio = image.width / image.height || 1;
  const height = maxHeight;
  const width = height * ratio;
  page.drawImage(image, {
    x: composer.pageWidth - composer.marginX - width,
    y: centerY - height / 2,
    width,
    height,
  });
  return { width, height };
};

const createInvoiceTableLayout = (composer: DocumentComposer): InvoiceTableLayout => {
  const cellPaddingX = 12;
  const qtyWidth = 64;
  const rateWidth = 116;
  const amountWidth = 138;
  const descriptionWidth = composer.contentWidth - qtyWidth - rateWidth - amountWidth;

  const descriptionX = composer.marginX;
  const qtyX = descriptionX + descriptionWidth;
  const rateX = qtyX + qtyWidth;
  const amountX = rateX + rateWidth;

  return {
    x: composer.marginX,
    width: composer.contentWidth,
    cellPaddingX,
    headerHeight: 30,
    baseRowHeight: 34,
    rowGap: 0,
    description: { x: descriptionX, width: descriptionWidth },
    qty: { x: qtyX, width: qtyWidth },
    rate: { x: rateX, width: rateWidth },
    amount: { x: amountX, width: amountWidth },
  };
};

const getRightAlignedTextX = (text: string, font: PdfFont, size: number, rightEdge: number) =>
  rightEdge - font.widthOfTextAtSize(text, size);

const getCenteredTextX = (
  text: string,
  font: PdfFont,
  size: number,
  columnX: number,
  columnWidth: number,
) => columnX + (columnWidth - font.widthOfTextAtSize(text, size)) / 2;

const getCellTextY = (cellBottom: number, cellHeight: number, fontSize: number) =>
  cellBottom + (cellHeight - fontSize) / 2 + 2;

const drawInvoiceTableColumnDividers = (
  page: PdfPage,
  layout: InvoiceTableLayout,
  bottomY: number,
  height: number,
) => {
  [layout.qty.x, layout.rate.x, layout.amount.x].forEach((x) => {
    page.drawLine({
      start: { x, y: bottomY },
      end: { x, y: bottomY + height },
      thickness: 1,
      color: rgb(0.88, 0.94, 0.97),
      opacity: 1,
    });
  });
};

const renderReport = async (
  composer: DocumentComposer,
  draft: PdfCreatorDraft,
  fonts: { regular: PdfFont; bold: PdfFont; mono: PdfFont },
  logo: Awaited<ReturnType<typeof PDFDocument.prototype.embedPng>> | null,
) => {
  const { report } = draft;
  const title = sanitizeText(report.title) || "Untitled document";
  const subtitle = sanitizeText(report.subtitle);
  const author = sanitizeText(report.author);
  const summary = sanitizeText(report.summary);
  const titleSize = 24;
  const subtitleSize = 11;

  const logoMetrics = drawLogo(composer.currentPage, composer, logo, 8);
  const titleX = composer.marginX + (logoMetrics.width > 0 ? logoMetrics.width + 18 : 0);
  const titleWidth = composer.pageWidth - composer.marginX - titleX;
  const titleLines = wrapText(title, fonts.bold, titleSize, titleWidth);

  let titleY = composer.pageHeight - composer.marginTop + 8;
  for (const line of titleLines) {
    composer.currentPage.drawText(line, {
      x: titleX,
      y: titleY,
      size: titleSize,
      font: fonts.bold,
      color: composer.accentColor,
    });
    titleY -= titleSize + 6;
  }

  if (subtitle) {
    const subtitleLines = wrapText(subtitle, fonts.regular, subtitleSize, titleWidth);
    for (const line of subtitleLines) {
      composer.currentPage.drawText(line, {
        x: titleX,
        y: titleY,
        size: subtitleSize,
        font: fonts.regular,
        color: rgb(0.43, 0.5, 0.58),
      });
      titleY -= subtitleSize + 4;
    }
  }

  if (author) {
    composer.currentPage.drawText(`Prepared by ${author}`, {
      x: titleX,
      y: titleY - 4,
      size: 10,
      font: fonts.regular,
      color: rgb(0.43, 0.5, 0.58),
    });
  }

  const headerDepth = Math.max(92, composer.pageHeight - composer.marginTop - titleY + 34);
  const dividerY = composer.pageHeight - composer.marginTop - headerDepth + 12;
  composer.currentPage.drawRectangle({
    x: composer.marginX,
    y: dividerY,
    width: composer.contentWidth,
    height: 3,
    color: composer.accentColor,
  });
  composer.setCursor(dividerY - 22);

  if (summary) {
    composer.drawWrappedText(summary, {
      font: fonts.regular,
      size: 12,
      color: rgb(0.2, 0.25, 0.33),
      lineHeight: 18,
      paragraphSpacing: 14,
    });
    composer.drawDivider(4, 18);
  }

  report.sections.forEach((section, index) => {
    const heading = sanitizeText(section.heading) || `Section ${index + 1}`;
    const body = sanitizeText(section.body);

    composer.ensureSpace(28);
    composer.currentPage.drawText(heading, {
      x: composer.marginX,
      y: composer.currentY,
      size: 16,
      font: fonts.bold,
      color: composer.accentColor,
    });
    composer.moveCursor(24);

    composer.drawWrappedText(body, {
      font: fonts.regular,
      size: 11,
      lineHeight: 16,
      paragraphSpacing: 16,
    });
  });
};

const renderLetter = async (
  composer: DocumentComposer,
  draft: PdfCreatorDraft,
  fonts: { regular: PdfFont; bold: PdfFont; mono: PdfFont },
  logo: Awaited<ReturnType<typeof PDFDocument.prototype.embedPng>> | null,
) => {
  const { letter } = draft;
  const senderLines = parseMultiline(letter.senderDetails);
  const recipientLines = parseMultiline(letter.recipientDetails);

  const logoMetrics = drawLogo(composer.currentPage, composer, logo, 4);
  const senderX = composer.marginX + (logoMetrics.width > 0 ? logoMetrics.width + 18 : 0);
  let senderY = composer.pageHeight - composer.marginTop + 6;
  const senderName = sanitizeText(letter.senderName);

  if (senderName) {
    composer.currentPage.drawText(senderName, {
      x: senderX,
      y: senderY,
      size: 18,
      font: fonts.bold,
      color: composer.accentColor,
    });
    senderY -= 24;
  }

  senderLines.forEach((line) => {
    composer.currentPage.drawText(line, {
      x: senderX,
      y: senderY,
      size: 10.5,
      font: fonts.regular,
      color: rgb(0.22, 0.28, 0.36),
    });
    senderY -= 14;
  });

  const dateText = sanitizeText(letter.date) || today();
  const dateWidth = fonts.regular.widthOfTextAtSize(dateText, 11);
  composer.currentPage.drawText(dateText, {
    x: composer.pageWidth - composer.marginX - dateWidth,
    y: composer.pageHeight - composer.marginTop + 6,
    size: 11,
    font: fonts.regular,
    color: rgb(0.43, 0.5, 0.58),
  });

  const headerBottom = Math.min(senderY, composer.pageHeight - composer.marginTop - 58);
  composer.setCursor(headerBottom - 12);
  composer.drawDivider(0, 18);

  const recipientBlock = [sanitizeText(letter.recipientName), ...recipientLines].filter(Boolean);
  recipientBlock.forEach((line) => {
    composer.ensureSpace(16);
    composer.currentPage.drawText(line, {
      x: composer.marginX,
      y: composer.currentY,
      size: 11,
      font: line === recipientBlock[0] ? fonts.bold : fonts.regular,
      color: rgb(0.19, 0.25, 0.33),
    });
    composer.moveCursor(15);
  });

  composer.moveCursor(6);

  const subject = sanitizeText(letter.subject);
  if (subject) {
    composer.currentPage.drawText(subject, {
      x: composer.marginX,
      y: composer.currentY,
      size: 13,
      font: fonts.bold,
      color: composer.accentColor,
    });
    composer.moveCursor(24);
  }

  const greeting = sanitizeText(letter.greeting) || "Hello,";
  composer.currentPage.drawText(greeting, {
    x: composer.marginX,
    y: composer.currentY,
    size: 11,
    font: fonts.regular,
    color: rgb(0.19, 0.25, 0.33),
  });
  composer.moveCursor(24);

  letter.paragraphs.forEach((paragraph) => {
    composer.drawWrappedText(paragraph.text, {
      font: fonts.regular,
      size: 11,
      lineHeight: 17,
      paragraphSpacing: 14,
    });
  });

  composer.moveCursor(8);
  const closing = sanitizeText(letter.closing);
  if (closing) {
    composer.currentPage.drawText(closing, {
      x: composer.marginX,
      y: composer.currentY,
      size: 11,
      font: fonts.regular,
      color: rgb(0.19, 0.25, 0.33),
    });
    composer.moveCursor(42);
  }

  const signature = sanitizeText(letter.signature);
  if (signature) {
    composer.currentPage.drawText(signature, {
      x: composer.marginX,
      y: composer.currentY,
      size: 12,
      font: fonts.bold,
      color: composer.accentColor,
    });
  }
};

const drawInvoiceTableHeader = (
  composer: DocumentComposer,
  fonts: { regular: PdfFont; bold: PdfFont; mono: PdfFont },
  layout: InvoiceTableLayout,
) => {
  composer.ensureSpace(layout.headerHeight + layout.rowGap + 6);
  const headerBottom = composer.currentY - layout.headerHeight;
  composer.currentPage.drawRectangle({
    x: layout.x,
    y: headerBottom,
    width: layout.width,
    height: layout.headerHeight,
    color: rgb(0.94, 0.98, 0.99),
    borderWidth: 1,
    borderColor: rgb(0.88, 0.94, 0.97),
  });
  drawInvoiceTableColumnDividers(composer.currentPage, layout, headerBottom, layout.headerHeight);

  const headerTextY = getCellTextY(headerBottom, layout.headerHeight, 10);

  const columns = [
    { label: "Description", x: layout.description.x + layout.cellPaddingX },
    {
      label: "Qty",
      x: getCenteredTextX("Qty", fonts.bold, 10, layout.qty.x, layout.qty.width),
    },
    {
      label: "Rate",
      x: getRightAlignedTextX(
        "Rate",
        fonts.bold,
        10,
        layout.rate.x + layout.rate.width - layout.cellPaddingX,
      ),
    },
    {
      label: "Amount",
      x: getRightAlignedTextX(
        "Amount",
        fonts.bold,
        10,
        layout.amount.x + layout.amount.width - layout.cellPaddingX,
      ),
    },
  ] as const;

  columns.forEach((column) => {
    composer.currentPage.drawText(column.label, {
      x: column.x,
      y: headerTextY,
      size: 10,
      font: fonts.bold,
      color: rgb(0.18, 0.24, 0.31),
    });
  });

  composer.setCursor(headerBottom - layout.rowGap);
};

const renderInvoice = async (
  composer: DocumentComposer,
  draft: PdfCreatorDraft,
  fonts: { regular: PdfFont; bold: PdfFont; mono: PdfFont },
  logo: Awaited<ReturnType<typeof PDFDocument.prototype.embedPng>> | null,
) => {
  const { invoice } = draft;
  const headerHeight = 82;
  const businessName = sanitizeText(invoice.businessName) || "Invoice";
  const invoiceLabel = "INVOICE";
  const invoiceLabelSize = 18;
  const headerTitleGap = 24;
  const headerContentCenterY = composer.pageHeight - headerHeight / 2 + 4;
  composer.currentPage.drawRectangle({
    x: 0,
    y: composer.pageHeight - headerHeight,
    width: composer.pageWidth,
    height: headerHeight,
    color: composer.accentColor,
  });

  let logoWidth = 0;
  if (logo) {
    const maxHeight = 36;
    const ratio = logo.width / logo.height || 1;
    const width = maxHeight * ratio;
    logoWidth = width;
    composer.currentPage.drawImage(logo, {
      x: composer.marginX,
      y: headerContentCenterY - maxHeight / 2,
      width,
      height: maxHeight,
    });
  }

  const invoiceLabelWidth = fonts.bold.widthOfTextAtSize(invoiceLabel, invoiceLabelSize);
  const invoiceLabelX = composer.pageWidth - composer.marginX - invoiceLabelWidth;
  const businessNameX = composer.marginX + (logoWidth > 0 ? logoWidth + 18 : 0);
  const businessNameMaxWidth = Math.max(120, invoiceLabelX - businessNameX - headerTitleGap);
  let businessNameSize = 24;
  while (
    businessNameSize > 16 &&
    fonts.bold.widthOfTextAtSize(businessName, businessNameSize) > businessNameMaxWidth
  ) {
    businessNameSize -= 1;
  }

  composer.currentPage.drawText(businessName, {
    x: businessNameX,
    y: headerContentCenterY - businessNameSize / 2,
    size: businessNameSize,
    font: fonts.bold,
    color: rgb(1, 1, 1),
  });

  composer.currentPage.drawText(invoiceLabel, {
    x: invoiceLabelX,
    y: headerContentCenterY - invoiceLabelSize / 2,
    size: invoiceLabelSize,
    font: fonts.bold,
    color: rgb(1, 1, 1),
  });

  composer.setCursor(composer.pageHeight - headerHeight - 18);

  const businessLines = parseMultiline(invoice.businessDetails);
  const clientLines = parseMultiline(invoice.clientDetails);
  const blockWidth = (composer.contentWidth - 32) / 2;

  composer.currentPage.drawText("From", {
    x: composer.marginX,
    y: composer.currentY,
    size: 11,
    font: fonts.bold,
    color: composer.accentColor,
  });
  composer.currentPage.drawText("Bill To", {
    x: composer.marginX + blockWidth + 32,
    y: composer.currentY,
    size: 11,
    font: fonts.bold,
    color: composer.accentColor,
  });
  composer.moveCursor(18);

  const leftBlock = [sanitizeText(invoice.businessName), ...businessLines].filter(Boolean);
  const rightBlock = [sanitizeText(invoice.clientName), ...clientLines].filter(Boolean);
  const blockRows = Math.max(leftBlock.length, rightBlock.length);

  for (let index = 0; index < blockRows; index += 1) {
    const left = leftBlock[index];
    const right = rightBlock[index];
    if (left) {
      composer.currentPage.drawText(left, {
        x: composer.marginX,
        y: composer.currentY,
        size: 10.5,
        font: index === 0 ? fonts.bold : fonts.regular,
        color: rgb(0.2, 0.25, 0.33),
      });
    }
    if (right) {
      composer.currentPage.drawText(right, {
        x: composer.marginX + blockWidth + 32,
        y: composer.currentY,
        size: 10.5,
        font: index === 0 ? fonts.bold : fonts.regular,
        color: rgb(0.2, 0.25, 0.33),
      });
    }
    composer.moveCursor(14);
  }

  composer.moveCursor(12);
  composer.drawLabelValue("Invoice #", sanitizeText(invoice.invoiceNumber) || "Pending");
  composer.drawLabelValue("Issue Date", sanitizeText(invoice.issueDate) || today());
  composer.drawLabelValue(
    "Due Date",
    sanitizeText(invoice.dueDate) || sanitizeText(invoice.issueDate) || today(),
  );

  composer.drawDivider(6, 16);

  const tableLayout = createInvoiceTableLayout(composer);

  drawInvoiceTableHeader(composer, fonts, tableLayout);

  invoice.lineItems.forEach((item) => {
    const quantity = sanitizeCurrencyNumber(item.quantity);
    const unitPrice = sanitizeCurrencyNumber(item.unitPrice);
    const amount = quantity * unitPrice;
    const descriptionLines = wrapText(
      item.description || "Line item",
      fonts.regular,
      10.5,
      tableLayout.description.width - tableLayout.cellPaddingX * 2,
    );
    const rowLineHeight = 14;
    const rowHeight = Math.max(
      tableLayout.baseRowHeight,
      descriptionLines.length * rowLineHeight + 14,
    );

    if (composer.ensureSpace(rowHeight + tableLayout.rowGap)) {
      drawInvoiceTableHeader(composer, fonts, tableLayout);
    }

    const rowBottom = composer.currentY - rowHeight;
    composer.currentPage.drawRectangle({
      x: tableLayout.x,
      y: rowBottom,
      width: tableLayout.width,
      height: rowHeight,
      color: rgb(1, 1, 1),
      borderWidth: 1,
      borderColor: rgb(0.88, 0.94, 0.97),
    });
    drawInvoiceTableColumnDividers(composer.currentPage, tableLayout, rowBottom, rowHeight);

    const descBlockHeight = 10.5 + Math.max(0, descriptionLines.length - 1) * rowLineHeight;
    let descY = rowBottom + (rowHeight - descBlockHeight) / 2 + descBlockHeight - 10.5;
    descriptionLines.forEach((line) => {
      composer.currentPage.drawText(line, {
        x: tableLayout.description.x + tableLayout.cellPaddingX,
        y: descY,
        size: 10.5,
        font: fonts.regular,
        color: rgb(0.2, 0.25, 0.33),
      });
      descY -= rowLineHeight;
    });

    const qtyText = String(quantity || 0);
    const rateText = formatCurrency(unitPrice, invoice.currency);
    const amountText = formatCurrency(amount, invoice.currency);
    const numericY = getCellTextY(rowBottom, rowHeight, 10.5);

    composer.currentPage.drawText(qtyText, {
      x: getCenteredTextX(qtyText, fonts.regular, 10.5, tableLayout.qty.x, tableLayout.qty.width),
      y: numericY,
      size: 10.5,
      font: fonts.regular,
      color: rgb(0.2, 0.25, 0.33),
    });
    composer.currentPage.drawText(rateText, {
      x: getRightAlignedTextX(
        rateText,
        fonts.regular,
        10.5,
        tableLayout.rate.x + tableLayout.rate.width - tableLayout.cellPaddingX,
      ),
      y: numericY,
      size: 10.5,
      font: fonts.regular,
      color: rgb(0.2, 0.25, 0.33),
    });
    composer.currentPage.drawText(amountText, {
      x: getRightAlignedTextX(
        amountText,
        fonts.bold,
        10.5,
        tableLayout.amount.x + tableLayout.amount.width - tableLayout.cellPaddingX,
      ),
      y: numericY,
      size: 10.5,
      font: fonts.bold,
      color: rgb(0.2, 0.25, 0.33),
    });

    composer.setCursor(rowBottom - tableLayout.rowGap);
  });

  const total = calculateInvoiceTotal(invoice.lineItems);
  const totalBoxHeight = 52;
  composer.ensureSpace(totalBoxHeight + 28);
  const totalBoxWidth = tableLayout.rate.width + tableLayout.amount.width;
  const totalBoxX = tableLayout.rate.x;
  const totalBoxY = composer.currentY - totalBoxHeight;

  composer.currentPage.drawRectangle({
    x: totalBoxX,
    y: totalBoxY,
    width: totalBoxWidth,
    height: totalBoxHeight,
    color: rgb(0.96, 0.99, 0.99),
    borderWidth: 1,
    borderColor: rgb(0.88, 0.94, 0.97),
  });
  composer.currentPage.drawText("Total Due", {
    x: totalBoxX + 14,
    y: totalBoxY + 30,
    size: 11,
    font: fonts.bold,
    color: composer.accentColor,
  });
  const totalText = formatCurrency(total, invoice.currency);
  composer.currentPage.drawText(totalText, {
    x: getRightAlignedTextX(totalText, fonts.bold, 18, totalBoxX + totalBoxWidth - 14),
    y: totalBoxY + 12,
    size: 18,
    font: fonts.bold,
    color: rgb(0.18, 0.24, 0.31),
  });
  composer.setCursor(totalBoxY - 22);

  const paymentDetails = sanitizeText(invoice.paymentDetails);
  const paymentLink = sanitizeText(invoice.paymentLink);
  if (paymentDetails || paymentLink) {
    composer.ensureSpace(34);
    composer.currentPage.drawText("Payment Details", {
      x: composer.marginX,
      y: composer.currentY,
      size: 12,
      font: fonts.bold,
      color: composer.accentColor,
    });
    composer.moveCursor(20);

    if (paymentDetails) {
      composer.drawWrappedText(paymentDetails, {
        font: fonts.regular,
        size: 10.5,
        lineHeight: 15,
        paragraphSpacing: 10,
      });
    }

    if (paymentLink) {
      composer.currentPage.drawText("Payment Link", {
        x: composer.marginX,
        y: composer.currentY,
        size: 10.5,
        font: fonts.bold,
        color: rgb(0.18, 0.24, 0.31),
      });
      composer.moveCursor(18);
      composer.drawWrappedText(paymentLink, {
        font: fonts.regular,
        size: 10.5,
        lineHeight: 15,
        paragraphSpacing: 10,
        color: composer.accentColor,
      });
    }
  }

  const notes = sanitizeText(invoice.notes);
  if (notes) {
    composer.ensureSpace(34);
    composer.currentPage.drawText("Notes", {
      x: composer.marginX,
      y: composer.currentY,
      size: 12,
      font: fonts.bold,
      color: composer.accentColor,
    });
    composer.moveCursor(20);
    composer.drawWrappedText(notes, {
      font: fonts.regular,
      size: 10.5,
      lineHeight: 15,
      paragraphSpacing: 12,
    });
  }
};

const renderCvHarvard = async (
  composer: DocumentComposer,
  draft: PdfCreatorDraft,
  fonts: { regular: PdfFont; bold: PdfFont; mono: PdfFont },
  logo: Awaited<ReturnType<typeof PDFDocument.prototype.embedPng>> | null,
) => {
  const { cv } = draft;
  const topY = composer.pageHeight - composer.marginTop + 8;
  const logoMetrics = drawCvTopRightLogo(composer.currentPage, composer, logo, topY - 8, 34);
  const rightLimit =
    composer.pageWidth - composer.marginX - (logoMetrics.width > 0 ? logoMetrics.width + 18 : 0);
  const name = sanitizeText(cv.fullName) || "Unnamed Candidate";
  const title = sanitizeText(cv.professionalTitle);
  const contact = buildCvContactLine(cv);

  const nameLines = wrapText(name, fonts.bold, 24, rightLimit - composer.marginX);
  let headerY = topY;
  nameLines.forEach((line) => {
    composer.currentPage.drawText(line, {
      x: composer.marginX,
      y: headerY,
      size: 24,
      font: fonts.bold,
      color: rgb(0.13, 0.17, 0.23),
    });
    headerY -= 26;
  });

  if (title) {
    composer.currentPage.drawText(title, {
      x: composer.marginX,
      y: headerY,
      size: 11.5,
      font: fonts.regular,
      color: composer.accentColor,
    });
    headerY -= 18;
  }

  if (contact) {
    const contactLines = wrapText(contact, fonts.regular, 9.8, rightLimit - composer.marginX);
    contactLines.forEach((line) => {
      composer.currentPage.drawText(line, {
        x: composer.marginX,
        y: headerY,
        size: 9.8,
        font: fonts.regular,
        color: rgb(0.33, 0.39, 0.46),
      });
      headerY -= 13;
    });
  }

  composer.setCursor(headerY - 8);
  composer.drawDivider(0, 18);

  const drawSectionHeading = (label: string) => {
    composer.ensureSpace(24);
    const heading = sanitizeText(label);
    if (!heading) return;
    composer.currentPage.drawText(heading.toUpperCase(), {
      x: composer.marginX,
      y: composer.currentY,
      size: 10.5,
      font: fonts.bold,
      color: rgb(0.11, 0.16, 0.22),
    });
    const labelWidth = fonts.bold.widthOfTextAtSize(heading.toUpperCase(), 10.5);
    composer.currentPage.drawLine({
      start: { x: composer.marginX + labelWidth + 12, y: composer.currentY + 4 },
      end: { x: composer.pageWidth - composer.marginX, y: composer.currentY + 4 },
      thickness: 1,
      color: rgb(0.82, 0.86, 0.9),
      opacity: 1,
    });
    composer.moveCursor(20);
  };

  const drawExperienceEntries = (entries: CreatorCvExperience[]) => {
    entries.forEach((entry) => {
      const role = sanitizeText(entry.role);
      const organization = sanitizeText(entry.organization);
      const location = sanitizeText(entry.location);
      const dateRange = formatCvDateRange(entry.startDate, entry.endDate);
      const subtitle = [organization, location].filter(Boolean).join(" • ");
      const dateWidth = fonts.regular.widthOfTextAtSize(dateRange, 10);

      composer.ensureSpace(20);
      if (role) {
        composer.currentPage.drawText(role, {
          x: composer.marginX,
          y: composer.currentY,
          size: 12,
          font: fonts.bold,
          color: rgb(0.14, 0.18, 0.25),
        });
      }
      if (dateRange) {
        composer.currentPage.drawText(dateRange, {
          x: composer.pageWidth - composer.marginX - dateWidth,
          y: composer.currentY + 1,
          size: 10,
          font: fonts.regular,
          color: rgb(0.4, 0.45, 0.52),
        });
      }
      composer.moveCursor(16);

      if (subtitle) {
        composer.currentPage.drawText(subtitle, {
          x: composer.marginX,
          y: composer.currentY,
          size: 10.5,
          font: fonts.regular,
          color: rgb(0.32, 0.37, 0.44),
        });
        composer.moveCursor(16);
      }

      const bullets = parseCvBullets(entry.achievements);
      if (bullets.length > 0) {
        drawCvBullets(composer, bullets, {
          font: fonts.regular,
          bulletFont: fonts.bold,
          size: 10.2,
          x: composer.marginX,
          maxWidth: composer.contentWidth,
          lineHeight: 14.5,
          paragraphSpacing: 4,
        });
      }

      composer.moveCursor(4);
    });
  };

  const drawEducationEntries = (entries: CreatorCvEducation[]) => {
    entries.forEach((entry) => {
      const qualification = sanitizeText(entry.qualification);
      const institutionLine = [sanitizeText(entry.institution), sanitizeText(entry.location)]
        .filter(Boolean)
        .join(" • ");
      const dateRange = formatCvDateRange(entry.startDate, entry.endDate);
      const dateWidth = fonts.regular.widthOfTextAtSize(dateRange, 10);

      composer.ensureSpace(18);
      if (qualification) {
        composer.currentPage.drawText(qualification, {
          x: composer.marginX,
          y: composer.currentY,
          size: 11.5,
          font: fonts.bold,
          color: rgb(0.14, 0.18, 0.25),
        });
      }
      if (dateRange) {
        composer.currentPage.drawText(dateRange, {
          x: composer.pageWidth - composer.marginX - dateWidth,
          y: composer.currentY + 1,
          size: 10,
          font: fonts.regular,
          color: rgb(0.4, 0.45, 0.52),
        });
      }
      composer.moveCursor(16);
      if (institutionLine) {
        composer.currentPage.drawText(institutionLine, {
          x: composer.marginX,
          y: composer.currentY,
          size: 10.5,
          font: fonts.regular,
          color: rgb(0.32, 0.37, 0.44),
        });
        composer.moveCursor(16);
      }
      if (sanitizeText(entry.details)) {
        composer.drawWrappedText(entry.details, {
          font: fonts.regular,
          size: 10.2,
          lineHeight: 14.5,
          paragraphSpacing: 8,
        });
      }
      composer.moveCursor(2);
    });
  };

  if (sanitizeText(cv.profileLabel) && sanitizeText(cv.profile)) {
    drawSectionHeading(cv.profileLabel);
    composer.drawWrappedText(cv.profile, {
      font: fonts.regular,
      size: 10.5,
      lineHeight: 15.5,
      paragraphSpacing: 12,
    });
  }

  if (sanitizeText(cv.experienceLabel) && cv.experiences.length > 0) {
    drawSectionHeading(cv.experienceLabel);
    drawExperienceEntries(cv.experiences);
  }

  if (sanitizeText(cv.educationLabel) && cv.education.length > 0) {
    drawSectionHeading(cv.educationLabel);
    drawEducationEntries(cv.education);
  }

  const skillItems = parseCvSkills(cv.skills);
  if (sanitizeText(cv.skillsLabel) && skillItems.length > 0) {
    drawSectionHeading(cv.skillsLabel);
    composer.drawWrappedText(skillItems.join(" • "), {
      font: fonts.regular,
      size: 10.4,
      lineHeight: 15,
      paragraphSpacing: 12,
    });
  }

  cv.additionalSections.forEach((section) => {
    const title = sanitizeText(section.title);
    const body = sanitizeText(section.body);
    if (!title || !body) return;
    drawSectionHeading(title);
    const bullets = parseCvBullets(body);
    if (bullets.length > 1) {
      drawCvBullets(composer, bullets, {
        font: fonts.regular,
        bulletFont: fonts.bold,
        size: 10.2,
        x: composer.marginX,
        maxWidth: composer.contentWidth,
        lineHeight: 14.5,
        paragraphSpacing: 4,
      });
      composer.moveCursor(6);
    } else {
      composer.drawWrappedText(body, {
        font: fonts.regular,
        size: 10.4,
        lineHeight: 15,
        paragraphSpacing: 12,
      });
    }
  });
};

const renderCvModern = async (
  composer: DocumentComposer,
  draft: PdfCreatorDraft,
  fonts: { regular: PdfFont; bold: PdfFont; mono: PdfFont },
  logo: Awaited<ReturnType<typeof PDFDocument.prototype.embedPng>> | null,
) => {
  const { cv } = draft;
  const headerHeight = 112;
  const panelX = composer.marginX;
  const panelWidth = composer.contentWidth;
  const name = sanitizeText(cv.fullName) || "Unnamed Candidate";
  const title = sanitizeText(cv.professionalTitle);
  const contact = buildCvContactLine(cv);

  composer.currentPage.drawRectangle({
    x: 0,
    y: composer.pageHeight - headerHeight - 6,
    width: composer.pageWidth,
    height: headerHeight + 6,
    color: composer.accentColor,
  });

  const logoMetrics = drawCvTopRightLogo(
    composer.currentPage,
    composer,
    logo,
    composer.pageHeight - headerHeight / 2 + 10,
    40,
  );
  const rightLimit =
    composer.pageWidth - composer.marginX - (logoMetrics.width > 0 ? logoMetrics.width + 20 : 0);

  let headerY = composer.pageHeight - 40;
  const nameLines = wrapText(name, fonts.bold, 26, rightLimit - composer.marginX);
  nameLines.forEach((line) => {
    composer.currentPage.drawText(line, {
      x: composer.marginX,
      y: headerY,
      size: 26,
      font: fonts.bold,
      color: rgb(1, 1, 1),
    });
    headerY -= 27;
  });

  if (title) {
    composer.currentPage.drawText(title, {
      x: composer.marginX,
      y: headerY,
      size: 11.5,
      font: fonts.regular,
      color: rgb(0.92, 0.98, 1),
    });
    headerY -= 18;
  }

  if (contact) {
    wrapText(contact, fonts.regular, 9.6, rightLimit - composer.marginX).forEach((line) => {
      composer.currentPage.drawText(line, {
        x: composer.marginX,
        y: headerY,
        size: 9.6,
        font: fonts.regular,
        color: rgb(0.92, 0.98, 1),
      });
      headerY -= 12;
    });
  }

  composer.setCursor(composer.pageHeight - headerHeight - 26);

  const drawSectionHeading = (label: string) => {
    const heading = sanitizeText(label);
    if (!heading) return;
    composer.moveCursor(6);
    composer.ensureSpace(30);
    const headingY = composer.currentY - 12;
    composer.currentPage.drawText(heading, {
      x: composer.marginX,
      y: headingY,
      size: 12,
      font: fonts.bold,
      color: composer.accentColor,
    });
    composer.currentPage.drawRectangle({
      x: composer.marginX,
      y: headingY - 5,
      width: composer.contentWidth,
      height: 1.5,
      color: rgb(0.84, 0.9, 0.94),
    });
    composer.setCursor(headingY - 14);
  };

  const drawEntryBlock = (
    titleText: string,
    subtitleText: string,
    dateRange: string,
    bodyLines: string[],
  ) => {
    const sidePadding = 14;
    const verticalPadding = 16;
    const titleLineHeight = 14;
    const subtitleLineHeight = 12;
    const bulletLineHeight = 13;
    const subtitleGap = subtitleText ? 2 : 0;
    const bodyGap = bodyLines.length > 0 ? 5 : 0;
    const bulletGap = 2;
    const textMaxWidth = panelWidth - sidePadding * 2;
    const dateColumnWidth = 116;
    const dateColumnGap = dateRange ? 12 : 0;
    const textColumnWidth = textMaxWidth - dateColumnWidth - dateColumnGap;
    const titleLines = wrapText(titleText, fonts.bold, 12, textColumnWidth);
    const subtitleLines = subtitleText
      ? wrapText(subtitleText, fonts.regular, 10.4, textColumnWidth)
      : [];
    const bulletBlocks = bodyLines.map((line) =>
      wrapText(line, fonts.regular, 10.1, textMaxWidth - 12),
    );
    const titleHeight = titleLines.length * titleLineHeight;
    const subtitleHeight = subtitleLines.length * subtitleLineHeight;
    const bulletHeight = bulletBlocks.reduce(
      (height, lines, index) =>
        height +
        Math.max(1, lines.length) * bulletLineHeight +
        (index < bulletBlocks.length - 1 ? bulletGap : 0),
      0,
    );
    const innerContentHeight = titleHeight + subtitleGap + subtitleHeight + bodyGap + bulletHeight;
    const contentHeight = Math.max(52, innerContentHeight + verticalPadding * 2);

    const startedNewPage = composer.ensureSpace(contentHeight);
    if (startedNewPage) {
      composer.setCursor(composer.pageHeight - 54);
    }
    const cardTop = composer.currentY;
    const cardBottom = cardTop - contentHeight;
    composer.currentPage.drawRectangle({
      x: panelX,
      y: cardBottom,
      width: panelWidth,
      height: contentHeight,
      color: rgb(0.98, 0.99, 1),
      borderWidth: 1,
      borderColor: rgb(0.88, 0.94, 0.97),
    });
    composer.currentPage.drawRectangle({
      x: panelX,
      y: cardBottom,
      width: 4,
      height: contentHeight,
      color: composer.accentColor,
    });

    let entryY = cardTop - verticalPadding;
    titleLines.forEach((line) => {
      composer.currentPage.drawText(line, {
        x: panelX + sidePadding,
        y: entryY,
        size: 12,
        font: fonts.bold,
        color: rgb(0.14, 0.18, 0.25),
      });
      entryY -= titleLineHeight;
    });

    if (dateRange) {
      composer.currentPage.drawText(dateRange, {
        x: panelX + panelWidth - sidePadding - dateColumnWidth,
        y: cardTop - verticalPadding + 1,
        size: 9.8,
        font: fonts.regular,
        color: rgb(0.39, 0.45, 0.52),
      });
    }

    if (subtitleLines.length > 0) {
      entryY -= subtitleGap;
    }
    subtitleLines.forEach((line) => {
      composer.currentPage.drawText(line, {
        x: panelX + sidePadding,
        y: entryY,
        size: 10.4,
        font: fonts.regular,
        color: rgb(0.33, 0.38, 0.44),
      });
      entryY -= subtitleLineHeight;
    });

    if (bodyLines.length > 0) {
      entryY -= bodyGap;
      bulletBlocks.forEach((lines, blockIndex) => {
        lines.forEach((line, lineIndex) => {
          if (lineIndex === 0) {
            composer.currentPage.drawText("•", {
              x: panelX + sidePadding,
              y: entryY,
              size: 10.1,
              font: fonts.bold,
              color: rgb(0.2, 0.25, 0.33),
            });
          }
          composer.currentPage.drawText(line, {
            x: panelX + sidePadding + 12,
            y: entryY,
            size: 10.1,
            font: fonts.regular,
            color: rgb(0.2, 0.25, 0.33),
          });
          entryY -= bulletLineHeight;
        });
        if (blockIndex < bulletBlocks.length - 1) {
          entryY -= bulletGap;
        }
      });
    }

    composer.setCursor(cardBottom - 6);
  };

  if (sanitizeText(cv.profileLabel) && sanitizeText(cv.profile)) {
    drawSectionHeading(cv.profileLabel);
    const profileVerticalPadding = 12;
    const profileLineHeight = 15;
    const profileLines = wrapText(cv.profile, fonts.regular, 10.5, panelWidth - 28);
    const profileTextHeight = profileLines.reduce(
      (height, line) => height + (line === "" ? 10 : profileLineHeight),
      0,
    );
    const profileHeight = Math.max(54, profileTextHeight + profileVerticalPadding * 2);
    const startedNewPage = composer.ensureSpace(profileHeight);
    if (startedNewPage) {
      composer.setCursor(composer.pageHeight - 54);
    }
    const profileTop = composer.currentY;
    const profileBottom = profileTop - profileHeight;
    composer.currentPage.drawRectangle({
      x: panelX,
      y: profileBottom,
      width: panelWidth,
      height: profileHeight,
      color: rgb(0.96, 0.99, 1),
      borderWidth: 1,
      borderColor: rgb(0.88, 0.94, 0.97),
    });
    let profileY = profileTop - profileVerticalPadding;
    profileLines.forEach((line) => {
      if (line === "") {
        profileY -= 10;
        return;
      }
      composer.currentPage.drawText(line, {
        x: panelX + 14,
        y: profileY,
        size: 10.5,
        font: fonts.regular,
        color: rgb(0.2, 0.25, 0.33),
      });
      profileY -= profileLineHeight;
    });
    composer.setCursor(profileBottom - 8);
  }

  if (sanitizeText(cv.experienceLabel) && cv.experiences.length > 0) {
    drawSectionHeading(cv.experienceLabel);
    cv.experiences.forEach((entry) => {
      drawEntryBlock(
        sanitizeText(entry.role),
        [sanitizeText(entry.organization), sanitizeText(entry.location)]
          .filter(Boolean)
          .join(" • "),
        formatCvDateRange(entry.startDate, entry.endDate),
        parseCvBullets(entry.achievements),
      );
    });
  }

  if (sanitizeText(cv.educationLabel) && cv.education.length > 0) {
    drawSectionHeading(cv.educationLabel);
    cv.education.forEach((entry) => {
      drawEntryBlock(
        sanitizeText(entry.qualification),
        [sanitizeText(entry.institution), sanitizeText(entry.location)].filter(Boolean).join(" • "),
        formatCvDateRange(entry.startDate, entry.endDate),
        parseCvBullets(entry.details),
      );
    });
  }

  const skillItems = parseCvSkills(cv.skills);
  if (sanitizeText(cv.skillsLabel) && skillItems.length > 0) {
    drawSectionHeading(cv.skillsLabel);
    composer.drawWrappedText(skillItems.join(" • "), {
      font: fonts.regular,
      size: 10.4,
      lineHeight: 15,
      paragraphSpacing: 12,
    });
  }

  cv.additionalSections.forEach((section) => {
    const title = sanitizeText(section.title);
    const body = sanitizeText(section.body);
    if (!title || !body) return;
    drawSectionHeading(title);
    const bodyLines = parseCvBullets(body);
    if (bodyLines.length > 1) {
      drawCvBullets(composer, bodyLines, {
        font: fonts.regular,
        bulletFont: fonts.bold,
        size: 10.1,
        x: composer.marginX,
        maxWidth: composer.contentWidth,
        lineHeight: 14,
        paragraphSpacing: 4,
      });
      composer.moveCursor(6);
    } else {
      composer.drawWrappedText(body, {
        font: fonts.regular,
        size: 10.4,
        lineHeight: 15,
        paragraphSpacing: 12,
      });
    }
  });
};

const serializePdf = async (pdfDoc: PDFDocument) => {
  const primaryBytes = await pdfDoc.save();
  if (primaryBytes.length > 0) {
    return primaryBytes;
  }

  const fallbackBytes = await pdfDoc.save({ useObjectStreams: false });
  if (fallbackBytes.length > 0) {
    return fallbackBytes;
  }

  const fallbackBase64 = await pdfDoc.saveAsBase64({ useObjectStreams: false });
  const decodedBytes = base64ToUint8Array(fallbackBase64);
  if (decodedBytes.length > 0) {
    return decodedBytes;
  }

  throw new Error("PDF serialization produced no content.");
};

export async function createPdfFromDraft(draft: PdfCreatorDraft): Promise<CreatePdfResult> {
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    mono: await pdfDoc.embedFont(StandardFonts.Courier),
  };

  const pageSize = getPageDimensions(draft.pageSize, draft.orientation);
  const composer = new DocumentComposer(pdfDoc, fonts, pageSize, draft.accentColor);
  const logo = await embedLogo(pdfDoc, draft.logoDataUrl);

  switch (draft.template) {
    case "report":
      await renderReport(composer, draft, fonts, logo);
      pdfDoc.setTitle(sanitizeText(draft.report.title) || "Document");
      pdfDoc.setAuthor(sanitizeText(draft.report.author) || "Kyte");
      pdfDoc.setSubject("Generated report");
      pdfDoc.setKeywords(["Kyte PDF", "report"]);
      break;
    case "letter":
      await renderLetter(composer, draft, fonts, logo);
      pdfDoc.setTitle(sanitizeText(draft.letter.subject) || "Letter");
      pdfDoc.setAuthor(sanitizeText(draft.letter.senderName) || "Kyte");
      pdfDoc.setSubject("Business letter");
      pdfDoc.setKeywords(["Kyte PDF", "letter"]);
      break;
    case "invoice":
      await renderInvoice(composer, draft, fonts, logo);
      pdfDoc.setTitle(sanitizeText(draft.invoice.invoiceNumber) || "Invoice");
      pdfDoc.setAuthor(sanitizeText(draft.invoice.businessName) || "Kyte");
      pdfDoc.setSubject("Invoice");
      pdfDoc.setKeywords(["Kyte PDF", "invoice"]);
      break;
    case "cv-harvard":
      await renderCvHarvard(composer, draft, fonts, logo);
      pdfDoc.setTitle(`${sanitizeText(draft.cv.fullName) || "Candidate"} CV`);
      pdfDoc.setAuthor(sanitizeText(draft.cv.fullName) || "Kyte");
      pdfDoc.setSubject("Harvard-style curriculum vitae");
      pdfDoc.setKeywords(["Kyte PDF", "cv", "harvard"]);
      break;
    case "cv-modern":
      await renderCvModern(composer, draft, fonts, logo);
      pdfDoc.setTitle(`${sanitizeText(draft.cv.fullName) || "Candidate"} CV`);
      pdfDoc.setAuthor(sanitizeText(draft.cv.fullName) || "Kyte");
      pdfDoc.setSubject("Modern curriculum vitae");
      pdfDoc.setKeywords(["Kyte PDF", "cv", "resume"]);
      break;
  }

  pdfDoc.setCreator("Kyte PDF");
  pdfDoc.setProducer("Kyte PDF");
  pdfDoc.setCreationDate(new Date());
  pdfDoc.setModificationDate(new Date());

  if (draft.includePageNumbers) {
    drawPageNumbers(composer, fonts.regular, rgb(0.52, 0.58, 0.65));
  }

  return {
    bytes: await serializePdf(pdfDoc),
    pageCount: composer.pageCount,
    outputName: `${normalizeFileName(draft.fileName)}.pdf`,
  };
}

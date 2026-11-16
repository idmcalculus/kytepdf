import { logger } from "./logger.ts";
import { degrees, PDFDocument, rgb, StandardFonts } from "./pdfConfig.ts";

export type PdfCreatorTemplate =
  | "report"
  | "letter"
  | "invoice"
  | "payslip"
  | "cv-harvard"
  | "cv-modern";
export type PdfCreatorPageSize = "letter" | "a4";
export type PdfCreatorOrientation = "portrait" | "landscape";
export type PdfCreatorCurrency = "USD" | "EUR" | "GBP";
export type PdfCreatorInvoiceStatus = "pending" | "paid" | "overdue" | "cancelled";
export type PdfCreatorInvoiceDetailsAlignment = "left" | "right";
export type PdfCreatorInvoiceFooterLogoPosition = "none" | "left" | "center" | "right";
export type PdfCreatorWatermarkSource = "company-logo" | "custom-image" | "text";
export type PdfCreatorWatermarkStyle = "centered" | "diagonal" | "tiled";

export const PDF_CREATOR_TEMPLATES = [
  "report",
  "letter",
  "invoice",
  "payslip",
  "cv-harvard",
  "cv-modern",
] as const satisfies readonly PdfCreatorTemplate[];
export const PDF_CREATOR_PAGE_SIZES = [
  "letter",
  "a4",
] as const satisfies readonly PdfCreatorPageSize[];
export const PDF_CREATOR_ORIENTATIONS = [
  "portrait",
  "landscape",
] as const satisfies readonly PdfCreatorOrientation[];
export const PDF_CREATOR_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
] as const satisfies readonly PdfCreatorCurrency[];

export const WATERMARK_SOURCE_OPTIONS = [
  { value: "company-logo", label: "Company logo" },
  { value: "custom-image", label: "Custom image" },
  { value: "text", label: "Custom text" },
] as const satisfies readonly { value: PdfCreatorWatermarkSource; label: string }[];

export const WATERMARK_STYLE_OPTIONS = [
  { value: "centered", label: "Centred" },
  { value: "diagonal", label: "Diagonal" },
  { value: "tiled", label: "Tiled" },
] as const satisfies readonly { value: PdfCreatorWatermarkStyle; label: string }[];

export const INVOICE_FOOTER_LOGO_OPTIONS = [
  { value: "none", label: "Do not show" },
  { value: "left", label: "Left" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Right" },
] as const satisfies readonly {
  value: PdfCreatorInvoiceFooterLogoPosition;
  label: string;
}[];

export const INVOICE_DETAILS_ALIGNMENT_OPTIONS = [
  { value: "right", label: "Right aligned" },
  { value: "left", label: "Left aligned" },
] as const satisfies readonly {
  value: PdfCreatorInvoiceDetailsAlignment;
  label: string;
}[];

export const INVOICE_STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "cancelled", label: "Cancelled" },
] as const satisfies readonly { value: PdfCreatorInvoiceStatus; label: string }[];

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
  companyReference: string;
  detailsValueAlignment: PdfCreatorInvoiceDetailsAlignment;
  footerLogoPosition: PdfCreatorInvoiceFooterLogoPosition;
  includeBusinessNameInHeader: boolean;
  headerTextColor: string;
  status: PdfCreatorInvoiceStatus;
  issueDate: string;
  dueDate: string;
  paidDate: string;
  currency: PdfCreatorCurrency;
  paymentDetails: string;
  paymentLink: string;
  notes: string;
  signature: string;
  lineItems: CreatorInvoiceItem[];
}

export interface CreatorPayslipDraft {
  companyName: string;
  companyAddress: string;
  employeeName: string;
  employeeDetails: string;
  payslipNumber: string;
  companyReference: string;
  copyrightNote: string;
  detailsValueAlignment: PdfCreatorInvoiceDetailsAlignment;
  footerLogoPosition: PdfCreatorInvoiceFooterLogoPosition;
  includeCompanyNameInHeader: boolean;
  headerTextColor: string;
  payPeriod: string;
  payDate: string;
  currency: PdfCreatorCurrency;
  notes: string;
  lineItems: CreatorInvoiceItem[];
  deductions: CreatorInvoiceItem[];
  watermark: CreatorWatermarkDraft;
}

export interface CreatorWatermarkDraft {
  enabled: boolean;
  source: PdfCreatorWatermarkSource;
  style: PdfCreatorWatermarkStyle;
  text: string;
  customImageDataUrl: string | null;
  customImageFileName: string | null;
  opacity: number;
  size: number;
  rotation: number;
  grayscale: boolean;
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
  payslip: CreatorPayslipDraft;
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
    case "payslip":
      return "Payslip";
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
    companyReference: "",
    detailsValueAlignment: "right",
    footerLogoPosition: "none",
    includeBusinessNameInHeader: true,
    headerTextColor: "#ffffff",
    status: "pending",
    issueDate: today(),
    dueDate: today(),
    paidDate: "",
    currency: "USD",
    paymentDetails: "",
    paymentLink: "",
    notes:
      "Thank you for your business. Please remit payment by the due date and include the invoice number with your transfer.",
    signature: "",
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
  payslip: {
    companyName: "Kyte Studio",
    companyAddress: "12 Market Lane\nLondon\nEC2A 4NE\npayroll@kytepdf.com",
    employeeName: "Jordan Taylor",
    employeeDetails: "Employee ID: EMP-001\nProduct Designer\nLondon, UK",
    payslipNumber: "PAY-2026-001",
    companyReference: "",
    copyrightNote: "© 2026 Kyte Studio. All rights reserved.",
    detailsValueAlignment: "right",
    footerLogoPosition: "none",
    includeCompanyNameInHeader: true,
    headerTextColor: "#ffffff",
    payPeriod: "June 2026",
    payDate: today(),
    currency: "GBP",
    notes: "This payslip is a record of earnings for the pay period shown above.",
    lineItems: [
      createDefaultInvoiceItem({
        description: "Basic salary",
        quantity: 1,
        unitPrice: 3500,
      }),
      createDefaultInvoiceItem({
        description: "Additional hours",
        quantity: 4,
        unitPrice: 35,
      }),
    ],
    deductions: [
      createDefaultInvoiceItem({
        description: "Income tax",
        quantity: 1,
        unitPrice: 420,
      }),
      createDefaultInvoiceItem({
        description: "Pension contribution",
        quantity: 1,
        unitPrice: 175,
      }),
    ],
    watermark: {
      enabled: true,
      source: "company-logo",
      style: "centered",
      text: "CONFIDENTIAL",
      customImageDataUrl: null,
      customImageFileName: null,
      opacity: 8,
      size: 45,
      rotation: 0,
      grayscale: false,
    },
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

export const calculatePayslipTotals = (
  payslip: Pick<CreatorPayslipDraft, "lineItems" | "deductions">,
) => {
  const earnings = calculateInvoiceTotal(payslip.lineItems);
  const deductions = calculateInvoiceTotal(payslip.deductions);
  return {
    earnings,
    deductions,
    totalPay: earnings - deductions,
  };
};

export const normalizeInvoiceStatus = (value: unknown): PdfCreatorInvoiceStatus => {
  if (
    typeof value === "string" &&
    INVOICE_STATUS_OPTIONS.some((option) => option.value === value)
  ) {
    return value as PdfCreatorInvoiceStatus;
  }
  return "pending";
};

export const normalizeInvoiceDetailsAlignment = (
  value: unknown,
): PdfCreatorInvoiceDetailsAlignment => {
  if (
    typeof value === "string" &&
    INVOICE_DETAILS_ALIGNMENT_OPTIONS.some((option) => option.value === value)
  ) {
    return value as PdfCreatorInvoiceDetailsAlignment;
  }
  return "right";
};

export const normalizeInvoiceFooterLogoPosition = (
  value: unknown,
): PdfCreatorInvoiceFooterLogoPosition => {
  if (
    typeof value === "string" &&
    INVOICE_FOOTER_LOGO_OPTIONS.some((option) => option.value === value)
  ) {
    return value as PdfCreatorInvoiceFooterLogoPosition;
  }
  return "none";
};

export const normalizeWatermarkSource = (value: unknown): PdfCreatorWatermarkSource => {
  if (
    typeof value === "string" &&
    WATERMARK_SOURCE_OPTIONS.some((option) => option.value === value)
  ) {
    return value as PdfCreatorWatermarkSource;
  }
  return "company-logo";
};

export const normalizeWatermarkStyle = (value: unknown): PdfCreatorWatermarkStyle => {
  if (
    typeof value === "string" &&
    WATERMARK_STYLE_OPTIONS.some((option) => option.value === value)
  ) {
    return value as PdfCreatorWatermarkStyle;
  }
  return "centered";
};

export const getInvoiceStatusLabel = (status: PdfCreatorInvoiceStatus) =>
  INVOICE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "Pending";

export const getInvoiceTotalLabel = (status: PdfCreatorInvoiceStatus) =>
  `Total ${getInvoiceStatusLabel(status)}`;

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

const hexToRgb = (hex: string, fallback = DEFAULT_ACCENT) => {
  const normalized = /^#[\da-f]{6}$/i.test(hex) ? hex : fallback;
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;
  return rgb(r, g, b);
};

const getReadableAccentTextColor = (hex: string) => {
  const normalized = /^#[\da-f]{6}$/i.test(hex) ? hex : DEFAULT_ACCENT;
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;
  const perceivedBrightness = r * 0.299 + g * 0.587 + b * 0.114;

  return perceivedBrightness > 0.82 ? rgb(0.11, 0.17, 0.29) : rgb(r, g, b);
};

const getAccentTintColor = (hex: string, strength: number) => {
  const normalized = /^#[\da-f]{6}$/i.test(hex) ? hex : DEFAULT_ACCENT;
  const clampedStrength = Math.min(1, Math.max(0, strength));
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;

  return rgb(
    1 - (1 - r) * clampedStrength,
    1 - (1 - g) * clampedStrength,
    1 - (1 - b) * clampedStrength,
  );
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

type SignatureFont = { font: PdfFont; isFallback: boolean };

const embedInvoiceSignatureFont = async (
  pdfDoc: PDFDocument,
  include: boolean,
): Promise<SignatureFont | null> => {
  if (!include) return null;

  try {
    const [fontkitModule, fontUrlModule] = await Promise.all([
      import("@pdf-lib/fontkit"),
      import("@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff?url"),
    ]);
    const response = await fetch(fontUrlModule.default);
    if (!response.ok) throw new Error("Signature font could not be loaded.");

    pdfDoc.registerFontkit(fontkitModule.default);
    const font = await pdfDoc.embedFont(new Uint8Array(await response.arrayBuffer()), {
      subset: true,
    });
    return { font, isFallback: false };
  } catch (error) {
    logger.warn("Signature font could not be loaded; using Times Italic instead.", error);
    return { font: await pdfDoc.embedFont(StandardFonts.TimesRomanItalic), isFallback: true };
  }
};

/**
 * Standard PDF fonts only cover WinAnsi, and drawing anything else throws.
 * Strip accents the font cannot show and drop other characters it cannot encode.
 */
const keepEncodableCharacters = (text: string, font: PdfFont) => {
  const supported = new Set(font.getCharacterSet());
  const canEncode = (value: string) =>
    Array.from(value).every((char) => supported.has(char.codePointAt(0) as number));
  let replaced = 0;
  let dropped = 0;

  const result = Array.from(text.normalize("NFC"))
    .map((char) => {
      if (canEncode(char)) return char;
      const base = char.normalize("NFD").replace(/\p{M}/gu, "");
      if (base && canEncode(base)) {
        replaced += 1;
        return base;
      }
      dropped += 1;
      return "";
    })
    .join("");

  if (replaced > 0 || dropped > 0) {
    logger.warn("The fallback signature font cannot show every character in the signature.", {
      replaced,
      dropped,
    });
  }
  return sanitizeText(result);
};

type PdfWatermark = {
  image: Awaited<ReturnType<typeof PDFDocument.prototype.embedPng>> | null;
  text: string;
  font: PdfFont;
  style: PdfCreatorWatermarkStyle;
  opacity: number;
  size: number;
  rotation: number;
};

const grayscaleImageCache = new Map<string, string>();

const getGrayscaleImageDataUrl = async (dataUrl: string) => {
  const cached = grayscaleImageCache.get(dataUrl);
  if (cached) return cached;
  if (typeof document === "undefined" || typeof globalThis.createImageBitmap !== "function") {
    return dataUrl;
  }

  try {
    const response = await fetch(dataUrl);
    const bitmap = await globalThis.createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;

    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const gray = Math.round(
        pixels.data[index] * 0.299 +
          pixels.data[index + 1] * 0.587 +
          pixels.data[index + 2] * 0.114,
      );
      pixels.data[index] = gray;
      pixels.data[index + 1] = gray;
      pixels.data[index + 2] = gray;
    }
    context.putImageData(pixels, 0, 0);
    const result = canvas.toDataURL("image/png");
    grayscaleImageCache.set(dataUrl, result);
    return result;
  } catch {
    return dataUrl;
  }
};

/**
 * pdf-lib rotates text and images about their bottom-left corner. Returns the
 * corner position that puts the middle of the rotated box at (centerX, centerY).
 */
const getRotatedBoxOrigin = (
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  rotationDegrees: number,
) => {
  const radians = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: centerX - (width / 2) * cos + (height / 2) * sin,
    y: centerY - (width / 2) * sin - (height / 2) * cos,
  };
};

const drawPdfWatermark = (
  page: PdfPage,
  pageWidth: number,
  pageHeight: number,
  watermark: PdfWatermark,
) => {
  const opacity = Math.min(0.6, Math.max(0.01, watermark.opacity / 100));
  const sizeRatio = Math.min(0.9, Math.max(0.1, watermark.size / 100));
  const configuredRotation = Math.min(180, Math.max(-180, watermark.rotation));
  const rotation =
    watermark.style === "diagonal" && configuredRotation === 0 ? -35 : configuredRotation;

  if (watermark.image) {
    const ratio = watermark.image.width / watermark.image.height || 1;
    let width = pageWidth * sizeRatio;
    let height = width / ratio;
    if (height > pageHeight * 0.7) {
      height = pageHeight * 0.7;
      width = height * ratio;
    }

    const drawImageCenteredAt = (
      centerX: number,
      centerY: number,
      imageWidth: number,
      imageHeight: number,
    ) => {
      const origin = getRotatedBoxOrigin(centerX, centerY, imageWidth, imageHeight, rotation);
      page.drawImage(watermark.image!, {
        x: origin.x,
        y: origin.y,
        width: imageWidth,
        height: imageHeight,
        opacity,
        rotate: degrees(rotation),
      });
    };

    if (watermark.style === "tiled") {
      const tileWidth = Math.min(width, pageWidth * 0.3);
      const tileHeight = tileWidth / ratio;
      const gapX = tileWidth * 0.45;
      const gapY = tileHeight * 0.65;
      for (let y = gapY; y < pageHeight - tileHeight / 2; y += tileHeight + gapY) {
        for (let x = gapX; x < pageWidth - tileWidth / 2; x += tileWidth + gapX) {
          drawImageCenteredAt(x + tileWidth / 2, y + tileHeight / 2, tileWidth, tileHeight);
        }
      }
      return;
    }

    drawImageCenteredAt(pageWidth / 2, pageHeight / 2, width, height);
    return;
  }

  if (!watermark.text) return;
  const fontSize = Math.min(72, Math.max(22, pageWidth * sizeRatio * 0.18));
  const textWidth = watermark.font.widthOfTextAtSize(watermark.text, fontSize);
  const drawTextCenteredAt = (centerX: number, centerY: number) => {
    const origin = getRotatedBoxOrigin(centerX, centerY, textWidth, fontSize, rotation);
    page.drawText(watermark.text, {
      x: origin.x,
      y: origin.y,
      size: fontSize,
      font: watermark.font,
      color: rgb(0.42, 0.47, 0.54),
      opacity,
      rotate: degrees(rotation),
    });
  };

  if (watermark.style === "tiled") {
    const gapX = Math.max(30, textWidth * 0.45);
    const gapY = fontSize * 2.5;
    for (let y = gapY; y < pageHeight; y += gapY) {
      for (let x = 24; x < pageWidth; x += textWidth + gapX) {
        drawTextCenteredAt(x + textWidth / 2, y + fontSize / 2);
      }
    }
    return;
  }

  drawTextCenteredAt(pageWidth / 2, pageHeight / 2);
};

const resolvePdfWatermark = async (
  pdfDoc: PDFDocument,
  draft: PdfCreatorDraft,
  companyLogo: Awaited<ReturnType<typeof PDFDocument.prototype.embedPng>> | null,
  font: PdfFont,
): Promise<PdfWatermark | null> => {
  if (draft.template !== "payslip" || !draft.payslip.watermark.enabled) return null;
  const settings = draft.payslip.watermark;
  const base = {
    text: "",
    font,
    style: normalizeWatermarkStyle(settings.style),
    opacity: Number.isFinite(settings.opacity) ? settings.opacity : 8,
    size: Number.isFinite(settings.size) ? settings.size : 45,
    rotation: Number.isFinite(settings.rotation) ? settings.rotation : 0,
  };

  if (normalizeWatermarkSource(settings.source) === "text") {
    return {
      ...base,
      image: null,
      text: sanitizeText(settings.text) || "CONFIDENTIAL",
    };
  }

  const sourceDataUrl =
    normalizeWatermarkSource(settings.source) === "custom-image"
      ? settings.customImageDataUrl
      : draft.logoDataUrl;
  if (!sourceDataUrl) return null;
  const imageDataUrl = settings.grayscale
    ? await getGrayscaleImageDataUrl(sourceDataUrl)
    : sourceDataUrl;
  const image =
    imageDataUrl === draft.logoDataUrl && !settings.grayscale
      ? companyLogo
      : await embedLogo(pdfDoc, imageDataUrl);
  if (!image) return null;

  return { ...base, image };
};

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
    pageSize: readonly [number, number],
    accentHex: string,
    private watermark: PdfWatermark | null = null,
  ) {
    [this.pageWidth, this.pageHeight] = pageSize;
    this.contentWidth = this.pageWidth - this.marginX * 2;
    this.accentColor = hexToRgb(accentHex);
    this.page = this.pdfDoc.addPage([this.pageWidth, this.pageHeight]);
    this.pages.push(this.page);
    this.drawWatermark(this.page);
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
    this.drawWatermark(this.page);
    this.cursorY = this.pageHeight - this.marginTop;
    return this.page;
  }

  private drawWatermark(page: PdfPage) {
    if (this.watermark) {
      drawPdfWatermark(page, this.pageWidth, this.pageHeight, this.watermark);
    }
  }

  ensureSpace(height: number) {
    if (this.cursorY - height < this.marginBottom) {
      this.addPage();
      return true;
    }
    return false;
  }

  drawDivider(spacingBefore = 18, spacingAfter = 18, color = rgb(0.84, 0.87, 0.91)) {
    this.ensureSpace(spacingBefore + spacingAfter + 2);
    this.cursorY -= spacingBefore;
    this.page.drawLine({
      start: { x: this.marginX, y: this.cursorY },
      end: { x: this.pageWidth - this.marginX, y: this.cursorY },
      thickness: 1,
      color,
      opacity: 1,
    });
    this.cursorY -= spacingAfter;
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

const drawInvoiceFooter = (
  composer: DocumentComposer,
  font: PdfFont,
  color: ReturnType<typeof rgb>,
  options: {
    reference: string;
    copyrightNote: string;
    includePageNumbers: boolean;
    logo: Awaited<ReturnType<typeof PDFDocument.prototype.embedPng>> | null;
    logoPosition: PdfCreatorInvoiceFooterLogoPosition;
  },
) => {
  type FooterSlot = "left" | "center" | "right";

  const effectiveLogoPosition =
    options.logo && options.logoPosition !== "none" ? options.logoPosition : "none";
  const referencePosition: FooterSlot =
    effectiveLogoPosition === "left" || effectiveLogoPosition === "right" ? "center" : "left";
  const pageNumberPosition: FooterSlot = effectiveLogoPosition === "right" ? "left" : "right";
  const getSlotX = (width: number, slot: FooterSlot) => {
    if (slot === "center") return (composer.pageWidth - width) / 2;
    if (slot === "right") return composer.pageWidth - composer.marginX - width;
    return composer.marginX;
  };

  let logoWidth = 0;
  let logoHeight = 0;
  if (effectiveLogoPosition !== "none" && options.logo) {
    const ratio = options.logo.width / options.logo.height || 1;
    logoWidth = 64;
    logoHeight = logoWidth / ratio;
    if (logoHeight > 22) {
      logoHeight = 22;
      logoWidth = logoHeight * ratio;
    }
  }

  const referenceLabel = options.reference ? `Ref: ${options.reference}` : "";
  const referenceMaxWidth = composer.contentWidth * (referencePosition === "center" ? 0.4 : 0.46);
  let referenceSize = 9;
  const copyrightNote = sanitizeText(options.copyrightNote);
  let copyrightSize = 7;

  while (
    referenceLabel &&
    referenceSize > 6.5 &&
    font.widthOfTextAtSize(referenceLabel, referenceSize) > referenceMaxWidth
  ) {
    referenceSize -= 0.5;
  }

  while (
    copyrightNote &&
    copyrightSize > 5.5 &&
    font.widthOfTextAtSize(copyrightNote, copyrightSize) > referenceMaxWidth * 2
  ) {
    copyrightSize -= 0.5;
  }
  const copyrightLines = copyrightNote
    ? wrapText(copyrightNote, font, copyrightSize, referenceMaxWidth).filter(Boolean).slice(0, 2)
    : [];

  composer.allPages.forEach((page, index) => {
    if (referenceLabel) {
      const referenceWidth = font.widthOfTextAtSize(referenceLabel, referenceSize);
      page.drawText(referenceLabel, {
        x: getSlotX(referenceWidth, referencePosition),
        y: copyrightLines.length > 0 ? 29 : 24,
        size: referenceSize,
        font,
        color,
      });
    }

    copyrightLines.forEach((line, lineIndex) => {
      const lineWidth = font.widthOfTextAtSize(line, copyrightSize);
      page.drawText(line, {
        x: getSlotX(lineWidth, referencePosition),
        y: 16 - lineIndex * 7.5,
        size: copyrightSize,
        font,
        color,
      });
    });

    if (options.includePageNumbers) {
      const pageLabel = `Page ${index + 1} of ${composer.pageCount}`;
      const pageWidth = font.widthOfTextAtSize(pageLabel, 9);
      page.drawText(pageLabel, {
        x: getSlotX(pageWidth, pageNumberPosition),
        y: 24,
        size: 9,
        font,
        color,
      });
    }

    if (effectiveLogoPosition !== "none" && options.logo) {
      page.drawImage(options.logo, {
        x: getSlotX(logoWidth, effectiveLogoPosition),
        y: 28.5 - logoHeight / 2,
        width: logoWidth,
        height: logoHeight,
      });
    }
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
  borderColor: ReturnType<typeof rgb>,
) => {
  [layout.qty.x, layout.rate.x, layout.amount.x].forEach((x) => {
    page.drawLine({
      start: { x, y: bottomY },
      end: { x, y: bottomY + height },
      thickness: 1,
      color: borderColor,
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
  const signature = sanitizeText(letter.signature);
  // Keep the sign-off together and above the bottom margin.
  const signOffHeight = (closing ? 42 : 0) + (signature ? 12 : 0);
  if (signOffHeight > 0) {
    composer.ensureSpace(signOffHeight);
  }
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
  colors: {
    tint: ReturnType<typeof rgb>;
    border: ReturnType<typeof rgb>;
    text: ReturnType<typeof rgb>;
  },
) => {
  composer.ensureSpace(layout.headerHeight + layout.rowGap + 6);
  const headerBottom = composer.currentY - layout.headerHeight;
  composer.currentPage.drawRectangle({
    x: layout.x,
    y: headerBottom,
    width: layout.width,
    height: layout.headerHeight,
    color: colors.tint,
    borderWidth: 1,
    borderColor: colors.border,
  });
  drawInvoiceTableColumnDividers(
    composer.currentPage,
    layout,
    headerBottom,
    layout.headerHeight,
    colors.border,
  );

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
      color: colors.text,
    });
  });

  composer.setCursor(headerBottom - layout.rowGap);
};

const drawFinancialItemsTable = (
  composer: DocumentComposer,
  fonts: { regular: PdfFont; bold: PdfFont; mono: PdfFont },
  layout: InvoiceTableLayout,
  colors: {
    tint: ReturnType<typeof rgb>;
    border: ReturnType<typeof rgb>;
    text: ReturnType<typeof rgb>;
  },
  items: CreatorInvoiceItem[],
  currency: PdfCreatorCurrency,
) => {
  drawInvoiceTableHeader(composer, fonts, layout, colors);

  items.forEach((item) => {
    const quantity = sanitizeCurrencyNumber(item.quantity);
    const unitPrice = sanitizeCurrencyNumber(item.unitPrice);
    const amount = quantity * unitPrice;
    const descriptionLines = wrapText(
      item.description || "Line item",
      fonts.regular,
      10.5,
      layout.description.width - layout.cellPaddingX * 2,
    );
    const rowLineHeight = 14;
    const rowHeight = Math.max(layout.baseRowHeight, descriptionLines.length * rowLineHeight + 14);

    if (composer.ensureSpace(rowHeight + layout.rowGap)) {
      drawInvoiceTableHeader(composer, fonts, layout, colors);
    }

    const rowBottom = composer.currentY - rowHeight;
    composer.currentPage.drawRectangle({
      x: layout.x,
      y: rowBottom,
      width: layout.width,
      height: rowHeight,
      color: rgb(1, 1, 1),
      borderWidth: 1,
      borderColor: colors.border,
    });
    drawInvoiceTableColumnDividers(
      composer.currentPage,
      layout,
      rowBottom,
      rowHeight,
      colors.border,
    );

    const descBlockHeight = 10.5 + Math.max(0, descriptionLines.length - 1) * rowLineHeight;
    let descY = rowBottom + (rowHeight - descBlockHeight) / 2 + descBlockHeight - 10.5;
    descriptionLines.forEach((line) => {
      composer.currentPage.drawText(line, {
        x: layout.description.x + layout.cellPaddingX,
        y: descY,
        size: 10.5,
        font: fonts.regular,
        color: rgb(0.2, 0.25, 0.33),
      });
      descY -= rowLineHeight;
    });

    const qtyText = String(quantity || 0);
    const rateText = formatCurrency(unitPrice, currency);
    const amountText = formatCurrency(amount, currency);
    const numericY = getCellTextY(rowBottom, rowHeight, 10.5);

    composer.currentPage.drawText(qtyText, {
      x: getCenteredTextX(qtyText, fonts.regular, 10.5, layout.qty.x, layout.qty.width),
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
        layout.rate.x + layout.rate.width - layout.cellPaddingX,
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
        layout.amount.x + layout.amount.width - layout.cellPaddingX,
      ),
      y: numericY,
      size: 10.5,
      font: fonts.bold,
      color: rgb(0.2, 0.25, 0.33),
    });

    composer.setCursor(rowBottom - layout.rowGap);
  });
};

const renderInvoice = async (
  composer: DocumentComposer,
  draft: PdfCreatorDraft,
  fonts: { regular: PdfFont; bold: PdfFont; mono: PdfFont; signature?: SignatureFont | null },
  logo: Awaited<ReturnType<typeof PDFDocument.prototype.embedPng>> | null,
) => {
  const isPayslip = draft.template === "payslip";
  const invoice: CreatorInvoiceDraft = isPayslip
    ? {
        businessName: draft.payslip.companyName,
        businessDetails: draft.payslip.companyAddress,
        clientName: draft.payslip.employeeName,
        clientDetails: draft.payslip.employeeDetails,
        invoiceNumber: draft.payslip.payslipNumber,
        companyReference: draft.payslip.companyReference,
        detailsValueAlignment: draft.payslip.detailsValueAlignment,
        footerLogoPosition: draft.payslip.footerLogoPosition,
        includeBusinessNameInHeader: draft.payslip.includeCompanyNameInHeader,
        headerTextColor: draft.payslip.headerTextColor,
        status: "pending",
        issueDate: draft.payslip.payDate,
        dueDate: draft.payslip.payDate,
        paidDate: "",
        currency: draft.payslip.currency,
        paymentDetails: "",
        paymentLink: "",
        notes: draft.payslip.notes,
        signature: "",
        lineItems: draft.payslip.lineItems,
      }
    : draft.invoice;
  const invoiceStatus = normalizeInvoiceStatus(invoice.status);
  const detailsValueAlignment = normalizeInvoiceDetailsAlignment(invoice.detailsValueAlignment);
  const payslipTotals = isPayslip
    ? calculatePayslipTotals(draft.payslip)
    : { earnings: calculateInvoiceTotal(invoice.lineItems), deductions: 0, totalPay: 0 };
  const total = isPayslip ? payslipTotals.totalPay : payslipTotals.earnings;
  const totalLabel = isPayslip ? "Total Pay" : getInvoiceTotalLabel(invoiceStatus);
  const contentAccentColor = getReadableAccentTextColor(draft.accentColor);
  const accentTintColor = getAccentTintColor(draft.accentColor, 0.1);
  const accentBorderColor = getAccentTintColor(draft.accentColor, 0.28);
  const invoiceTheme = {
    tint: accentTintColor,
    border: accentBorderColor,
    text: contentAccentColor,
  };
  const businessName = sanitizeText(invoice.businessName) || (isPayslip ? "Company" : "Invoice");
  const page = composer.currentPage;
  const topY = composer.pageHeight - composer.marginTop + 12;
  const columnGap = 36;
  const rightColumnWidth = Math.min(224, composer.contentWidth * 0.44);
  const rightColumnX = composer.pageWidth - composer.marginX - rightColumnWidth;
  const leftColumnRight = rightColumnX - columnGap;
  const invoiceLabel = isPayslip ? "PAYSLIP" : "INVOICE";
  const invoiceLabelSize = 16;
  const invoiceTitleHeight = 32;
  const headerTextColor = hexToRgb(invoice.headerTextColor, "#ffffff");

  let logoWidth = 0;
  let logoHeight = 0;
  if (logo) {
    const ratio = logo.width / logo.height || 1;
    logoWidth = 108;
    logoHeight = logoWidth / ratio;
    if (logoHeight > 50) {
      logoHeight = 50;
      logoWidth = logoHeight * ratio;
    }
  }

  const businessNameX = composer.marginX + (logoWidth > 0 ? logoWidth + 18 : 0);
  const businessNameMaxWidth = Math.max(80, leftColumnRight - businessNameX);
  let businessNameSize = 22;
  while (
    businessNameSize > 14 &&
    fonts.bold.widthOfTextAtSize(businessName, businessNameSize) > businessNameMaxWidth
  ) {
    businessNameSize -= 1;
  }

  const topRowHeight = Math.max(
    invoiceTitleHeight,
    logoHeight,
    invoice.includeBusinessNameInHeader ? businessNameSize : 0,
  );
  const topRowCenterY = topY - topRowHeight / 2;

  if (logo) {
    page.drawImage(logo, {
      x: composer.marginX,
      y: topRowCenterY - logoHeight / 2,
      width: logoWidth,
      height: logoHeight,
    });
  }

  if (invoice.includeBusinessNameInHeader) {
    page.drawText(businessName, {
      x: businessNameX,
      y: topRowCenterY - businessNameSize / 2,
      size: businessNameSize,
      font: fonts.bold,
      color: rgb(0.11, 0.17, 0.29),
    });
  }

  const invoiceTitleY = topRowCenterY - invoiceTitleHeight / 2;
  page.drawRectangle({
    x: rightColumnX,
    y: invoiceTitleY,
    width: rightColumnWidth,
    height: invoiceTitleHeight,
    color: composer.accentColor,
  });
  const invoiceLabelWidth = fonts.bold.widthOfTextAtSize(invoiceLabel, invoiceLabelSize);
  page.drawText(invoiceLabel, {
    x: rightColumnX + (rightColumnWidth - invoiceLabelWidth) / 2,
    y: invoiceTitleY + (invoiceTitleHeight - invoiceLabelSize) / 2,
    size: invoiceLabelSize,
    font: fonts.bold,
    color: headerTextColor,
  });

  const addressLabelX = composer.marginX;
  const addressValueX = composer.marginX + 78;
  const addressValueWidth = leftColumnRight - addressValueX;
  const drawAddressBlock = (label: string, values: string[], startY: number) => {
    page.drawText(label, {
      x: addressLabelX,
      y: startY,
      size: 11,
      font: fonts.bold,
      color: contentAccentColor,
    });

    let valueY = startY;
    values.forEach((value, index) => {
      const valueFont = index === 0 ? fonts.bold : fonts.regular;
      const lines = wrapText(value, valueFont, 10.5, addressValueWidth);
      lines.forEach((line) => {
        page.drawText(line, {
          x: addressValueX,
          y: valueY,
          size: 10.5,
          font: valueFont,
          color: rgb(0.2, 0.25, 0.33),
        });
        valueY -= 14;
      });
    });
    return valueY;
  };

  const addressStartY = topY - topRowHeight - 28;
  const billFromValues = [businessName, ...parseMultiline(invoice.businessDetails)].filter(Boolean);
  const billToValues = [
    sanitizeText(invoice.clientName),
    ...parseMultiline(invoice.clientDetails),
  ].filter(Boolean);
  let identityBottom: number;
  if (isPayslip) {
    let companyY = addressStartY;
    parseMultiline(invoice.businessDetails).forEach((value) => {
      const lines = wrapText(value, fonts.regular, 10.5, leftColumnRight - composer.marginX);
      lines.forEach((line) => {
        page.drawText(line, {
          x: composer.marginX,
          y: companyY,
          size: 10.5,
          font: fonts.regular,
          color: rgb(0.2, 0.25, 0.33),
        });
        companyY -= 14;
      });
    });

    const employeeHeadingY = companyY - 18;
    page.drawText("Employee Information", {
      x: composer.marginX,
      y: employeeHeadingY,
      size: 11,
      font: fonts.bold,
      color: contentAccentColor,
    });

    let employeeY = employeeHeadingY - 18;
    billToValues.forEach((value, index) => {
      const valueFont = index === 0 ? fonts.bold : fonts.regular;
      const lines = wrapText(value, valueFont, 10.5, leftColumnRight - composer.marginX);
      lines.forEach((line) => {
        page.drawText(line, {
          x: composer.marginX,
          y: employeeY,
          size: 10.5,
          font: valueFont,
          color: rgb(0.2, 0.25, 0.33),
        });
        employeeY -= 14;
      });
    });
    identityBottom = employeeY;
  } else {
    const billFromBottom = drawAddressBlock("Bill From", billFromValues, addressStartY);
    identityBottom = drawAddressBlock("Bill To", billToValues, billFromBottom - 24);
  }

  const metadataLabelX = rightColumnX + 4;
  const metadataRightX = rightColumnX + rightColumnWidth - 4;
  const metadataValueWidth = rightColumnWidth * 0.56;
  const metadataValueX = metadataRightX - metadataValueWidth;
  let metadataY = invoiceTitleY - 24;
  const drawInvoiceDetail = (label: string, value: string, emphasize = false) => {
    const valueFont = emphasize ? fonts.bold : fonts.regular;
    const lines = wrapText(value, valueFont, 10.5, metadataValueWidth);
    page.drawText(label, {
      x: metadataLabelX,
      y: metadataY,
      size: 10.5,
      font: fonts.bold,
      color: contentAccentColor,
    });

    let valueY = metadataY;
    lines.forEach((line) => {
      const lineWidth = valueFont.widthOfTextAtSize(line, 10.5);
      page.drawText(line, {
        x: detailsValueAlignment === "right" ? metadataRightX - lineWidth : metadataValueX,
        y: valueY,
        size: 10.5,
        font: valueFont,
        color: rgb(0.24, 0.29, 0.36),
      });
      valueY -= 15;
    });
    metadataY = valueY - 4;
  };

  drawInvoiceDetail(
    isPayslip ? "Payslip #" : "Invoice #",
    sanitizeText(invoice.invoiceNumber) || "Pending",
  );
  const companyReference = sanitizeText(invoice.companyReference);
  if (companyReference) {
    drawInvoiceDetail("Company Ref", companyReference);
  }
  if (isPayslip) {
    drawInvoiceDetail("Pay Period", sanitizeText(draft.payslip.payPeriod) || "Not provided");
  }
  drawInvoiceDetail(
    isPayslip ? "Pay Date" : "Issue Date",
    sanitizeText(invoice.issueDate) || today(),
  );
  if (!isPayslip) {
    drawInvoiceDetail(
      "Due Date",
      sanitizeText(invoice.dueDate) || sanitizeText(invoice.issueDate) || today(),
    );
    drawInvoiceDetail("Status", getInvoiceStatusLabel(invoiceStatus));
    if (invoiceStatus === "paid") {
      drawInvoiceDetail("Paid Date", sanitizeText(invoice.paidDate) || "Not provided", true);
    }
  }
  drawInvoiceDetail(totalLabel, formatCurrency(total, invoice.currency), true);

  composer.setCursor(Math.min(identityBottom, metadataY) - 24);

  composer.drawDivider(6, 16, accentBorderColor);

  const tableLayout = createInvoiceTableLayout(composer);

  if (isPayslip) {
    composer.currentPage.drawText("Earnings", {
      x: composer.marginX,
      y: composer.currentY,
      size: 12,
      font: fonts.bold,
      color: contentAccentColor,
    });
    composer.moveCursor(20);
  }

  drawInvoiceTableHeader(composer, fonts, tableLayout, invoiceTheme);

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
      drawInvoiceTableHeader(composer, fonts, tableLayout, invoiceTheme);
    }

    const rowBottom = composer.currentY - rowHeight;
    composer.currentPage.drawRectangle({
      x: tableLayout.x,
      y: rowBottom,
      width: tableLayout.width,
      height: rowHeight,
      color: rgb(1, 1, 1),
      borderWidth: 1,
      borderColor: accentBorderColor,
    });
    drawInvoiceTableColumnDividers(
      composer.currentPage,
      tableLayout,
      rowBottom,
      rowHeight,
      accentBorderColor,
    );

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

  if (isPayslip) {
    composer.ensureSpace(110);
    composer.moveCursor(22);
    composer.currentPage.drawText("Deductions", {
      x: composer.marginX,
      y: composer.currentY,
      size: 12,
      font: fonts.bold,
      color: contentAccentColor,
    });
    composer.moveCursor(20);
    drawFinancialItemsTable(
      composer,
      fonts,
      tableLayout,
      invoiceTheme,
      draft.payslip.deductions,
      invoice.currency,
    );
  }

  const totalBoxHeight = isPayslip ? 84 : 52;
  composer.ensureSpace(totalBoxHeight + 28);
  const totalBoxWidth = tableLayout.rate.width + tableLayout.amount.width;
  const totalBoxX = tableLayout.rate.x;
  const totalBoxY = composer.currentY - totalBoxHeight;

  composer.currentPage.drawRectangle({
    x: totalBoxX,
    y: totalBoxY,
    width: totalBoxWidth,
    height: totalBoxHeight,
    color: accentTintColor,
    borderWidth: 1,
    borderColor: accentBorderColor,
  });
  if (isPayslip) {
    const summaryRightX = totalBoxX + totalBoxWidth - 14;
    const drawSummaryRow = (label: string, value: string, y: number) => {
      composer.currentPage.drawText(label, {
        x: totalBoxX + 14,
        y,
        size: 10.5,
        font: fonts.bold,
        color: contentAccentColor,
      });
      composer.currentPage.drawText(value, {
        x: getRightAlignedTextX(value, fonts.bold, 10.5, summaryRightX),
        y,
        size: 10.5,
        font: fonts.bold,
        color: rgb(0.18, 0.24, 0.31),
      });
    };

    drawSummaryRow(
      "Total Earnings",
      formatCurrency(payslipTotals.earnings, invoice.currency),
      totalBoxY + 62,
    );
    drawSummaryRow(
      "Total Deductions",
      `-${formatCurrency(payslipTotals.deductions, invoice.currency)}`,
      totalBoxY + 44,
    );
    composer.currentPage.drawLine({
      start: { x: totalBoxX + 14, y: totalBoxY + 34 },
      end: { x: summaryRightX, y: totalBoxY + 34 },
      thickness: 1,
      color: accentBorderColor,
      opacity: 1,
    });
    const totalText = formatCurrency(total, invoice.currency);
    composer.currentPage.drawText(totalLabel, {
      x: totalBoxX + 14,
      y: totalBoxY + 14,
      size: 11,
      font: fonts.bold,
      color: contentAccentColor,
    });
    composer.currentPage.drawText(totalText, {
      x: getRightAlignedTextX(totalText, fonts.bold, 16, summaryRightX),
      y: totalBoxY + 11,
      size: 16,
      font: fonts.bold,
      color: rgb(0.18, 0.24, 0.31),
    });
  } else {
    composer.currentPage.drawText(totalLabel, {
      x: totalBoxX + 14,
      y: totalBoxY + 30,
      size: 11,
      font: fonts.bold,
      color: contentAccentColor,
    });
    const totalText = formatCurrency(total, invoice.currency);
    composer.currentPage.drawText(totalText, {
      x: getRightAlignedTextX(totalText, fonts.bold, 18, totalBoxX + totalBoxWidth - 14),
      y: totalBoxY + 12,
      size: 18,
      font: fonts.bold,
      color: rgb(0.18, 0.24, 0.31),
    });
  }
  composer.setCursor(totalBoxY - 22);

  const paymentDetails = sanitizeText(invoice.paymentDetails);
  const paymentLink = sanitizeText(invoice.paymentLink);
  if (!isPayslip && (paymentDetails || paymentLink)) {
    composer.ensureSpace(34);
    composer.currentPage.drawText("Payment Details", {
      x: composer.marginX,
      y: composer.currentY,
      size: 12,
      font: fonts.bold,
      color: contentAccentColor,
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
      // Keep the label on the same page as the first line of the link.
      composer.ensureSpace(18 + 15);
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
        color: contentAccentColor,
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
      color: contentAccentColor,
    });
    composer.moveCursor(20);
    composer.drawWrappedText(notes, {
      font: fonts.regular,
      size: 10.5,
      lineHeight: 15,
      paragraphSpacing: 12,
    });
  }

  const signatureText = isPayslip ? "" : sanitizeText(invoice.signature);
  const signature = fonts.signature?.isFallback
    ? keepEncodableCharacters(signatureText, fonts.signature.font)
    : signatureText;
  if (signature) {
    const signatureFont = fonts.signature?.font ?? fonts.bold;
    const signatureSize = 28;
    const signatureLineHeight = 34;
    const signatureMaxWidth = Math.min(320, composer.contentWidth * 0.62);
    const signatureLines = wrapText(signature, signatureFont, signatureSize, signatureMaxWidth);
    const signatureHeight = signatureLines.length * signatureLineHeight + 8;
    const signatureSpacingBefore = notes ? 15 : 75;

    composer.ensureSpace(signatureHeight + signatureSpacingBefore);
    composer.moveCursor(signatureSpacingBefore);
    signatureLines.forEach((line) => {
      composer.currentPage.drawText(line, {
        x: composer.marginX,
        y: composer.currentY,
        size: signatureSize,
        font: signatureFont,
        color: rgb(0.04, 0.06, 0.09),
      });
      composer.moveCursor(signatureLineHeight);
    });
    composer.moveCursor(8);
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

  type PanelRow = { gapBefore: number; height: number; draw: (baselineY: number) => void };
  const freshPageTop = composer.pageHeight - 54;

  // Draws a shaded panel of text rows. A panel that fits on one page stays whole
  // (moving to a new page if needed); a taller one is split line by line.
  const drawPanel = (
    rows: PanelRow[],
    style: {
      padding: number;
      minHeight: number;
      fill: ReturnType<typeof rgb>;
      accentBar: boolean;
      spacingAfter: number;
    },
  ) => {
    const drawSlice = (slice: { row: PanelRow; gap: number }[], height: number) => {
      const top = composer.currentY;
      composer.currentPage.drawRectangle({
        x: panelX,
        y: top - height,
        width: panelWidth,
        height,
        color: style.fill,
        borderWidth: 1,
        borderColor: rgb(0.88, 0.94, 0.97),
      });
      if (style.accentBar) {
        composer.currentPage.drawRectangle({
          x: panelX,
          y: top - height,
          width: 4,
          height,
          color: composer.accentColor,
        });
      }
      let y = top - style.padding;
      for (const { row, gap } of slice) {
        y -= gap;
        row.draw(y);
        y -= row.height;
      }
      composer.setCursor(top - height - style.spacingAfter);
    };
    const startFreshPage = () => {
      composer.addPage();
      composer.setCursor(freshPageTop);
    };

    const contentHeight = rows.reduce((total, row) => total + row.gapBefore + row.height, 0);
    const fullHeight = Math.max(style.minHeight, contentHeight + style.padding * 2);
    if (fullHeight <= freshPageTop - composer.marginBottom) {
      if (composer.ensureSpace(fullHeight)) {
        composer.setCursor(freshPageTop);
      }
      drawSlice(
        rows.map((row) => ({ row, gap: row.gapBefore })),
        fullHeight,
      );
      return;
    }

    let index = 0;
    while (index < rows.length) {
      const spaceLeft = () => composer.currentY - composer.marginBottom - style.padding * 2;
      if (spaceLeft() < rows[index].height) {
        startFreshPage();
      }
      const available = spaceLeft();
      const slice: { row: PanelRow; gap: number }[] = [];
      let used = 0;
      while (index < rows.length) {
        const row = rows[index];
        const gap = slice.length === 0 ? 0 : row.gapBefore;
        if (slice.length > 0 && used + gap + row.height > available) break;
        slice.push({ row, gap });
        used += gap + row.height;
        index += 1;
      }
      drawSlice(slice, used + style.padding * 2);
      if (index < rows.length) {
        startFreshPage();
      }
    }
  };

  const drawEntryBlock = (
    titleText: string,
    subtitleText: string,
    dateRange: string,
    bodyLines: string[],
  ) => {
    const sidePadding = 14;
    const textMaxWidth = panelWidth - sidePadding * 2;
    const dateColumnWidth = 116;
    const textColumnWidth = textMaxWidth - dateColumnWidth - (dateRange ? 12 : 0);
    const rows: PanelRow[] = [];

    wrapText(titleText, fonts.bold, 12, textColumnWidth).forEach((line, index) => {
      rows.push({
        gapBefore: 0,
        height: 14,
        draw: (y) => {
          composer.currentPage.drawText(line, {
            x: panelX + sidePadding,
            y,
            size: 12,
            font: fonts.bold,
            color: rgb(0.14, 0.18, 0.25),
          });
          if (index === 0 && dateRange) {
            composer.currentPage.drawText(dateRange, {
              x: panelX + panelWidth - sidePadding - dateColumnWidth,
              y: y + 1,
              size: 9.8,
              font: fonts.regular,
              color: rgb(0.39, 0.45, 0.52),
            });
          }
        },
      });
    });

    if (subtitleText) {
      wrapText(subtitleText, fonts.regular, 10.4, textColumnWidth).forEach((line, index) => {
        rows.push({
          gapBefore: index === 0 ? 2 : 0,
          height: 12,
          draw: (y) => {
            composer.currentPage.drawText(line, {
              x: panelX + sidePadding,
              y,
              size: 10.4,
              font: fonts.regular,
              color: rgb(0.33, 0.38, 0.44),
            });
          },
        });
      });
    }

    bodyLines.forEach((bodyLine, blockIndex) => {
      wrapText(bodyLine, fonts.regular, 10.1, textMaxWidth - 12).forEach((line, lineIndex) => {
        rows.push({
          gapBefore: lineIndex > 0 ? 0 : blockIndex === 0 ? 5 : 2,
          height: 13,
          draw: (y) => {
            if (lineIndex === 0) {
              composer.currentPage.drawText("•", {
                x: panelX + sidePadding,
                y,
                size: 10.1,
                font: fonts.bold,
                color: rgb(0.2, 0.25, 0.33),
              });
            }
            composer.currentPage.drawText(line, {
              x: panelX + sidePadding + 12,
              y,
              size: 10.1,
              font: fonts.regular,
              color: rgb(0.2, 0.25, 0.33),
            });
          },
        });
      });
    });

    drawPanel(rows, {
      padding: 16,
      minHeight: 52,
      fill: rgb(0.98, 0.99, 1),
      accentBar: true,
      spacingAfter: 6,
    });
  };

  if (sanitizeText(cv.profileLabel) && sanitizeText(cv.profile)) {
    drawSectionHeading(cv.profileLabel);
    const rows = wrapText(cv.profile, fonts.regular, 10.5, panelWidth - 28).map(
      (line): PanelRow =>
        line === ""
          ? { gapBefore: 0, height: 10, draw: () => undefined }
          : {
              gapBefore: 0,
              height: 15,
              draw: (y) => {
                composer.currentPage.drawText(line, {
                  x: panelX + 14,
                  y,
                  size: 10.5,
                  font: fonts.regular,
                  color: rgb(0.2, 0.25, 0.33),
                });
              },
            },
    );
    drawPanel(rows, {
      padding: 12,
      minHeight: 54,
      fill: rgb(0.96, 0.99, 1),
      accentBar: false,
      spacingAfter: 8,
    });
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
  const signatureText = draft.template === "invoice" ? sanitizeText(draft.invoice.signature) : "";
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    mono: await pdfDoc.embedFont(StandardFonts.Courier),
    signature: await embedInvoiceSignatureFont(pdfDoc, Boolean(signatureText)),
  };

  const pageSize = getPageDimensions(draft.pageSize, draft.orientation);
  const logo = await embedLogo(pdfDoc, draft.logoDataUrl);
  const watermark = await resolvePdfWatermark(pdfDoc, draft, logo, fonts.bold);
  const composer = new DocumentComposer(pdfDoc, pageSize, draft.accentColor, watermark);

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
    case "payslip":
      await renderInvoice(composer, draft, fonts, logo);
      pdfDoc.setTitle(sanitizeText(draft.payslip.payslipNumber) || "Payslip");
      pdfDoc.setAuthor(sanitizeText(draft.payslip.companyName) || "Kyte");
      pdfDoc.setSubject("Payslip");
      pdfDoc.setKeywords(["Kyte PDF", "payslip"]);
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

  if (draft.template === "invoice" || draft.template === "payslip") {
    const financialDocument =
      draft.template === "invoice"
        ? { ...draft.invoice, copyrightNote: "" }
        : {
            companyReference: draft.payslip.companyReference,
            copyrightNote: draft.payslip.copyrightNote,
            footerLogoPosition: draft.payslip.footerLogoPosition,
          };
    drawInvoiceFooter(composer, fonts.regular, getReadableAccentTextColor(draft.accentColor), {
      reference: sanitizeText(financialDocument.companyReference),
      copyrightNote: sanitizeText(financialDocument.copyrightNote),
      includePageNumbers: draft.includePageNumbers,
      logo,
      logoPosition: normalizeInvoiceFooterLogoPosition(financialDocument.footerLogoPosition),
    });
  } else if (draft.includePageNumbers) {
    drawPageNumbers(composer, fonts.regular, rgb(0.52, 0.58, 0.65));
  }

  return {
    bytes: await serializePdf(pdfDoc),
    pageCount: composer.pageCount,
    outputName: `${normalizeFileName(draft.fileName)}.pdf`,
  };
}

/**
 * pdfCreatorWorkflow.ts
 *
 * Pure, DOM-free business logic extracted from components/PdfCreator.ts.
 * All functions are side-effect-free and can be unit-tested without jsdom.
 *
 * The Web Component stays as the thin shell that:
 *   1. Calls render() to produce HTML
 *   2. Binds DOM events
 *   3. Delegates mutations to functions in this file
 */

import {
  CREATOR_SOURCES_TEXT_POSITIONS,
  type CreatorCvEducation,
  type CreatorCvExperience,
  type CreatorCvExtraSection,
  type CreatorInvoiceItem,
  type CreatorSection,
  createDefaultCreatorDraft,
  createDefaultCvEducation,
  createDefaultCvExperience,
  createDefaultCvExtraSection,
  createDefaultInvoiceItem,
  createDefaultLetterParagraph,
  createDefaultReportSection,
  getTemplateLabel,
  normalizeInvoiceDetailsAlignment,
  normalizeInvoiceFooterLogoPosition,
  normalizeInvoiceStatus,
  normalizeWatermarkSource,
  normalizeWatermarkStyle,
  PDF_CREATOR_CURRENCIES,
  PDF_CREATOR_MODES,
  PDF_CREATOR_ORIENTATIONS,
  PDF_CREATOR_PAGE_SIZES,
  PDF_CREATOR_TEMPLATES,
  type PdfCreatorCurrency,
  type PdfCreatorDraft,
  type PdfCreatorTemplate,
} from "./pdfCreator.ts";
import type { SourcesProgress } from "./pdfFromSources.ts";
import { moveArrayItem } from "./pdfUtils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DraftState = "idle" | "saving" | "saved" | "restored";

export interface DraftValidationResult {
  isValid: boolean;
  /** Human-readable summary shown in the action bar */
  summaryText: string;
}

// ---------------------------------------------------------------------------
// Draft status label
// ---------------------------------------------------------------------------

/**
 * Returns the text shown next to the "Local draft" label.
 * Pure: depends only on `state`.
 */
export function getDraftStatusText(state: DraftState): string {
  switch (state) {
    case "saving":
      return "Saving your draft locally...";
    case "saved":
      return "Draft saved locally.";
    case "restored":
      return "Previous draft restored from this browser.";
    default:
      return "Changes will be saved locally as you edit.";
  }
}

// ---------------------------------------------------------------------------
// Summary text
// ---------------------------------------------------------------------------

/**
 * Computes the short summary line shown above the Create button.
 * Pure: depends only on the draft and current preview page count.
 */
/** Status line for the progress bar while a PDF is built from text and files. */
export function describeSourcesProgress(progress: SourcesProgress): string {
  switch (progress.stage) {
    case "saving":
      return "Saving PDF...";
    case "done":
      return "Finishing up...";
    default: {
      const verb = { reading: "Reading", converting: "Converting", adding: "Adding" }[
        progress.stage
      ];
      return `${verb} ${progress.name} (${progress.index + 1} of ${progress.total})...`;
    }
  }
}

/** The heading for what is being made: the template name, or "Your own content". */
export function getCreatorLabel(draft: Pick<PdfCreatorDraft, "mode" | "template">): string {
  return draft.mode === "sources" ? SOURCES_MODE_LABEL : getTemplateLabel(draft.template);
}

export const SOURCES_MODE_LABEL = "Your own content";

export function computeSummaryText(
  draft: PdfCreatorDraft,
  previewPageCount: number | null,
): string {
  const base = `${getCreatorLabel(draft)} · ${draft.pageSize.toUpperCase()} ${draft.orientation}`;
  if (previewPageCount) {
    return `${base} · ${previewPageCount} preview page${previewPageCount === 1 ? "" : "s"}`;
  }
  return `${base} · Preview updates automatically`;
}

// ---------------------------------------------------------------------------
// Preview meta text
// ---------------------------------------------------------------------------

/**
 * Returns the small meta line shown below the Live Preview heading.
 */
export function computePreviewMetaText(
  previewPageCount: number | null,
  outputName: string | null,
): string {
  if (previewPageCount && outputName) {
    return `${previewPageCount} page${previewPageCount === 1 ? "" : "s"} · ${outputName}`;
  }
  if (previewPageCount) {
    return `${previewPageCount} page${previewPageCount === 1 ? "" : "s"} ready`;
  }
  return "Preview updates automatically while you edit.";
}

// ---------------------------------------------------------------------------
// Draft normalization
// ---------------------------------------------------------------------------

/**
 * Merges a partially-saved draft (from IndexedDB) with current defaults,
 * filling in any missing fields added since the draft was first saved.
 *
 * Pure: takes a value and returns a normalized draft.
 */
const pickAllowed = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

export function normalizeDraft(value: Partial<PdfCreatorDraft>): PdfCreatorDraft {
  const defaults = createDefaultCreatorDraft();
  return {
    ...defaults,
    ...value,
    mode: pickAllowed(value.mode, PDF_CREATOR_MODES, defaults.mode),
    template: pickAllowed(value.template, PDF_CREATOR_TEMPLATES, defaults.template),
    pageSize: pickAllowed(value.pageSize, PDF_CREATOR_PAGE_SIZES, defaults.pageSize),
    orientation: pickAllowed(value.orientation, PDF_CREATOR_ORIENTATIONS, defaults.orientation),
    report: {
      ...defaults.report,
      ...value.report,
      sections:
        value.report?.sections && value.report.sections.length > 0
          ? value.report.sections.map((section) => ({
              id: section.id || createDefaultReportSection().id,
              heading: section.heading ?? "",
              body: section.body ?? "",
            }))
          : defaults.report.sections,
    },
    letter: {
      ...defaults.letter,
      ...value.letter,
      paragraphs:
        value.letter?.paragraphs && value.letter.paragraphs.length > 0
          ? value.letter.paragraphs.map((paragraph) => ({
              id: paragraph.id || createDefaultLetterParagraph().id,
              text: paragraph.text ?? "",
            }))
          : defaults.letter.paragraphs,
    },
    invoice: {
      ...defaults.invoice,
      ...value.invoice,
      companyReference: value.invoice?.companyReference ?? defaults.invoice.companyReference,
      detailsValueAlignment: normalizeInvoiceDetailsAlignment(value.invoice?.detailsValueAlignment),
      footerLogoPosition: normalizeInvoiceFooterLogoPosition(value.invoice?.footerLogoPosition),
      includeBusinessNameInHeader:
        value.invoice?.includeBusinessNameInHeader ??
        (value.invoice as { includeHeader?: boolean } | undefined)?.includeHeader ??
        defaults.invoice.includeBusinessNameInHeader,
      headerTextColor: value.invoice?.headerTextColor ?? defaults.invoice.headerTextColor,
      status: normalizeInvoiceStatus(value.invoice?.status),
      currency: pickAllowed(
        value.invoice?.currency,
        PDF_CREATOR_CURRENCIES,
        defaults.invoice.currency,
      ),
      paidDate: value.invoice?.paidDate ?? defaults.invoice.paidDate,
      paymentDetails: value.invoice?.paymentDetails ?? defaults.invoice.paymentDetails,
      paymentLink: value.invoice?.paymentLink ?? defaults.invoice.paymentLink,
      signature: value.invoice?.signature ?? defaults.invoice.signature,
      lineItems:
        value.invoice?.lineItems && value.invoice.lineItems.length > 0
          ? value.invoice.lineItems.map((item) => ({
              id: item.id || createDefaultInvoiceItem().id,
              description: item.description ?? "",
              quantity: Number.isFinite(item.quantity) ? item.quantity : 0,
              unitPrice: Number.isFinite(item.unitPrice) ? item.unitPrice : 0,
            }))
          : defaults.invoice.lineItems,
    },
    payslip: {
      ...defaults.payslip,
      ...value.payslip,
      companyReference: value.payslip?.companyReference ?? defaults.payslip.companyReference,
      copyrightNote: value.payslip?.copyrightNote ?? defaults.payslip.copyrightNote,
      detailsValueAlignment: normalizeInvoiceDetailsAlignment(value.payslip?.detailsValueAlignment),
      footerLogoPosition: normalizeInvoiceFooterLogoPosition(value.payslip?.footerLogoPosition),
      includeCompanyNameInHeader:
        value.payslip?.includeCompanyNameInHeader ?? defaults.payslip.includeCompanyNameInHeader,
      headerTextColor: value.payslip?.headerTextColor ?? defaults.payslip.headerTextColor,
      currency: pickAllowed(
        value.payslip?.currency,
        PDF_CREATOR_CURRENCIES,
        defaults.payslip.currency,
      ),
      lineItems:
        value.payslip?.lineItems && value.payslip.lineItems.length > 0
          ? value.payslip.lineItems.map((item) => ({
              id: item.id || createDefaultInvoiceItem().id,
              description: item.description ?? "",
              quantity: Number.isFinite(item.quantity) ? item.quantity : 0,
              unitPrice: Number.isFinite(item.unitPrice) ? item.unitPrice : 0,
            }))
          : defaults.payslip.lineItems,
      deductions:
        value.payslip?.deductions && value.payslip.deductions.length > 0
          ? value.payslip.deductions.map((item) => ({
              id: item.id || createDefaultInvoiceItem().id,
              description: item.description ?? "",
              quantity: Number.isFinite(item.quantity) ? item.quantity : 0,
              unitPrice: Number.isFinite(item.unitPrice) ? item.unitPrice : 0,
            }))
          : defaults.payslip.deductions,
      watermark: {
        ...defaults.payslip.watermark,
        ...value.payslip?.watermark,
        enabled: value.payslip?.watermark?.enabled ?? defaults.payslip.watermark.enabled,
        source: normalizeWatermarkSource(value.payslip?.watermark?.source),
        style: normalizeWatermarkStyle(value.payslip?.watermark?.style),
        text: value.payslip?.watermark?.text ?? defaults.payslip.watermark.text,
        customImageDataUrl:
          value.payslip?.watermark?.customImageDataUrl ??
          defaults.payslip.watermark.customImageDataUrl,
        customImageFileName:
          value.payslip?.watermark?.customImageFileName ??
          defaults.payslip.watermark.customImageFileName,
        opacity: Number.isFinite(value.payslip?.watermark?.opacity)
          ? Math.min(60, Math.max(1, value.payslip!.watermark.opacity))
          : defaults.payslip.watermark.opacity,
        size: Number.isFinite(value.payslip?.watermark?.size)
          ? Math.min(90, Math.max(10, value.payslip!.watermark.size))
          : defaults.payslip.watermark.size,
        rotation: Number.isFinite(value.payslip?.watermark?.rotation)
          ? Math.min(180, Math.max(-180, value.payslip!.watermark.rotation))
          : defaults.payslip.watermark.rotation,
        grayscale: value.payslip?.watermark?.grayscale ?? defaults.payslip.watermark.grayscale,
      },
    },
    sources: {
      text: typeof value.sources?.text === "string" ? value.sources.text : defaults.sources.text,
      markdown:
        typeof value.sources?.markdown === "boolean"
          ? value.sources.markdown
          : defaults.sources.markdown,
      textPosition: pickAllowed(
        value.sources?.textPosition,
        CREATOR_SOURCES_TEXT_POSITIONS,
        defaults.sources.textPosition,
      ),
    },
    cv: {
      ...defaults.cv,
      ...value.cv,
      experiences:
        value.cv?.experiences && value.cv.experiences.length > 0
          ? value.cv.experiences.map((entry) => ({
              id: entry.id || createDefaultCvExperience().id,
              role: entry.role ?? "",
              organization: entry.organization ?? "",
              location: entry.location ?? "",
              startDate: entry.startDate ?? "",
              endDate: entry.endDate ?? "",
              achievements: entry.achievements ?? "",
            }))
          : defaults.cv.experiences,
      education:
        value.cv?.education && value.cv.education.length > 0
          ? value.cv.education.map((entry) => ({
              id: entry.id || createDefaultCvEducation().id,
              qualification: entry.qualification ?? "",
              institution: entry.institution ?? "",
              location: entry.location ?? "",
              startDate: entry.startDate ?? "",
              endDate: entry.endDate ?? "",
              details: entry.details ?? "",
            }))
          : defaults.cv.education,
      additionalSections:
        value.cv?.additionalSections && value.cv.additionalSections.length > 0
          ? value.cv.additionalSections.map((section) => ({
              id: section.id || createDefaultCvExtraSection().id,
              title: section.title ?? "",
              body: section.body ?? "",
            }))
          : defaults.cv.additionalSections,
    },
  };
}

// ---------------------------------------------------------------------------
// Invoice total display helpers
// ---------------------------------------------------------------------------

/**
 * Formats an amount in the editor's locale, as shown next to the line items.
 */
export function formatCurrencyAmount(value: number, currency: PdfCreatorCurrency): string {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
}

// ---------------------------------------------------------------------------
// Collection mutation helpers (pure — return new arrays, never mutate)
// ---------------------------------------------------------------------------

/**
 * Removes an item from a collection by id. Returns null if removal would
 * leave the collection empty (minimum-of-one guard).
 */
export function removeCollectionItem<T extends { id: string }>(items: T[], id: string): T[] | null {
  const next = items.filter((item) => item.id !== id);
  return next.length === 0 ? null : next;
}

/**
 * Moves an item up (-1) or down (+1) in a collection by id.
 * Returns the original array unchanged if the move is a no-op.
 */
export function moveCollectionItem<T extends { id: string }>(
  items: T[],
  id: string,
  direction: -1 | 1,
): T[] {
  const index = items.findIndex((item) => item.id === id);
  if (direction === -1 && index < 1) return items;
  if (direction === 1 && (index < 0 || index === items.length - 1)) return items;
  return moveArrayItem(items, index, direction);
}

// ---------------------------------------------------------------------------
// Report section helpers
// ---------------------------------------------------------------------------

export function addReportSection(draft: PdfCreatorDraft): PdfCreatorDraft {
  return {
    ...draft,
    report: {
      ...draft.report,
      sections: [...draft.report.sections, createDefaultReportSection()],
    },
  };
}

export function removeReportSection(draft: PdfCreatorDraft, id: string): PdfCreatorDraft | null {
  const next = removeCollectionItem(draft.report.sections, id);
  if (!next) return null;
  return { ...draft, report: { ...draft.report, sections: next } };
}

export function moveReportSection(
  draft: PdfCreatorDraft,
  id: string,
  direction: -1 | 1,
): PdfCreatorDraft {
  return {
    ...draft,
    report: {
      ...draft.report,
      sections: moveCollectionItem(draft.report.sections, id, direction) as CreatorSection[],
    },
  };
}

// ---------------------------------------------------------------------------
// Letter paragraph helpers
// ---------------------------------------------------------------------------

export function addLetterParagraph(draft: PdfCreatorDraft): PdfCreatorDraft {
  return {
    ...draft,
    letter: {
      ...draft.letter,
      paragraphs: [...draft.letter.paragraphs, createDefaultLetterParagraph()],
    },
  };
}

export function removeLetterParagraph(draft: PdfCreatorDraft, id: string): PdfCreatorDraft | null {
  const next = removeCollectionItem(draft.letter.paragraphs, id);
  if (!next) return null;
  return { ...draft, letter: { ...draft.letter, paragraphs: next } };
}

export function moveLetterParagraph(
  draft: PdfCreatorDraft,
  id: string,
  direction: -1 | 1,
): PdfCreatorDraft {
  return {
    ...draft,
    letter: {
      ...draft.letter,
      paragraphs: moveCollectionItem(draft.letter.paragraphs, id, direction),
    },
  };
}

// ---------------------------------------------------------------------------
// Invoice line-item helpers
// ---------------------------------------------------------------------------

export function addInvoiceItem(draft: PdfCreatorDraft): PdfCreatorDraft {
  return {
    ...draft,
    invoice: {
      ...draft.invoice,
      lineItems: [...draft.invoice.lineItems, createDefaultInvoiceItem()],
    },
  };
}

export function removeInvoiceItem(draft: PdfCreatorDraft, id: string): PdfCreatorDraft | null {
  const next = removeCollectionItem(draft.invoice.lineItems, id);
  if (!next) return null;
  return { ...draft, invoice: { ...draft.invoice, lineItems: next } };
}

export function moveInvoiceItem(
  draft: PdfCreatorDraft,
  id: string,
  direction: -1 | 1,
): PdfCreatorDraft {
  return {
    ...draft,
    invoice: {
      ...draft.invoice,
      lineItems: moveCollectionItem(draft.invoice.lineItems, id, direction) as CreatorInvoiceItem[],
    },
  };
}

// ---------------------------------------------------------------------------
// Payslip earning helpers
// ---------------------------------------------------------------------------

export function addPayslipItem(draft: PdfCreatorDraft): PdfCreatorDraft {
  return {
    ...draft,
    payslip: {
      ...draft.payslip,
      lineItems: [
        ...draft.payslip.lineItems,
        createDefaultInvoiceItem({ description: "Earning", unitPrice: 0 }),
      ],
    },
  };
}

export function removePayslipItem(draft: PdfCreatorDraft, id: string): PdfCreatorDraft | null {
  const next = removeCollectionItem(draft.payslip.lineItems, id);
  if (!next) return null;
  return { ...draft, payslip: { ...draft.payslip, lineItems: next } };
}

export function movePayslipItem(
  draft: PdfCreatorDraft,
  id: string,
  direction: -1 | 1,
): PdfCreatorDraft {
  return {
    ...draft,
    payslip: {
      ...draft.payslip,
      lineItems: moveCollectionItem(draft.payslip.lineItems, id, direction) as CreatorInvoiceItem[],
    },
  };
}

export function addPayslipDeduction(draft: PdfCreatorDraft): PdfCreatorDraft {
  return {
    ...draft,
    payslip: {
      ...draft.payslip,
      deductions: [
        ...draft.payslip.deductions,
        createDefaultInvoiceItem({ description: "Deduction", unitPrice: 0 }),
      ],
    },
  };
}

export function removePayslipDeduction(draft: PdfCreatorDraft, id: string): PdfCreatorDraft | null {
  const next = removeCollectionItem(draft.payslip.deductions, id);
  if (!next) return null;
  return { ...draft, payslip: { ...draft.payslip, deductions: next } };
}

export function movePayslipDeduction(
  draft: PdfCreatorDraft,
  id: string,
  direction: -1 | 1,
): PdfCreatorDraft {
  return {
    ...draft,
    payslip: {
      ...draft.payslip,
      deductions: moveCollectionItem(
        draft.payslip.deductions,
        id,
        direction,
      ) as CreatorInvoiceItem[],
    },
  };
}

// ---------------------------------------------------------------------------
// CV collection helpers
// ---------------------------------------------------------------------------

export function addCvExperience(draft: PdfCreatorDraft): PdfCreatorDraft {
  return {
    ...draft,
    cv: { ...draft.cv, experiences: [...draft.cv.experiences, createDefaultCvExperience()] },
  };
}

export function removeCvExperience(draft: PdfCreatorDraft, id: string): PdfCreatorDraft | null {
  const next = removeCollectionItem(draft.cv.experiences, id);
  if (!next) return null;
  return { ...draft, cv: { ...draft.cv, experiences: next as CreatorCvExperience[] } };
}

export function moveCvExperience(
  draft: PdfCreatorDraft,
  id: string,
  direction: -1 | 1,
): PdfCreatorDraft {
  return {
    ...draft,
    cv: {
      ...draft.cv,
      experiences: moveCollectionItem(draft.cv.experiences, id, direction) as CreatorCvExperience[],
    },
  };
}

export function addCvEducation(draft: PdfCreatorDraft): PdfCreatorDraft {
  return {
    ...draft,
    cv: { ...draft.cv, education: [...draft.cv.education, createDefaultCvEducation()] },
  };
}

export function removeCvEducation(draft: PdfCreatorDraft, id: string): PdfCreatorDraft | null {
  const next = removeCollectionItem(draft.cv.education, id);
  if (!next) return null;
  return { ...draft, cv: { ...draft.cv, education: next as CreatorCvEducation[] } };
}

export function moveCvEducation(
  draft: PdfCreatorDraft,
  id: string,
  direction: -1 | 1,
): PdfCreatorDraft {
  return {
    ...draft,
    cv: {
      ...draft.cv,
      education: moveCollectionItem(draft.cv.education, id, direction) as CreatorCvEducation[],
    },
  };
}

export function addCvExtraSection(draft: PdfCreatorDraft): PdfCreatorDraft {
  return {
    ...draft,
    cv: {
      ...draft.cv,
      additionalSections: [...draft.cv.additionalSections, createDefaultCvExtraSection()],
    },
  };
}

export function removeCvExtraSection(draft: PdfCreatorDraft, id: string): PdfCreatorDraft | null {
  const next = removeCollectionItem(draft.cv.additionalSections, id);
  if (!next) return null;
  return { ...draft, cv: { ...draft.cv, additionalSections: next as CreatorCvExtraSection[] } };
}

export function moveCvExtraSection(
  draft: PdfCreatorDraft,
  id: string,
  direction: -1 | 1,
): PdfCreatorDraft {
  return {
    ...draft,
    cv: {
      ...draft.cv,
      additionalSections: moveCollectionItem(
        draft.cv.additionalSections,
        id,
        direction,
      ) as CreatorCvExtraSection[],
    },
  };
}

// ---------------------------------------------------------------------------
// Template change
// ---------------------------------------------------------------------------

/**
 * Applies a template switch, preserving all other draft fields.
 */
export function applyTemplateChange(
  draft: PdfCreatorDraft,
  template: PdfCreatorTemplate,
): PdfCreatorDraft {
  return { ...draft, template };
}

// ---------------------------------------------------------------------------
// Floating preview position helpers (pure geometry)
// ---------------------------------------------------------------------------

const FLOATING_PREVIEW_BREAKPOINT = 1280;
const FLOATING_PREVIEW_GUTTER = 24;
export const FLOATING_PREVIEW_TOP = 112;
export const FLOATING_PREVIEW_WIDTH = 420;
export const FLOATING_PREVIEW_HEIGHT = 560;

export interface PreviewPosition {
  x: number;
  y: number;
}

export interface ViewportSize {
  innerWidth: number;
  innerHeight: number;
}

/**
 * Returns whether the floating preview can be shown given the viewport width.
 */
export function canFloatPreview(viewport: Pick<ViewportSize, "innerWidth">): boolean {
  return viewport.innerWidth >= FLOATING_PREVIEW_BREAKPOINT;
}

/**
 * Clamps a floating preview position so it stays inside the visible viewport.
 */
export function clampFloatingPreviewPosition(
  position: PreviewPosition,
  viewport: ViewportSize,
  previewSize: { width: number; height: number } = {
    width: FLOATING_PREVIEW_WIDTH,
    height: FLOATING_PREVIEW_HEIGHT,
  },
): PreviewPosition {
  const maxX = Math.max(
    FLOATING_PREVIEW_GUTTER,
    viewport.innerWidth - previewSize.width - FLOATING_PREVIEW_GUTTER,
  );
  const maxY = Math.max(
    FLOATING_PREVIEW_GUTTER,
    viewport.innerHeight - previewSize.height - FLOATING_PREVIEW_GUTTER,
  );
  return {
    x: Math.min(Math.max(position.x, FLOATING_PREVIEW_GUTTER), maxX),
    y: Math.min(Math.max(position.y, FLOATING_PREVIEW_GUTTER), maxY),
  };
}

/**
 * Computes the default floating preview position anchored to the right of a
 * reference element rectangle (or the viewport right edge if no rect). With
 * `keepRightOf`, the preview starts at least a gutter to the right of that x,
 * so it does not cover the editor column (where Create and Download are).
 */
export function getDefaultFloatingPreviewPosition(
  viewport: ViewportSize,
  anchorRight: number | null,
  previewSize: { width: number; height: number } = {
    width: FLOATING_PREVIEW_WIDTH,
    height: FLOATING_PREVIEW_HEIGHT,
  },
  keepRightOf: number | null = null,
): PreviewPosition {
  const anchoredX =
    anchorRight != null
      ? anchorRight - previewSize.width - FLOATING_PREVIEW_GUTTER
      : viewport.innerWidth - previewSize.width - FLOATING_PREVIEW_GUTTER;
  const rawX =
    keepRightOf != null ? Math.max(anchoredX, keepRightOf + FLOATING_PREVIEW_GUTTER) : anchoredX;

  return clampFloatingPreviewPosition({ x: rawX, y: FLOATING_PREVIEW_TOP }, viewport, previewSize);
}

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
  type CreatorCvEducation,
  type CreatorCvExperience,
  type CreatorCvExtraSection,
  type CreatorInvoiceItem,
  type CreatorSection,
  calculateInvoiceTotal,
  createDefaultCreatorDraft,
  createDefaultCvEducation,
  createDefaultCvExperience,
  createDefaultCvExtraSection,
  createDefaultInvoiceItem,
  createDefaultLetterParagraph,
  createDefaultReportSection,
  getTemplateLabel,
  type PdfCreatorDraft,
  type PdfCreatorTemplate,
} from "./pdfCreator.ts";
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
export function computeSummaryText(
  draft: PdfCreatorDraft,
  previewPageCount: number | null,
): string {
  const base = `${getTemplateLabel(draft.template)} · ${draft.pageSize.toUpperCase()} ${draft.orientation}`;
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
export function normalizeDraft(value: Partial<PdfCreatorDraft>): PdfCreatorDraft {
  const defaults = createDefaultCreatorDraft();
  return {
    ...defaults,
    ...value,
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
      paymentDetails: value.invoice?.paymentDetails ?? defaults.invoice.paymentDetails,
      paymentLink: value.invoice?.paymentLink ?? defaults.invoice.paymentLink,
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
 * Formats the invoice total for display. Pure wrapper around calculateInvoiceTotal.
 */
export function formatInvoiceTotal(items: CreatorInvoiceItem[], currency: string): string {
  const total = calculateInvoiceTotal(items);
  return total.toLocaleString(undefined, {
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
const FLOATING_PREVIEW_TOP = 112;
const FLOATING_PREVIEW_WIDTH = 420;
const FLOATING_PREVIEW_HEIGHT = 560;

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
 * reference element rectangle (or the viewport right edge if no rect).
 */
export function getDefaultFloatingPreviewPosition(
  viewport: ViewportSize,
  anchorRight: number | null,
  previewSize: { width: number; height: number } = {
    width: FLOATING_PREVIEW_WIDTH,
    height: FLOATING_PREVIEW_HEIGHT,
  },
): PreviewPosition {
  const rawX =
    anchorRight != null
      ? anchorRight - previewSize.width - FLOATING_PREVIEW_GUTTER
      : viewport.innerWidth - previewSize.width - FLOATING_PREVIEW_GUTTER;

  return clampFloatingPreviewPosition({ x: rawX, y: FLOATING_PREVIEW_TOP }, viewport, previewSize);
}

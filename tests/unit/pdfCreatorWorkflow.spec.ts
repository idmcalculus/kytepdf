import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createDefaultCreatorDraft,
  createDefaultCvEducation,
  createDefaultCvExperience,
  createDefaultCvExtraSection,
  createDefaultInvoiceItem,
  createDefaultLetterParagraph,
  createDefaultReportSection,
} from "../../utils/pdfCreator.ts";
import {
  addCvEducation,
  addCvExperience,
  addCvExtraSection,
  addInvoiceItem,
  addLetterParagraph,
  addReportSection,
  applyTemplateChange,
  canFloatPreview,
  clampFloatingPreviewPosition,
  computePreviewMetaText,
  computeSummaryText,
  getDefaultFloatingPreviewPosition,
  getDraftStatusText,
  moveCollectionItem,
  moveCvEducation,
  moveCvExperience,
  moveCvExtraSection,
  moveInvoiceItem,
  moveLetterParagraph,
  moveReportSection,
  normalizeDraft,
  removeCollectionItem,
  removeCvEducation,
  removeCvExperience,
  removeCvExtraSection,
  removeInvoiceItem,
  removeLetterParagraph,
  removeReportSection,
} from "../../utils/pdfCreatorWorkflow.ts";

// ---------------------------------------------------------------------------
// getDraftStatusText
// ---------------------------------------------------------------------------

describe("getDraftStatusText", () => {
  it('returns idle text for "idle"', () => {
    expect(getDraftStatusText("idle")).toContain("Changes will be saved");
  });

  it('returns saving text for "saving"', () => {
    expect(getDraftStatusText("saving")).toContain("Saving");
  });

  it('returns saved text for "saved"', () => {
    expect(getDraftStatusText("saved")).toContain("saved");
  });

  it('returns restored text for "restored"', () => {
    expect(getDraftStatusText("restored")).toContain("restored");
  });
});

// ---------------------------------------------------------------------------
// computeSummaryText
// ---------------------------------------------------------------------------

describe("computeSummaryText", () => {
  const draft = createDefaultCreatorDraft();

  it("includes template label, page size and orientation", () => {
    const text = computeSummaryText(draft, null);
    expect(text).toContain("LETTER");
    expect(text).toContain("portrait");
  });

  it("includes page count when known", () => {
    const text = computeSummaryText(draft, 3);
    expect(text).toContain("3 preview pages");
  });

  it("uses singular 'page' for 1 page", () => {
    const text = computeSummaryText(draft, 1);
    expect(text).toContain("1 preview page");
    expect(text).not.toContain("pages");
  });

  it("falls back when pageCount is null", () => {
    const text = computeSummaryText(draft, null);
    expect(text).toContain("Preview updates automatically");
  });
});

// ---------------------------------------------------------------------------
// computePreviewMetaText
// ---------------------------------------------------------------------------

describe("computePreviewMetaText", () => {
  it("returns pages + filename when both available", () => {
    const text = computePreviewMetaText(2, "report.pdf");
    expect(text).toContain("2 pages");
    expect(text).toContain("report.pdf");
  });

  it("returns pages ready when only count available", () => {
    const text = computePreviewMetaText(1, null);
    expect(text).toContain("1 page");
    expect(text).toContain("ready");
  });

  it("returns default text when nothing available", () => {
    const text = computePreviewMetaText(null, null);
    expect(text).toContain("Preview updates automatically");
  });
});

// ---------------------------------------------------------------------------
// normalizeDraft
// ---------------------------------------------------------------------------

describe("normalizeDraft", () => {
  it("fills defaults for completely empty object", () => {
    const result = normalizeDraft({});
    expect(result.template).toBe("report");
    expect(result.report.sections.length).toBeGreaterThan(0);
    expect(result.invoice.lineItems.length).toBeGreaterThan(0);
    expect(result.cv.experiences.length).toBeGreaterThan(0);
  });

  it("preserves existing template", () => {
    const result = normalizeDraft({ template: "invoice" });
    expect(result.template).toBe("invoice");
  });

  it("preserves existing report sections when non-empty", () => {
    const sections = [createDefaultReportSection({ heading: "Custom", body: "Content" })];
    const result = normalizeDraft({
      report: { title: "T", subtitle: "", author: "", summary: "", sections },
    });
    expect(result.report.sections).toHaveLength(1);
    expect(result.report.sections[0].heading).toBe("Custom");
  });

  it("falls back to defaults when report.sections is empty array", () => {
    const result = normalizeDraft({
      report: { title: "T", subtitle: "", author: "", summary: "", sections: [] },
    });
    expect(result.report.sections.length).toBeGreaterThan(0);
  });

  it("normalizes null/undefined fields in invoice line items", () => {
    const badItem = {
      id: "x",
      description: null as any,
      quantity: NaN,
      unitPrice: undefined as any,
    };
    const result = normalizeDraft({
      invoice: { ...createDefaultCreatorDraft().invoice, lineItems: [badItem] },
    });
    expect(result.invoice.lineItems[0].description).toBe("");
    expect(result.invoice.lineItems[0].quantity).toBe(0);
    expect(result.invoice.lineItems[0].unitPrice).toBe(0);
  });

  it("preserves paymentDetails and paymentLink", () => {
    const result = normalizeDraft({
      invoice: {
        ...createDefaultCreatorDraft().invoice,
        paymentDetails: "IBAN: XX00",
        paymentLink: "https://pay.example.com",
      },
    });
    expect(result.invoice.paymentDetails).toBe("IBAN: XX00");
    expect(result.invoice.paymentLink).toBe("https://pay.example.com");
  });

  it("normalizes null cv experience fields", () => {
    const badEntry = {
      id: "e1",
      role: null as any,
      organization: null as any,
      location: null as any,
      startDate: null as any,
      endDate: null as any,
      achievements: null as any,
    };
    const result = normalizeDraft({
      cv: { ...createDefaultCreatorDraft().cv, experiences: [badEntry] },
    });
    expect(result.cv.experiences[0].role).toBe("");
  });

  it("property: normalizeDraft is idempotent on a valid full draft", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("report", "letter", "invoice", "cv-harvard", "cv-modern"),
        (template) => {
          const base = createDefaultCreatorDraft();
          base.template = template as any;
          const once = normalizeDraft(base);
          const twice = normalizeDraft(once);
          expect(twice.template).toBe(once.template);
          expect(twice.report.sections).toHaveLength(once.report.sections.length);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// removeCollectionItem
// ---------------------------------------------------------------------------

describe("removeCollectionItem", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("removes the item with the given id", () => {
    const result = removeCollectionItem(items, "b");
    expect(result).toEqual([{ id: "a" }, { id: "c" }]);
  });

  it("returns null when removing the last item", () => {
    expect(removeCollectionItem([{ id: "only" }], "only")).toBeNull();
  });

  it("returns the original array when id not found", () => {
    const result = removeCollectionItem(items, "z");
    expect(result).toEqual(items);
  });
});

// ---------------------------------------------------------------------------
// moveCollectionItem
// ---------------------------------------------------------------------------

describe("moveCollectionItem", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("moves item up", () => {
    const result = moveCollectionItem(items, "b", -1);
    expect(result.map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("moves item down", () => {
    const result = moveCollectionItem(items, "b", 1);
    expect(result.map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("no-op when moving first item up", () => {
    const result = moveCollectionItem(items, "a", -1);
    expect(result).toBe(items); // reference equality — unchanged
  });

  it("no-op when moving last item down", () => {
    const result = moveCollectionItem(items, "c", 1);
    expect(result).toBe(items);
  });

  it("no-op when id not found moving down", () => {
    const result = moveCollectionItem(items, "z", 1);
    expect(result).toBe(items);
  });
});

// ---------------------------------------------------------------------------
// Report section mutations
// ---------------------------------------------------------------------------

describe("addReportSection", () => {
  it("appends a new section", () => {
    const draft = createDefaultCreatorDraft();
    const before = draft.report.sections.length;
    const result = addReportSection(draft);
    expect(result.report.sections).toHaveLength(before + 1);
  });

  it("does not mutate the original draft", () => {
    const draft = createDefaultCreatorDraft();
    addReportSection(draft);
    expect(draft.report.sections).toHaveLength(createDefaultCreatorDraft().report.sections.length);
  });
});

describe("removeReportSection", () => {
  it("removes an existing section", () => {
    const draft = createDefaultCreatorDraft();
    const id = draft.report.sections[0].id;
    const result = removeReportSection(draft, id);
    expect(result).not.toBeNull();
    expect(result!.report.sections.find((s) => s.id === id)).toBeUndefined();
  });

  it("returns null when section is the last one", () => {
    const draft = {
      ...createDefaultCreatorDraft(),
      report: { ...createDefaultCreatorDraft().report, sections: [createDefaultReportSection()] },
    };
    const id = draft.report.sections[0].id;
    expect(removeReportSection(draft, id)).toBeNull();
  });
});

describe("moveReportSection", () => {
  it("moves a section up", () => {
    const draft = createDefaultCreatorDraft();
    const ids = draft.report.sections.map((s) => s.id);
    const moved = moveReportSection(draft, ids[1], -1);
    expect(moved.report.sections[0].id).toBe(ids[1]);
  });
});

// ---------------------------------------------------------------------------
// Letter paragraph mutations
// ---------------------------------------------------------------------------

describe("addLetterParagraph", () => {
  it("appends a new paragraph", () => {
    const draft = createDefaultCreatorDraft();
    const before = draft.letter.paragraphs.length;
    const result = addLetterParagraph(draft);
    expect(result.letter.paragraphs).toHaveLength(before + 1);
  });
});

describe("removeLetterParagraph", () => {
  it("returns null on last paragraph", () => {
    const draft = {
      ...createDefaultCreatorDraft(),
      letter: {
        ...createDefaultCreatorDraft().letter,
        paragraphs: [createDefaultLetterParagraph()],
      },
    };
    expect(removeLetterParagraph(draft, draft.letter.paragraphs[0].id)).toBeNull();
  });
});

describe("moveLetterParagraph", () => {
  it("moves a paragraph down", () => {
    const draft = createDefaultCreatorDraft();
    const ids = draft.letter.paragraphs.map((p) => p.id);
    const moved = moveLetterParagraph(draft, ids[0], 1);
    expect(moved.letter.paragraphs[1].id).toBe(ids[0]);
  });
});

// ---------------------------------------------------------------------------
// Invoice line-item mutations
// ---------------------------------------------------------------------------

describe("addInvoiceItem", () => {
  it("appends a new line item", () => {
    const draft = createDefaultCreatorDraft();
    const before = draft.invoice.lineItems.length;
    expect(addInvoiceItem(draft).invoice.lineItems).toHaveLength(before + 1);
  });
});

describe("removeInvoiceItem", () => {
  it("returns null on last item", () => {
    const draft = {
      ...createDefaultCreatorDraft(),
      invoice: { ...createDefaultCreatorDraft().invoice, lineItems: [createDefaultInvoiceItem()] },
    };
    expect(removeInvoiceItem(draft, draft.invoice.lineItems[0].id)).toBeNull();
  });
});

describe("moveInvoiceItem", () => {
  it("moves an item up", () => {
    const draft = createDefaultCreatorDraft();
    const ids = draft.invoice.lineItems.map((i) => i.id);
    const moved = moveInvoiceItem(draft, ids[1], -1);
    expect(moved.invoice.lineItems[0].id).toBe(ids[1]);
  });
});

// ---------------------------------------------------------------------------
// CV collection mutations
// ---------------------------------------------------------------------------

describe("CV experience mutations", () => {
  it("addCvExperience appends", () => {
    const draft = createDefaultCreatorDraft();
    expect(addCvExperience(draft).cv.experiences.length).toBe(draft.cv.experiences.length + 1);
  });

  it("removeCvExperience returns null on last item", () => {
    const draft = {
      ...createDefaultCreatorDraft(),
      cv: { ...createDefaultCreatorDraft().cv, experiences: [createDefaultCvExperience()] },
    };
    expect(removeCvExperience(draft, draft.cv.experiences[0].id)).toBeNull();
  });

  it("moveCvExperience moves up", () => {
    const draft = createDefaultCreatorDraft();
    const ids = draft.cv.experiences.map((e) => e.id);
    const moved = moveCvExperience(draft, ids[1], -1);
    expect(moved.cv.experiences[0].id).toBe(ids[1]);
  });
});

describe("CV education mutations", () => {
  it("addCvEducation appends", () => {
    const draft = createDefaultCreatorDraft();
    expect(addCvEducation(draft).cv.education.length).toBe(draft.cv.education.length + 1);
  });

  it("removeCvEducation returns null on last item", () => {
    const draft = {
      ...createDefaultCreatorDraft(),
      cv: { ...createDefaultCreatorDraft().cv, education: [createDefaultCvEducation()] },
    };
    expect(removeCvEducation(draft, draft.cv.education[0].id)).toBeNull();
  });

  it("moveCvEducation is a no-op on single item", () => {
    const draft = {
      ...createDefaultCreatorDraft(),
      cv: { ...createDefaultCreatorDraft().cv, education: [createDefaultCvEducation()] },
    };
    const id = draft.cv.education[0].id;
    const moved = moveCvEducation(draft, id, -1);
    expect(moved.cv.education[0].id).toBe(id);
  });
});

describe("CV extra section mutations", () => {
  it("addCvExtraSection appends", () => {
    const draft = createDefaultCreatorDraft();
    expect(addCvExtraSection(draft).cv.additionalSections.length).toBe(
      draft.cv.additionalSections.length + 1,
    );
  });

  it("removeCvExtraSection removes correctly", () => {
    const draft = createDefaultCreatorDraft();
    const id = draft.cv.additionalSections[0].id;
    const before = draft.cv.additionalSections.length;
    const result = removeCvExtraSection(draft, id);
    if (before === 1) {
      expect(result).toBeNull();
    } else {
      expect(result!.cv.additionalSections.find((s) => s.id === id)).toBeUndefined();
    }
  });

  it("moveCvExtraSection down works", () => {
    const draft = createDefaultCreatorDraft();
    const draftWithTwo = addCvExtraSection({
      ...draft,
      cv: { ...draft.cv, additionalSections: [createDefaultCvExtraSection()] },
    });
    const ids = draftWithTwo.cv.additionalSections.map((s) => s.id);
    const moved = moveCvExtraSection(draftWithTwo, ids[0], 1);
    expect(moved.cv.additionalSections[1].id).toBe(ids[0]);
  });
});

// ---------------------------------------------------------------------------
// applyTemplateChange
// ---------------------------------------------------------------------------

describe("applyTemplateChange", () => {
  it("changes the template", () => {
    const draft = createDefaultCreatorDraft();
    const result = applyTemplateChange(draft, "invoice");
    expect(result.template).toBe("invoice");
  });

  it("preserves other draft fields", () => {
    const draft = createDefaultCreatorDraft();
    draft.fileName = "my-doc";
    const result = applyTemplateChange(draft, "letter");
    expect(result.fileName).toBe("my-doc");
  });
});

// ---------------------------------------------------------------------------
// Floating preview geometry
// ---------------------------------------------------------------------------

describe("canFloatPreview", () => {
  it("returns true at exactly the breakpoint (1280)", () => {
    expect(canFloatPreview({ innerWidth: 1280 })).toBe(true);
  });

  it("returns false below the breakpoint", () => {
    expect(canFloatPreview({ innerWidth: 1279 })).toBe(false);
  });

  it("returns true above the breakpoint", () => {
    expect(canFloatPreview({ innerWidth: 1920 })).toBe(true);
  });
});

describe("clampFloatingPreviewPosition", () => {
  const viewport = { innerWidth: 1440, innerHeight: 900 };
  const size = { width: 420, height: 560 };

  it("clamps x to gutter minimum (24)", () => {
    const result = clampFloatingPreviewPosition({ x: -100, y: 200 }, viewport, size);
    expect(result.x).toBe(24);
  });

  it("clamps y to gutter minimum (24)", () => {
    const result = clampFloatingPreviewPosition({ x: 200, y: -50 }, viewport, size);
    expect(result.y).toBe(24);
  });

  it("clamps x to maxX (viewport - width - gutter)", () => {
    const result = clampFloatingPreviewPosition({ x: 99999, y: 200 }, viewport, size);
    expect(result.x).toBe(viewport.innerWidth - size.width - 24);
  });

  it("clamps y to maxY (viewport - height - gutter)", () => {
    const result = clampFloatingPreviewPosition({ x: 200, y: 99999 }, viewport, size);
    expect(result.y).toBe(viewport.innerHeight - size.height - 24);
  });

  it("passes through positions already in bounds", () => {
    const result = clampFloatingPreviewPosition({ x: 300, y: 150 }, viewport, size);
    expect(result.x).toBe(300);
    expect(result.y).toBe(150);
  });

  it("property: clamped result is always within bounds", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 5000 }),
        fc.integer({ min: -1000, max: 5000 }),
        (x, y) => {
          const result = clampFloatingPreviewPosition({ x, y }, viewport, size);
          expect(result.x).toBeGreaterThanOrEqual(24);
          expect(result.y).toBeGreaterThanOrEqual(24);
          expect(result.x).toBeLessThanOrEqual(viewport.innerWidth - size.width - 24);
          expect(result.y).toBeLessThanOrEqual(viewport.innerHeight - size.height - 24);
        },
      ),
    );
  });
});

describe("getDefaultFloatingPreviewPosition", () => {
  const viewport = { innerWidth: 1440, innerHeight: 900 };
  const size = { width: 420, height: 560 };

  it("anchors to provided anchorRight", () => {
    const result = getDefaultFloatingPreviewPosition(viewport, 1200, size);
    // x should be anchorRight - width - gutter, clamped
    const expected = 1200 - 420 - 24;
    expect(result.x).toBe(Math.min(Math.max(expected, 24), viewport.innerWidth - 420 - 24));
  });

  it("uses viewport right edge when anchorRight is null", () => {
    const result = getDefaultFloatingPreviewPosition(viewport, null, size);
    expect(result.x).toBe(viewport.innerWidth - 420 - 24);
  });

  it("top position is FLOATING_PREVIEW_TOP (112) when in bounds", () => {
    const result = getDefaultFloatingPreviewPosition(viewport, null, size);
    expect(result.y).toBe(112);
  });
});

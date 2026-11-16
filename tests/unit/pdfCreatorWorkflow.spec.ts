import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  calculateInvoiceTotal,
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
  addPayslipDeduction,
  addPayslipItem,
  addReportSection,
  applyTemplateChange,
  canFloatPreview,
  clampFloatingPreviewPosition,
  computePreviewMetaText,
  computeSummaryText,
  formatCurrencyAmount,
  getDefaultFloatingPreviewPosition,
  getDraftStatusText,
  moveCollectionItem,
  moveCvEducation,
  moveCvExperience,
  moveCvExtraSection,
  moveInvoiceItem,
  moveLetterParagraph,
  movePayslipDeduction,
  movePayslipItem,
  moveReportSection,
  normalizeDraft,
  removeCollectionItem,
  removeCvEducation,
  removeCvExperience,
  removeCvExtraSection,
  removeInvoiceItem,
  removeLetterParagraph,
  removePayslipDeduction,
  removePayslipItem,
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

  it("uses the singular with a file name and the plural without one", () => {
    expect(computePreviewMetaText(1, "invoice.pdf")).toBe("1 page · invoice.pdf");
    expect(computePreviewMetaText(3, null)).toBe("3 pages ready");
  });
});

// ---------------------------------------------------------------------------
// formatCurrencyAmount
// ---------------------------------------------------------------------------

describe("formatCurrencyAmount", () => {
  const format = (value: number, currency: string) =>
    value.toLocaleString(undefined, { style: "currency", currency, maximumFractionDigits: 2 });

  it("formats an amount in the chosen currency, rounded to pence or cents", () => {
    expect(formatCurrencyAmount(541.5, "GBP")).toBe(format(541.5, "GBP"));
    expect(formatCurrencyAmount(1234.567, "EUR")).toBe(format(1234.57, "EUR"));
    expect(formatCurrencyAmount(0, "USD")).toBe(format(0, "USD"));
  });

  it("shows invoice totals that ignore negative and non-finite amounts", () => {
    const items = [
      createDefaultInvoiceItem({ quantity: 1, unitPrice: 100 }),
      createDefaultInvoiceItem({ quantity: -4, unitPrice: 50 }),
      createDefaultInvoiceItem({ quantity: 2, unitPrice: Number.NaN }),
      createDefaultInvoiceItem({ quantity: Number.POSITIVE_INFINITY, unitPrice: 9 }),
    ];

    expect(formatCurrencyAmount(calculateInvoiceTotal(items), "USD")).toBe(format(100, "USD"));
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
    expect(result.payslip.lineItems.length).toBeGreaterThan(0);
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

  it("preserves payslip fields and normalizes invalid earning values", () => {
    const result = normalizeDraft({
      payslip: {
        ...createDefaultCreatorDraft().payslip,
        companyName: "Northstar Ltd",
        employeeName: "Morgan Lee",
        companyReference: "PAYROLL-REF-42",
        copyrightNote: "© 2026 Northstar Ltd.",
        detailsValueAlignment: "left",
        footerLogoPosition: "right",
        includeCompanyNameInHeader: false,
        headerTextColor: "#00aa55",
        payPeriod: "June 2026",
        watermark: {
          ...createDefaultCreatorDraft().payslip.watermark,
          source: "invalid" as any,
          style: "invalid" as any,
          customImageDataUrl: "data:image/png;base64,AQID",
          customImageFileName: "watermark.png",
          opacity: 99,
          size: 5,
          rotation: 999,
          grayscale: true,
        },
        lineItems: [
          {
            id: "earning-1",
            description: undefined as any,
            quantity: Number.NaN,
            unitPrice: Number.POSITIVE_INFINITY,
          },
        ],
        deductions: [
          {
            id: "deduction-1",
            description: null as any,
            quantity: Number.NaN,
            unitPrice: undefined as any,
          },
        ],
      },
    });

    expect(result.payslip.companyName).toBe("Northstar Ltd");
    expect(result.payslip.employeeName).toBe("Morgan Lee");
    expect(result.payslip.companyReference).toBe("PAYROLL-REF-42");
    expect(result.payslip.copyrightNote).toBe("© 2026 Northstar Ltd.");
    expect(result.payslip.detailsValueAlignment).toBe("left");
    expect(result.payslip.footerLogoPosition).toBe("right");
    expect(result.payslip.includeCompanyNameInHeader).toBe(false);
    expect(result.payslip.headerTextColor).toBe("#00aa55");
    expect(result.payslip.payPeriod).toBe("June 2026");
    expect(result.payslip.watermark).toEqual(
      expect.objectContaining({
        source: "company-logo",
        style: "centered",
        customImageDataUrl: "data:image/png;base64,AQID",
        customImageFileName: "watermark.png",
        opacity: 60,
        size: 10,
        rotation: 180,
        grayscale: true,
      }),
    );
    expect(result.payslip.lineItems[0]).toEqual({
      id: "earning-1",
      description: "",
      quantity: 0,
      unitPrice: 0,
    });
    expect(result.payslip.deductions[0]).toEqual({
      id: "deduction-1",
      description: "",
      quantity: 0,
      unitPrice: 0,
    });
  });

  it("preserves optional invoice metadata fields", () => {
    const result = normalizeDraft({
      invoice: {
        ...createDefaultCreatorDraft().invoice,
        companyReference: "DEEL REF: 5099601",
        detailsValueAlignment: "left",
        footerLogoPosition: "center",
        includeBusinessNameInHeader: false,
        headerTextColor: "#111827",
        status: "paid",
        paidDate: "2022-11-09",
        paymentDetails: "IBAN: XX00",
        paymentLink: "https://pay.example.com",
        signature: "Habeeb Tijani",
      },
    });
    expect(result.invoice.companyReference).toBe("DEEL REF: 5099601");
    expect(result.invoice.detailsValueAlignment).toBe("left");
    expect(result.invoice.footerLogoPosition).toBe("center");
    expect(result.invoice.includeBusinessNameInHeader).toBe(false);
    expect(result.invoice.headerTextColor).toBe("#111827");
    expect(result.invoice.status).toBe("paid");
    expect(result.invoice.paidDate).toBe("2022-11-09");
    expect(result.invoice.paymentDetails).toBe("IBAN: XX00");
    expect(result.invoice.paymentLink).toBe("https://pay.example.com");
    expect(result.invoice.signature).toBe("Habeeb Tijani");
  });

  it("falls back to pending for invalid saved invoice status", () => {
    const result = normalizeDraft({
      invoice: {
        ...createDefaultCreatorDraft().invoice,
        status: "unknown" as any,
      },
    });
    expect(result.invoice.status).toBe("pending");
  });

  it("falls back to right-aligned invoice details for invalid saved alignment", () => {
    const result = normalizeDraft({
      invoice: {
        ...createDefaultCreatorDraft().invoice,
        detailsValueAlignment: "centre" as any,
      },
    });
    expect(result.invoice.detailsValueAlignment).toBe("right");
  });

  it("falls back to no footer logo for an invalid saved position", () => {
    const result = normalizeDraft({
      invoice: {
        ...createDefaultCreatorDraft().invoice,
        footerLogoPosition: "bottom" as any,
      },
    });
    expect(result.invoice.footerLogoPosition).toBe("none");
  });

  it("migrates the old invoice header toggle to business-name visibility", () => {
    const legacyInvoice = {
      ...createDefaultCreatorDraft().invoice,
      includeBusinessNameInHeader: undefined,
      includeHeader: false,
    };
    const result = normalizeDraft({ invoice: legacyInvoice as any });

    expect(result.invoice.includeBusinessNameInHeader).toBe(false);
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

  it("gives saved items without ids fresh unique ids and blanks their missing text", () => {
    const missing = undefined as any;
    const result = normalizeDraft({
      report: {
        ...createDefaultCreatorDraft().report,
        sections: [{ id: "", heading: missing, body: missing }],
      },
      letter: {
        ...createDefaultCreatorDraft().letter,
        paragraphs: [{ id: "", text: missing }],
      },
      invoice: {
        ...createDefaultCreatorDraft().invoice,
        lineItems: [
          { id: "", description: "Audit", quantity: 2, unitPrice: 300 },
          { id: "", description: "Support", quantity: 1, unitPrice: 90 },
        ],
      },
      payslip: {
        ...createDefaultCreatorDraft().payslip,
        lineItems: [{ id: "", description: "Salary", quantity: 1, unitPrice: 4000 }],
        deductions: [{ id: "", description: "Tax", quantity: 1, unitPrice: 800 }],
      },
      cv: {
        ...createDefaultCreatorDraft().cv,
        experiences: [{ id: "", role: "Designer" } as any],
        education: [{ id: "" } as any],
        additionalSections: [{ id: "", title: missing, body: missing }],
      },
    });

    const ids = [
      result.report.sections[0].id,
      result.letter.paragraphs[0].id,
      ...result.invoice.lineItems.map((item) => item.id),
      result.payslip.lineItems[0].id,
      result.payslip.deductions[0].id,
      result.cv.experiences[0].id,
      result.cv.education[0].id,
      result.cv.additionalSections[0].id,
    ];
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);

    expect(result.report.sections[0]).toEqual(expect.objectContaining({ heading: "", body: "" }));
    expect(result.letter.paragraphs[0].text).toBe("");
    expect(result.invoice.lineItems.map(({ quantity, unitPrice }) => quantity * unitPrice)).toEqual(
      [600, 90],
    );
    expect(result.payslip.lineItems[0].unitPrice).toBe(4000);
    expect(result.payslip.deductions[0].description).toBe("Tax");
    expect(result.cv.experiences[0]).toEqual(
      expect.objectContaining({
        role: "Designer",
        organization: "",
        location: "",
        startDate: "",
        endDate: "",
        achievements: "",
      }),
    );
    expect(result.cv.education[0]).toEqual(
      expect.objectContaining({
        qualification: "",
        institution: "",
        location: "",
        startDate: "",
        endDate: "",
        details: "",
      }),
    );
    expect(result.cv.additionalSections[0]).toEqual(
      expect.objectContaining({ title: "", body: "" }),
    );
  });

  it("replaces unknown template, page size, orientation and currencies with the defaults", () => {
    const defaults = createDefaultCreatorDraft();
    const result = normalizeDraft({
      template: "brochure" as any,
      pageSize: "a3" as any,
      orientation: 90 as any,
      invoice: { ...defaults.invoice, currency: "JPY" as any },
      payslip: { ...defaults.payslip, currency: undefined as any },
    });

    expect(result.template).toBe(defaults.template);
    expect(result.pageSize).toBe(defaults.pageSize);
    expect(result.orientation).toBe(defaults.orientation);
    expect(result.invoice.currency).toBe("USD");
    expect(result.payslip.currency).toBe("GBP");
  });

  it("keeps every allowed template, page size, orientation and currency", () => {
    for (const template of ["letter", "invoice", "payslip", "cv-harvard", "cv-modern"] as const) {
      expect(normalizeDraft({ template }).template).toBe(template);
    }
    const defaults = createDefaultCreatorDraft();
    const result = normalizeDraft({
      pageSize: "a4",
      orientation: "landscape",
      invoice: { ...defaults.invoice, currency: "EUR" },
      payslip: { ...defaults.payslip, currency: "USD" },
    });

    expect(result).toEqual(expect.objectContaining({ pageSize: "a4", orientation: "landscape" }));
    expect(result.invoice.currency).toBe("EUR");
    expect(result.payslip.currency).toBe("USD");
  });

  it("keeps in-range saved watermark settings unchanged", () => {
    const result = normalizeDraft({
      payslip: {
        ...createDefaultCreatorDraft().payslip,
        watermark: {
          ...createDefaultCreatorDraft().payslip.watermark,
          enabled: false,
          source: "text",
          style: "tiled",
          text: "PRIVATE",
          opacity: 20,
          size: 50,
          rotation: -45,
        },
      },
    });

    expect(result.payslip.watermark).toEqual(
      expect.objectContaining({
        enabled: false,
        source: "text",
        style: "tiled",
        text: "PRIVATE",
        opacity: 20,
        size: 50,
        rotation: -45,
      }),
    );
  });

  it("property: normalizeDraft is idempotent on a valid full draft", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("report", "letter", "invoice", "payslip", "cv-harvard", "cv-modern"),
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

describe("removing one of several items", () => {
  it("removes only the chosen item and leaves the source draft untouched", () => {
    const draft = createDefaultCreatorDraft();
    draft.cv.experiences = [createDefaultCvExperience(), createDefaultCvExperience()];
    draft.cv.education = [createDefaultCvEducation(), createDefaultCvEducation()];
    draft.cv.additionalSections = [createDefaultCvExtraSection(), createDefaultCvExtraSection()];

    const cases = [
      { remove: removeLetterParagraph, list: (d: typeof draft) => d.letter.paragraphs },
      { remove: removeInvoiceItem, list: (d: typeof draft) => d.invoice.lineItems },
      { remove: removeCvExperience, list: (d: typeof draft) => d.cv.experiences },
      { remove: removeCvEducation, list: (d: typeof draft) => d.cv.education },
      { remove: removeCvExtraSection, list: (d: typeof draft) => d.cv.additionalSections },
    ];

    for (const { remove, list } of cases) {
      const [first, second] = list(draft);
      const result = remove(draft, first.id);

      expect(result).not.toBeNull();
      expect(list(result!).map((item) => item.id)).toEqual([second.id]);
      expect(list(draft)).toHaveLength(2);
    }
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

describe("payslip earning mutations", () => {
  it("adds, moves, and removes earnings with the minimum-one guard", () => {
    const draft = createDefaultCreatorDraft();
    const added = addPayslipItem(draft);
    const addedId = added.payslip.lineItems.at(-1)?.id as string;
    const moved = movePayslipItem(added, addedId, -1);
    const removed = removePayslipItem(moved, addedId);

    expect(added.payslip.lineItems).toHaveLength(draft.payslip.lineItems.length + 1);
    expect(moved.payslip.lineItems.at(-2)?.id).toBe(addedId);
    expect(removed?.payslip.lineItems).toHaveLength(draft.payslip.lineItems.length);

    const singleItemDraft = {
      ...draft,
      payslip: { ...draft.payslip, lineItems: [draft.payslip.lineItems[0]] },
    };
    expect(removePayslipItem(singleItemDraft, singleItemDraft.payslip.lineItems[0].id)).toBeNull();
  });
});

describe("payslip deduction mutations", () => {
  it("adds, moves, and removes deductions with the minimum-one guard", () => {
    const draft = createDefaultCreatorDraft();
    const added = addPayslipDeduction(draft);
    const addedId = added.payslip.deductions.at(-1)?.id as string;
    const moved = movePayslipDeduction(added, addedId, -1);
    const removed = removePayslipDeduction(moved, addedId);

    expect(added.payslip.deductions).toHaveLength(draft.payslip.deductions.length + 1);
    expect(moved.payslip.deductions.at(-2)?.id).toBe(addedId);
    expect(removed?.payslip.deductions).toHaveLength(draft.payslip.deductions.length);

    const singleItemDraft = {
      ...draft,
      payslip: { ...draft.payslip, deductions: [draft.payslip.deductions[0]] },
    };
    expect(
      removePayslipDeduction(singleItemDraft, singleItemDraft.payslip.deductions[0].id),
    ).toBeNull();
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

  it("assumes the standard 420 × 560 preview when no size is given", () => {
    expect(getDefaultFloatingPreviewPosition(viewport, 1300)).toEqual({ x: 856, y: 112 });
    expect(getDefaultFloatingPreviewPosition({ innerWidth: 1280, innerHeight: 600 }, null)).toEqual(
      { x: 836, y: 24 },
    );
    expect(clampFloatingPreviewPosition({ x: 5000, y: 5000 }, viewport)).toEqual({
      x: 1440 - 420 - 24,
      y: 900 - 560 - 24,
    });
  });
});

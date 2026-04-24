import { beforeEach, describe, expect, it, vi } from "vitest";

const previewMock = vi.hoisted(() => ({
  load: vi.fn().mockResolvedValue(undefined),
  prev: vi.fn(),
  next: vi.fn(),
  destroy: vi.fn().mockResolvedValue(undefined),
}));

const creatorMocks = vi.hoisted(() => ({
  createPdfFromDraft: vi.fn(),
}));

vi.mock("../../utils/pdfPreview", () => ({
  PdfPreviewController: class {
    load = previewMock.load;
    prev = previewMock.prev;
    next = previewMock.next;
    destroy = previewMock.destroy;
  },
}));

vi.mock("../../utils/persistence", () => ({
  persistence: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    addJob: vi.fn().mockResolvedValue(1),
    getJobs: vi.fn().mockResolvedValue([]),
    estimateUsage: vi.fn().mockResolvedValue(0),
    getStorageUsage: vi.fn().mockResolvedValue({ usage: 0, quota: 1000 }),
  },
}));

vi.mock("../../utils/pdfCreator", async () => {
  const actual =
    await vi.importActual<typeof import("../../utils/pdfCreator")>("../../utils/pdfCreator");
  return {
    ...actual,
    createPdfFromDraft: creatorMocks.createPdfFromDraft,
  };
});

import { PdfCreator } from "../../components/PdfCreator";
import { persistence } from "../../utils/persistence";

describe("PdfCreator", () => {
  const originalInnerWidth = window.innerWidth;
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
    (window as any).showAbout = vi.fn();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;

    creatorMocks.createPdfFromDraft.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      pageCount: 2,
      outputName: "draft.pdf",
    });
  });

  const mountCreator = async () => {
    const component = new PdfCreator();
    document.body.appendChild(component);
    await new Promise((resolve) => setTimeout(resolve, 10));
    return component;
  };

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const setInputValue = (
    component: PdfCreator,
    selector: string,
    value: string,
    eventType = "input",
  ) => {
    const input = component.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
    input.value = value;
    input.dispatchEvent(new Event(eventType, { bubbles: true }));
  };
  const setInputValueForMissingItem = (
    component: PdfCreator,
    selector: string,
    value = "ignored",
  ) => {
    const input = component.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
    input.dataset.id = "missing-item";
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const switchTemplate = async (component: PdfCreator, template: string) => {
    (component.querySelector(`[data-template="${template}"]`) as HTMLButtonElement).click();
    await flush();
  };

  it("renders the default report template", async () => {
    const component = await mountCreator();

    expect(component.innerHTML).toContain("Create PDF");
    expect(component.querySelector('[data-template="report"]')?.classList.contains("active")).toBe(
      true,
    );
  });

  it("switches to the invoice template", async () => {
    const component = await mountCreator();
    const invoiceButton = component.querySelector('[data-template="invoice"]') as HTMLButtonElement;
    invoiceButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(component.querySelector("#invoiceBusinessName")).toBeTruthy();
  });

  it("switches to the Harvard CV template", async () => {
    const component = await mountCreator();
    const cvButton = component.querySelector('[data-template="cv-harvard"]') as HTMLButtonElement;
    cvButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(component.querySelector("#cvFullName")).toBeTruthy();
    expect(component.querySelector("#cvProfileLabel")).toBeTruthy();
  });

  it("places payment fields before line items in the invoice editor", async () => {
    const component = await mountCreator();
    const invoiceButton = component.querySelector('[data-template="invoice"]') as HTMLButtonElement;
    invoiceButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const paymentDetails = component.querySelector(
      "#invoicePaymentDetails",
    ) as HTMLTextAreaElement | null;
    const lineItemsHeader = Array.from(
      component.querySelectorAll(".creator-repeatable-header h4"),
    ).find((element) => element.textContent?.trim() === "Line Items");

    expect(paymentDetails).toBeTruthy();
    expect(lineItemsHeader).toBeTruthy();
    expect(
      Boolean(
        paymentDetails &&
          lineItemsHeader &&
          paymentDetails.compareDocumentPosition(lineItemsHeader) &
            Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it("updates invoice numeric fields without rerendering the editor", async () => {
    const component = await mountCreator();
    const invoiceButton = component.querySelector('[data-template="invoice"]') as HTMLButtonElement;
    invoiceButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const refreshSpy = vi.spyOn(component as any, "refreshUi");
    const quantityInput = component.querySelectorAll(
      ".invoice-item-quantity",
    )[1] as HTMLInputElement;
    quantityInput.value = "9";
    quantityInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(refreshSpy).not.toHaveBeenCalled();
    expect(
      (component.querySelector(".creator-invoice-total strong") as HTMLElement | null)?.textContent,
    ).toBe("$2,885.00");
  });

  it("floats the preview on large screens and allows docking it back into the page", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });

    const component = await mountCreator();
    expect(document.body.querySelector("#floatingPreview")).toBeTruthy();
    expect(component.querySelector("#floatingPreview")).toBeFalsy();
    expect(document.body.querySelector("#previewDragHandle")).toBeFalsy();

    previewMock.load.mockClear();
    creatorMocks.createPdfFromDraft.mockClear();

    const toggleButton = document.body.querySelector("#togglePreviewModeBtn") as HTMLButtonElement;
    toggleButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(previewMock.load).toHaveBeenCalledTimes(1);
    expect(creatorMocks.createPdfFromDraft).not.toHaveBeenCalled();
    expect(document.body.querySelector("#floatingPreview")).toBeFalsy();
    expect(component.querySelector(".creator-preview-column .creator-preview-card")).toBeTruthy();

    previewMock.load.mockClear();
    creatorMocks.createPdfFromDraft.mockClear();

    const floatButton = component.querySelector("#togglePreviewModeBtn") as HTMLButtonElement;
    floatButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(previewMock.load).toHaveBeenCalledTimes(1);
    expect(creatorMocks.createPdfFromDraft).not.toHaveBeenCalled();
    expect(document.body.querySelector("#floatingPreview")).toBeTruthy();
  });

  it("anchors the floating preview as a body overlay instead of inside the glass card", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1200 });

    document.body.innerHTML = `
      <div id="app">
        <div id="main-container" class="card"></div>
      </div>
      <div id="globalDialog"></div>
    `;
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);

    HTMLElement.prototype.getBoundingClientRect = vi.fn(function (this: HTMLElement) {
      if (this.id === "main-container") {
        return {
          x: 232,
          y: 96,
          left: 232,
          top: 96,
          right: 1368,
          bottom: 3521,
          width: 1136,
          height: 3425,
          toJSON: () => ({}),
        } as DOMRect;
      }

      if (this.classList?.contains("tool-view")) {
        return {
          x: 281,
          y: 145,
          left: 281,
          top: 145,
          right: 1319,
          bottom: 3472,
          width: 1038,
          height: 3327,
          toJSON: () => ({}),
        } as DOMRect;
      }

      return originalGetBoundingClientRect.call(this);
    });

    const component = new PdfCreator();
    document.getElementById("main-container")?.appendChild(component);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const floatingPreview = document.body.querySelector("#floatingPreview") as HTMLElement | null;

    expect(floatingPreview).toBeTruthy();
    expect(floatingPreview?.parentElement).toBe(document.body);
    expect(floatingPreview?.style.left).toBe("875px");
    expect(floatingPreview?.style.top).toBe("112px");
    expect(component.querySelector("#floatingPreview")).toBeFalsy();
  });

  it("renders the floating preview banner directly below the draft status bar", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });

    const component = await mountCreator();
    const statusBar = component.querySelector(".creator-status-bar");
    const banner = component.querySelector(".creator-floating-banner");

    expect(banner).toBeTruthy();
    expect(statusBar?.nextElementSibling).toBe(banner);
  });

  it("creates a PDF and records the job", async () => {
    const component = await mountCreator();
    const createButton = component.querySelector("#createPdfBtn") as HTMLButtonElement;
    createButton.click();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(creatorMocks.createPdfFromDraft).toHaveBeenCalled();
    expect(persistence.addJob).toHaveBeenCalled();
    expect(component.querySelector("#successMessage")?.classList.contains("hidden")).toBe(false);
  });

  it("restores a saved draft from persistence", async () => {
    (persistence.get as any).mockResolvedValueOnce({
      fileName: "client-invoice",
      template: "invoice",
      invoice: {
        businessName: "Saved Business",
        paymentDetails: "IBAN: GB12KYTE12345678",
        paymentLink: "https://pay.example.com/invoice/1",
        lineItems: [{ id: "item-1", description: "Retainer", quantity: 1, unitPrice: 900 }],
      },
    });

    const restored = await mountCreator();

    expect((restored.querySelector("#fileNameInput") as HTMLInputElement).value).toBe(
      "client-invoice",
    );
    expect((restored.querySelector("#invoiceBusinessName") as HTMLInputElement).value).toBe(
      "Saved Business",
    );
    expect((restored.querySelector("#invoicePaymentDetails") as HTMLTextAreaElement).value).toBe(
      "IBAN: GB12KYTE12345678",
    );
    expect((restored.querySelector("#invoicePaymentLink") as HTMLInputElement).value).toBe(
      "https://pay.example.com/invoice/1",
    );
  });

  it("restores a saved CV draft with custom section labels", async () => {
    (persistence.get as any).mockResolvedValueOnce({
      fileName: "alex-cv",
      template: "cv-modern",
      cv: {
        fullName: "Alex Morgan",
        profileLabel: "Personal Profile",
        experienceLabel: "Work History",
        skillsLabel: "Capabilities",
        experiences: [
          {
            id: "exp-1",
            role: "Designer",
            organization: "Northstar",
            location: "London",
            startDate: "2021",
            endDate: "Present",
            achievements: "Led redesign work",
          },
        ],
        education: [
          {
            id: "edu-1",
            qualification: "BA Design",
            institution: "UAL",
            location: "London",
            startDate: "2016",
            endDate: "2019",
            details: "First Class",
          },
        ],
        additionalSections: [
          {
            id: "section-1",
            title: "Awards",
            body: "D&AD New Blood",
          },
        ],
      },
    });

    const restored = await mountCreator();

    expect((restored.querySelector("#fileNameInput") as HTMLInputElement).value).toBe("alex-cv");
    expect((restored.querySelector("#cvFullName") as HTMLInputElement).value).toBe("Alex Morgan");
    expect((restored.querySelector("#cvProfileLabel") as HTMLInputElement).value).toBe(
      "Personal Profile",
    );
    expect((restored.querySelector("#cvExperienceLabel") as HTMLInputElement).value).toBe(
      "Work History",
    );
    expect((restored.querySelector("#cvSkillsLabel") as HTMLInputElement).value).toBe(
      "Capabilities",
    );
    expect((restored.querySelector(".cv-section-title") as HTMLInputElement).value).toBe("Awards");
  });

  it("updates document settings, chrome actions, logo upload, and reset", async () => {
    const originalFileReader = globalThis.FileReader;
    class FakeFileReader {
      result = "data:image/png;base64,logo";
      error: Error | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.onload?.();
      }
    }
    globalThis.FileReader = FakeFileReader as any;

    const component = await mountCreator();
    const backSpy = vi.fn();
    component.addEventListener("back-to-dashboard", backSpy);

    (component.querySelector("#aboutBtn") as HTMLButtonElement).click();
    (component.querySelector("#userAccountBtn") as HTMLButtonElement).click();
    (component.querySelector("#backToDash") as HTMLButtonElement).click();

    expect((window as any).showAbout).toHaveBeenCalled();
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "User Account" }),
    );
    expect(backSpy).toHaveBeenCalled();

    setInputValue(component, "#fileNameInput", "  client-brief.pdf");
    setInputValue(component, "#pageSizeSelect", "a4", "change");
    setInputValue(component, "#orientationSelect", "landscape", "change");
    setInputValue(component, "#accentColorInput", "#ff0000");
    const pageNumbersToggle = component.querySelector("#pageNumbersToggle") as HTMLInputElement;
    pageNumbersToggle.checked = false;
    pageNumbersToggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect((component as any).draft.fileName).toBe("client-brief");
    expect((component as any).draft.pageSize).toBe("a4");
    expect((component as any).draft.orientation).toBe("landscape");
    expect((component as any).draft.accentColor).toBe("#ff0000");
    expect((component as any).draft.includePageNumbers).toBe(false);

    const logoInput = component.querySelector("#logoInput") as HTMLInputElement;
    Object.defineProperty(logoInput, "files", {
      configurable: true,
      value: [new File(["logo"], "logo.png", { type: "image/png" })],
    });
    logoInput.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect((component as any).draft.logoDataUrl).toBe("data:image/png;base64,logo");
    expect((component as any).draft.logoFileName).toBe("logo.png");

    (component.querySelector("#clearLogoBtn") as HTMLButtonElement).click();
    expect((component as any).draft.logoDataUrl).toBeNull();

    (component.querySelector("#resetDraftBtn") as HTMLButtonElement).click();
    await flush();
    expect(persistence.delete).toHaveBeenCalledWith("create-pdf");

    globalThis.FileReader = originalFileReader;
  });

  it("edits report collections and prevents invalid collection moves", async () => {
    const component = await mountCreator();
    const initialSectionId = (component as any).draft.report.sections[0].id;
    const initialSectionCount = (component as any).draft.report.sections.length;

    setInputValue(component, "#reportTitle", "New Report");
    setInputValue(component, "#reportSubtitle", "Quarterly");
    setInputValue(component, "#reportAuthor", "Kyte");
    setInputValue(component, "#reportSummary", "Summary");
    setInputValue(component, ".report-section-heading", "Intro");
    setInputValue(component, ".report-section-body", "Body copy");

    expect((component as any).draft.report.title).toBe("New Report");
    expect((component as any).draft.report.sections[0]).toEqual(
      expect.objectContaining({ body: "Body copy", heading: "Intro" }),
    );

    (component.querySelector(".report-move-up") as HTMLButtonElement).click();
    expect((component as any).draft.report.sections[0].id).toBe(initialSectionId);

    (component.querySelector("#addReportSectionBtn") as HTMLButtonElement).click();
    await flush();
    expect((component as any).draft.report.sections).toHaveLength(initialSectionCount + 1);

    const secondId = (component as any).draft.report.sections[1].id;
    (component.querySelectorAll(".report-move-up")[1] as HTMLButtonElement).click();
    await flush();
    expect((component as any).draft.report.sections[0].id).toBe(secondId);

    (component.querySelector(".report-remove") as HTMLButtonElement).click();
    await flush();
    expect((component as any).draft.report.sections).toHaveLength(initialSectionCount);
  });

  it("edits letter paragraphs and repeatable controls", async () => {
    const component = await mountCreator();
    await switchTemplate(component, "letter");

    setInputValue(component, "#letterSenderName", "Sender");
    setInputValue(component, "#letterSenderDetails", "Sender details");
    setInputValue(component, "#letterRecipientName", "Recipient");
    setInputValue(component, "#letterRecipientDetails", "Recipient details");
    setInputValue(component, "#letterSubject", "Subject");
    setInputValue(component, "#letterGreeting", "Hello");
    setInputValue(component, "#letterClosing", "Regards");
    setInputValue(component, "#letterSignature", "Signature");
    setInputValue(component, "#letterDate", "2026-04-24", "change");
    setInputValue(component, ".letter-paragraph-text", "First paragraph");

    expect((component as any).draft.letter).toEqual(
      expect.objectContaining({
        closing: "Regards",
        date: "2026-04-24",
        recipientName: "Recipient",
        senderName: "Sender",
      }),
    );

    (component.querySelector("#addLetterParagraphBtn") as HTMLButtonElement).click();
    await flush();
    expect((component as any).draft.letter.paragraphs.length).toBeGreaterThan(1);

    const lastId = (component as any).draft.letter.paragraphs.at(-1).id;
    (Array.from(component.querySelectorAll(".letter-move-up")).at(-1) as HTMLButtonElement).click();
    await flush();
    expect((component as any).draft.letter.paragraphs.some((p: any) => p.id === lastId)).toBe(true);

    (component.querySelector(".letter-remove") as HTMLButtonElement).click();
    await flush();
    expect((component as any).draft.template).toBe("letter");
  });

  it("edits invoice fields, totals, and line item controls", async () => {
    const component = await mountCreator();
    await switchTemplate(component, "invoice");

    setInputValue(component, "#invoiceBusinessName", "Business");
    setInputValue(component, "#invoiceBusinessDetails", "Business details");
    setInputValue(component, "#invoiceClientName", "Client");
    setInputValue(component, "#invoiceClientDetails", "Client details");
    setInputValue(component, "#invoiceNumber", "INV-2");
    setInputValue(component, "#invoiceIssueDate", "2026-04-24", "change");
    setInputValue(component, "#invoiceDueDate", "2026-05-24", "change");
    setInputValue(component, "#invoiceCurrency", "GBP", "change");
    setInputValue(component, "#invoicePaymentDetails", "Bank details");
    setInputValue(component, "#invoicePaymentLink", "https://pay.example.com");
    setInputValue(component, "#invoiceNotes", "Thank you");

    (component.querySelector("#addInvoiceItemBtn") as HTMLButtonElement).click();
    await flush();
    setInputValue(component, ".invoice-item-description", "Consulting");
    setInputValue(component, ".invoice-item-quantity", "-10");
    setInputValue(component, ".invoice-item-rate", "250");

    expect((component as any).draft.invoice).toEqual(
      expect.objectContaining({
        businessName: "Business",
        currency: "GBP",
        invoiceNumber: "INV-2",
        paymentDetails: "Bank details",
      }),
    );
    expect((component as any).draft.invoice.lineItems[0].quantity).toBe(0);
    expect(component.querySelector(".creator-invoice-total strong")?.textContent).toContain("£");

    (component.querySelectorAll(".invoice-move-down")[0] as HTMLButtonElement).click();
    await flush();
    (component.querySelectorAll(".invoice-move-up")[1] as HTMLButtonElement).click();
    await flush();
    (component.querySelector(".invoice-remove") as HTMLButtonElement).click();
    await flush();

    expect((component as any).draft.invoice.lineItems.length).toBeGreaterThan(0);
  });

  it("edits CV fields, dynamic headings, and repeatable controls", async () => {
    const component = await mountCreator();
    await switchTemplate(component, "cv-modern");

    setInputValue(component, "#cvFullName", "Jordan Lee");
    setInputValue(component, "#cvProfessionalTitle", "Product Designer");
    setInputValue(component, "#cvEmail", "jordan@example.com");
    setInputValue(component, "#cvPhone", "123");
    setInputValue(component, "#cvLocation", "London");
    setInputValue(component, "#cvWebsite", "https://example.com");
    setInputValue(component, "#cvLinkedin", "linkedin.com/in/jordan");
    setInputValue(component, "#cvProfileLabel", "Profile");
    setInputValue(component, "#cvExperienceLabel", "");
    expect(component.querySelector("#cvExperienceHeading")?.textContent).toBe("Experience");
    setInputValue(component, "#cvExperienceLabel", "Roles");
    setInputValue(component, "#cvEducationLabel", "Study");
    setInputValue(component, "#cvSkillsLabel", "Tools");
    setInputValue(component, "#cvProfile", "Profile text");
    setInputValue(component, "#cvSkills", "Research, Design");

    (component.querySelector("#addCvExperienceBtn") as HTMLButtonElement).click();
    await flush();
    setInputValue(component, ".cv-experience-role", "Lead");
    setInputValue(component, ".cv-experience-organization", "Studio");
    setInputValue(component, ".cv-experience-location", "Remote");
    setInputValue(component, ".cv-experience-start", "2020");
    setInputValue(component, ".cv-experience-end", "2026");
    setInputValue(component, ".cv-experience-achievements", "Built systems");

    (component.querySelector("#addCvEducationBtn") as HTMLButtonElement).click();
    await flush();
    setInputValue(component, ".cv-education-qualification", "MSc");
    setInputValue(component, ".cv-education-institution", "UCL");
    setInputValue(component, ".cv-education-location", "London");
    setInputValue(component, ".cv-education-start", "2018");
    setInputValue(component, ".cv-education-end", "2019");
    setInputValue(component, ".cv-education-details", "Distinction");

    (component.querySelector("#addCvSectionBtn") as HTMLButtonElement).click();
    await flush();
    setInputValue(component, ".cv-section-title", "Awards");
    setInputValue(component, ".cv-section-body", "Design award");

    expect((component as any).draft.cv.fullName).toBe("Jordan Lee");
    expect((component as any).draft.cv.experienceLabel).toBe("Roles");
    expect((component as any).draft.cv.experiences.length).toBeGreaterThan(1);
    expect((component as any).draft.cv.education.length).toBeGreaterThan(1);
    expect((component as any).draft.cv.additionalSections.length).toBeGreaterThan(1);

    (component.querySelectorAll(".cv-experience-move-down")[0] as HTMLButtonElement).click();
    (component.querySelectorAll(".cv-education-move-down")[0] as HTMLButtonElement).click();
    (component.querySelectorAll(".cv-section-move-down")[0] as HTMLButtonElement).click();
    await flush();
    (component.querySelector(".cv-experience-remove") as HTMLButtonElement).click();
    (component.querySelector(".cv-education-remove") as HTMLButtonElement).click();
    (component.querySelector(".cv-section-remove") as HTMLButtonElement).click();
    await flush();

    expect((component as any).draft.template).toBe("cv-modern");
  });

  it("covers repeatable-control guard paths for reports, invoices, and CVs", async () => {
    const component = await mountCreator();

    setInputValueForMissingItem(component, ".report-section-heading");
    setInputValueForMissingItem(component, ".report-section-body");
    (component.querySelector("#addReportSectionBtn") as HTMLButtonElement).click();
    await flush();
    (component.querySelectorAll(".report-move-down")[0] as HTMLButtonElement).click();
    await flush();
    (
      Array.from(component.querySelectorAll(".report-move-down")).at(-1) as HTMLButtonElement
    ).click();

    await switchTemplate(component, "invoice");
    setInputValueForMissingItem(component, ".invoice-item-description");
    setInputValueForMissingItem(component, ".invoice-item-quantity", "4");
    setInputValueForMissingItem(component, ".invoice-item-rate", "100");
    (component as any).draft.invoice.lineItems = [
      { id: "only-item", description: "Only", quantity: 1, unitPrice: 10 },
    ];
    (component as any).refreshUi();
    await flush();
    (component.querySelector(".invoice-remove") as HTMLButtonElement).click();
    expect((component as any).draft.invoice.lineItems).toHaveLength(1);
    (component.querySelector(".invoice-move-up") as HTMLButtonElement).click();
    (component.querySelector(".invoice-move-down") as HTMLButtonElement).click();

    await switchTemplate(component, "cv-modern");
    for (const selector of [
      ".cv-experience-role",
      ".cv-experience-organization",
      ".cv-experience-location",
      ".cv-experience-start",
      ".cv-experience-end",
      ".cv-experience-achievements",
      ".cv-education-qualification",
      ".cv-education-institution",
      ".cv-education-location",
      ".cv-education-start",
      ".cv-education-end",
      ".cv-education-details",
      ".cv-section-title",
      ".cv-section-body",
    ]) {
      setInputValueForMissingItem(component, selector);
    }

    (component.querySelector("#addCvExperienceBtn") as HTMLButtonElement).click();
    await flush();
    (component.querySelectorAll(".cv-experience-move-up")[1] as HTMLButtonElement).click();
    await flush();
    (component.querySelectorAll(".cv-experience-move-down")[0] as HTMLButtonElement).click();
    await flush();

    (component.querySelector("#addCvEducationBtn") as HTMLButtonElement).click();
    await flush();
    (component.querySelectorAll(".cv-education-move-up")[1] as HTMLButtonElement).click();
    await flush();
    (component.querySelectorAll(".cv-education-move-down")[0] as HTMLButtonElement).click();
    await flush();

    (component.querySelector("#addCvSectionBtn") as HTMLButtonElement).click();
    await flush();
    (component.querySelectorAll(".cv-section-move-up")[1] as HTMLButtonElement).click();
    await flush();
    (component.querySelectorAll(".cv-section-move-down")[0] as HTMLButtonElement).click();
    await flush();

    (component as any).draft.cv.experiences = [(component as any).draft.cv.experiences[0]];
    (component as any).draft.cv.education = [(component as any).draft.cv.education[0]];
    (component as any).draft.cv.additionalSections = [
      (component as any).draft.cv.additionalSections[0],
    ];
    (component as any).refreshUi();
    await flush();
    (component.querySelector(".cv-experience-remove") as HTMLButtonElement).click();
    (component.querySelector(".cv-education-remove") as HTMLButtonElement).click();
    (component.querySelector(".cv-section-remove") as HTMLButtonElement).click();

    expect((component as any).draft.cv.experiences).toHaveLength(1);
    expect((component as any).draft.cv.education).toHaveLength(1);
    expect((component as any).draft.cv.additionalSections).toHaveLength(1);
  });

  it("handles draft persistence, preview, creation failures, drag, resize, and teardown", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    const component = await mountCreator();

    expect((component as any).getDraftStatusText()).toBe(
      "Changes will be saved locally as you edit.",
    );
    (component as any).draftState = "saving";
    expect((component as any).getDraftStatusText()).toBe("Saving your draft locally...");
    (component as any).draftState = "saved";
    expect((component as any).getDraftStatusText()).toBe("Draft saved locally.");
    (component as any).draftState = "restored";
    expect((component as any).getDraftStatusText()).toBe(
      "Previous draft restored from this browser.",
    );

    await (component as any).refreshPreview();
    expect(previewMock.load).toHaveBeenCalled();
    expect(component.querySelector("#creatorSummary")?.textContent).toContain("preview pages");

    creatorMocks.createPdfFromDraft.mockRejectedValueOnce(new Error("preview failed"));
    await (component as any).refreshPreview();
    expect(document.querySelector("#previewState")?.textContent).toContain(
      "Preview could not be generated",
    );

    (persistence.set as any).mockRejectedValueOnce(new Error("storage failed"));
    await (component as any).saveDraft();
    expect(component.querySelector("#draftStatusText")?.textContent).toBe(
      "Changes will be saved locally as you edit.",
    );

    creatorMocks.createPdfFromDraft.mockRejectedValueOnce(new Error("create failed"));
    await (component as any).startCreation();
    expect((document.getElementById("globalDialog") as any).show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Error", type: "error" }),
    );

    const floatingPreview = document.body.querySelector("#floatingPreview") as HTMLElement;
    floatingPreview.getBoundingClientRect = vi.fn(
      () =>
        ({
          bottom: 660,
          height: 560,
          left: 100,
          right: 520,
          top: 100,
          width: 420,
          x: 100,
          y: 100,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    (component as any).startPreviewDrag({
      clientX: 120,
      clientY: 140,
      preventDefault: vi.fn(),
    });
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 300, clientY: 360 }));
    window.dispatchEvent(new MouseEvent("pointerup"));
    expect(floatingPreview.classList.contains("is-dragging")).toBe(false);

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    window.dispatchEvent(new Event("resize"));
    await flush();
    expect(document.body.querySelector("#floatingPreview")).toBeFalsy();

    component.disconnectedCallback();
    expect(previewMock.destroy).toHaveBeenCalled();
  });

  it("covers guarded creator actions, preview controls, and logo read failures", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    const component = await mountCreator();
    const dialog = document.getElementById("globalDialog") as any;

    const mutationSpy = vi.spyOn(component as any, "handleDraftMutation");
    (component.querySelector('[data-template="report"]') as HTMLButtonElement).click();
    expect(mutationSpy).not.toHaveBeenCalled();

    const fileInput = component.querySelector("#logoInput") as HTMLInputElement;
    const inputClick = vi.spyOn(fileInput, "click");
    (component.querySelector("#uploadLogoBtn") as HTMLButtonElement).click();
    expect(inputClick).toHaveBeenCalled();

    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [],
    });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));

    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["bad"], "bad.txt", { type: "text/plain" })],
    });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect((component as any).draft.logoDataUrl).toBeNull();

    const originalFileReader = globalThis.FileReader;
    class ErrorFileReader {
      error = new Error("read failed");
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.onerror?.();
      }
    }
    globalThis.FileReader = ErrorFileReader as any;
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["logo"], "logo.png", { type: "image/png" })],
    });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(dialog.show).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
    globalThis.FileReader = originalFileReader;

    previewMock.prev.mockClear();
    previewMock.next.mockClear();
    (document.body.querySelector("#prevPreviewPage") as HTMLButtonElement).click();
    (document.body.querySelector("#nextPreviewPage") as HTMLButtonElement).click();
    expect(previewMock.prev).toHaveBeenCalled();
    expect(previewMock.next).toHaveBeenCalled();

    (document.body.querySelector("#resetPreviewPositionBtn") as HTMLButtonElement).click();
    expect((component as any).previewPosition.x).toBeGreaterThanOrEqual(16);

    const portal = document.body.querySelector("#floatingPreview") as HTMLElement;
    const startDragSpy = vi.spyOn(component as any, "startPreviewDrag");
    (portal.querySelector("button") as HTMLButtonElement).dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }),
    );
    expect(startDragSpy).not.toHaveBeenCalled();

    portal.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 20 }),
    );
    expect(startDragSpy).toHaveBeenCalled();
    window.dispatchEvent(new MouseEvent("pointercancel"));

    dialog.show.mockResolvedValueOnce(false);
    await (component as any).resetDraft();
    expect(persistence.delete).not.toHaveBeenCalledWith("create-pdf");

    (component as any).isCreating = true;
    creatorMocks.createPdfFromDraft.mockClear();
    await (component as any).startCreation();
    expect(creatorMocks.createPdfFromDraft).not.toHaveBeenCalled();
    (component as any).isCreating = false;

    await switchTemplate(component, "invoice");
    (component as any).draft.template = "report";
    expect(() => (component as any).updateInvoiceTotalDisplay()).not.toThrow();
  });

  it("normalizes sparse saved report and letter drafts and tolerates restore failures", async () => {
    (persistence.get as any).mockRejectedValueOnce(new Error("restore failed"));
    const failedRestore = await mountCreator();
    expect(failedRestore.querySelector("#draftStatusText")?.textContent).toContain("saved locally");

    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
    (persistence.get as any).mockResolvedValueOnce({
      fileName: "sparse-report",
      report: {
        sections: [{ heading: undefined, body: undefined }],
      },
      template: "report",
    });
    const report = await mountCreator();
    expect((report as any).draft.report.sections[0].id).toBeTruthy();
    expect((report.querySelector(".report-section-heading") as HTMLInputElement).value).toBe("");

    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
    (persistence.get as any).mockResolvedValueOnce({
      fileName: "sparse-letter",
      letter: {
        paragraphs: [{ text: undefined }],
      },
      template: "letter",
    });
    const letter = await mountCreator();
    expect((letter as any).draft.letter.paragraphs[0].id).toBeTruthy();
    expect((letter.querySelector(".letter-paragraph-text") as HTMLTextAreaElement).value).toBe("");
  });
});

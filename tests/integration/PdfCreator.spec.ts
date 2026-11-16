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
    (window as any).showAccountModal = vi.fn();
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
    // Wait for the initial draft to load and the first preview to be queued and executed
    await vi.waitFor(
      () => {
        if (creatorMocks.createPdfFromDraft.mock.calls.length === 0) {
          throw new Error("Preview not generated yet");
        }
      },
      { timeout: 2000 },
    );
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

  it("edits an independent payslip with company and employee information", async () => {
    const component = await mountCreator();
    await switchTemplate(component, "payslip");

    setInputValue(component, "#payslipCompanyName", "Northstar Ltd");
    setInputValue(component, "#payslipCompanyAddress", "1 Payroll Way\nLondon");
    setInputValue(component, "#payslipEmployeeName", "Morgan Lee");
    setInputValue(component, "#payslipEmployeeDetails", "Employee ID: EMP-42");
    setInputValue(component, "#payslipCompanyReference", "PAYROLL-REF-42");
    setInputValue(component, "#payslipDetailsAlignment", "left", "change");
    setInputValue(component, "#payslipFooterLogoPosition", "right", "change");
    setInputValue(component, "#payslipCopyrightNote", "© 2026 Northstar Ltd. All rights reserved.");
    setInputValue(component, "#payslipHeaderTextColor", "#00aa55");
    setInputValue(component, "#payslipWatermarkSource", "text", "change");
    setInputValue(component, "#payslipWatermarkText", "PRIVATE PAYROLL");
    setInputValue(component, "#payslipWatermarkStyle", "diagonal", "change");
    setInputValue(component, "#payslipWatermarkOpacity", "15");
    setInputValue(component, "#payslipWatermarkSize", "55");
    setInputValue(component, "#payslipWatermarkRotation", "-30");
    setInputValue(component, "#payslipPayPeriod", "June 2026");
    setInputValue(component, "#payslipCurrency", "USD", "change");
    setInputValue(component, ".payslip-item-rate", "4200");
    const deductionCount = (component as any).draft.payslip.deductions.length;
    (component.querySelector("#addPayslipDeductionBtn") as HTMLButtonElement).click();
    setInputValue(component, ".payslip-deduction-description", "Tax adjustment");
    setInputValue(component, ".payslip-deduction-quantity", "2");
    setInputValue(component, ".payslip-deduction-rate", "100");
    const companyNameToggle = component.querySelector(
      "#payslipCompanyNameHeaderToggle",
    ) as HTMLInputElement;
    companyNameToggle.checked = false;
    companyNameToggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect((component as any).draft.payslip).toEqual(
      expect.objectContaining({
        companyName: "Northstar Ltd",
        companyAddress: "1 Payroll Way\nLondon",
        employeeName: "Morgan Lee",
        employeeDetails: "Employee ID: EMP-42",
        companyReference: "PAYROLL-REF-42",
        detailsValueAlignment: "left",
        footerLogoPosition: "right",
        copyrightNote: "© 2026 Northstar Ltd. All rights reserved.",
        includeCompanyNameInHeader: false,
        headerTextColor: "#00aa55",
        payPeriod: "June 2026",
        currency: "USD",
        watermark: expect.objectContaining({
          enabled: true,
          source: "text",
          style: "diagonal",
          text: "PRIVATE PAYROLL",
          opacity: 15,
          size: 55,
          rotation: -30,
        }),
      }),
    );
    expect((component as any).draft.invoice.businessName).toBe("Kyte Studio");
    expect((component as any).draft.payslip.deductions).toHaveLength(deductionCount + 1);
    expect((component as any).draft.payslip.deductions[0]).toEqual(
      expect.objectContaining({
        description: "Tax adjustment",
        quantity: 2,
        unitPrice: 100,
      }),
    );
    expect(component.querySelector('[data-payslip-total="earnings"]')?.textContent).toContain("$");
    expect(component.querySelector('[data-payslip-total="deductions"]')?.textContent).toContain(
      "-$",
    );
    expect(component.querySelector('[data-payslip-total="net"]')?.textContent).toContain("$");
    expect(component.textContent).not.toContain("Bill From");
    expect(component.textContent).not.toContain("Bill To");
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
    expect((window as any).showAccountModal).toHaveBeenCalled();
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

    await switchTemplate(component, "payslip");
    setInputValue(component, "#payslipWatermarkSource", "custom-image", "change");
    const watermarkInput = component.querySelector("#watermarkImageInput") as HTMLInputElement;
    Object.defineProperty(watermarkInput, "files", {
      configurable: true,
      value: [new File(["watermark"], "watermark.png", { type: "image/png" })],
    });
    watermarkInput.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect((component as any).draft.payslip.watermark.customImageDataUrl).toBe(
      "data:image/png;base64,logo",
    );
    expect((component as any).draft.payslip.watermark.customImageFileName).toBe("watermark.png");
    const grayscaleToggle = component.querySelector(
      "#payslipWatermarkGrayscale",
    ) as HTMLInputElement;
    grayscaleToggle.checked = true;
    grayscaleToggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect((component as any).draft.payslip.watermark.grayscale).toBe(true);
    (component.querySelector("#clearWatermarkImageBtn") as HTMLButtonElement).click();
    expect((component as any).draft.payslip.watermark.customImageDataUrl).toBeNull();

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

    const statusFor = (state: string) => {
      (component as any).draftState = state;
      (component as any).updateDraftStatus();
      return component.querySelector("#draftStatusText")?.textContent;
    };
    expect(statusFor("idle")).toBe("Changes will be saved locally as you edit.");
    expect(statusFor("saving")).toBe("Saving your draft locally...");
    expect(statusFor("saved")).toBe("Draft saved locally.");
    expect(statusFor("restored")).toBe("Previous draft restored from this browser.");

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

  const query = <T extends Element = HTMLElement>(component: PdfCreator, selector: string) =>
    component.querySelector(selector) as T;
  const setChecked = (component: PdfCreator, selector: string, checked: boolean) => {
    const input = query<HTMLInputElement>(component, selector);
    input.checked = checked;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const payslipTotals = (component: PdfCreator) => ({
    earnings: query(component, '[data-payslip-total="earnings"]').textContent,
    deductions: query(component, '[data-payslip-total="deductions"]').textContent,
    net: query(component, '[data-payslip-total="net"]').textContent,
  });
  const ids = (items: { id: string }[]) => items.map((item) => item.id);

  it("edits invoice header, reference, alignment, status, and signature fields", async () => {
    const component = await mountCreator();
    await switchTemplate(component, "invoice");

    setChecked(component, "#invoiceBusinessNameHeaderToggle", false);
    setInputValue(component, "#invoiceHeaderTextColor", "#111827");
    setInputValue(component, "#invoiceCompanyReference", "PO-4471");
    setInputValue(component, "#invoiceDetailsAlignment", "left", "change");
    setInputValue(component, "#invoiceFooterLogoPosition", "center", "change");
    setInputValue(component, "#invoiceStatus", "paid", "change");
    setInputValue(component, "#invoicePaidDate", "2026-05-01", "change");
    setInputValue(component, "#invoiceSignature", "Habeeb Tijani");

    expect((component as any).draft.invoice).toEqual(
      expect.objectContaining({
        includeBusinessNameInHeader: false,
        headerTextColor: "#111827",
        companyReference: "PO-4471",
        detailsValueAlignment: "left",
        footerLogoPosition: "center",
        status: "paid",
        paidDate: "2026-05-01",
        signature: "Habeeb Tijani",
      }),
    );
    expect(query(component, ".creator-invoice-total span").textContent).toBe("Total Paid");

    await switchTemplate(component, "report");
    await switchTemplate(component, "invoice");

    expect(query<HTMLInputElement>(component, "#invoiceBusinessNameHeaderToggle").checked).toBe(
      false,
    );
    expect(query<HTMLSelectElement>(component, "#invoiceStatus").value).toBe("paid");
    expect(query<HTMLSelectElement>(component, "#invoiceFooterLogoPosition").value).toBe("center");
    expect(query<HTMLInputElement>(component, "#invoiceSignature").value).toBe("Habeeb Tijani");
    expect(query(component, ".creator-invoice-total span").textContent?.trim()).toBe("Total Paid");
  });

  it("saves a burst of edits once, after typing pauses", async () => {
    const component = await mountCreator();
    await flush();
    (persistence.set as any).mockClear();

    setInputValue(component, "#reportTitle", "Q");
    setInputValue(component, "#reportTitle", "Q3");
    setInputValue(component, "#reportTitle", "Q3 Review");

    expect(query(component, "#draftStatusText").textContent).toBe("Saving your draft locally...");
    await vi.waitFor(() => expect(persistence.set).toHaveBeenCalled());
    expect(persistence.set).toHaveBeenCalledTimes(1);
    expect(persistence.set).toHaveBeenCalledWith(
      "create-pdf",
      expect.objectContaining({ report: expect.objectContaining({ title: "Q3 Review" }) }),
    );
    await vi.waitFor(() =>
      expect(query(component, "#draftStatusText").textContent).toBe("Draft saved locally."),
    );
  });

  it("edits payslip earnings and deductions and keeps the totals in step", async () => {
    const component = await mountCreator();
    await switchTemplate(component, "payslip");

    // Defaults: £3,500 + 4 × £35 earned; £420 + £175 deducted.
    expect(payslipTotals(component)).toEqual({
      earnings: "£3,640.00",
      deductions: "-£595.00",
      net: "£3,045.00",
    });

    setInputValue(component, ".payslip-item-description", "Base pay");
    setInputValue(component, ".payslip-item-quantity", "2");
    setInputValue(component, ".payslip-item-rate", "3600");
    setInputValue(component, ".payslip-deduction-description", "PAYE");
    setInputValue(component, ".payslip-deduction-quantity", "");
    setInputValue(component, ".payslip-deduction-rate", "-50");

    expect((component as any).draft.payslip.lineItems[0]).toEqual(
      expect.objectContaining({ description: "Base pay", quantity: 2, unitPrice: 3600 }),
    );
    expect((component as any).draft.payslip.deductions[0]).toEqual(
      expect.objectContaining({ description: "PAYE", quantity: 0, unitPrice: 0 }),
    );
    expect(payslipTotals(component)).toEqual({
      earnings: "£7,340.00",
      deductions: "-£175.00",
      net: "£7,165.00",
    });

    const earningIds = ids((component as any).draft.payslip.lineItems);
    query<HTMLButtonElement>(component, "#addPayslipItemBtn").click();
    await flush();
    const added = (component as any).draft.payslip.lineItems.at(-1);
    expect(added).toEqual(expect.objectContaining({ description: "Earning", unitPrice: 0 }));

    (component.querySelectorAll(".payslip-move-up")[2] as HTMLButtonElement).click();
    expect(ids((component as any).draft.payslip.lineItems)).toEqual([
      earningIds[0],
      added.id,
      earningIds[1],
    ]);
    (component.querySelectorAll(".payslip-move-down")[0] as HTMLButtonElement).click();
    expect(ids((component as any).draft.payslip.lineItems)).toEqual([
      added.id,
      earningIds[0],
      earningIds[1],
    ]);
    (component.querySelectorAll(".payslip-remove")[0] as HTMLButtonElement).click();
    expect(ids((component as any).draft.payslip.lineItems)).toEqual(earningIds);

    const deductionIds = ids((component as any).draft.payslip.deductions);
    query<HTMLButtonElement>(component, "#addPayslipDeductionBtn").click();
    await flush();
    const addedDeduction = (component as any).draft.payslip.deductions.at(-1);
    (component.querySelectorAll(".payslip-deduction-move-up")[2] as HTMLButtonElement).click();
    (component.querySelectorAll(".payslip-deduction-move-down")[1] as HTMLButtonElement).click();
    expect(ids((component as any).draft.payslip.deductions)).toEqual([
      deductionIds[0],
      deductionIds[1],
      addedDeduction.id,
    ]);
    (component.querySelectorAll(".payslip-deduction-remove")[2] as HTMLButtonElement).click();
    expect(ids((component as any).draft.payslip.deductions)).toEqual(deductionIds);
    expect(payslipTotals(component).net).toBe("£7,165.00");
  });

  it("treats a cleared quantity or price as zero and updates the totals", async () => {
    const component = await mountCreator();
    await switchTemplate(component, "invoice");
    const invoiceTotal = () => query(component, ".creator-invoice-total strong").textContent;

    // Defaults: 1 × $1,400 + 8 × $165.
    expect(invoiceTotal()).toBe("$2,720.00");
    setInputValue(component, ".invoice-item-quantity", "");
    expect(invoiceTotal()).toBe("$1,320.00");
    const secondRate = component.querySelectorAll(".invoice-item-rate")[1] as HTMLInputElement;
    secondRate.value = "";
    secondRate.dispatchEvent(new Event("input", { bubbles: true }));
    expect(invoiceTotal()).toBe("$0.00");
    expect(
      (component as any).draft.invoice.lineItems.map((item: any) => [
        item.quantity,
        item.unitPrice,
      ]),
    ).toEqual([
      [0, 1400],
      [8, 0],
    ]);

    await switchTemplate(component, "payslip");
    setInputValue(component, ".payslip-item-quantity", "");
    const secondEarningRate = component.querySelectorAll(
      ".payslip-item-rate",
    )[1] as HTMLInputElement;
    secondEarningRate.value = "";
    secondEarningRate.dispatchEvent(new Event("input", { bubbles: true }));
    setInputValue(component, ".payslip-deduction-rate", "");

    expect(payslipTotals(component)).toEqual({
      earnings: "£0.00",
      deductions: "-£175.00",
      net: "-£175.00",
    });
  });

  it("ignores payslip edits aimed at rows that no longer exist", async () => {
    const component = await mountCreator();
    await switchTemplate(component, "payslip");
    const before = structuredClone((component as any).draft.payslip);
    const mutationSpy = vi.spyOn(component as any, "handleDraftMutation");

    for (const selector of [
      ".payslip-item-description",
      ".payslip-item-quantity",
      ".payslip-item-rate",
      ".payslip-deduction-description",
      ".payslip-deduction-quantity",
      ".payslip-deduction-rate",
    ]) {
      setInputValueForMissingItem(component, selector, "7");
    }
    for (const selector of [".payslip-move-down", ".payslip-deduction-move-down"]) {
      const button = query<HTMLButtonElement>(component, selector);
      button.dataset.id = "missing-item";
      button.click();
    }
    const unlabelled = component.querySelectorAll(".payslip-move-up")[1] as HTMLButtonElement;
    delete unlabelled.dataset.id;
    unlabelled.click();

    expect((component as any).draft.payslip).toEqual(before);
    expect(mutationSpy).not.toHaveBeenCalled();
  });

  it("never empties a collection or moves past its ends, even from a stale enabled control", async () => {
    const component = await mountCreator();
    const draft = () => (component as any).draft;
    const cases = [
      { template: "report", prefix: "report", list: () => draft().report.sections },
      { template: "letter", prefix: "letter", list: () => draft().letter.paragraphs },
      { template: "invoice", prefix: "invoice", list: () => draft().invoice.lineItems },
      { template: "payslip", prefix: "payslip", list: () => draft().payslip.lineItems },
      { template: "payslip", prefix: "payslip-deduction", list: () => draft().payslip.deductions },
      { template: "cv-modern", prefix: "cv-experience", list: () => draft().cv.experiences },
      { template: "cv-modern", prefix: "cv-education", list: () => draft().cv.education },
      { template: "cv-modern", prefix: "cv-section", list: () => draft().cv.additionalSections },
    ];

    for (const { template, prefix, list } of cases) {
      await switchTemplate(component, template);
      list().splice(1);
      (component as any).refreshUi();
      const before = ids(list());
      const mutationSpy = vi.spyOn(component as any, "handleDraftMutation");

      for (const action of ["remove", "move-up", "move-down"]) {
        const button = query<HTMLButtonElement>(component, `.${prefix}-${action}`);
        expect(button.disabled).toBe(true);
        button.disabled = false;
        button.click();
      }

      expect({ prefix, ids: ids(list()) }).toEqual({ prefix, ids: before });
      expect(mutationSpy).not.toHaveBeenCalled();
      mutationSpy.mockRestore();
    }
  });

  it("edits payslip identifiers and clamps watermark numbers to their allowed ranges", async () => {
    const component = await mountCreator();
    await switchTemplate(component, "payslip");
    const watermark = () => (component as any).draft.payslip.watermark;

    setInputValue(component, "#payslipNumber", "PAY-77");
    setChecked(component, "#payslipWatermarkEnabled", false);
    setInputValue(component, "#payslipPayDate", "2026-06-30", "change");
    setInputValue(component, "#payslipNotes", "Paid by bank transfer");

    expect((component as any).draft.payslip).toEqual(
      expect.objectContaining({
        payslipNumber: "PAY-77",
        payDate: "2026-06-30",
        notes: "Paid by bank transfer",
      }),
    );
    expect(watermark().enabled).toBe(false);

    const expectations: [string, string, string, number][] = [
      ["#payslipWatermarkOpacity", "", "opacity", 1],
      ["#payslipWatermarkOpacity", "95", "opacity", 60],
      ["#payslipWatermarkSize", "", "size", 10],
      ["#payslipWatermarkSize", "200", "size", 90],
      ["#payslipWatermarkRotation", "", "rotation", 0],
      ["#payslipWatermarkRotation", "-400", "rotation", -180],
      ["#payslipWatermarkRotation", "45", "rotation", 45],
    ];
    for (const [selector, value, field, expected] of expectations) {
      setInputValue(component, selector, value);
      expect({ selector, value, result: watermark()[field] }).toEqual({
        selector,
        value,
        result: expected,
      });
    }
  });

  it("restores a saved payslip and repairs damaged rows and watermark values", async () => {
    (persistence.get as any).mockResolvedValueOnce({
      template: "payslip",
      payslip: {
        companyName: "Northstar Ltd",
        currency: "EUR",
        includeCompanyNameInHeader: false,
        lineItems: [{ description: "Salary", quantity: Number.NaN, unitPrice: 4000 }],
        deductions: [
          { id: "tax", description: null, quantity: 1, unitPrice: Number.POSITIVE_INFINITY },
        ],
        watermark: {
          enabled: false,
          source: "text",
          style: "bogus",
          opacity: 500,
          size: 1,
          rotation: -999,
        },
      },
    });

    const restored = await mountCreator();
    const { payslip } = (restored as any).draft;

    expect(payslip.lineItems[0].id).toBeTruthy();
    expect(payslip.lineItems[0]).toEqual(
      expect.objectContaining({ description: "Salary", quantity: 0, unitPrice: 4000 }),
    );
    expect(payslip.deductions[0]).toEqual({
      id: "tax",
      description: "",
      quantity: 1,
      unitPrice: 0,
    });
    expect(payslip.watermark).toEqual(
      expect.objectContaining({
        enabled: false,
        source: "text",
        style: "centered",
        text: "CONFIDENTIAL",
        opacity: 60,
        size: 10,
        rotation: -180,
      }),
    );
    expect(query(restored, "#draftStatusText").textContent).toBe(
      "Previous draft restored from this browser.",
    );
    expect(query<HTMLSelectElement>(restored, "#payslipCurrency").value).toBe("EUR");
    expect(query<HTMLInputElement>(restored, "#payslipCompanyNameHeaderToggle").checked).toBe(
      false,
    );
    expect(query<HTMLInputElement>(restored, "#payslipWatermarkEnabled").checked).toBe(false);
    expect(query<HTMLInputElement>(restored, "#payslipWatermarkText").value).toBe("CONFIDENTIAL");
    expect(query<HTMLInputElement>(restored, "#payslipWatermarkOpacity").value).toBe("60");
    expect(query<HTMLButtonElement>(restored, ".payslip-remove").disabled).toBe(true);
    expect(query<HTMLButtonElement>(restored, ".payslip-deduction-remove").disabled).toBe(true);
    expect(payslipTotals(restored)).toEqual({
      earnings: "€0.00",
      deductions: "-€0.00",
      net: "€0.00",
    });
  });

  it("restores a saved invoice and repairs rows with missing ids or amounts", async () => {
    (persistence.get as any).mockResolvedValueOnce({
      template: "invoice",
      invoice: {
        currency: "EUR",
        includeBusinessNameInHeader: false,
        lineItems: [
          { description: undefined, quantity: 2, unitPrice: Number.NaN },
          { id: "kept", description: "Retainer", quantity: Number.NaN, unitPrice: 300 },
        ],
      },
    });

    const restored = await mountCreator();
    const items = (restored as any).draft.invoice.lineItems;

    expect(items[0].id).toBeTruthy();
    expect(items[0]).toEqual(expect.objectContaining({ description: "", unitPrice: 0 }));
    expect(items[1]).toEqual({ id: "kept", description: "Retainer", quantity: 0, unitPrice: 300 });
    expect(query<HTMLSelectElement>(restored, "#invoiceCurrency").value).toBe("EUR");
    expect(query<HTMLInputElement>(restored, "#invoiceBusinessNameHeaderToggle").checked).toBe(
      false,
    );
    expect(query(restored, ".creator-invoice-total strong").textContent).toBe("€0.00");
  });

  it("restores a saved CV whose entries lost ids, fields, and section labels", async () => {
    (persistence.get as any).mockResolvedValueOnce({
      template: "cv-harvard",
      cv: {
        experienceLabel: "",
        educationLabel: "",
        experiences: [{ role: "Designer" }],
        education: [{ qualification: "BA Design" }],
        additionalSections: [{ title: undefined, body: undefined }],
      },
    });

    const restored = await mountCreator();
    const { cv } = (restored as any).draft;

    expect([cv.experiences[0].id, cv.education[0].id, cv.additionalSections[0].id]).toEqual([
      expect.any(String),
      expect.any(String),
      expect.any(String),
    ]);
    expect(cv.experiences[0]).toEqual(
      expect.objectContaining({ role: "Designer", organization: "", achievements: "" }),
    );
    expect(cv.education[0]).toEqual(
      expect.objectContaining({ qualification: "BA Design", institution: "", details: "" }),
    );
    expect(query(restored, "#cvExperienceHeading").textContent).toBe("Experience");
    expect(query(restored, "#cvEducationHeading").textContent).toBe("Education");
    expect(query<HTMLInputElement>(restored, ".cv-section-title").value).toBe("");
  });

  it("renames the education heading as its label is edited", async () => {
    const component = await mountCreator();
    await switchTemplate(component, "cv-harvard");

    setInputValue(component, "#cvEducationLabel", "  ");
    expect(query(component, "#cvEducationHeading").textContent).toBe("Education");
    setInputValue(component, "#cvEducationLabel", "Study");
    expect(query(component, "#cvEducationHeading").textContent).toBe("Study");

    query(component, "#cvEducationHeading").remove();
    query(component, "#cvExperienceHeading").remove();
    setInputValue(component, "#cvEducationLabel", "Training");
    setInputValue(component, "#cvExperienceLabel", "Roles");
    expect((component as any).draft.cv).toEqual(
      expect.objectContaining({ educationLabel: "Training", experienceLabel: "Roles" }),
    );
  });

  it("only accepts valid watermark images and reports read failures", async () => {
    const component = await mountCreator();
    const dialog = document.getElementById("globalDialog") as any;
    await switchTemplate(component, "payslip");
    setInputValue(component, "#payslipWatermarkSource", "custom-image", "change");
    const input = query<HTMLInputElement>(component, "#watermarkImageInput");
    const watermark = () => (component as any).draft.payslip.watermark;
    const choose = async (files: File[]) => {
      Object.defineProperty(input, "files", { configurable: true, value: files });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
    };

    const clickSpy = vi.spyOn(input, "click");
    query<HTMLButtonElement>(component, "#uploadWatermarkImageBtn").click();
    expect(clickSpy).toHaveBeenCalled();

    await choose([]);
    expect(dialog.show).not.toHaveBeenCalled();

    await choose([new File(["notes"], "notes.txt", { type: "text/plain" })]);
    expect(dialog.show).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("Invalid file type"),
      }),
    );
    expect(watermark().customImageDataUrl).toBeNull();

    const originalFileReader = globalThis.FileReader;
    class NoDetailErrorReader {
      error = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.onerror?.();
      }
    }
    globalThis.FileReader = NoDetailErrorReader as any;
    try {
      await choose([new File(["png"], "mark.png", { type: "image/png" })]);
    } finally {
      globalThis.FileReader = originalFileReader;
    }

    expect(dialog.show).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "error",
        message: "Could not read the selected watermark image.",
      }),
    );
    expect(watermark().customImageDataUrl).toBeNull();
    expect(watermark().customImageFileName).toBeNull();
  });

  it("ignores a slower, older preview that finishes after a newer one", async () => {
    const component = await mountCreator();
    await flush();
    const meta = () => document.querySelector("#previewMetaText")?.textContent;
    const older = deferred<any>();
    creatorMocks.createPdfFromDraft
      .mockImplementationOnce(() => older.promise)
      .mockResolvedValueOnce({ bytes: new Uint8Array([7]), pageCount: 3, outputName: "newer.pdf" });
    previewMock.load.mockClear();

    const first = (component as any).refreshPreview();
    await (component as any).refreshPreview();
    older.resolve({ bytes: new Uint8Array([9]), pageCount: 9, outputName: "older.pdf" });
    await first;

    expect((component as any).previewPageCount).toBe(3);
    expect(meta()).toBe("3 pages · newer.pdf");
    expect(previewMock.load).toHaveBeenCalledTimes(1);
    expect(previewMock.load).toHaveBeenCalledWith(new Uint8Array([7]));
  });

  it("ignores an older preview failure once a newer preview has succeeded", async () => {
    const component = await mountCreator();
    await flush();
    const older = deferred<any>();
    creatorMocks.createPdfFromDraft
      .mockImplementationOnce(() => older.promise)
      .mockResolvedValueOnce({ bytes: new Uint8Array([4]), pageCount: 1, outputName: "fresh.pdf" });

    const first = (component as any).refreshPreview();
    await (component as any).refreshPreview();
    older.reject(new Error("late failure"));
    await first;

    const previewState = document.querySelector("#previewState") as HTMLElement;
    expect(previewState.classList.contains("error")).toBe(false);
    expect(previewState.classList.contains("hidden")).toBe(true);
    expect(document.querySelector("#previewMetaText")?.textContent).toBe("1 page · fresh.pdf");
    expect(query(component, "#creatorSummary").textContent).toContain("· 1 preview page");
    expect(query(component, "#creatorSummary").textContent).not.toContain("pages");
  });

  it("does not let an older preview overwrite the page label after its canvas load", async () => {
    const component = await mountCreator();
    await flush();
    const slowLoad = deferred<void>();
    creatorMocks.createPdfFromDraft
      .mockResolvedValueOnce({ bytes: new Uint8Array([1]), pageCount: 4, outputName: "slow.pdf" })
      .mockResolvedValueOnce({ bytes: new Uint8Array([2]), pageCount: 2, outputName: "fast.pdf" });
    previewMock.load.mockImplementationOnce(() => slowLoad.promise);

    const first = (component as any).refreshPreview();
    await flush();
    await (component as any).refreshPreview();
    slowLoad.resolve();
    await first;

    expect(document.querySelector("#previewMetaText")?.textContent).toBe("2 pages · fast.pdf");
    expect((component as any).previewPageCount).toBe(2);
  });

  it("re-enables the Create PDF button when the editor re-renders during creation", async () => {
    const component = await mountCreator();
    await flush();
    const creation = deferred<any>();
    creatorMocks.createPdfFromDraft.mockImplementationOnce(() => creation.promise);

    query<HTMLButtonElement>(component, "#createPdfBtn").click();
    await switchTemplate(component, "invoice");

    const busyButton = query<HTMLButtonElement>(component, "#createPdfBtn");
    expect(busyButton.disabled).toBe(true);
    expect(busyButton.textContent?.trim()).toBe("Creating...");

    creation.resolve({ bytes: new Uint8Array([5]), pageCount: 1, outputName: "invoice.pdf" });
    await vi.waitFor(() => expect((component as any).isCreating).toBe(false));

    const button = query<HTMLButtonElement>(component, "#createPdfBtn");
    expect(persistence.addJob).toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    expect(button.textContent?.trim()).toBe("Create PDF");
  });

  it("keeps progress and success details on screen when the editor re-renders during creation", async () => {
    const component = await mountCreator();
    await flush();
    const creation = deferred<any>();
    creatorMocks.createPdfFromDraft.mockImplementationOnce(() => creation.promise);

    query<HTMLButtonElement>(component, "#createPdfBtn").click();
    await switchTemplate(component, "invoice");

    expect(query(component, "#progressSection").classList.contains("hidden")).toBe(false);

    creation.resolve({ bytes: new Uint8Array([5]), pageCount: 3, outputName: "invoice.pdf" });
    await vi.waitFor(() => expect((component as any).isCreating).toBe(false));

    expect(query(component, "#successDetails").textContent).toBe("Invoice created with 3 pages.");
    expect(query(component, "#successMessage").classList.contains("hidden")).toBe(false);
    expect(query(component, "#progressSection").classList.contains("hidden")).toBe(true);
  });

  it("opens a saved draft with unknown settings as a normal default document", async () => {
    (persistence.get as any).mockResolvedValueOnce({
      fileName: "old-brochure",
      template: "brochure",
      pageSize: "a3",
      orientation: "sideways",
      invoice: { currency: "JPY" },
    });

    const restored = await mountCreator();

    expect(restored.innerHTML).not.toContain("undefined");
    expect(query(restored, '[data-template="report"]').classList.contains("active")).toBe(true);
    expect(query<HTMLInputElement>(restored, "#reportTitle")).toBeTruthy();
    expect(query<HTMLSelectElement>(restored, "#pageSizeSelect").value).toBe("letter");
    expect(query<HTMLSelectElement>(restored, "#orientationSelect").value).toBe("portrait");
    expect(query(restored, "#creatorSummary").textContent).toContain(
      "Project Report · LETTER portrait",
    );
    expect(creatorMocks.createPdfFromDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ template: "report", pageSize: "letter" }),
    );

    await switchTemplate(restored, "invoice");
    expect(query<HTMLSelectElement>(restored, "#invoiceCurrency").value).toBe("USD");
  });

  it("describes a one-page result in the singular", async () => {
    creatorMocks.createPdfFromDraft.mockResolvedValue({
      bytes: new Uint8Array([1]),
      pageCount: 1,
      outputName: "brief.pdf",
    });
    const component = await mountCreator();

    await (component as any).startCreation();

    expect(query(component, "#successDetails").textContent).toBe(
      "Project Report created with 1 page.",
    );
    expect(document.querySelector("#previewMetaText")?.textContent).toBe("1 page · brief.pdf");
    expect(persistence.addJob).toHaveBeenCalled();
  });

  it("floats the preview when the window grows and keeps it on screen when it shrinks", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    const component = await mountCreator();
    const refreshSpy = vi.spyOn(component as any, "refreshUi");

    window.dispatchEvent(new Event("resize"));
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(document.body.querySelector("#floatingPreview")).toBeFalsy();

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    window.dispatchEvent(new Event("resize"));
    const portal = document.body.querySelector("#floatingPreview") as HTMLElement;
    expect(portal).toBeTruthy();
    expect(component.querySelector(".creator-floating-banner")).toBeTruthy();

    (component as any).previewPosition = { x: 1000, y: 112 };
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1300 });
    window.dispatchEvent(new Event("resize"));
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(portal.style.left).toBe(`${1300 - 420 - 24}px`);
    expect(portal.style.top).toBe("112px");
  });

  it("restores the last preview after docking and survives a failed restore", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    creatorMocks.createPdfFromDraft.mockResolvedValue({
      bytes: new Uint8Array([1]),
      pageCount: 1,
      outputName: "one.pdf",
    });
    const component = await mountCreator();
    await flush();

    query<HTMLButtonElement>(document.body as any, "#togglePreviewModeBtn").click();
    await flush();
    expect(query(component, "#previewMetaText").textContent).toBe("1 page · one.pdf");
    expect(query(component, "#creatorSummary").textContent).toContain("· 1 preview page");

    previewMock.load.mockRejectedValueOnce(new Error("canvas lost"));
    query<HTMLButtonElement>(component, "#togglePreviewModeBtn").click();
    await flush();

    const portal = document.body.querySelector("#floatingPreview") as HTMLElement;
    expect(portal.querySelector("#previewMetaText")?.textContent).toBe("1 page ready");
    expect(portal.querySelector("#previewState")?.classList.contains("hidden")).toBe(false);
  });

  it("ignores the about and account buttons when their dialogs are unavailable", async () => {
    const component = await mountCreator();
    delete (window as any).showAbout;
    delete (window as any).showAccountModal;

    expect(() => {
      query<HTMLButtonElement>(component, "#aboutBtn").click();
      query<HTMLButtonElement>(component, "#userAccountBtn").click();
    }).not.toThrow();
  });
});

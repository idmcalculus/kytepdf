import { logger } from "../utils/logger.ts";
import {
  type CreatorCvEducation,
  type CreatorCvExperience,
  type CreatorCvExtraSection,
  type CreatorInvoiceItem,
  type CreatorParagraph,
  type CreatorSection,
  calculateInvoiceTotal,
  createDefaultCreatorDraft,
  createDefaultCvEducation,
  createDefaultCvExperience,
  createDefaultCvExtraSection,
  createDefaultInvoiceItem,
  createDefaultLetterParagraph,
  createDefaultReportSection,
  createPdfFromDraft,
  getTemplateLabel,
  type PdfCreatorDraft,
  type PdfCreatorTemplate,
} from "../utils/pdfCreator.ts";
import { PdfPreviewController } from "../utils/pdfPreview.ts";
import { moveArrayItem } from "../utils/pdfUtils.ts";
import { persistence } from "../utils/persistence.ts";
import { BaseComponent } from "./BaseComponent.ts";

type DraftState = "idle" | "saving" | "saved" | "restored";
type PreviewMode = "floating" | "docked";

const FLOATING_PREVIEW_BREAKPOINT = 1280;
const FLOATING_PREVIEW_WIDTH = 420;
const FLOATING_PREVIEW_GUTTER = 24;
const FLOATING_PREVIEW_TOP = 112;
const FLOATING_PREVIEW_HEIGHT = 560;

const TEMPLATE_DESCRIPTIONS: Record<PdfCreatorTemplate, string> = {
  report: "Polished reports, proposals, and briefs with structured sections.",
  letter: "Formal letters with sender, recipient, subject, and signature blocks.",
  invoice: "Client-ready invoices with line items, totals, and payment notes.",
  "cv-harvard": "Classic Harvard-style CV with editable section titles and ATS-friendly structure.",
  "cv-modern": "Contemporary CV with stronger visual hierarchy and the same structured data model.",
};

const TEMPLATE_OPTIONS: PdfCreatorTemplate[] = [
  "report",
  "letter",
  "invoice",
  "cv-harvard",
  "cv-modern",
];

export class PdfCreator extends BaseComponent {
  protected toolKey = "create-pdf";

  private draft: PdfCreatorDraft = createDefaultCreatorDraft();
  private previewController: PdfPreviewController | null = null;
  private floatingPreviewPortal: HTMLElement | null = null;
  private previewPageCount: number | null = null;
  private lastPreviewBytes: Uint8Array | null = null;
  private lastPreviewOutputName: string | null = null;
  private draftState: DraftState = "idle";
  private previewMode: PreviewMode = "floating";
  private previewPosition = { x: 0, y: FLOATING_PREVIEW_TOP };
  private hasInitialized = false;
  private previewTimer: number | null = null;
  private saveTimer: number | null = null;
  private previewToken = 0;
  private isCreating = false;
  private activeDragCleanup: (() => void) | null = null;
  private readonly handleWindowResize = () => this.onWindowResize();

  render() {
    const draft = this.draft;
    const isPreviewFloating = this.isFloatingPreviewActive();

    this.innerHTML = `
      <div class="tool-view">
        ${this.getBackButton()}

        <h1>Create PDF</h1>
        <p class="subtitle">Compose polished PDFs from structured templates, brand them, and export them locally.</p>

        <div class="creator-header-stack">
          <div class="creator-status-bar">
            <div>
              <strong>Local draft:</strong>
              <span id="draftStatusText">${this.getDraftStatusText()}</span>
            </div>
            <button id="resetDraftBtn" class="btn btn-secondary btn-sm" style="width: auto;">Start Over</button>
          </div>

          ${
            isPreviewFloating
              ? `
            <div class="creator-floating-banner">
              <strong>Live preview is floating</strong>
              <span>Keep editing below. Drag the preview anywhere or dock it back into the page.</span>
            </div>
          `
              : ""
          }
        </div>

        <div class="creator-layout ${isPreviewFloating ? "preview-floating" : ""}">
          <div class="creator-sidebar">
            <div class="card creator-card">
              <div class="creator-card-header">
                <div>
                  <h3>Template</h3>
                  <p>Pick the document shape first. You can switch at any time.</p>
                </div>
              </div>
              <div class="creator-template-grid">
                ${TEMPLATE_OPTIONS.map(
                  (template) => `
                  <button
                    class="creator-template-option ${draft.template === template ? "active" : ""}"
                    data-template="${template}"
                    type="button"
                  >
                    <span class="creator-template-title">${getTemplateLabel(template)}</span>
                    <span class="creator-template-desc">${TEMPLATE_DESCRIPTIONS[template]}</span>
                  </button>
                `,
                ).join("")}
              </div>
            </div>

            <div class="card creator-card">
              <div class="creator-card-header">
                <div>
                  <h3>Document Settings</h3>
                  <p>Control output name, page size, orientation, and overall style.</p>
                </div>
              </div>

              <div class="control-group">
                <label for="fileNameInput">File Name</label>
                <input type="text" id="fileNameInput" value="${this.sanitize(draft.fileName)}" placeholder="kyte-document" />
              </div>

              <div class="creator-settings-grid">
                <div class="control-group">
                  <label for="pageSizeSelect">Page Size</label>
                  <select id="pageSizeSelect">
                    <option value="letter" ${draft.pageSize === "letter" ? "selected" : ""}>Letter</option>
                    <option value="a4" ${draft.pageSize === "a4" ? "selected" : ""}>A4</option>
                  </select>
                </div>

                <div class="control-group">
                  <label for="orientationSelect">Orientation</label>
                  <select id="orientationSelect">
                    <option value="portrait" ${draft.orientation === "portrait" ? "selected" : ""}>Portrait</option>
                    <option value="landscape" ${draft.orientation === "landscape" ? "selected" : ""}>Landscape</option>
                  </select>
                </div>
              </div>

              <div class="creator-settings-grid">
                <div class="control-group">
                  <label for="accentColorInput">Accent Color</label>
                  <input type="color" id="accentColorInput" value="${this.sanitize(draft.accentColor)}" />
                </div>

                <div class="control-group">
                  <label>&nbsp;</label>
                  <label class="creator-inline-check">
                    <input type="checkbox" id="pageNumbersToggle" ${draft.includePageNumbers ? "checked" : ""} />
                    <span>Include page numbers</span>
                  </label>
                </div>
              </div>
            </div>

            <div class="card creator-card">
              <div class="creator-card-header">
                <div>
                  <h3>Branding</h3>
                  <p>Optional. Add a logo that will be embedded into the exported PDF.</p>
                </div>
              </div>

              <div class="creator-brand-row">
                <button id="uploadLogoBtn" class="btn btn-secondary btn-sm" style="width: auto;" type="button">
                  ${draft.logoDataUrl ? "Replace Logo" : "Upload Logo"}
                </button>
                ${
                  draft.logoDataUrl
                    ? '<button id="clearLogoBtn" class="btn btn-secondary btn-sm" style="width: auto;" type="button">Remove Logo</button>'
                    : ""
                }
              </div>
              <p class="creator-logo-caption">
                ${
                  draft.logoFileName
                    ? `Current logo: ${this.sanitize(draft.logoFileName)}`
                    : "PNG or JPG recommended. The image is stored locally with your draft."
                }
              </p>
            </div>

            <div class="card creator-card">
              <div class="creator-card-header">
                <div>
                  <h3>${getTemplateLabel(draft.template)} Content</h3>
                  <p>${TEMPLATE_DESCRIPTIONS[draft.template]}</p>
                </div>
              </div>
              ${this.renderTemplateEditor()}
            </div>

            <div class="creator-action-row">
              <span id="creatorSummary">${this.getSummaryText()}</span>
              <button id="createPdfBtn" class="btn btn-primary" ${this.isCreating ? "disabled" : ""}>
                ${this.isCreating ? "Creating..." : "Create PDF"}
              </button>
            </div>
          </div>

          ${
            isPreviewFloating
              ? ""
              : `
            <div class="creator-preview-column">
              ${this.renderPreviewCard(false)}
            </div>
          `
          }
        </div>

        <input type="file" id="logoInput" class="hidden" accept="image/png,image/jpeg" />

        ${this.getProgressSection("Preparing document...")}

        <div id="successMessage" class="success-message hidden" style="margin-top: 2rem;">
          <p id="successTitle" style="font-size: 1.1rem; margin-bottom: 0.5rem;">PDF Created</p>
          <div id="successDetails" style="font-size: 0.95rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.6;">
            Your new document is ready to download.
          </div>
          <button id="downloadLink" class="btn btn-primary">Download PDF</button>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    this.setupChromeListeners();
    this.mountFloatingPreviewPortal();
    this.setupPreviewModeControls();

    this.previewController = this.createPreviewController();

    this.querySelectorAll<HTMLElement>("[data-template]").forEach((button) => {
      button.onclick = () => {
        const template = button.dataset.template as PdfCreatorTemplate;
        if (template === this.draft.template) return;
        this.draft.template = template;
        this.refreshUi();
        this.handleDraftMutation();
      };
    });

    this.bindInput("#fileNameInput", (value) => {
      this.draft.fileName = value.replace(/\.pdf$/i, "").trimStart();
    });
    this.bindSelect("#pageSizeSelect", (value) => {
      this.draft.pageSize = value as PdfCreatorDraft["pageSize"];
    });
    this.bindSelect("#orientationSelect", (value) => {
      this.draft.orientation = value as PdfCreatorDraft["orientation"];
    });
    this.bindInput("#accentColorInput", (value) => {
      this.draft.accentColor = value;
    });
    this.bindCheckbox("#pageNumbersToggle", (checked) => {
      this.draft.includePageNumbers = checked;
    });

    this.bindTemplateEditor();

    const uploadLogoBtn = this.querySelector("#uploadLogoBtn") as HTMLButtonElement | null;
    const clearLogoBtn = this.querySelector("#clearLogoBtn") as HTMLButtonElement | null;
    const logoInput = this.querySelector("#logoInput") as HTMLInputElement | null;
    const resetDraftBtn = this.querySelector("#resetDraftBtn") as HTMLButtonElement | null;
    const createPdfBtn = this.querySelector("#createPdfBtn") as HTMLButtonElement | null;

    uploadLogoBtn?.addEventListener("click", () => logoInput?.click());
    clearLogoBtn?.addEventListener("click", () => {
      this.draft.logoDataUrl = null;
      this.draft.logoFileName = null;
      this.refreshUi();
      this.handleDraftMutation();
    });
    logoInput?.addEventListener("change", async () => {
      const file = logoInput.files?.[0];
      if (!file) return;
      if (
        !(await this.validateFile(file, {
          maxSizeMB: 5,
          allowedTypes: ["image/png", "image/jpeg"],
        }))
      ) {
        logoInput.value = "";
        return;
      }

      try {
        this.draft.logoDataUrl = await this.fileToDataUrl(file);
        this.draft.logoFileName = file.name;
        this.refreshUi();
        this.handleDraftMutation();
      } catch (error) {
        logger.error("Failed to process logo upload", error);
        await this.showErrorDialog("Could not read the selected logo.");
      } finally {
        logoInput.value = "";
      }
    });

    resetDraftBtn?.addEventListener("click", () => {
      void this.resetDraft();
    });
    createPdfBtn?.addEventListener("click", () => {
      void this.startCreation();
    });

    if (!this.hasInitialized) {
      this.hasInitialized = true;
      window.addEventListener("resize", this.handleWindowResize);
      void this.initializeDraft();
    }
  }

  disconnectedCallback() {
    if (this.previewTimer !== null) {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.activeDragCleanup?.();
    this.activeDragCleanup = null;
    window.removeEventListener("resize", this.handleWindowResize);
    void this.previewController?.destroy();
    this.previewController = null;
    this.unmountFloatingPreviewPortal();
  }

  private renderPreviewCard(isFloating: boolean) {
    const canFloat = this.canFloatPreview();
    const modeLabel = isFloating ? "Dock Preview" : "Float Preview";
    const toggleButton = canFloat
      ? `<button id="togglePreviewModeBtn" class="btn btn-secondary btn-sm" style="width: auto;" type="button">${modeLabel}</button>`
      : "";
    const resetButton = isFloating
      ? '<button id="resetPreviewPositionBtn" class="btn btn-secondary btn-sm" style="width: auto;" type="button">Reset Position</button>'
      : "";

    return `
      <div class="card creator-preview-card ${isFloating ? "is-floating" : ""}">
        <div class="creator-card-header creator-preview-header">
          <div class="creator-preview-meta">
            <h3>Live Preview</h3>
            <p id="previewMetaText">${this.getPreviewMetaText()}</p>
          </div>
          ${toggleButton ? `<div class="creator-preview-controls">${toggleButton}</div>` : ""}
        </div>

        <div class="creator-preview-stage">
          <canvas id="previewCanvas"></canvas>
          <div id="previewState" class="creator-preview-state">
            Preview updates automatically as you edit.
          </div>
        </div>

        <div class="creator-preview-nav">
          <button id="prevPreviewPage" class="btn btn-secondary btn-sm" style="width: auto;">Prev</button>
          <span id="previewPageIndicator">Preview unavailable</span>
          <button id="nextPreviewPage" class="btn btn-secondary btn-sm" style="width: auto;">Next</button>
        </div>

        ${
          resetButton
            ? `
          <div class="creator-preview-footer">
            ${resetButton}
          </div>
        `
            : ""
        }
      </div>
    `;
  }

  private renderTemplateEditor() {
    switch (this.draft.template) {
      case "report":
        return this.renderReportEditor();
      case "letter":
        return this.renderLetterEditor();
      case "invoice":
        return this.renderInvoiceEditor();
      case "cv-harvard":
      case "cv-modern":
        return this.renderCvEditor();
    }
  }

  private renderReportEditor() {
    return `
      <div class="control-group">
        <label for="reportTitle">Title</label>
        <input type="text" id="reportTitle" value="${this.sanitize(this.draft.report.title)}" />
      </div>
      <div class="control-group">
        <label for="reportSubtitle">Subtitle</label>
        <input type="text" id="reportSubtitle" value="${this.sanitize(this.draft.report.subtitle)}" />
      </div>
      <div class="control-group">
        <label for="reportAuthor">Author</label>
        <input type="text" id="reportAuthor" value="${this.sanitize(this.draft.report.author)}" />
      </div>
      <div class="control-group">
        <label for="reportSummary">Executive Summary</label>
        <textarea id="reportSummary" rows="4">${this.sanitize(this.draft.report.summary)}</textarea>
      </div>
      <div class="creator-repeatable-header">
        <h4>Sections</h4>
        <button id="addReportSectionBtn" class="btn btn-secondary btn-sm" style="width: auto;" type="button">Add Section</button>
      </div>
      <div class="creator-repeatable-list">
        ${this.draft.report.sections
          .map(
            (section, index) => `
          <div class="creator-item-card">
            <div class="creator-item-toolbar">
              <span>Section ${index + 1}</span>
              <div class="creator-item-actions">
                <button type="button" class="action-btn report-move-up" data-id="${section.id}" ${index === 0 ? "disabled" : ""}>↑</button>
                <button type="button" class="action-btn report-move-down" data-id="${section.id}" ${index === this.draft.report.sections.length - 1 ? "disabled" : ""}>↓</button>
                <button type="button" class="action-btn report-remove" data-id="${section.id}" ${this.draft.report.sections.length === 1 ? "disabled" : ""}>×</button>
              </div>
            </div>
            <div class="control-group">
              <label>Heading</label>
              <input type="text" class="report-section-heading" data-id="${section.id}" value="${this.sanitize(section.heading)}" />
            </div>
            <div class="control-group">
              <label>Body</label>
              <textarea class="report-section-body" data-id="${section.id}" rows="5">${this.sanitize(section.body)}</textarea>
            </div>
          </div>
        `,
          )
          .join("")}
      </div>
    `;
  }

  private renderLetterEditor() {
    return `
      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="letterSenderName">Sender Name</label>
          <input type="text" id="letterSenderName" value="${this.sanitize(this.draft.letter.senderName)}" />
        </div>
        <div class="control-group">
          <label for="letterDate">Date</label>
          <input type="date" id="letterDate" value="${this.sanitize(this.draft.letter.date)}" />
        </div>
      </div>

      <div class="control-group">
        <label for="letterSenderDetails">Sender Details</label>
        <textarea id="letterSenderDetails" rows="3">${this.sanitize(this.draft.letter.senderDetails)}</textarea>
      </div>

      <div class="control-group">
        <label for="letterRecipientName">Recipient Name</label>
        <input type="text" id="letterRecipientName" value="${this.sanitize(this.draft.letter.recipientName)}" />
      </div>
      <div class="control-group">
        <label for="letterRecipientDetails">Recipient Details</label>
        <textarea id="letterRecipientDetails" rows="3">${this.sanitize(this.draft.letter.recipientDetails)}</textarea>
      </div>

      <div class="control-group">
        <label for="letterSubject">Subject</label>
        <input type="text" id="letterSubject" value="${this.sanitize(this.draft.letter.subject)}" />
      </div>
      <div class="control-group">
        <label for="letterGreeting">Greeting</label>
        <input type="text" id="letterGreeting" value="${this.sanitize(this.draft.letter.greeting)}" />
      </div>

      <div class="creator-repeatable-header">
        <h4>Body Paragraphs</h4>
        <button id="addLetterParagraphBtn" class="btn btn-secondary btn-sm" style="width: auto;" type="button">Add Paragraph</button>
      </div>
      <div class="creator-repeatable-list">
        ${this.draft.letter.paragraphs
          .map(
            (paragraph, index) => `
          <div class="creator-item-card">
            <div class="creator-item-toolbar">
              <span>Paragraph ${index + 1}</span>
              <div class="creator-item-actions">
                <button type="button" class="action-btn letter-move-up" data-id="${paragraph.id}" ${index === 0 ? "disabled" : ""}>↑</button>
                <button type="button" class="action-btn letter-move-down" data-id="${paragraph.id}" ${index === this.draft.letter.paragraphs.length - 1 ? "disabled" : ""}>↓</button>
                <button type="button" class="action-btn letter-remove" data-id="${paragraph.id}" ${this.draft.letter.paragraphs.length === 1 ? "disabled" : ""}>×</button>
              </div>
            </div>
            <div class="control-group">
              <label>Paragraph text</label>
              <textarea class="letter-paragraph-text" data-id="${paragraph.id}" rows="4">${this.sanitize(paragraph.text)}</textarea>
            </div>
          </div>
        `,
          )
          .join("")}
      </div>

      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="letterClosing">Closing</label>
          <input type="text" id="letterClosing" value="${this.sanitize(this.draft.letter.closing)}" />
        </div>
        <div class="control-group">
          <label for="letterSignature">Signature</label>
          <input type="text" id="letterSignature" value="${this.sanitize(this.draft.letter.signature)}" />
        </div>
      </div>
    `;
  }

  private renderInvoiceEditor() {
    const total = calculateInvoiceTotal(this.draft.invoice.lineItems);
    return `
      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="invoiceBusinessName">Business Name</label>
          <input type="text" id="invoiceBusinessName" value="${this.sanitize(this.draft.invoice.businessName)}" />
        </div>
        <div class="control-group">
          <label for="invoiceNumber">Invoice #</label>
          <input type="text" id="invoiceNumber" value="${this.sanitize(this.draft.invoice.invoiceNumber)}" />
        </div>
      </div>

      <div class="control-group">
        <label for="invoiceBusinessDetails">Business Details</label>
        <textarea id="invoiceBusinessDetails" rows="3">${this.sanitize(this.draft.invoice.businessDetails)}</textarea>
      </div>

      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="invoiceClientName">Client Name</label>
          <input type="text" id="invoiceClientName" value="${this.sanitize(this.draft.invoice.clientName)}" />
        </div>
        <div class="control-group">
          <label for="invoiceCurrency">Currency</label>
          <select id="invoiceCurrency">
            <option value="USD" ${this.draft.invoice.currency === "USD" ? "selected" : ""}>USD</option>
            <option value="EUR" ${this.draft.invoice.currency === "EUR" ? "selected" : ""}>EUR</option>
            <option value="GBP" ${this.draft.invoice.currency === "GBP" ? "selected" : ""}>GBP</option>
          </select>
        </div>
      </div>

      <div class="control-group">
        <label for="invoiceClientDetails">Client Details</label>
        <textarea id="invoiceClientDetails" rows="3">${this.sanitize(this.draft.invoice.clientDetails)}</textarea>
      </div>

      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="invoiceIssueDate">Issue Date</label>
          <input type="date" id="invoiceIssueDate" value="${this.sanitize(this.draft.invoice.issueDate)}" />
        </div>
        <div class="control-group">
          <label for="invoiceDueDate">Due Date</label>
          <input type="date" id="invoiceDueDate" value="${this.sanitize(this.draft.invoice.dueDate)}" />
        </div>
      </div>

      <div class="control-group">
        <label for="invoicePaymentDetails">Payment Details (Optional)</label>
        <textarea
          id="invoicePaymentDetails"
          rows="4"
          placeholder="Bank name, account number, sort code, IBAN, SWIFT, or any payment instructions."
        >${this.sanitize(this.draft.invoice.paymentDetails)}</textarea>
      </div>

      <div class="control-group">
        <label for="invoicePaymentLink">Payment Link (Optional)</label>
        <input
          type="url"
          id="invoicePaymentLink"
          value="${this.sanitize(this.draft.invoice.paymentLink)}"
          placeholder="https://pay.example.com/invoice/123"
        />
      </div>

      <div class="creator-repeatable-header">
        <h4>Line Items</h4>
        <button id="addInvoiceItemBtn" class="btn btn-secondary btn-sm" style="width: auto;" type="button">Add Item</button>
      </div>
      <div class="creator-repeatable-list">
        ${this.draft.invoice.lineItems
          .map(
            (item, index) => `
          <div class="creator-item-card">
            <div class="creator-item-toolbar">
              <span>Item ${index + 1}</span>
              <div class="creator-item-actions">
                <button type="button" class="action-btn invoice-move-up" data-id="${item.id}" ${index === 0 ? "disabled" : ""}>↑</button>
                <button type="button" class="action-btn invoice-move-down" data-id="${item.id}" ${index === this.draft.invoice.lineItems.length - 1 ? "disabled" : ""}>↓</button>
                <button type="button" class="action-btn invoice-remove" data-id="${item.id}" ${this.draft.invoice.lineItems.length === 1 ? "disabled" : ""}>×</button>
              </div>
            </div>
            <div class="control-group">
              <label>Description</label>
              <textarea class="invoice-item-description" data-id="${item.id}" rows="3">${this.sanitize(item.description)}</textarea>
            </div>
            <div class="creator-settings-grid">
              <div class="control-group">
                <label>Quantity</label>
                <input type="number" min="0" step="1" class="invoice-item-quantity" data-id="${item.id}" value="${item.quantity}" />
              </div>
              <div class="control-group">
                <label>Unit Price</label>
                <input type="number" min="0" step="0.01" class="invoice-item-rate" data-id="${item.id}" value="${item.unitPrice}" />
              </div>
            </div>
          </div>
        `,
          )
          .join("")}
      </div>

      <div class="creator-invoice-total">
        <span>Total</span>
        <strong>${total.toLocaleString(undefined, {
          style: "currency",
          currency: this.draft.invoice.currency,
          maximumFractionDigits: 2,
        })}</strong>
      </div>

      <div class="control-group">
        <label for="invoiceNotes">Notes</label>
        <textarea id="invoiceNotes" rows="4">${this.sanitize(this.draft.invoice.notes)}</textarea>
      </div>
    `;
  }

  private renderCvEditor() {
    const { cv } = this.draft;
    return `
      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="cvFullName">Full Name</label>
          <input type="text" id="cvFullName" value="${this.sanitize(cv.fullName)}" />
        </div>
        <div class="control-group">
          <label for="cvProfessionalTitle">Professional Title</label>
          <input type="text" id="cvProfessionalTitle" value="${this.sanitize(cv.professionalTitle)}" />
        </div>
      </div>

      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="cvEmail">Email</label>
          <input type="email" id="cvEmail" value="${this.sanitize(cv.email)}" />
        </div>
        <div class="control-group">
          <label for="cvPhone">Phone</label>
          <input type="text" id="cvPhone" value="${this.sanitize(cv.phone)}" />
        </div>
      </div>

      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="cvLocation">Location</label>
          <input type="text" id="cvLocation" value="${this.sanitize(cv.location)}" />
        </div>
        <div class="control-group">
          <label for="cvWebsite">Website or Portfolio</label>
          <input type="text" id="cvWebsite" value="${this.sanitize(cv.website)}" />
        </div>
      </div>

      <div class="control-group">
        <label for="cvLinkedin">LinkedIn</label>
        <input type="text" id="cvLinkedin" value="${this.sanitize(cv.linkedin)}" />
      </div>

      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="cvProfileLabel">Profile Section Title</label>
          <input type="text" id="cvProfileLabel" value="${this.sanitize(cv.profileLabel)}" />
        </div>
        <div class="control-group">
          <label for="cvExperienceLabel">Experience Section Title</label>
          <input type="text" id="cvExperienceLabel" value="${this.sanitize(cv.experienceLabel)}" />
        </div>
      </div>

      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="cvEducationLabel">Education Section Title</label>
          <input type="text" id="cvEducationLabel" value="${this.sanitize(cv.educationLabel)}" />
        </div>
        <div class="control-group">
          <label for="cvSkillsLabel">Skills Section Title</label>
          <input type="text" id="cvSkillsLabel" value="${this.sanitize(cv.skillsLabel)}" />
        </div>
      </div>

      <div class="control-group">
        <label for="cvProfile">Profile Content</label>
        <textarea id="cvProfile" rows="4">${this.sanitize(cv.profile)}</textarea>
      </div>

      <div class="creator-repeatable-header">
        <h4 id="cvExperienceHeading">${this.sanitize(cv.experienceLabel || "Experience")}</h4>
        <button id="addCvExperienceBtn" class="btn btn-secondary btn-sm" style="width: auto;" type="button">Add Role</button>
      </div>
      <div class="creator-repeatable-list">
        ${cv.experiences
          .map(
            (entry, index) => `
          <div class="creator-item-card">
            <div class="creator-item-toolbar">
              <span>Role ${index + 1}</span>
              <div class="creator-item-actions">
                <button type="button" class="action-btn cv-experience-move-up" data-id="${entry.id}" ${index === 0 ? "disabled" : ""}>↑</button>
                <button type="button" class="action-btn cv-experience-move-down" data-id="${entry.id}" ${index === cv.experiences.length - 1 ? "disabled" : ""}>↓</button>
                <button type="button" class="action-btn cv-experience-remove" data-id="${entry.id}" ${cv.experiences.length === 1 ? "disabled" : ""}>×</button>
              </div>
            </div>
            <div class="creator-settings-grid">
              <div class="control-group">
                <label>Role Title</label>
                <input type="text" class="cv-experience-role" data-id="${entry.id}" value="${this.sanitize(entry.role)}" />
              </div>
              <div class="control-group">
                <label>Organization</label>
                <input type="text" class="cv-experience-organization" data-id="${entry.id}" value="${this.sanitize(entry.organization)}" />
              </div>
            </div>
            <div class="creator-settings-grid">
              <div class="control-group">
                <label>Location</label>
                <input type="text" class="cv-experience-location" data-id="${entry.id}" value="${this.sanitize(entry.location)}" />
              </div>
              <div class="control-group">
                <label>Start Date</label>
                <input type="text" class="cv-experience-start" data-id="${entry.id}" value="${this.sanitize(entry.startDate)}" placeholder="2022" />
              </div>
            </div>
            <div class="creator-settings-grid">
              <div class="control-group">
                <label>End Date</label>
                <input type="text" class="cv-experience-end" data-id="${entry.id}" value="${this.sanitize(entry.endDate)}" placeholder="Present" />
              </div>
              <div class="control-group">
                <label>&nbsp;</label>
              </div>
            </div>
            <div class="control-group">
              <label>Achievements</label>
              <textarea class="cv-experience-achievements" data-id="${entry.id}" rows="4">${this.sanitize(entry.achievements)}</textarea>
            </div>
          </div>
        `,
          )
          .join("")}
      </div>

      <div class="creator-repeatable-header">
        <h4 id="cvEducationHeading">${this.sanitize(cv.educationLabel || "Education")}</h4>
        <button id="addCvEducationBtn" class="btn btn-secondary btn-sm" style="width: auto;" type="button">Add Education</button>
      </div>
      <div class="creator-repeatable-list">
        ${cv.education
          .map(
            (entry, index) => `
          <div class="creator-item-card">
            <div class="creator-item-toolbar">
              <span>Education ${index + 1}</span>
              <div class="creator-item-actions">
                <button type="button" class="action-btn cv-education-move-up" data-id="${entry.id}" ${index === 0 ? "disabled" : ""}>↑</button>
                <button type="button" class="action-btn cv-education-move-down" data-id="${entry.id}" ${index === cv.education.length - 1 ? "disabled" : ""}>↓</button>
                <button type="button" class="action-btn cv-education-remove" data-id="${entry.id}" ${cv.education.length === 1 ? "disabled" : ""}>×</button>
              </div>
            </div>
            <div class="creator-settings-grid">
              <div class="control-group">
                <label>Qualification</label>
                <input type="text" class="cv-education-qualification" data-id="${entry.id}" value="${this.sanitize(entry.qualification)}" />
              </div>
              <div class="control-group">
                <label>Institution</label>
                <input type="text" class="cv-education-institution" data-id="${entry.id}" value="${this.sanitize(entry.institution)}" />
              </div>
            </div>
            <div class="creator-settings-grid">
              <div class="control-group">
                <label>Location</label>
                <input type="text" class="cv-education-location" data-id="${entry.id}" value="${this.sanitize(entry.location)}" />
              </div>
              <div class="control-group">
                <label>Start Date</label>
                <input type="text" class="cv-education-start" data-id="${entry.id}" value="${this.sanitize(entry.startDate)}" placeholder="2016" />
              </div>
            </div>
            <div class="creator-settings-grid">
              <div class="control-group">
                <label>End Date</label>
                <input type="text" class="cv-education-end" data-id="${entry.id}" value="${this.sanitize(entry.endDate)}" placeholder="2019" />
              </div>
              <div class="control-group">
                <label>&nbsp;</label>
              </div>
            </div>
            <div class="control-group">
              <label>Details</label>
              <textarea class="cv-education-details" data-id="${entry.id}" rows="3">${this.sanitize(entry.details)}</textarea>
            </div>
          </div>
        `,
          )
          .join("")}
      </div>

      <div class="control-group">
        <label for="cvSkills">Skills</label>
        <textarea id="cvSkills" rows="4">${this.sanitize(cv.skills)}</textarea>
      </div>

      <div class="creator-repeatable-header">
        <h4>Additional Sections</h4>
        <button id="addCvSectionBtn" class="btn btn-secondary btn-sm" style="width: auto;" type="button">Add Section</button>
      </div>
      <div class="creator-repeatable-list">
        ${cv.additionalSections
          .map(
            (section, index) => `
          <div class="creator-item-card">
            <div class="creator-item-toolbar">
              <span>Section ${index + 1}</span>
              <div class="creator-item-actions">
                <button type="button" class="action-btn cv-section-move-up" data-id="${section.id}" ${index === 0 ? "disabled" : ""}>↑</button>
                <button type="button" class="action-btn cv-section-move-down" data-id="${section.id}" ${index === cv.additionalSections.length - 1 ? "disabled" : ""}>↓</button>
                <button type="button" class="action-btn cv-section-remove" data-id="${section.id}" ${cv.additionalSections.length === 1 ? "disabled" : ""}>×</button>
              </div>
            </div>
            <div class="control-group">
              <label>Section Title</label>
              <input type="text" class="cv-section-title" data-id="${section.id}" value="${this.sanitize(section.title)}" />
            </div>
            <div class="control-group">
              <label>Content</label>
              <textarea class="cv-section-body" data-id="${section.id}" rows="4">${this.sanitize(section.body)}</textarea>
            </div>
          </div>
        `,
          )
          .join("")}
      </div>
    `;
  }

  private bindTemplateEditor() {
    switch (this.draft.template) {
      case "report":
        this.bindInput("#reportTitle", (value) => {
          this.draft.report.title = value;
        });
        this.bindInput("#reportSubtitle", (value) => {
          this.draft.report.subtitle = value;
        });
        this.bindInput("#reportAuthor", (value) => {
          this.draft.report.author = value;
        });
        this.bindInput("#reportSummary", (value) => {
          this.draft.report.summary = value;
        });
        this.querySelector("#addReportSectionBtn")?.addEventListener("click", () => {
          this.draft.report.sections.push(createDefaultReportSection());
          this.refreshUi();
          this.handleDraftMutation();
        });
        this.bindCollectionControls<CreatorSection>({
          headingSelector: ".report-section-heading",
          bodySelector: ".report-section-body",
          removeSelector: ".report-remove",
          moveUpSelector: ".report-move-up",
          moveDownSelector: ".report-move-down",
          items: this.draft.report.sections,
          onHeading: (item, value) => {
            item.heading = value;
          },
          onBody: (item, value) => {
            item.body = value;
          },
          onReplace: (items) => {
            this.draft.report.sections = items;
          },
        });
        break;
      case "letter":
        this.bindInput("#letterSenderName", (value) => {
          this.draft.letter.senderName = value;
        });
        this.bindInput("#letterSenderDetails", (value) => {
          this.draft.letter.senderDetails = value;
        });
        this.bindInput("#letterRecipientName", (value) => {
          this.draft.letter.recipientName = value;
        });
        this.bindInput("#letterRecipientDetails", (value) => {
          this.draft.letter.recipientDetails = value;
        });
        this.bindInput("#letterSubject", (value) => {
          this.draft.letter.subject = value;
        });
        this.bindInput("#letterGreeting", (value) => {
          this.draft.letter.greeting = value;
        });
        this.bindInput("#letterClosing", (value) => {
          this.draft.letter.closing = value;
        });
        this.bindInput("#letterSignature", (value) => {
          this.draft.letter.signature = value;
        });
        this.bindSelect("#letterDate", (value) => {
          this.draft.letter.date = value;
        });
        this.querySelector("#addLetterParagraphBtn")?.addEventListener("click", () => {
          this.draft.letter.paragraphs.push(createDefaultLetterParagraph());
          this.refreshUi();
          this.handleDraftMutation();
        });
        this.bindCollectionControls<CreatorParagraph>({
          bodySelector: ".letter-paragraph-text",
          removeSelector: ".letter-remove",
          moveUpSelector: ".letter-move-up",
          moveDownSelector: ".letter-move-down",
          items: this.draft.letter.paragraphs,
          onBody: (item, value) => {
            item.text = value;
          },
          onReplace: (items) => {
            this.draft.letter.paragraphs = items;
          },
        });
        break;
      case "invoice":
        this.bindInput("#invoiceBusinessName", (value) => {
          this.draft.invoice.businessName = value;
        });
        this.bindInput("#invoiceBusinessDetails", (value) => {
          this.draft.invoice.businessDetails = value;
        });
        this.bindInput("#invoiceClientName", (value) => {
          this.draft.invoice.clientName = value;
        });
        this.bindInput("#invoiceClientDetails", (value) => {
          this.draft.invoice.clientDetails = value;
        });
        this.bindInput("#invoiceNumber", (value) => {
          this.draft.invoice.invoiceNumber = value;
        });
        this.bindSelect("#invoiceIssueDate", (value) => {
          this.draft.invoice.issueDate = value;
        });
        this.bindSelect("#invoiceDueDate", (value) => {
          this.draft.invoice.dueDate = value;
        });
        this.bindSelect("#invoiceCurrency", (value) => {
          this.draft.invoice.currency = value as PdfCreatorDraft["invoice"]["currency"];
          this.updateInvoiceTotalDisplay();
        });
        this.bindInput("#invoicePaymentDetails", (value) => {
          this.draft.invoice.paymentDetails = value;
        });
        this.bindInput("#invoicePaymentLink", (value) => {
          this.draft.invoice.paymentLink = value;
        });
        this.bindInput("#invoiceNotes", (value) => {
          this.draft.invoice.notes = value;
        });
        this.querySelector("#addInvoiceItemBtn")?.addEventListener("click", () => {
          this.draft.invoice.lineItems.push(createDefaultInvoiceItem());
          this.refreshUi();
          this.handleDraftMutation();
        });
        this.bindInvoiceItemControls();
        break;
      case "cv-harvard":
      case "cv-modern":
        this.bindInput("#cvFullName", (value) => {
          this.draft.cv.fullName = value;
        });
        this.bindInput("#cvProfessionalTitle", (value) => {
          this.draft.cv.professionalTitle = value;
        });
        this.bindInput("#cvEmail", (value) => {
          this.draft.cv.email = value;
        });
        this.bindInput("#cvPhone", (value) => {
          this.draft.cv.phone = value;
        });
        this.bindInput("#cvLocation", (value) => {
          this.draft.cv.location = value;
        });
        this.bindInput("#cvWebsite", (value) => {
          this.draft.cv.website = value;
        });
        this.bindInput("#cvLinkedin", (value) => {
          this.draft.cv.linkedin = value;
        });
        this.bindInput("#cvProfileLabel", (value) => {
          this.draft.cv.profileLabel = value;
        });
        this.bindInput("#cvExperienceLabel", (value) => {
          this.draft.cv.experienceLabel = value;
          const heading = this.querySelector("#cvExperienceHeading") as HTMLElement | null;
          if (heading) {
            heading.textContent = value.trim() || "Experience";
          }
        });
        this.bindInput("#cvEducationLabel", (value) => {
          this.draft.cv.educationLabel = value;
          const heading = this.querySelector("#cvEducationHeading") as HTMLElement | null;
          if (heading) {
            heading.textContent = value.trim() || "Education";
          }
        });
        this.bindInput("#cvSkillsLabel", (value) => {
          this.draft.cv.skillsLabel = value;
        });
        this.bindInput("#cvProfile", (value) => {
          this.draft.cv.profile = value;
        });
        this.bindInput("#cvSkills", (value) => {
          this.draft.cv.skills = value;
        });
        this.querySelector("#addCvExperienceBtn")?.addEventListener("click", () => {
          this.draft.cv.experiences.push(createDefaultCvExperience());
          this.refreshUi();
          this.handleDraftMutation();
        });
        this.querySelector("#addCvEducationBtn")?.addEventListener("click", () => {
          this.draft.cv.education.push(createDefaultCvEducation());
          this.refreshUi();
          this.handleDraftMutation();
        });
        this.querySelector("#addCvSectionBtn")?.addEventListener("click", () => {
          this.draft.cv.additionalSections.push(createDefaultCvExtraSection());
          this.refreshUi();
          this.handleDraftMutation();
        });
        this.bindCvExperienceControls();
        this.bindCvEducationControls();
        this.bindCvExtraSectionControls();
        break;
    }
  }

  private bindCollectionControls<T extends { id: string }>(options: {
    headingSelector?: string;
    bodySelector: string;
    removeSelector: string;
    moveUpSelector: string;
    moveDownSelector: string;
    items: T[];
    onHeading?: (item: T, value: string) => void;
    onBody: (item: T, value: string) => void;
    onReplace: (items: T[]) => void;
  }) {
    if (options.headingSelector && options.onHeading) {
      this.querySelectorAll<HTMLInputElement>(options.headingSelector).forEach((input) => {
        input.addEventListener("input", () => {
          const item = options.items.find((entry) => entry.id === input.dataset.id);
          if (!item) return;
          options.onHeading?.(item, input.value);
          this.handleDraftMutation();
        });
      });
    }

    this.querySelectorAll<HTMLTextAreaElement>(options.bodySelector).forEach((textarea) => {
      textarea.addEventListener("input", () => {
        const item = options.items.find((entry) => entry.id === textarea.dataset.id);
        if (!item) return;
        options.onBody(item, textarea.value);
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLElement>(options.removeSelector).forEach((button) => {
      button.addEventListener("click", () => {
        const next = options.items.filter((entry) => entry.id !== button.dataset.id);
        if (next.length === 0) return;
        options.onReplace(next);
        this.refreshUi();
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLElement>(options.moveUpSelector).forEach((button) => {
      button.addEventListener("click", () => {
        const index = options.items.findIndex((entry) => entry.id === button.dataset.id);
        if (index < 1) return;
        options.onReplace(moveArrayItem(options.items, index, -1));
        this.refreshUi();
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLElement>(options.moveDownSelector).forEach((button) => {
      button.addEventListener("click", () => {
        const index = options.items.findIndex((entry) => entry.id === button.dataset.id);
        if (index < 0 || index === options.items.length - 1) return;
        options.onReplace(moveArrayItem(options.items, index, 1));
        this.refreshUi();
        this.handleDraftMutation();
      });
    });
  }

  private bindInvoiceItemControls() {
    const items = this.draft.invoice.lineItems;

    this.querySelectorAll<HTMLTextAreaElement>(".invoice-item-description").forEach((textarea) => {
      textarea.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === textarea.dataset.id);
        if (!item) return;
        item.description = textarea.value;
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLInputElement>(".invoice-item-quantity").forEach((input) => {
      input.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === input.dataset.id);
        if (!item) return;
        item.quantity = Math.max(0, parseFloat(input.value || "0"));
        this.updateInvoiceTotalDisplay();
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLInputElement>(".invoice-item-rate").forEach((input) => {
      input.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === input.dataset.id);
        if (!item) return;
        item.unitPrice = Math.max(0, parseFloat(input.value || "0"));
        this.updateInvoiceTotalDisplay();
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLElement>(".invoice-remove").forEach((button) => {
      button.addEventListener("click", () => {
        const next = items.filter((entry) => entry.id !== button.dataset.id);
        if (next.length === 0) return;
        this.draft.invoice.lineItems = next;
        this.refreshUi();
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLElement>(".invoice-move-up").forEach((button) => {
      button.addEventListener("click", () => {
        const index = items.findIndex((entry) => entry.id === button.dataset.id);
        if (index < 1) return;
        this.draft.invoice.lineItems = moveArrayItem(items, index, -1) as CreatorInvoiceItem[];
        this.refreshUi();
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLElement>(".invoice-move-down").forEach((button) => {
      button.addEventListener("click", () => {
        const index = items.findIndex((entry) => entry.id === button.dataset.id);
        if (index < 0 || index === items.length - 1) return;
        this.draft.invoice.lineItems = moveArrayItem(items, index, 1) as CreatorInvoiceItem[];
        this.refreshUi();
        this.handleDraftMutation();
      });
    });
  }

  private bindCvExperienceControls() {
    const items = this.draft.cv.experiences;

    this.querySelectorAll<HTMLInputElement>(".cv-experience-role").forEach((input) => {
      input.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === input.dataset.id);
        if (!item) return;
        item.role = input.value;
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLInputElement>(".cv-experience-organization").forEach((input) => {
      input.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === input.dataset.id);
        if (!item) return;
        item.organization = input.value;
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLInputElement>(".cv-experience-location").forEach((input) => {
      input.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === input.dataset.id);
        if (!item) return;
        item.location = input.value;
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLInputElement>(".cv-experience-start").forEach((input) => {
      input.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === input.dataset.id);
        if (!item) return;
        item.startDate = input.value;
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLInputElement>(".cv-experience-end").forEach((input) => {
      input.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === input.dataset.id);
        if (!item) return;
        item.endDate = input.value;
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLTextAreaElement>(".cv-experience-achievements").forEach(
      (textarea) => {
        textarea.addEventListener("input", () => {
          const item = items.find((entry) => entry.id === textarea.dataset.id);
          if (!item) return;
          item.achievements = textarea.value;
          this.handleDraftMutation();
        });
      },
    );

    this.querySelectorAll<HTMLElement>(".cv-experience-remove").forEach((button) => {
      button.addEventListener("click", () => {
        const next = items.filter((entry) => entry.id !== button.dataset.id);
        if (next.length === 0) return;
        this.draft.cv.experiences = next;
        this.refreshUi();
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLElement>(".cv-experience-move-up").forEach((button) => {
      button.addEventListener("click", () => {
        const index = items.findIndex((entry) => entry.id === button.dataset.id);
        if (index < 1) return;
        this.draft.cv.experiences = moveArrayItem(items, index, -1) as CreatorCvExperience[];
        this.refreshUi();
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLElement>(".cv-experience-move-down").forEach((button) => {
      button.addEventListener("click", () => {
        const index = items.findIndex((entry) => entry.id === button.dataset.id);
        if (index < 0 || index === items.length - 1) return;
        this.draft.cv.experiences = moveArrayItem(items, index, 1) as CreatorCvExperience[];
        this.refreshUi();
        this.handleDraftMutation();
      });
    });
  }

  private bindCvEducationControls() {
    const items = this.draft.cv.education;

    this.querySelectorAll<HTMLInputElement>(".cv-education-qualification").forEach((input) => {
      input.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === input.dataset.id);
        if (!item) return;
        item.qualification = input.value;
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLInputElement>(".cv-education-institution").forEach((input) => {
      input.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === input.dataset.id);
        if (!item) return;
        item.institution = input.value;
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLInputElement>(".cv-education-location").forEach((input) => {
      input.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === input.dataset.id);
        if (!item) return;
        item.location = input.value;
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLInputElement>(".cv-education-start").forEach((input) => {
      input.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === input.dataset.id);
        if (!item) return;
        item.startDate = input.value;
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLInputElement>(".cv-education-end").forEach((input) => {
      input.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === input.dataset.id);
        if (!item) return;
        item.endDate = input.value;
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLTextAreaElement>(".cv-education-details").forEach((textarea) => {
      textarea.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === textarea.dataset.id);
        if (!item) return;
        item.details = textarea.value;
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLElement>(".cv-education-remove").forEach((button) => {
      button.addEventListener("click", () => {
        const next = items.filter((entry) => entry.id !== button.dataset.id);
        if (next.length === 0) return;
        this.draft.cv.education = next;
        this.refreshUi();
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLElement>(".cv-education-move-up").forEach((button) => {
      button.addEventListener("click", () => {
        const index = items.findIndex((entry) => entry.id === button.dataset.id);
        if (index < 1) return;
        this.draft.cv.education = moveArrayItem(items, index, -1) as CreatorCvEducation[];
        this.refreshUi();
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLElement>(".cv-education-move-down").forEach((button) => {
      button.addEventListener("click", () => {
        const index = items.findIndex((entry) => entry.id === button.dataset.id);
        if (index < 0 || index === items.length - 1) return;
        this.draft.cv.education = moveArrayItem(items, index, 1) as CreatorCvEducation[];
        this.refreshUi();
        this.handleDraftMutation();
      });
    });
  }

  private bindCvExtraSectionControls() {
    const items = this.draft.cv.additionalSections;

    this.querySelectorAll<HTMLInputElement>(".cv-section-title").forEach((input) => {
      input.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === input.dataset.id);
        if (!item) return;
        item.title = input.value;
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLTextAreaElement>(".cv-section-body").forEach((textarea) => {
      textarea.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === textarea.dataset.id);
        if (!item) return;
        item.body = textarea.value;
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLElement>(".cv-section-remove").forEach((button) => {
      button.addEventListener("click", () => {
        const next = items.filter((entry) => entry.id !== button.dataset.id);
        if (next.length === 0) return;
        this.draft.cv.additionalSections = next;
        this.refreshUi();
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLElement>(".cv-section-move-up").forEach((button) => {
      button.addEventListener("click", () => {
        const index = items.findIndex((entry) => entry.id === button.dataset.id);
        if (index < 1) return;
        this.draft.cv.additionalSections = moveArrayItem(
          items,
          index,
          -1,
        ) as CreatorCvExtraSection[];
        this.refreshUi();
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLElement>(".cv-section-move-down").forEach((button) => {
      button.addEventListener("click", () => {
        const index = items.findIndex((entry) => entry.id === button.dataset.id);
        if (index < 0 || index === items.length - 1) return;
        this.draft.cv.additionalSections = moveArrayItem(
          items,
          index,
          1,
        ) as CreatorCvExtraSection[];
        this.refreshUi();
        this.handleDraftMutation();
      });
    });
  }

  private bindInput(selector: string, apply: (value: string) => void) {
    const element = this.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
    element?.addEventListener("input", () => {
      apply(element.value);
      this.handleDraftMutation();
    });
  }

  private bindSelect(selector: string, apply: (value: string) => void) {
    const element = this.querySelector(selector) as HTMLSelectElement | HTMLInputElement | null;
    element?.addEventListener("change", () => {
      apply(element.value);
      this.handleDraftMutation();
    });
  }

  private bindCheckbox(selector: string, apply: (checked: boolean) => void) {
    const element = this.querySelector(selector) as HTMLInputElement | null;
    element?.addEventListener("change", () => {
      apply(element.checked);
      this.handleDraftMutation();
    });
  }

  private updateInvoiceTotalDisplay() {
    if (this.draft.template !== "invoice") return;

    const totalValue = this.querySelector(".creator-invoice-total strong") as HTMLElement | null;
    if (!totalValue) return;

    const total = calculateInvoiceTotal(this.draft.invoice.lineItems);
    totalValue.textContent = total.toLocaleString(undefined, {
      style: "currency",
      currency: this.draft.invoice.currency,
      maximumFractionDigits: 2,
    });
  }

  private setupChromeListeners() {
    const backBtn = this.querySelector("#backToDash");
    backBtn?.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("back-to-dashboard", { bubbles: true }));
    });

    const aboutBtn = this.querySelector("#aboutBtn") as HTMLElement | null;
    aboutBtn?.addEventListener("click", () => {
      if ((window as any).showAbout) {
        (window as any).showAbout();
      }
    });

    const accountBtn = this.querySelector("#userAccountBtn") as HTMLElement | null;
    accountBtn?.addEventListener("click", () => {
      void this.showDialog({
        title: "User Account",
        message:
          "Optional cloud sync and cross-device history are coming soon. Your draft and generated documents stay local by default.",
        type: "info",
        confirmText: "Get Notified",
      });
    });
  }

  private setupPreviewModeControls() {
    const previewRoot = this.getPreviewRoot();
    const togglePreviewModeBtn = previewRoot.querySelector(
      "#togglePreviewModeBtn",
    ) as HTMLButtonElement | null;
    const resetPreviewPositionBtn = previewRoot.querySelector(
      "#resetPreviewPositionBtn",
    ) as HTMLButtonElement | null;

    togglePreviewModeBtn?.addEventListener("click", () => {
      this.previewMode = this.isFloatingPreviewActive() ? "docked" : "floating";
      this.refreshUi();
    });

    resetPreviewPositionBtn?.addEventListener("click", () => {
      this.previewPosition = this.getDefaultFloatingPreviewPosition();
      this.applyFloatingPreviewPosition();
    });
  }

  private async initializeDraft() {
    try {
      const savedDraft = await persistence.get<PdfCreatorDraft>(this.toolKey);
      if (savedDraft) {
        this.draft = this.normalizeDraft(savedDraft);
        this.draftState = "restored";
        this.refreshUi();
      }
    } catch (error) {
      logger.error("Failed to restore create-pdf draft", error);
    }

    this.updateDraftStatus();
    this.updateSummary();
    this.queuePreviewRefresh(0);
  }

  private normalizeDraft(value: Partial<PdfCreatorDraft>) {
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

  private refreshUi() {
    this.activeDragCleanup?.();
    this.activeDragCleanup = null;
    void this.previewController?.destroy();
    this.previewController = null;
    this.unmountFloatingPreviewPortal();
    this.render();
    this.setupEventListeners();
    void this.restorePreviewSnapshot();
    this.updateDraftStatus();
    this.updateSummary();
  }

  private handleDraftMutation(options: { rerender?: boolean } = {}) {
    this.draftState = "idle";
    this.updateDraftStatus();
    this.updateSummary();
    this.queueDraftSave();
    this.queuePreviewRefresh();

    if (options.rerender) {
      this.refreshUi();
    }
  }

  private queueDraftSave(delay = 250) {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }

    this.draftState = "saving";
    this.updateDraftStatus();
    this.saveTimer = window.setTimeout(() => {
      void this.saveDraft();
    }, delay);
  }

  private async saveDraft() {
    try {
      await persistence.set(this.toolKey, this.draft);
      this.draftState = "saved";
      this.updateDraftStatus();
    } catch (error) {
      logger.error("Failed to save create-pdf draft", error);
      this.draftState = "idle";
      this.updateDraftStatus();
    }
  }

  private queuePreviewRefresh(delay = 300) {
    if (this.previewTimer !== null) {
      window.clearTimeout(this.previewTimer);
    }

    const previewState = this.getPreviewRoot().querySelector("#previewState") as HTMLElement | null;
    if (previewState) {
      previewState.textContent = "Refreshing preview...";
      previewState.classList.remove("hidden", "error");
    }
    this.updatePreviewMeta("Rendering preview...");

    this.previewTimer = window.setTimeout(() => {
      void this.refreshPreview();
    }, delay);
  }

  private async refreshPreview() {
    const token = ++this.previewToken;

    try {
      const result = await createPdfFromDraft(this.draft);
      if (token !== this.previewToken) return;

      this.lastPreviewBytes = result.bytes.slice();
      this.lastPreviewOutputName = result.outputName;
      this.previewPageCount = result.pageCount;
      await this.previewController?.load(result.bytes);
      if (token !== this.previewToken) return;

      const previewState = this.getPreviewRoot().querySelector(
        "#previewState",
      ) as HTMLElement | null;
      previewState?.classList.add("hidden");
      this.updatePreviewMeta(
        `${result.pageCount} page${result.pageCount === 1 ? "" : "s"} · ${result.outputName}`,
      );
      this.updateSummary();
    } catch (error) {
      logger.error("Preview generation failed", error);
      if (token !== this.previewToken) return;

      this.previewPageCount = null;
      this.lastPreviewBytes = null;
      this.lastPreviewOutputName = null;
      const previewState = this.getPreviewRoot().querySelector(
        "#previewState",
      ) as HTMLElement | null;
      if (previewState) {
        previewState.textContent =
          "Preview could not be generated. Adjust the content and try again.";
        previewState.classList.remove("hidden");
        previewState.classList.add("error");
      }
      this.updatePreviewMeta("Preview unavailable");
      this.updateSummary();
    }
  }

  private async startCreation() {
    if (this.isCreating) return;

    const createButton = this.querySelector("#createPdfBtn") as HTMLButtonElement | null;
    const progressSection = this.querySelector("#progressSection") as HTMLElement | null;
    const successDetails = this.querySelector("#successDetails") as HTMLElement | null;

    this.isCreating = true;
    if (createButton) createButton.disabled = true;
    progressSection?.classList.remove("hidden");
    this.updateProgress(12, "Composing pages...");

    try {
      const result = await createPdfFromDraft(this.draft);
      const previewBytes = result.bytes.slice();
      const historyBytes = result.bytes.slice();
      const downloadBytes = result.bytes.slice();
      this.updateProgress(70, "Finalizing PDF...");

      this.lastPreviewBytes = previewBytes.slice();
      this.lastPreviewOutputName = result.outputName;
      this.previewPageCount = result.pageCount;
      await this.previewController?.load(previewBytes);
      this.updateProgress(100, "Ready to download");

      await this.recordJob("Create", result.outputName, historyBytes, {
        template: getTemplateLabel(this.draft.template),
        pageCount: result.pageCount,
      });

      if (successDetails) {
        successDetails.textContent = `${getTemplateLabel(this.draft.template)} created with ${result.pageCount} page${result.pageCount === 1 ? "" : "s"}.`;
      }

      this.showSuccess(downloadBytes, result.outputName, "", ".pdf");
      await this.showSuccessDialog(`${getTemplateLabel(this.draft.template)} PDF is ready.`);
      this.updatePreviewMeta(
        `${result.pageCount} page${result.pageCount === 1 ? "" : "s"} · ${result.outputName}`,
      );
      this.updateSummary();
    } catch (error) {
      logger.error("Failed to create PDF", error);
      await this.showErrorDialog(
        "Failed to create PDF. Please review the document fields and try again.",
      );
    } finally {
      this.isCreating = false;
      if (createButton) createButton.disabled = false;
      progressSection?.classList.add("hidden");
    }
  }

  private async resetDraft() {
    const confirmed = await this.showConfirmDialog(
      "Start over with a fresh draft? Your current local draft will be replaced.",
      "Reset Draft",
    );
    if (!confirmed) return;

    this.draft = createDefaultCreatorDraft();
    this.previewPageCount = null;
    this.lastPreviewBytes = null;
    this.lastPreviewOutputName = null;
    this.draftState = "idle";
    await persistence.delete(this.toolKey);
    this.refreshUi();
    this.handleDraftMutation();
  }

  private createPreviewController() {
    const previewRoot = this.getPreviewRoot();
    const canvas = previewRoot.querySelector("#previewCanvas") as HTMLCanvasElement | null;
    if (!canvas) return null;

    const pageIndicator = previewRoot.querySelector("#previewPageIndicator") as HTMLElement | null;
    const prevButton = previewRoot.querySelector("#prevPreviewPage") as HTMLButtonElement | null;
    const nextButton = previewRoot.querySelector("#nextPreviewPage") as HTMLButtonElement | null;

    const controller = new PdfPreviewController({
      canvas,
      pageIndicator,
      prevButton,
      nextButton,
      scale: 0.85,
    });

    prevButton?.addEventListener("click", () => controller.prev());
    nextButton?.addEventListener("click", () => controller.next());
    return controller;
  }

  private canFloatPreview() {
    return typeof window !== "undefined" && window.innerWidth >= FLOATING_PREVIEW_BREAKPOINT;
  }

  private isFloatingPreviewActive() {
    return this.previewMode === "floating" && this.canFloatPreview();
  }

  private getDefaultFloatingPreviewPosition() {
    if (typeof window === "undefined") {
      return { x: 0, y: FLOATING_PREVIEW_TOP };
    }

    const anchorRect = this.getFloatingPreviewAnchorRect();
    const width = this.getFloatingPreviewSize().width;
    const anchoredX = anchorRect
      ? anchorRect.right - width - FLOATING_PREVIEW_GUTTER
      : window.innerWidth - width - FLOATING_PREVIEW_GUTTER;

    return this.clampFloatingPreviewPosition({
      x: anchoredX,
      y: FLOATING_PREVIEW_TOP,
    });
  }

  private getFloatingPreviewAnchorRect() {
    const toolView = this.querySelector(".tool-view") as HTMLElement | null;
    const mainContainer = this.closest("#main-container") as HTMLElement | null;
    const appShell = document.querySelector("#app") as HTMLElement | null;
    const rect =
      toolView?.getBoundingClientRect() ??
      mainContainer?.getBoundingClientRect() ??
      appShell?.getBoundingClientRect() ??
      this.getBoundingClientRect();

    if (!rect || rect.width === 0) {
      return null;
    }

    return rect;
  }

  private getFloatingPreviewPosition() {
    if (!this.isFloatingPreviewActive()) {
      return this.previewPosition;
    }

    const current =
      this.previewPosition.x === 0
        ? this.getDefaultFloatingPreviewPosition()
        : this.previewPosition;
    const clamped = this.clampFloatingPreviewPosition(current);
    this.previewPosition = clamped;
    return clamped;
  }

  private clampFloatingPreviewPosition(position: { x: number; y: number }) {
    if (typeof window === "undefined") {
      return position;
    }

    const { width, height } = this.getFloatingPreviewSize();
    const maxX = Math.max(
      FLOATING_PREVIEW_GUTTER,
      window.innerWidth - width - FLOATING_PREVIEW_GUTTER,
    );
    const maxY = Math.max(
      FLOATING_PREVIEW_GUTTER,
      window.innerHeight - height - FLOATING_PREVIEW_GUTTER,
    );

    return {
      x: Math.min(Math.max(position.x, FLOATING_PREVIEW_GUTTER), maxX),
      y: Math.min(Math.max(position.y, FLOATING_PREVIEW_GUTTER), maxY),
    };
  }

  private applyFloatingPreviewPosition() {
    if (!this.isFloatingPreviewActive()) return;
    const floatingPreview = this.floatingPreviewPortal;
    const position = this.getFloatingPreviewPosition();
    if (floatingPreview) {
      floatingPreview.style.left = `${position.x}px`;
      floatingPreview.style.top = `${position.y}px`;
    }
  }

  private startPreviewDrag(event: PointerEvent) {
    if (!this.isFloatingPreviewActive()) return;

    const floatingPreview = this.floatingPreviewPortal;
    if (!floatingPreview) return;

    event.preventDefault();
    floatingPreview.classList.add("is-dragging");
    const rect = floatingPreview.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    const move = (moveEvent: PointerEvent) => {
      this.previewPosition = this.clampFloatingPreviewPosition({
        x: moveEvent.clientX - offsetX,
        y: moveEvent.clientY - offsetY,
      });
      this.applyFloatingPreviewPosition();
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      floatingPreview.classList.remove("is-dragging");
      this.activeDragCleanup = null;
    };

    this.activeDragCleanup?.();
    this.activeDragCleanup = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  }

  private onWindowResize() {
    const hasFloatingPreview = !!this.floatingPreviewPortal;

    if (this.previewMode === "floating" && this.canFloatPreview()) {
      if (!hasFloatingPreview) {
        this.refreshUi();
        return;
      }

      this.previewPosition = this.clampFloatingPreviewPosition(this.previewPosition);
      this.applyFloatingPreviewPosition();
      return;
    }

    if (hasFloatingPreview && !this.canFloatPreview()) {
      this.refreshUi();
    }
  }

  private updateDraftStatus() {
    const target = this.querySelector("#draftStatusText") as HTMLElement | null;
    if (target) {
      target.textContent = this.getDraftStatusText();
    }
  }

  private updateSummary() {
    const target = this.querySelector("#creatorSummary") as HTMLElement | null;
    if (target) {
      target.textContent = this.getSummaryText();
    }
  }

  private updatePreviewMeta(message: string) {
    const target = this.getPreviewRoot().querySelector("#previewMetaText") as HTMLElement | null;
    if (target) {
      target.textContent = message;
    }
  }

  private getPreviewRoot() {
    return this.floatingPreviewPortal ?? this;
  }

  private mountFloatingPreviewPortal() {
    if (!this.isFloatingPreviewActive()) {
      this.unmountFloatingPreviewPortal();
      return;
    }

    const portal = this.floatingPreviewPortal ?? document.createElement("div");
    portal.id = "floatingPreview";
    portal.className = "creator-floating-preview";
    portal.innerHTML = this.renderPreviewCard(true);
    portal.onpointerdown = (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("button")) return;
      this.startPreviewDrag(event);
    };

    if (!portal.isConnected) {
      document.body.appendChild(portal);
    }

    this.floatingPreviewPortal = portal;
    this.applyFloatingPreviewPosition();
  }

  private unmountFloatingPreviewPortal() {
    this.floatingPreviewPortal?.remove();
    this.floatingPreviewPortal = null;
  }

  private getFloatingPreviewSize() {
    const width = this.floatingPreviewPortal?.offsetWidth || FLOATING_PREVIEW_WIDTH;
    const height = this.floatingPreviewPortal?.offsetHeight || FLOATING_PREVIEW_HEIGHT;
    return { width, height };
  }

  private async restorePreviewSnapshot() {
    if (!this.previewController || !this.lastPreviewBytes) {
      return;
    }

    try {
      await this.previewController.load(this.lastPreviewBytes.slice());
      const previewState = this.getPreviewRoot().querySelector(
        "#previewState",
      ) as HTMLElement | null;
      previewState?.classList.add("hidden");

      if (this.previewPageCount && this.lastPreviewOutputName) {
        this.updatePreviewMeta(
          `${this.previewPageCount} page${this.previewPageCount === 1 ? "" : "s"} · ${this.lastPreviewOutputName}`,
        );
      }
    } catch (error) {
      logger.error("Failed to restore preview after layout change", error);
    }
  }

  private getDraftStatusText() {
    switch (this.draftState) {
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

  private getSummaryText() {
    const base = `${getTemplateLabel(this.draft.template)} · ${this.draft.pageSize.toUpperCase()} ${this.draft.orientation}`;
    if (this.previewPageCount) {
      return `${base} · ${this.previewPageCount} preview page${this.previewPageCount === 1 ? "" : "s"}`;
    }
    return `${base} · Preview updates automatically`;
  }

  private getPreviewMetaText() {
    if (this.previewPageCount) {
      return `${this.previewPageCount} page${this.previewPageCount === 1 ? "" : "s"} ready`;
    }
    return "Preview updates automatically while you edit.";
  }

  private fileToDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
      reader.readAsDataURL(file);
    });
  }
}

customElements.define("pdf-creator", PdfCreator);

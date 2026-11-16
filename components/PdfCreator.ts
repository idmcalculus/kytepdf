import { UserFacingError } from "../utils/errorMapper.ts";
import { logger } from "../utils/logger.ts";
import {
  type CreatorInvoiceItem,
  type CreatorParagraph,
  type CreatorSection,
  calculateInvoiceTotal,
  calculatePayslipTotals,
  createDefaultCreatorDraft,
  createPdfFromDraft,
  detectDataUrlImageFormat,
  getInvoiceTotalLabel,
  getPdfOutputName,
  getTemplateLabel,
  INVOICE_DETAILS_ALIGNMENT_OPTIONS,
  INVOICE_FOOTER_LOGO_OPTIONS,
  INVOICE_STATUS_OPTIONS,
  normalizeInvoiceDetailsAlignment,
  normalizeInvoiceFooterLogoPosition,
  normalizeInvoiceStatus,
  normalizeWatermarkSource,
  normalizeWatermarkStyle,
  PDF_CREATOR_TEMPLATES,
  type PdfCreatorDraft,
  type PdfCreatorTemplate,
  WATERMARK_SOURCE_OPTIONS,
  WATERMARK_STYLE_OPTIONS,
} from "../utils/pdfCreator.ts";
import {
  addCvEducation,
  addCvExperience,
  addCvExtraSection,
  addInvoiceItem,
  addLetterParagraph,
  addPayslipDeduction,
  addPayslipItem,
  addReportSection,
  canFloatPreview,
  clampFloatingPreviewPosition,
  computePreviewMetaText,
  computeSummaryText,
  type DraftState,
  describeSourcesProgress,
  FLOATING_PREVIEW_HEIGHT,
  FLOATING_PREVIEW_TOP,
  FLOATING_PREVIEW_WIDTH,
  formatCurrencyAmount,
  getCreatorLabel,
  getDefaultFloatingPreviewPosition,
  getDraftStatusText,
  moveCollectionItem,
  normalizeDraft,
  removeCollectionItem,
  SOURCES_MODE_LABEL,
} from "../utils/pdfCreatorWorkflow.ts";
import { buildPdfFromSources, type SourcesProgress } from "../utils/pdfFromSources.ts";
import { PdfPreviewController } from "../utils/pdfPreview.ts";
import { persistence } from "../utils/persistence.ts";
import { BaseComponent } from "./BaseComponent.ts";
import { CreatorSourcesPanel, type SourcesChangeDetail } from "./CreatorSourcesPanel.ts";

type PreviewMode = "floating" | "docked";

/** Keeps the sources panel's text and files across this component's re-renders. */
const SOURCES_STORE_KEY = "pdf-creator";
const SOURCES_DESCRIPTION =
  "Type or paste text, or add files: images, PDFs, Word, Excel, PowerPoint, CSV and more.";
const SOURCES_EMPTY_MESSAGE = "Type some text or add a file to see a preview.";

interface BuiltDocument {
  bytes: Uint8Array;
  pageCount: number;
  outputName: string;
  warnings: string[];
}

const TEMPLATE_DESCRIPTIONS: Record<PdfCreatorTemplate, string> = {
  report: "Polished reports, proposals, and briefs with structured sections.",
  letter: "Formal letters with sender, recipient, subject, and signature blocks.",
  invoice: "Client-ready invoices with line items, totals, and payment notes.",
  payslip: "Payroll-ready payslips with company, employee, earnings, and pay details.",
  "cv-harvard": "Classic Harvard-style CV with editable section titles and ATS-friendly structure.",
  "cv-modern": "Contemporary CV with stronger visual hierarchy and the same structured data model.",
};

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
    const usesSources = draft.mode === "sources";

    // Custom elements are inline by default, but this one holds the whole
    // tool's block layout. Inline, it confuses hit testing (Playwright reports
    // it as covering the Download button).
    this.style.display = "block";
    this.innerHTML = `
      <div class="tool-view">
        ${this.getBackButton()}

        <h1>Create PDF</h1>
        <p class="subtitle">Turn your own text and files into a PDF, or start from a template. Everything is built in your browser.</p>

        <div class="creator-header-stack">
          <div class="creator-status-bar">
            <div>
              <strong>Local draft:</strong>
              <span id="draftStatusText">${getDraftStatusText(this.draftState)}</span>
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
                  <h3>Start From</h3>
                  <p>Use your own text and files, or pick a template. You can switch at any time.</p>
                </div>
              </div>
              <div class="creator-template-grid">
                <button
                  class="creator-template-option ${usesSources ? "active" : ""}"
                  data-mode="sources"
                  type="button"
                >
                  <span class="creator-template-title">${SOURCES_MODE_LABEL}</span>
                  <span class="creator-template-desc">${SOURCES_DESCRIPTION}</span>
                </button>
                ${PDF_CREATOR_TEMPLATES.map(
                  (template) => `
                  <button
                    class="creator-template-option ${!usesSources && draft.template === template ? "active" : ""}"
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
                  <p>${usesSources ? "Control output name, page size and orientation." : "Control output name, page size, orientation, and overall style."}</p>
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

              ${usesSources ? "" : this.renderStyleSettings()}
            </div>

            ${usesSources ? "" : this.renderBrandingCard()}

            <div class="card creator-card">
              <div class="creator-card-header">
                <div>
                  <h3>${usesSources ? SOURCES_MODE_LABEL : `${getTemplateLabel(draft.template)} Content`}</h3>
                  <p>${usesSources ? SOURCES_DESCRIPTION : TEMPLATE_DESCRIPTIONS[draft.template]}</p>
                </div>
              </div>
              ${usesSources ? `<creator-sources-panel store-key="${SOURCES_STORE_KEY}"></creator-sources-panel>` : this.renderTemplateEditor()}
            </div>

            <div class="creator-action-row">
              <span id="creatorSummary">${computeSummaryText(this.draft, this.previewPageCount)}</span>
              <button id="createPdfBtn" class="btn btn-primary" ${this.isCreating ? "disabled" : ""}>
                ${this.isCreating ? "Creating..." : "Create PDF"}
              </button>
            </div>

            ${this.renderResultArea()}
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
        <input type="file" id="watermarkImageInput" class="hidden" accept="image/png,image/jpeg" />

      </div>
    `;
  }

  /**
   * Progress and the Download button sit in the editor column, under Create.
   * That column keeps clear of the floating preview, so the preview never
   * covers them (a full-width row below the layout would be).
   */
  private renderResultArea() {
    return `
      ${this.getProgressSection("Preparing document...")}

      <div id="successMessage" class="success-message hidden" style="margin-top: 2rem;">
        <p id="successTitle" style="font-size: 1.1rem; margin-bottom: 0.5rem;">PDF Created</p>
        <div id="successDetails" style="font-size: 0.95rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.6;">
          Your new document is ready to download.
        </div>
        <button id="downloadLink" class="btn btn-primary">Download PDF</button>
      </div>
    `;
  }

  private renderStyleSettings() {
    const draft = this.draft;
    return `
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
    `;
  }

  private renderBrandingCard() {
    const draft = this.draft;
    return `
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
        if (this.draft.mode === "template" && template === this.draft.template) return;
        this.draft.mode = "template";
        this.draft.template = template;
        this.refreshUi();
        this.handleDraftMutation();
      };
    });
    this.querySelectorAll<HTMLElement>('[data-mode="sources"]').forEach((button) => {
      button.onclick = () => {
        if (this.draft.mode === "sources") return;
        this.draft.mode = "sources";
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

    // The panel is rendered in place of a template editor in "Your own content" mode.
    const sourcesPanel = this.getSourcesPanel();
    if (sourcesPanel) {
      this.bindSourcesPanel(sourcesPanel);
    } else {
      this.bindTemplateEditor();
    }

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
        const dataUrl = await this.readPngOrJpeg(file);
        if (!dataUrl) return;
        this.draft.logoDataUrl = dataUrl;
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
    this.updateCreateButton();

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
      // Leaving the tool must not drop the last few edits.
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.saveDraft();
    }
    this.activeDragCleanup?.();
    this.activeDragCleanup = null;
    window.removeEventListener("resize", this.handleWindowResize);
    void this.previewController?.destroy();
    this.previewController = null;
    this.unmountFloatingPreviewPortal();
  }

  private renderPreviewCard(isFloating: boolean) {
    const canFloat = canFloatPreview(window);
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
            <p id="previewMetaText">${computePreviewMetaText(this.previewPageCount, null)}</p>
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
      case "payslip":
        return this.renderPayslipEditor();
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
                <button type="button" class="action-btn report-move-up" data-id="${this.sanitize(section.id)}" aria-label="Move section ${index + 1} up" ${index === 0 ? "disabled" : ""}>↑</button>
                <button type="button" class="action-btn report-move-down" data-id="${this.sanitize(section.id)}" aria-label="Move section ${index + 1} down" ${index === this.draft.report.sections.length - 1 ? "disabled" : ""}>↓</button>
                <button type="button" class="action-btn report-remove" data-id="${this.sanitize(section.id)}" aria-label="Remove section ${index + 1}" ${this.draft.report.sections.length === 1 ? "disabled" : ""}>×</button>
              </div>
            </div>
            <div class="control-group">
              <label for="report-section-heading-${this.sanitize(section.id)}">Heading</label>
              <input type="text" id="report-section-heading-${this.sanitize(section.id)}" class="report-section-heading" data-id="${this.sanitize(section.id)}" value="${this.sanitize(section.heading)}" />
            </div>
            <div class="control-group">
              <label for="report-section-body-${this.sanitize(section.id)}">Body</label>
              <textarea id="report-section-body-${this.sanitize(section.id)}" class="report-section-body" data-id="${this.sanitize(section.id)}" rows="5">${this.sanitize(section.body)}</textarea>
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
                <button type="button" class="action-btn letter-move-up" data-id="${this.sanitize(paragraph.id)}" aria-label="Move paragraph ${index + 1} up" ${index === 0 ? "disabled" : ""}>↑</button>
                <button type="button" class="action-btn letter-move-down" data-id="${this.sanitize(paragraph.id)}" aria-label="Move paragraph ${index + 1} down" ${index === this.draft.letter.paragraphs.length - 1 ? "disabled" : ""}>↓</button>
                <button type="button" class="action-btn letter-remove" data-id="${this.sanitize(paragraph.id)}" aria-label="Remove paragraph ${index + 1}" ${this.draft.letter.paragraphs.length === 1 ? "disabled" : ""}>×</button>
              </div>
            </div>
            <div class="control-group">
              <label for="letter-paragraph-text-${this.sanitize(paragraph.id)}">Paragraph text</label>
              <textarea id="letter-paragraph-text-${this.sanitize(paragraph.id)}" class="letter-paragraph-text" data-id="${this.sanitize(paragraph.id)}" rows="4">${this.sanitize(paragraph.text)}</textarea>
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
    const totalLabel = getInvoiceTotalLabel(normalizeInvoiceStatus(this.draft.invoice.status));
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

      <div class="creator-settings-grid">
        <div class="control-group">
          <label>&nbsp;</label>
          <label class="creator-inline-check">
            <input type="checkbox" id="invoiceBusinessNameHeaderToggle" ${this.draft.invoice.includeBusinessNameInHeader ? "checked" : ""} />
            <span>Show business name in header</span>
          </label>
        </div>
        <div class="control-group">
          <label for="invoiceHeaderTextColor">Header Text Color</label>
          <input
            type="color"
            id="invoiceHeaderTextColor"
            value="${this.sanitize(this.draft.invoice.headerTextColor)}"
          />
        </div>
      </div>

      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="invoiceCompanyReference">Company Reference (Optional)</label>
          <input
            type="text"
            id="invoiceCompanyReference"
            value="${this.sanitize(this.draft.invoice.companyReference)}"
            placeholder="PO, platform, or client reference"
          />
        </div>
        <div class="control-group">
          <label for="invoiceDetailsAlignment">Details Value Alignment</label>
          <select id="invoiceDetailsAlignment">
            ${INVOICE_DETAILS_ALIGNMENT_OPTIONS.map(
              (option) => `
              <option value="${option.value}" ${this.draft.invoice.detailsValueAlignment === option.value ? "selected" : ""}>
                ${option.label}
              </option>
            `,
            ).join("")}
          </select>
        </div>
      </div>

      <div class="control-group">
        <label for="invoiceFooterLogoPosition">Footer Logo Position</label>
        <select id="invoiceFooterLogoPosition">
          ${INVOICE_FOOTER_LOGO_OPTIONS.map(
            (option) => `
            <option value="${option.value}" ${this.draft.invoice.footerLogoPosition === option.value ? "selected" : ""}>
              ${option.label}
            </option>
          `,
          ).join("")}
        </select>
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

      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="invoiceStatus">Status</label>
          <select id="invoiceStatus">
            ${INVOICE_STATUS_OPTIONS.map(
              (option) => `
              <option value="${option.value}" ${this.draft.invoice.status === option.value ? "selected" : ""}>
                ${option.label}
              </option>
            `,
            ).join("")}
          </select>
        </div>
        <div class="control-group">
          <label for="invoicePaidDate">Paid Date (If Paid)</label>
          <input type="date" id="invoicePaidDate" value="${this.sanitize(this.draft.invoice.paidDate)}" />
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
          .map((item, index, items) =>
            this.renderPricedRow(item, index, items.length, {
              noun: "item",
              buttons: "invoice",
              fields: "invoice-item",
              rateLabel: "Unit Price",
            }),
          )
          .join("")}
      </div>

      <div class="creator-invoice-total">
        <span>${totalLabel}</span>
        <strong>${formatCurrencyAmount(total, this.draft.invoice.currency)}</strong>
      </div>

      <div class="control-group">
        <label for="invoiceNotes">Notes</label>
        <textarea id="invoiceNotes" rows="4">${this.sanitize(this.draft.invoice.notes)}</textarea>
      </div>

      <div class="control-group">
        <label for="invoiceSignature">Signature (Optional)</label>
        <input
          type="text"
          id="invoiceSignature"
          value="${this.sanitize(this.draft.invoice.signature)}"
          placeholder="Name to sign on the invoice"
        />
      </div>
    `;
  }

  /**
   * One priced row (invoice item, earning or deduction). Each field has a
   * linked label and each icon button says what it does to which row.
   */
  private renderPricedRow(
    item: CreatorInvoiceItem,
    index: number,
    count: number,
    names: { noun: string; buttons: string; fields: string; rateLabel: string },
  ) {
    const id = this.sanitize(item.id);
    const fieldId = (part: string) => `${names.fields}-${part}-${id}`;
    const position = `${names.noun} ${index + 1}`;
    return `
          <div class="creator-item-card">
            <div class="creator-item-toolbar">
              <span>${position.charAt(0).toUpperCase()}${position.slice(1)}</span>
              <div class="creator-item-actions">
                <button type="button" class="action-btn ${names.buttons}-move-up" data-id="${id}" aria-label="Move ${position} up" ${index === 0 ? "disabled" : ""}>↑</button>
                <button type="button" class="action-btn ${names.buttons}-move-down" data-id="${id}" aria-label="Move ${position} down" ${index === count - 1 ? "disabled" : ""}>↓</button>
                <button type="button" class="action-btn ${names.buttons}-remove" data-id="${id}" aria-label="Remove ${position}" ${count === 1 ? "disabled" : ""}>×</button>
              </div>
            </div>
            <div class="control-group">
              <label for="${fieldId("description")}">Description</label>
              <textarea id="${fieldId("description")}" class="${names.fields}-description" data-id="${id}" rows="3">${this.sanitize(item.description)}</textarea>
            </div>
            <div class="creator-settings-grid">
              <div class="control-group">
                <label for="${fieldId("quantity")}">Quantity</label>
                <input type="number" min="0" step="1" id="${fieldId("quantity")}" class="${names.fields}-quantity" data-id="${id}" value="${item.quantity}" />
              </div>
              <div class="control-group">
                <label for="${fieldId("rate")}">${names.rateLabel}</label>
                <input type="number" min="0" step="0.01" id="${fieldId("rate")}" class="${names.fields}-rate" data-id="${id}" value="${item.unitPrice}" />
              </div>
            </div>
          </div>
        `;
  }

  private renderPayslipEditor() {
    const { payslip } = this.draft;
    const totals = calculatePayslipTotals(payslip);
    return `
      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="payslipCompanyName">Company Name</label>
          <input type="text" id="payslipCompanyName" value="${this.sanitize(payslip.companyName)}" />
        </div>
        <div class="control-group">
          <label for="payslipNumber">Payslip #</label>
          <input type="text" id="payslipNumber" value="${this.sanitize(payslip.payslipNumber)}" />
        </div>
      </div>

      <div class="creator-settings-grid">
        <div class="control-group">
          <label>&nbsp;</label>
          <label class="creator-inline-check">
            <input type="checkbox" id="payslipCompanyNameHeaderToggle" ${payslip.includeCompanyNameInHeader ? "checked" : ""} />
            <span>Show company name in header</span>
          </label>
        </div>
        <div class="control-group">
          <label for="payslipHeaderTextColor">Header Text Color</label>
          <input
            type="color"
            id="payslipHeaderTextColor"
            value="${this.sanitize(payslip.headerTextColor)}"
          />
        </div>
      </div>

      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="payslipCompanyReference">Company Reference (Optional)</label>
          <input
            type="text"
            id="payslipCompanyReference"
            value="${this.sanitize(payslip.companyReference)}"
            placeholder="Payroll, platform, or company reference"
          />
        </div>
        <div class="control-group">
          <label for="payslipDetailsAlignment">Details Value Alignment</label>
          <select id="payslipDetailsAlignment">
            ${INVOICE_DETAILS_ALIGNMENT_OPTIONS.map(
              (option) => `
              <option value="${option.value}" ${payslip.detailsValueAlignment === option.value ? "selected" : ""}>
                ${option.label}
              </option>
            `,
            ).join("")}
          </select>
        </div>
      </div>

      <div class="control-group">
        <label for="payslipFooterLogoPosition">Footer Logo Position</label>
        <select id="payslipFooterLogoPosition">
          ${INVOICE_FOOTER_LOGO_OPTIONS.map(
            (option) => `
            <option value="${option.value}" ${payslip.footerLogoPosition === option.value ? "selected" : ""}>
              ${option.label}
            </option>
          `,
          ).join("")}
        </select>
      </div>

      <div class="control-group">
        <label for="payslipCopyrightNote">Copyright Note (Optional)</label>
        <input
          type="text"
          id="payslipCopyrightNote"
          value="${this.sanitize(payslip.copyrightNote)}"
          placeholder="© 2026 Company Name. All rights reserved."
        />
      </div>

      <div class="creator-repeatable-header">
        <h4>Watermark</h4>
      </div>
      <div class="control-group">
        <label class="creator-inline-check">
          <input type="checkbox" id="payslipWatermarkEnabled" ${payslip.watermark.enabled ? "checked" : ""} />
          <span>Include watermark</span>
        </label>
      </div>

      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="payslipWatermarkSource">Watermark Source</label>
          <select id="payslipWatermarkSource">
            ${WATERMARK_SOURCE_OPTIONS.map(
              (option) => `
              <option value="${option.value}" ${payslip.watermark.source === option.value ? "selected" : ""}>
                ${option.label}
              </option>
            `,
            ).join("")}
          </select>
        </div>
        <div class="control-group">
          <label for="payslipWatermarkStyle">Watermark Style</label>
          <select id="payslipWatermarkStyle">
            ${WATERMARK_STYLE_OPTIONS.map(
              (option) => `
              <option value="${option.value}" ${payslip.watermark.style === option.value ? "selected" : ""}>
                ${option.label}
              </option>
            `,
            ).join("")}
          </select>
        </div>
      </div>

      ${
        payslip.watermark.source === "custom-image"
          ? `
        <div class="creator-brand-row">
          <button id="uploadWatermarkImageBtn" class="btn btn-secondary btn-sm" style="width: auto;" type="button">
            ${payslip.watermark.customImageDataUrl ? "Replace Watermark Image" : "Upload Watermark Image"}
          </button>
          ${
            payslip.watermark.customImageDataUrl
              ? '<button id="clearWatermarkImageBtn" class="btn btn-secondary btn-sm" style="width: auto;" type="button">Remove Image</button>'
              : ""
          }
        </div>
        <p class="creator-logo-caption">
          ${
            payslip.watermark.customImageFileName
              ? `Current watermark: ${this.sanitize(payslip.watermark.customImageFileName)}`
              : "Upload a PNG or JPG to use instead of the company logo."
          }
        </p>
      `
          : ""
      }

      ${
        payslip.watermark.source === "text"
          ? `
        <div class="control-group">
          <label for="payslipWatermarkText">Watermark Text</label>
          <input type="text" id="payslipWatermarkText" value="${this.sanitize(payslip.watermark.text)}" placeholder="CONFIDENTIAL" />
        </div>
      `
          : ""
      }

      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="payslipWatermarkOpacity">Opacity (%)</label>
          <input type="number" id="payslipWatermarkOpacity" min="1" max="60" step="1" value="${payslip.watermark.opacity}" />
        </div>
        <div class="control-group">
          <label for="payslipWatermarkSize">Size (%)</label>
          <input type="number" id="payslipWatermarkSize" min="10" max="90" step="1" value="${payslip.watermark.size}" />
        </div>
      </div>

      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="payslipWatermarkRotation">Rotation (Degrees)</label>
          <input type="number" id="payslipWatermarkRotation" min="-180" max="180" step="1" value="${payslip.watermark.rotation}" />
        </div>
        <div class="control-group">
          <label>&nbsp;</label>
          <label class="creator-inline-check">
            <input type="checkbox" id="payslipWatermarkGrayscale" ${payslip.watermark.grayscale ? "checked" : ""} ${payslip.watermark.source === "text" ? "disabled" : ""} />
            <span>Use grayscale image</span>
          </label>
        </div>
      </div>

      <div class="control-group">
        <label for="payslipCompanyAddress">Company Address</label>
        <textarea id="payslipCompanyAddress" rows="4" placeholder="Shown below the company logo">${this.sanitize(payslip.companyAddress)}</textarea>
      </div>

      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="payslipEmployeeName">Employee Name</label>
          <input type="text" id="payslipEmployeeName" value="${this.sanitize(payslip.employeeName)}" />
        </div>
        <div class="control-group">
          <label for="payslipCurrency">Currency</label>
          <select id="payslipCurrency">
            <option value="USD" ${payslip.currency === "USD" ? "selected" : ""}>USD</option>
            <option value="EUR" ${payslip.currency === "EUR" ? "selected" : ""}>EUR</option>
            <option value="GBP" ${payslip.currency === "GBP" ? "selected" : ""}>GBP</option>
          </select>
        </div>
      </div>

      <div class="control-group">
        <label for="payslipEmployeeDetails">Employee Information</label>
        <textarea id="payslipEmployeeDetails" rows="4" placeholder="Employee ID, role, department, or address">${this.sanitize(payslip.employeeDetails)}</textarea>
      </div>

      <div class="creator-settings-grid">
        <div class="control-group">
          <label for="payslipPayPeriod">Pay Period</label>
          <input type="text" id="payslipPayPeriod" value="${this.sanitize(payslip.payPeriod)}" placeholder="June 2026" />
        </div>
        <div class="control-group">
          <label for="payslipPayDate">Pay Date</label>
          <input type="date" id="payslipPayDate" value="${this.sanitize(payslip.payDate)}" />
        </div>
      </div>

      <div class="creator-repeatable-header">
        <h4>Earnings</h4>
        <button id="addPayslipItemBtn" class="btn btn-secondary btn-sm" style="width: auto;" type="button">Add Earning</button>
      </div>
      <div class="creator-repeatable-list">
        ${payslip.lineItems
          .map((item, index, items) =>
            this.renderPricedRow(item, index, items.length, {
              noun: "earning",
              buttons: "payslip",
              fields: "payslip-item",
              rateLabel: "Rate",
            }),
          )
          .join("")}
      </div>

      <div class="creator-repeatable-header">
        <h4>Deductions</h4>
        <button id="addPayslipDeductionBtn" class="btn btn-secondary btn-sm" style="width: auto;" type="button">Add Deduction</button>
      </div>
      <div class="creator-repeatable-list">
        ${payslip.deductions
          .map((item, index, items) =>
            this.renderPricedRow(item, index, items.length, {
              noun: "deduction",
              buttons: "payslip-deduction",
              fields: "payslip-deduction",
              rateLabel: "Rate",
            }),
          )
          .join("")}
      </div>

      <div class="creator-invoice-total creator-payslip-totals">
        <div class="creator-payslip-total-row">
          <span>Total Earnings</span>
          <strong data-payslip-total="earnings">${formatCurrencyAmount(totals.earnings, payslip.currency)}</strong>
        </div>
        <div class="creator-payslip-total-row">
          <span>Total Deductions</span>
          <strong data-payslip-total="deductions">-${formatCurrencyAmount(totals.deductions, payslip.currency)}</strong>
        </div>
        <div class="creator-payslip-total-row creator-payslip-net-total">
          <span>Total Pay</span>
          <strong data-payslip-total="net">${formatCurrencyAmount(totals.totalPay, payslip.currency)}</strong>
        </div>
      </div>

      <div class="control-group">
        <label for="payslipNotes">Notes</label>
        <textarea id="payslipNotes" rows="4">${this.sanitize(payslip.notes)}</textarea>
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
                <button type="button" class="action-btn cv-experience-move-up" data-id="${this.sanitize(entry.id)}" aria-label="Move role ${index + 1} up" ${index === 0 ? "disabled" : ""}>↑</button>
                <button type="button" class="action-btn cv-experience-move-down" data-id="${this.sanitize(entry.id)}" aria-label="Move role ${index + 1} down" ${index === cv.experiences.length - 1 ? "disabled" : ""}>↓</button>
                <button type="button" class="action-btn cv-experience-remove" data-id="${this.sanitize(entry.id)}" aria-label="Remove role ${index + 1}" ${cv.experiences.length === 1 ? "disabled" : ""}>×</button>
              </div>
            </div>
            <div class="creator-settings-grid">
              <div class="control-group">
                <label for="cv-experience-role-${this.sanitize(entry.id)}">Role Title</label>
                <input type="text" id="cv-experience-role-${this.sanitize(entry.id)}" class="cv-experience-role" data-id="${this.sanitize(entry.id)}" value="${this.sanitize(entry.role)}" />
              </div>
              <div class="control-group">
                <label for="cv-experience-organization-${this.sanitize(entry.id)}">Organization</label>
                <input type="text" id="cv-experience-organization-${this.sanitize(entry.id)}" class="cv-experience-organization" data-id="${this.sanitize(entry.id)}" value="${this.sanitize(entry.organization)}" />
              </div>
            </div>
            <div class="creator-settings-grid">
              <div class="control-group">
                <label for="cv-experience-location-${this.sanitize(entry.id)}">Location</label>
                <input type="text" id="cv-experience-location-${this.sanitize(entry.id)}" class="cv-experience-location" data-id="${this.sanitize(entry.id)}" value="${this.sanitize(entry.location)}" />
              </div>
              <div class="control-group">
                <label for="cv-experience-start-${this.sanitize(entry.id)}">Start Date</label>
                <input type="text" id="cv-experience-start-${this.sanitize(entry.id)}" class="cv-experience-start" data-id="${this.sanitize(entry.id)}" value="${this.sanitize(entry.startDate)}" placeholder="2022" />
              </div>
            </div>
            <div class="creator-settings-grid">
              <div class="control-group">
                <label for="cv-experience-end-${this.sanitize(entry.id)}">End Date</label>
                <input type="text" id="cv-experience-end-${this.sanitize(entry.id)}" class="cv-experience-end" data-id="${this.sanitize(entry.id)}" value="${this.sanitize(entry.endDate)}" placeholder="Present" />
              </div>
              <div class="control-group">
                <label>&nbsp;</label>
              </div>
            </div>
            <div class="control-group">
              <label for="cv-experience-achievements-${this.sanitize(entry.id)}">Achievements</label>
              <textarea id="cv-experience-achievements-${this.sanitize(entry.id)}" class="cv-experience-achievements" data-id="${this.sanitize(entry.id)}" rows="4">${this.sanitize(entry.achievements)}</textarea>
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
                <button type="button" class="action-btn cv-education-move-up" data-id="${this.sanitize(entry.id)}" aria-label="Move education ${index + 1} up" ${index === 0 ? "disabled" : ""}>↑</button>
                <button type="button" class="action-btn cv-education-move-down" data-id="${this.sanitize(entry.id)}" aria-label="Move education ${index + 1} down" ${index === cv.education.length - 1 ? "disabled" : ""}>↓</button>
                <button type="button" class="action-btn cv-education-remove" data-id="${this.sanitize(entry.id)}" aria-label="Remove education ${index + 1}" ${cv.education.length === 1 ? "disabled" : ""}>×</button>
              </div>
            </div>
            <div class="creator-settings-grid">
              <div class="control-group">
                <label for="cv-education-qualification-${this.sanitize(entry.id)}">Qualification</label>
                <input type="text" id="cv-education-qualification-${this.sanitize(entry.id)}" class="cv-education-qualification" data-id="${this.sanitize(entry.id)}" value="${this.sanitize(entry.qualification)}" />
              </div>
              <div class="control-group">
                <label for="cv-education-institution-${this.sanitize(entry.id)}">Institution</label>
                <input type="text" id="cv-education-institution-${this.sanitize(entry.id)}" class="cv-education-institution" data-id="${this.sanitize(entry.id)}" value="${this.sanitize(entry.institution)}" />
              </div>
            </div>
            <div class="creator-settings-grid">
              <div class="control-group">
                <label for="cv-education-location-${this.sanitize(entry.id)}">Location</label>
                <input type="text" id="cv-education-location-${this.sanitize(entry.id)}" class="cv-education-location" data-id="${this.sanitize(entry.id)}" value="${this.sanitize(entry.location)}" />
              </div>
              <div class="control-group">
                <label for="cv-education-start-${this.sanitize(entry.id)}">Start Date</label>
                <input type="text" id="cv-education-start-${this.sanitize(entry.id)}" class="cv-education-start" data-id="${this.sanitize(entry.id)}" value="${this.sanitize(entry.startDate)}" placeholder="2016" />
              </div>
            </div>
            <div class="creator-settings-grid">
              <div class="control-group">
                <label for="cv-education-end-${this.sanitize(entry.id)}">End Date</label>
                <input type="text" id="cv-education-end-${this.sanitize(entry.id)}" class="cv-education-end" data-id="${this.sanitize(entry.id)}" value="${this.sanitize(entry.endDate)}" placeholder="2019" />
              </div>
              <div class="control-group">
                <label>&nbsp;</label>
              </div>
            </div>
            <div class="control-group">
              <label for="cv-education-details-${this.sanitize(entry.id)}">Details</label>
              <textarea id="cv-education-details-${this.sanitize(entry.id)}" class="cv-education-details" data-id="${this.sanitize(entry.id)}" rows="3">${this.sanitize(entry.details)}</textarea>
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
                <button type="button" class="action-btn cv-section-move-up" data-id="${this.sanitize(section.id)}" aria-label="Move section ${index + 1} up" ${index === 0 ? "disabled" : ""}>↑</button>
                <button type="button" class="action-btn cv-section-move-down" data-id="${this.sanitize(section.id)}" aria-label="Move section ${index + 1} down" ${index === cv.additionalSections.length - 1 ? "disabled" : ""}>↓</button>
                <button type="button" class="action-btn cv-section-remove" data-id="${this.sanitize(section.id)}" aria-label="Remove section ${index + 1}" ${cv.additionalSections.length === 1 ? "disabled" : ""}>×</button>
              </div>
            </div>
            <div class="control-group">
              <label for="cv-section-title-${this.sanitize(section.id)}">Section Title</label>
              <input type="text" id="cv-section-title-${this.sanitize(section.id)}" class="cv-section-title" data-id="${this.sanitize(section.id)}" value="${this.sanitize(section.title)}" />
            </div>
            <div class="control-group">
              <label for="cv-section-body-${this.sanitize(section.id)}">Content</label>
              <textarea id="cv-section-body-${this.sanitize(section.id)}" class="cv-section-body" data-id="${this.sanitize(section.id)}" rows="4">${this.sanitize(section.body)}</textarea>
            </div>
          </div>
        `,
          )
          .join("")}
      </div>
    `;
  }

  private getSourcesPanel() {
    return this.querySelector("creator-sources-panel") as CreatorSourcesPanel | null;
  }

  private isSourcesEmpty() {
    return this.draft.mode === "sources" && !this.getSourcesPanel()?.hasContent();
  }

  private bindSourcesPanel(panel: CreatorSourcesPanel) {
    // Files live in memory only, but the typed text and where it goes are saved
    // with the draft. After a reload the panel starts empty, so give them back.
    // The listener is added afterwards, so this does not count as an edit.
    const saved = this.draft.sources;
    const current = panel.getText();
    if (current.text !== saved.text || current.markdown !== saved.markdown) {
      panel.setText(saved.text, saved.markdown);
    }
    if (panel.textPosition !== saved.textPosition) {
      panel.setTextPosition(saved.textPosition);
    }

    panel.addEventListener("sources-change", (event) => {
      const { reason } = (event as CustomEvent<SourcesChangeDetail>).detail;
      if (reason === "text" || reason === "markdown" || reason === "position") {
        this.draft.sources = { ...panel.getText(), textPosition: panel.textPosition };
      }
      this.updateCreateButton();
      this.handleDraftMutation();
    });
  }

  private updateCreateButton() {
    const button = this.querySelector<HTMLButtonElement>("#createPdfBtn");
    const empty = this.isSourcesEmpty();
    button?.toggleAttribute("disabled", this.isCreating || empty);
    button?.replaceChildren(this.isCreating ? "Creating..." : "Create PDF");
    button?.setAttribute("title", empty ? "Type some text or add a file first." : "");
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
        this.bindAddButton("#addReportSectionBtn", addReportSection);
        this.bindCollectionControls<CreatorSection>({
          prefix: "report",
          headingSelector: ".report-section-heading",
          bodySelector: ".report-section-body",
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
        this.bindAddButton("#addLetterParagraphBtn", addLetterParagraph);
        this.bindCollectionControls<CreatorParagraph>({
          prefix: "letter",
          bodySelector: ".letter-paragraph-text",
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
        this.bindCheckbox("#invoiceBusinessNameHeaderToggle", (checked) => {
          this.draft.invoice.includeBusinessNameInHeader = checked;
        });
        this.bindInput("#invoiceHeaderTextColor", (value) => {
          this.draft.invoice.headerTextColor = value;
        });
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
        this.bindInput("#invoiceCompanyReference", (value) => {
          this.draft.invoice.companyReference = value;
        });
        this.bindSelect("#invoiceDetailsAlignment", (value) => {
          this.draft.invoice.detailsValueAlignment = normalizeInvoiceDetailsAlignment(value);
        });
        this.bindSelect("#invoiceFooterLogoPosition", (value) => {
          this.draft.invoice.footerLogoPosition = normalizeInvoiceFooterLogoPosition(value);
        });
        this.bindSelect("#invoiceIssueDate", (value) => {
          this.draft.invoice.issueDate = value;
        });
        this.bindSelect("#invoiceDueDate", (value) => {
          this.draft.invoice.dueDate = value;
        });
        this.bindSelect("#invoiceStatus", (value) => {
          this.draft.invoice.status = normalizeInvoiceStatus(value);
          this.updateInvoiceTotalDisplay();
        });
        this.bindSelect("#invoicePaidDate", (value) => {
          this.draft.invoice.paidDate = value;
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
        this.bindInput("#invoiceSignature", (value) => {
          this.draft.invoice.signature = value;
        });
        this.bindAddButton("#addInvoiceItemBtn", addInvoiceItem);
        this.bindInvoiceItemControls();
        break;
      case "payslip":
        this.bindCheckbox("#payslipCompanyNameHeaderToggle", (checked) => {
          this.draft.payslip.includeCompanyNameInHeader = checked;
        });
        this.bindInput("#payslipHeaderTextColor", (value) => {
          this.draft.payslip.headerTextColor = value;
        });
        this.bindInput("#payslipCompanyName", (value) => {
          this.draft.payslip.companyName = value;
        });
        this.bindInput("#payslipCompanyAddress", (value) => {
          this.draft.payslip.companyAddress = value;
        });
        this.bindInput("#payslipEmployeeName", (value) => {
          this.draft.payslip.employeeName = value;
        });
        this.bindInput("#payslipEmployeeDetails", (value) => {
          this.draft.payslip.employeeDetails = value;
        });
        this.bindInput("#payslipNumber", (value) => {
          this.draft.payslip.payslipNumber = value;
        });
        this.bindInput("#payslipCompanyReference", (value) => {
          this.draft.payslip.companyReference = value;
        });
        this.bindSelect("#payslipDetailsAlignment", (value) => {
          this.draft.payslip.detailsValueAlignment = normalizeInvoiceDetailsAlignment(value);
        });
        this.bindSelect("#payslipFooterLogoPosition", (value) => {
          this.draft.payslip.footerLogoPosition = normalizeInvoiceFooterLogoPosition(value);
        });
        this.bindInput("#payslipCopyrightNote", (value) => {
          this.draft.payslip.copyrightNote = value;
        });
        this.bindCheckbox("#payslipWatermarkEnabled", (checked) => {
          this.draft.payslip.watermark.enabled = checked;
        });
        this.bindSelect("#payslipWatermarkSource", (value) => {
          this.draft.payslip.watermark.source = normalizeWatermarkSource(value);
          this.refreshUi();
        });
        this.bindSelect("#payslipWatermarkStyle", (value) => {
          this.draft.payslip.watermark.style = normalizeWatermarkStyle(value);
        });
        this.bindInput("#payslipWatermarkText", (value) => {
          this.draft.payslip.watermark.text = value;
        });
        this.bindInput("#payslipWatermarkOpacity", (value) => {
          this.draft.payslip.watermark.opacity = Math.min(
            60,
            Math.max(1, Number.parseFloat(value) || 1),
          );
        });
        this.bindInput("#payslipWatermarkSize", (value) => {
          this.draft.payslip.watermark.size = Math.min(
            90,
            Math.max(10, Number.parseFloat(value) || 10),
          );
        });
        this.bindInput("#payslipWatermarkRotation", (value) => {
          this.draft.payslip.watermark.rotation = Math.min(
            180,
            Math.max(-180, Number.parseFloat(value) || 0),
          );
        });
        this.bindCheckbox("#payslipWatermarkGrayscale", (checked) => {
          this.draft.payslip.watermark.grayscale = checked;
        });
        this.bindWatermarkImageControls();
        this.bindInput("#payslipPayPeriod", (value) => {
          this.draft.payslip.payPeriod = value;
        });
        this.bindSelect("#payslipPayDate", (value) => {
          this.draft.payslip.payDate = value;
        });
        this.bindSelect("#payslipCurrency", (value) => {
          this.draft.payslip.currency = value as PdfCreatorDraft["payslip"]["currency"];
          this.updateInvoiceTotalDisplay();
        });
        this.bindInput("#payslipNotes", (value) => {
          this.draft.payslip.notes = value;
        });
        this.bindAddButton("#addPayslipItemBtn", addPayslipItem);
        this.bindAddButton("#addPayslipDeductionBtn", addPayslipDeduction);
        this.bindPayslipItemControls();
        this.bindPayslipDeductionControls();
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
        this.bindAddButton("#addCvExperienceBtn", addCvExperience);
        this.bindAddButton("#addCvEducationBtn", addCvEducation);
        this.bindAddButton("#addCvSectionBtn", addCvExtraSection);
        this.bindCvExperienceControls();
        this.bindCvEducationControls();
        this.bindCvExtraSectionControls();
        break;
    }
  }

  private bindAddButton(selector: string, add: (draft: PdfCreatorDraft) => PdfCreatorDraft) {
    this.querySelector(selector)?.addEventListener("click", () => {
      this.draft = add(this.draft);
      this.refreshUi();
      this.handleDraftMutation();
    });
  }

  /** Binds the remove, move-up and move-down buttons of one repeatable list. */
  private bindOrderControls<T extends { id: string }>(
    prefix: string,
    items: T[],
    onReplace: (items: T[]) => void,
  ) {
    const bind = (action: string, update: (id: string) => T[] | null) => {
      this.querySelectorAll<HTMLElement>(`.${prefix}-${action}`).forEach((button) => {
        button.addEventListener("click", () => {
          const next = update(button.dataset.id ?? "");
          // null: removing would empty the list; same array: the move is a no-op.
          if (!next || next === items) return;
          onReplace(next);
          this.refreshUi();
          this.handleDraftMutation();
        });
      });
    };

    bind("remove", (id) => removeCollectionItem(items, id));
    bind("move-up", (id) => moveCollectionItem(items, id, -1));
    bind("move-down", (id) => moveCollectionItem(items, id, 1));
  }

  private bindCollectionControls<T extends { id: string }>(options: {
    prefix: string;
    headingSelector?: string;
    bodySelector: string;
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

    this.bindOrderControls(options.prefix, options.items, options.onReplace);
  }

  private bindWatermarkImageControls() {
    const uploadButton = this.querySelector("#uploadWatermarkImageBtn") as HTMLButtonElement | null;
    const clearButton = this.querySelector("#clearWatermarkImageBtn") as HTMLButtonElement | null;
    const input = this.querySelector("#watermarkImageInput") as HTMLInputElement | null;
    if (!uploadButton || !input) return;

    uploadButton.addEventListener("click", () => input.click());
    clearButton?.addEventListener("click", () => {
      this.draft.payslip.watermark.customImageDataUrl = null;
      this.draft.payslip.watermark.customImageFileName = null;
      this.refreshUi();
      this.handleDraftMutation();
    });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (
        !(await this.validateFile(file, {
          maxSizeMB: 5,
          allowedTypes: ["image/png", "image/jpeg"],
        }))
      ) {
        input.value = "";
        return;
      }

      try {
        const dataUrl = await this.readPngOrJpeg(file);
        if (!dataUrl) return;
        this.draft.payslip.watermark.customImageDataUrl = dataUrl;
        this.draft.payslip.watermark.customImageFileName = file.name;
        this.refreshUi();
        this.handleDraftMutation();
      } catch (error) {
        logger.error("Failed to process watermark image upload", error);
        await this.showErrorDialog("Could not read the selected watermark image.");
      } finally {
        input.value = "";
      }
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

    this.bindOrderControls("invoice", items, (next) => {
      this.draft.invoice.lineItems = next;
    });
  }

  private bindPayslipItemControls() {
    const items = this.draft.payslip.lineItems;

    this.querySelectorAll<HTMLTextAreaElement>(".payslip-item-description").forEach((textarea) => {
      textarea.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === textarea.dataset.id);
        if (!item) return;
        item.description = textarea.value;
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLInputElement>(".payslip-item-quantity").forEach((input) => {
      input.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === input.dataset.id);
        if (!item) return;
        item.quantity = Math.max(0, parseFloat(input.value || "0"));
        this.updateInvoiceTotalDisplay();
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLInputElement>(".payslip-item-rate").forEach((input) => {
      input.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === input.dataset.id);
        if (!item) return;
        item.unitPrice = Math.max(0, parseFloat(input.value || "0"));
        this.updateInvoiceTotalDisplay();
        this.handleDraftMutation();
      });
    });

    this.bindOrderControls("payslip", items, (next) => {
      this.draft.payslip.lineItems = next;
    });
  }

  private bindPayslipDeductionControls() {
    const items = this.draft.payslip.deductions;

    this.querySelectorAll<HTMLTextAreaElement>(".payslip-deduction-description").forEach(
      (textarea) => {
        textarea.addEventListener("input", () => {
          const item = items.find((entry) => entry.id === textarea.dataset.id);
          if (!item) return;
          item.description = textarea.value;
          this.handleDraftMutation();
        });
      },
    );

    this.querySelectorAll<HTMLInputElement>(".payslip-deduction-quantity").forEach((input) => {
      input.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === input.dataset.id);
        if (!item) return;
        item.quantity = Math.max(0, parseFloat(input.value || "0"));
        this.updateInvoiceTotalDisplay();
        this.handleDraftMutation();
      });
    });

    this.querySelectorAll<HTMLInputElement>(".payslip-deduction-rate").forEach((input) => {
      input.addEventListener("input", () => {
        const item = items.find((entry) => entry.id === input.dataset.id);
        if (!item) return;
        item.unitPrice = Math.max(0, parseFloat(input.value || "0"));
        this.updateInvoiceTotalDisplay();
        this.handleDraftMutation();
      });
    });

    this.bindOrderControls("payslip-deduction", items, (next) => {
      this.draft.payslip.deductions = next;
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

    this.bindOrderControls("cv-experience", items, (next) => {
      this.draft.cv.experiences = next;
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

    this.bindOrderControls("cv-education", items, (next) => {
      this.draft.cv.education = next;
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

    this.bindOrderControls("cv-section", items, (next) => {
      this.draft.cv.additionalSections = next;
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
    if (this.draft.template !== "invoice" && this.draft.template !== "payslip") return;

    if (this.draft.template === "payslip") {
      const totals = calculatePayslipTotals(this.draft.payslip);
      const format = (value: number) => formatCurrencyAmount(value, this.draft.payslip.currency);
      const earnings = this.querySelector('[data-payslip-total="earnings"]');
      const deductions = this.querySelector('[data-payslip-total="deductions"]');
      const net = this.querySelector('[data-payslip-total="net"]');
      if (earnings) earnings.textContent = format(totals.earnings);
      if (deductions) deductions.textContent = `-${format(totals.deductions)}`;
      if (net) net.textContent = format(totals.totalPay);
      return;
    }

    const totalValue = this.querySelector(".creator-invoice-total strong") as HTMLElement | null;
    const totalLabel = this.querySelector(".creator-invoice-total span") as HTMLElement | null;
    if (!totalValue || !totalLabel) return;

    const total = calculateInvoiceTotal(this.draft.invoice.lineItems);
    totalLabel.textContent = getInvoiceTotalLabel(
      normalizeInvoiceStatus(this.draft.invoice.status),
    );
    totalValue.textContent = formatCurrencyAmount(total, this.draft.invoice.currency);
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
      if ((window as any).showAccountModal) (window as any).showAccountModal();
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
      this.previewPosition = this.getDefaultPreviewPosition();
      this.applyFloatingPreviewPosition();
    });
  }

  private async initializeDraft() {
    try {
      const savedDraft = await persistence.get<PdfCreatorDraft>(this.toolKey);
      // The tool may have been closed while the draft loaded; stop here.
      if (!this.isConnected) return;
      if (savedDraft) {
        this.draft = normalizeDraft(savedDraft);
        this.draftState = "restored";
        this.refreshUi();
      }
    } catch (error) {
      logger.error("Failed to restore create-pdf draft", error);
      if (!this.isConnected) return;
    }

    this.updateDraftStatus();
    this.updateSummary();
    this.queuePreviewRefresh(0);
  }

  private refreshUi() {
    this.activeDragCleanup?.();
    this.activeDragCleanup = null;
    void this.previewController?.destroy();
    this.previewController = null;
    this.unmountFloatingPreviewPortal();
    this.render();
    this.setupEventListeners();
    // A re-render mid-creation draws a fresh, hidden progress bar; keep it showing.
    if (this.isCreating) this.setProgressVisible(true);
    void this.restorePreviewSnapshot();
    this.updateDraftStatus();
    this.updateSummary();
  }

  private handleDraftMutation() {
    this.draftState = "idle";
    this.updateDraftStatus();
    this.updateSummary();
    this.queueDraftSave();
    this.queuePreviewRefresh();
  }

  private queueDraftSave(delay = 250) {
    if (!this.isConnected) {
      // Nothing is left on the page to wait for: save now, without a timer.
      void this.saveDraft();
      return;
    }
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

  /** Text and files can be slow to convert, so typing waits a little longer. */
  private queuePreviewRefresh(delay = this.draft.mode === "sources" ? 400 : 300) {
    // A closed tool has no preview to refresh (and in tests, maybe no window).
    if (!this.isConnected) return;
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

  /** Builds the PDF for the current mode: a template, or the panel's text and files. */
  /**
   * Builds the PDF for a draft snapshot: a template, or the panel's text and
   * files. Callers pass a copy so edits made while it runs cannot mix in.
   */
  private async buildDocument(
    draft: PdfCreatorDraft,
    onProgress?: (progress: SourcesProgress) => void,
  ): Promise<BuiltDocument> {
    if (draft.mode !== "sources") {
      return await createPdfFromDraft(draft);
    }
    const result = await buildPdfFromSources(
      // In this mode the panel is always rendered in place of a template editor.
      (this.getSourcesPanel() as CreatorSourcesPanel).getSources(),
      {
        pageSize: draft.pageSize,
        orientation: draft.orientation,
        title: draft.fileName,
      },
      onProgress,
    );
    return {
      bytes: result.bytes,
      pageCount: result.pageCount,
      outputName: getPdfOutputName(draft.fileName),
      warnings: result.warnings,
    };
  }

  private showEmptyPreview() {
    this.previewPageCount = null;
    this.lastPreviewBytes = null;
    this.lastPreviewOutputName = null;
    const previewState = this.getPreviewRoot().querySelector("#previewState") as HTMLElement | null;
    if (previewState) {
      previewState.textContent = SOURCES_EMPTY_MESSAGE;
      previewState.classList.remove("hidden", "error");
    }
    this.updatePreviewMeta("Nothing to preview yet.");
    this.updateSummary();
  }

  private async refreshPreview() {
    const token = ++this.previewToken;
    if (this.isSourcesEmpty()) {
      this.showEmptyPreview();
      return;
    }

    try {
      const result = await this.buildDocument(structuredClone(this.draft));
      if (token !== this.previewToken || !this.isConnected) return;

      this.lastPreviewBytes = result.bytes.slice();
      this.lastPreviewOutputName = result.outputName;
      this.previewPageCount = result.pageCount;
      await this.loadPreview(result.bytes);
      if (token !== this.previewToken || !this.isConnected) return;

      const previewState = this.getPreviewRoot().querySelector(
        "#previewState",
      ) as HTMLElement | null;
      previewState?.classList.add("hidden");
      this.updatePreviewMeta(computePreviewMetaText(result.pageCount, result.outputName));
      this.updateSummary();
    } catch (error) {
      logger.error("Preview generation failed", error);
      if (token !== this.previewToken || !this.isConnected) return;

      this.previewPageCount = null;
      this.lastPreviewBytes = null;
      this.lastPreviewOutputName = null;
      const previewState = this.getPreviewRoot().querySelector(
        "#previewState",
      ) as HTMLElement | null;
      if (previewState) {
        // Problems with the user's own files are explained as written.
        previewState.textContent =
          error instanceof UserFacingError
            ? error.message
            : "Preview could not be generated. Adjust the content and try again.";
        previewState.classList.remove("hidden");
        previewState.classList.add("error");
      }
      this.updatePreviewMeta("Preview unavailable");
      this.updateSummary();
    }
  }

  private async startCreation() {
    if (this.isCreating || this.isSourcesEmpty()) return;

    // The editor can re-render while the PDF is built, so every element below is
    // looked up when it is used rather than once here. The draft is copied for
    // the same reason: the PDF and its label must match what was clicked.
    const draft = structuredClone(this.draft);
    const label = getCreatorLabel(draft);
    this.isCreating = true;
    const createButton = this.querySelector("#createPdfBtn") as HTMLButtonElement | null;
    if (createButton) createButton.disabled = true;
    this.setProgressVisible(true);
    this.updateProgress(12, "Composing pages...");

    try {
      const result = await this.buildDocument(draft, (progress) =>
        this.updateProgress(progress.percent, describeSourcesProgress(progress)),
      );
      const previewBytes = result.bytes.slice();
      const historyBytes = result.bytes.slice();
      const downloadBytes = result.bytes.slice();
      if (draft.mode === "template") this.updateProgress(70, "Finalizing PDF...");

      await this.recordJob("Create", result.outputName, historyBytes, {
        template: label,
        pageCount: result.pageCount,
      });
      // Closed while the PDF was built: it is in history; skip the screen updates.
      if (!this.isConnected) return;

      this.lastPreviewBytes = previewBytes.slice();
      this.lastPreviewOutputName = result.outputName;
      this.previewPageCount = result.pageCount;
      await this.loadPreview(previewBytes);
      if (!this.isConnected) return;
      this.updateProgress(100, "Ready to download");

      const successDetails = this.querySelector("#successDetails") as HTMLElement | null;
      if (successDetails) {
        successDetails.textContent = `${label} created with ${result.pageCount} page${result.pageCount === 1 ? "" : "s"}.`;
        if (result.warnings.length > 0) {
          const list = document.createElement("ul");
          list.className = "creator-warnings";
          for (const warning of result.warnings) {
            const item = document.createElement("li");
            item.textContent = warning;
            list.append(item);
          }
          successDetails.append(list);
        }
      }

      // Warnings never block the download; they are shown alongside it.
      this.showSuccess(downloadBytes, result.outputName, "", ".pdf");
      await this.showSuccessDialog([`${label} PDF is ready.`, ...result.warnings].join(" "));
      this.updatePreviewMeta(computePreviewMetaText(result.pageCount, result.outputName));
      this.updateSummary();
    } catch (error) {
      logger.error("Failed to create PDF", error);
      if (!this.isConnected) return;
      await this.showErrorDialog(
        error instanceof UserFacingError
          ? error.message
          : "Failed to create PDF. Please review the document fields and try again.",
      );
    } finally {
      this.isCreating = false;
      // A re-render during creation draws the button as disabled "Creating...".
      this.updateCreateButton();
      this.setProgressVisible(false);
    }
  }

  /**
   * Shows bytes in the preview. A re-render can replace the controller while
   * it is still opening the PDF; the old one then keeps the document it opened
   * (and its pdf.js worker), so it is destroyed again here.
   */
  private async loadPreview(bytes: Uint8Array) {
    const controller = this.previewController;
    await controller?.load(bytes);
    if (controller && controller !== this.previewController) {
      await controller.destroy();
    }
  }

  private setProgressVisible(visible: boolean) {
    this.querySelector("#progressSection")?.classList.toggle("hidden", !visible);
  }

  private async resetDraft() {
    const confirmed = await this.showConfirmDialog(
      "Start over with a fresh draft? Your current local draft will be replaced.",
      "Reset Draft",
    );
    if (!confirmed) return;

    this.draft = createDefaultCreatorDraft();
    // Typed text and files are not part of the saved draft, so clear them too.
    CreatorSourcesPanel.clearStore(SOURCES_STORE_KEY);
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

  private isFloatingPreviewActive() {
    return this.previewMode === "floating" && canFloatPreview(window);
  }

  private getDefaultPreviewPosition() {
    // The stylesheet leaves room beside the editor column, but a little less
    // than the preview needs at some widths; start right of the column instead.
    const column = this.querySelector(".creator-sidebar")?.getBoundingClientRect();
    return getDefaultFloatingPreviewPosition(
      window,
      this.getFloatingPreviewAnchorRect()?.right ?? null,
      this.getFloatingPreviewSize(),
      column?.width ? column.right : null,
    );
  }

  private clampPreviewPosition(position: { x: number; y: number }) {
    return clampFloatingPreviewPosition(position, window, this.getFloatingPreviewSize());
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

  private applyFloatingPreviewPosition() {
    if (!this.isFloatingPreviewActive()) return;
    const current =
      this.previewPosition.x === 0 ? this.getDefaultPreviewPosition() : this.previewPosition;
    this.previewPosition = this.clampPreviewPosition(current);
    const floatingPreview = this.floatingPreviewPortal;
    if (floatingPreview) {
      floatingPreview.style.left = `${this.previewPosition.x}px`;
      floatingPreview.style.top = `${this.previewPosition.y}px`;
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
      this.previewPosition = this.clampPreviewPosition({
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

    if (this.previewMode === "floating" && canFloatPreview(window)) {
      if (!hasFloatingPreview) {
        this.refreshUi();
        return;
      }

      this.previewPosition = this.clampPreviewPosition(this.previewPosition);
      this.applyFloatingPreviewPosition();
      return;
    }

    if (hasFloatingPreview && !canFloatPreview(window)) {
      this.refreshUi();
    }
  }

  private updateDraftStatus() {
    const target = this.querySelector("#draftStatusText") as HTMLElement | null;
    if (target) {
      target.textContent = getDraftStatusText(this.draftState);
    }
  }

  private updateSummary() {
    const target = this.querySelector("#creatorSummary") as HTMLElement | null;
    if (target) {
      target.textContent = computeSummaryText(this.draft, this.previewPageCount);
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
      await this.loadPreview(this.lastPreviewBytes.slice());
      if (!this.isConnected) return;
      const previewState = this.getPreviewRoot().querySelector(
        "#previewState",
      ) as HTMLElement | null;
      previewState?.classList.add("hidden");
      // The snapshot bytes, page count and file name are always stored together.
      this.updatePreviewMeta(
        computePreviewMetaText(this.previewPageCount, this.lastPreviewOutputName),
      );
    } catch (error) {
      logger.error("Failed to restore preview after layout change", error);
    }
  }

  /**
   * Reads an uploaded image, checking its bytes: a PNG saved as "logo.jpg" is
   * labelled image/jpeg and would otherwise break every preview.
   */
  private async readPngOrJpeg(file: File) {
    const dataUrl = await this.fileToDataUrl(file);
    if (detectDataUrlImageFormat(dataUrl)) return dataUrl;
    await this.showErrorDialog(
      `"${file.name}" is not a PNG or JPEG image, whatever its name says. Save it as PNG or JPEG and try again.`,
    );
    return null;
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

/**
 * FormattingToolbar - Word-like inline formatting toolbar for rich text editing.
 * Provides bold, italic, underline, strikethrough, font family, font size,
 * text color, text alignment, and list formatting options.
 */

import { logger } from "../../utils/logger.ts";
import { EDITOR_FONTS, nearestEditorFont } from "../../utils/richText.ts";

export interface FormattingState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  fontFamily: string;
  fontSize: number;
  color: string;
  textAlign: "left" | "center" | "right" | "justify";
  isList: boolean;
  isOrderedList: boolean;
}

/** Paragraph settings the toolbar reports on their own, outside FormattingState. */
export interface ParagraphFormatting {
  lineHeight?: number;
  /** Space above the box's first line, in editor pixels (like fontSize). */
  paragraphSpacing?: number;
}

/** Options for the fonts the toolbar and the properties panel offer. */
export const fontOptionsHtml = () =>
  EDITOR_FONTS.map(({ value, label }) => `<option value="${value}">${label}</option>`).join("");

/** What a text box shows when its style leaves a value unset (see PdfEditor.renderAnnotation). */
const TEXT_BOX_DEFAULTS = {
  font: "Helvetica",
  fontSize: 16,
  color: "#000000",
  textAlign: "left",
  lineHeight: 1.4,
  paragraphSpacing: 0,
} as const;

/** Style fields of a text box that the toolbar mirrors. */
export interface ToolbarTextStyle {
  font?: string;
  fontSize?: number;
  color?: string;
  textAlign?: FormattingState["textAlign"];
  lineHeight?: number;
  paragraphSpacing?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

export type FormattingChangeCallback = (
  state: Partial<FormattingState> & ParagraphFormatting,
) => void;

/** The CSS sizes browsers write for HTML font size 7 (the toolbar's size marker). */
const SIZE_MARKERS = new Set(["xxx-large", "-webkit-xxx-large"]);

export class FormattingToolbar {
  private toolbar: HTMLElement | null = null;
  private onFormatChange: FormattingChangeCallback;
  private currentState: FormattingState = {
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    fontFamily: "Helvetica",
    fontSize: 14,
    color: "#000000",
    textAlign: "left",
    isList: false,
    isOrderedList: false,
  };
  /** Editor pixels per PDF point on the selected box's page. */
  private pageScale = 1;
  private selectionChangeHandler = () => this.updateButtonStates();

  constructor(_container: HTMLElement, onFormatChange: FormattingChangeCallback) {
    this.onFormatChange = onFormatChange;
  }

  /**
   * Render the formatting toolbar into the editor
   */
  render(): HTMLElement {
    this.toolbar = document.createElement("div");
    this.toolbar.className = "formatting-toolbar";
    this.toolbar.innerHTML = `
      <div class="fmt-group fmt-font-group">
        <select class="fmt-font-select" title="Font Family">
          ${fontOptionsHtml()}
        </select>
        <select class="fmt-size-select" title="Font Size">
          <option value="8">8</option>
          <option value="9">9</option>
          <option value="10">10</option>
          <option value="11">11</option>
          <option value="12">12</option>
          <option value="13">13</option>
          <option value="14" selected>14</option>
          <option value="16">16</option>
          <option value="18">18</option>
          <option value="20">20</option>
          <option value="22">22</option>
          <option value="24">24</option>
          <option value="26">26</option>
          <option value="28">28</option>
          <option value="32">32</option>
          <option value="36">36</option>
          <option value="42">42</option>
          <option value="48">48</option>
          <option value="56">56</option>
          <option value="72">72</option>
        </select>
      </div>

      <div class="fmt-separator"></div>

      <div class="fmt-group fmt-style-group">
        <button class="fmt-btn" data-command="bold" title="Bold (Ctrl+B)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>
        </button>
        <button class="fmt-btn" data-command="italic" title="Italic (Ctrl+I)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
        </button>
        <button class="fmt-btn" data-command="underline" title="Underline (Ctrl+U)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" y1="20" x2="20" y2="20"/></svg>
        </button>
        <button class="fmt-btn" data-command="strikeThrough" title="Strikethrough">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/></svg>
        </button>
      </div>

      <div class="fmt-separator"></div>

      <div class="fmt-group fmt-color-group">
        <label class="fmt-color-btn" title="Text Color">
          <input type="color" class="fmt-color-input" value="#000000" />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="m5.5 16 6.5-14 6.5 14"/><path d="M8.5 10h7"/></svg>
          <span class="fmt-color-indicator" style="background-color: #000000;"></span>
        </label>
      </div>

      <div class="fmt-separator"></div>

      <div class="fmt-group fmt-align-group">
        <button class="fmt-btn active" data-command="justifyLeft" title="Align Left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>
        </button>
        <button class="fmt-btn" data-command="justifyCenter" title="Align Center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="10" x2="6" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="18" y1="18" x2="6" y2="18"/></svg>
        </button>
        <button class="fmt-btn" data-command="justifyRight" title="Align Right">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="10" x2="7" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="7" y2="18"/></svg>
        </button>
        <button class="fmt-btn" data-command="justifyFull" title="Justify">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/></svg>
        </button>
      </div>

      <div class="fmt-separator"></div>

      <div class="fmt-group fmt-list-group">
        <button class="fmt-btn" data-command="insertUnorderedList" title="Bullet List">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>
        </button>
        <button class="fmt-btn" data-command="insertOrderedList" title="Numbered List">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="2" y="8" font-size="8" fill="currentColor" stroke="none">1</text><text x="2" y="14" font-size="8" fill="currentColor" stroke="none">2</text><text x="2" y="20" font-size="8" fill="currentColor" stroke="none">3</text></svg>
        </button>
      </div>

      <div class="fmt-separator"></div>

      <div class="fmt-group fmt-paragraph-group">
        <select class="fmt-line-height-select" title="Line Spacing">
          <option value="1.0">1.0</option>
          <option value="1.15">1.15</option>
          <option value="1.2">1.2</option>
          <option value="1.4" selected>1.4</option>
          <option value="1.5">1.5</option>
          <option value="1.6">1.6</option>
          <option value="1.8">1.8</option>
          <option value="2.0">2.0</option>
          <option value="2.5">2.5</option>
          <option value="3.0">3.0</option>
        </select>
        <select class="fmt-para-spacing-select" title="Space above the text (pt)">
          <option value="0" selected>No space above</option>
          <option value="6">6pt above</option>
          <option value="12">12pt above</option>
          <option value="18">18pt above</option>
          <option value="24">24pt above</option>
        </select>
      </div>

      <div class="fmt-separator"></div>

      <div class="fmt-group fmt-extra-group">
        <button class="fmt-btn" data-command="subscript" title="Subscript">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 5 8 8"/><path d="m12 5-8 8"/><path d="M20 19h-4c0-1.5.44-2 1.5-2.5S20 15.33 20 14c0-.47-.17-.93-.48-1.29a2.11 2.11 0 0 0-2.62-.44c-.42.24-.74.62-.9 1.07"/></svg>
        </button>
        <button class="fmt-btn" data-command="superscript" title="Superscript">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12 8 8"/><path d="m12 12-8 8"/><path d="M20 7h-4c0-1.5.44-2 1.5-2.5S20 3.33 20 2c0-.47-.17-.93-.48-1.29a2.11 2.11 0 0 0-2.62-.44c-.42.24-.74.62-.9 1.07"/></svg>
        </button>
        <button class="fmt-btn" data-action="clearFormat" title="Clear Formatting">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/><line x1="3" y1="21" x2="21" y2="3"/></svg>
        </button>
      </div>
    `;

    this.setupEventListeners();
    return this.toolbar;
  }

  /**
   * Setup event listeners for all toolbar buttons
   */
  private setupEventListeners() {
    if (!this.toolbar) return;

    // Style buttons (bold, italic, underline, strikethrough)
    const styleBtns = this.toolbar.querySelectorAll(".fmt-style-group .fmt-btn");
    for (const btn of styleBtns) {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault(); // Prevent losing focus from contenteditable
      });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const command = (btn as HTMLElement).dataset.command;
        if (command) {
          document.execCommand(command, false);
          this.updateButtonStates();
          this.emitCurrentState();
        }
      });
    }

    // Alignment buttons
    const alignBtns = this.toolbar.querySelectorAll(".fmt-align-group .fmt-btn");
    for (const btn of alignBtns) {
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        // Alignment belongs to the whole box (its style.textAlign, which the
        // PDF export uses). execCommand would instead leave per-paragraph
        // alignment in the markup that the export ignores.
        const command = (btn as HTMLElement).dataset.command as string;
        const textAlign = this.getAlignmentForCommand(command);
        this.applyTextAlignToActiveEditable(textAlign);
        this.currentState.textAlign = textAlign;
        this.setActiveAlignmentButton(command);
        this.onFormatChange({ textAlign });
      });
    }

    // List buttons
    const listBtns = this.toolbar.querySelectorAll(".fmt-list-group .fmt-btn");
    for (const btn of listBtns) {
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const command = (btn as HTMLElement).dataset.command;
        if (command) {
          document.execCommand(command, false);
          this.updateButtonStates();
          this.emitCurrentState();
        }
      });
    }

    // Font family select
    const fontSelect = this.toolbar.querySelector(".fmt-font-select") as HTMLSelectElement;
    fontSelect?.addEventListener("mousedown", (e) => e.stopPropagation());
    // The font applies to the whole box (its style.font), not to the
    // selection: execCommand("fontName") makes <font face> markup, which the
    // rich-text sanitizer drops and the PDF export cannot draw.
    fontSelect?.addEventListener("change", () => {
      this.currentState.fontFamily = fontSelect.value;
      this.onFormatChange({ fontFamily: fontSelect.value });
    });

    // Font size select
    const sizeSelect = this.toolbar.querySelector(".fmt-size-select") as HTMLSelectElement;
    sizeSelect?.addEventListener("mousedown", (e) => e.stopPropagation());
    // execCommand's fontSize only knows the HTML sizes 1-7, so apply the
    // largest as a marker, with CSS styling so it is a styled span, then set
    // the marked spans' size in place. Changing them in place (not replacing
    // them) keeps the selection and the browser's own undo history intact.
    sizeSelect?.addEventListener("change", () => {
      const size = `${sizeSelect.value}px`;
      this.withCssStyling(() => document.execCommand("fontSize", false, "7"));
      const editable = this.selectionEditable();
      for (const el of editable?.querySelectorAll<HTMLElement>("[style]") ?? []) {
        if (SIZE_MARKERS.has(el.style.fontSize)) el.style.fontSize = size;
      }
      this.currentState.fontSize = parseInt(sizeSelect.value, 10);
      this.onFormatChange({ fontSize: this.currentState.fontSize });
    });

    // Color picker. With CSS styling on, the browser writes the colour as a
    // styled span itself and keeps the selection, so repeated picks apply.
    const colorInput = this.toolbar.querySelector(".fmt-color-input") as HTMLInputElement;
    const colorIndicator = this.toolbar.querySelector(".fmt-color-indicator") as HTMLElement;
    colorInput?.addEventListener("input", () => {
      this.withCssStyling(() => document.execCommand("foreColor", false, colorInput.value));
      if (colorIndicator) colorIndicator.style.backgroundColor = colorInput.value;
      this.currentState.color = colorInput.value;
      this.onFormatChange({ color: colorInput.value });
    });

    // Line height select
    const lineHeightSelect = this.toolbar.querySelector(
      ".fmt-line-height-select",
    ) as HTMLSelectElement;
    lineHeightSelect?.addEventListener("mousedown", (e) => e.stopPropagation());
    lineHeightSelect?.addEventListener("change", () => {
      const value = lineHeightSelect.value;
      // Apply line-height to the focused contenteditable element
      const activeEl = document.activeElement as HTMLElement;
      if (activeEl?.isContentEditable) {
        activeEl.style.lineHeight = value;
      }
      this.onFormatChange({ lineHeight: parseFloat(value) });
    });

    // Paragraph spacing select
    const paraSpacingSelect = this.toolbar.querySelector(
      ".fmt-para-spacing-select",
    ) as HTMLSelectElement;
    paraSpacingSelect?.addEventListener("mousedown", (e) => e.stopPropagation());
    paraSpacingSelect?.addEventListener("change", () => {
      // The options are PDF points; report editor pixels, the unit every
      // other size on the box uses. The editor applies it to the box, since
      // this select (not the text box) has focus when it changes.
      const points = parseFloat(paraSpacingSelect.value);
      this.onFormatChange({ paragraphSpacing: points * this.pageScale });
    });

    // Subscript/Superscript/Clear formatting buttons
    const extraBtns = this.toolbar.querySelectorAll(".fmt-extra-group .fmt-btn");
    for (const btn of extraBtns) {
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const command = (btn as HTMLElement).dataset.command;
        const action = (btn as HTMLElement).dataset.action;
        if (command) {
          document.execCommand(command, false);
          this.updateButtonStates();
          this.emitCurrentState();
        } else if (action === "clearFormat") {
          document.execCommand("removeFormat", false);
          this.updateButtonStates();
          this.emitCurrentState();
        }
      });
    }

    // Listen for selection changes to update button states
    document.addEventListener("selectionchange", this.selectionChangeHandler);
  }

  /**
   * Update toolbar button active states based on current selection
   */
  updateButtonStates() {
    if (!this.toolbar) return;
    // Guard against environments where execCommand APIs aren't available (e.g., jsdom in tests)
    if (typeof document.queryCommandState !== "function") return;

    const commands = ["bold", "italic", "underline", "strikeThrough"];
    for (const cmd of commands) {
      const btn = this.toolbar.querySelector(`[data-command="${cmd}"]`);
      if (btn) {
        if (document.queryCommandState(cmd)) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      }
    }

    // Update alignment buttons
    const alignCommands = ["justifyLeft", "justifyCenter", "justifyRight", "justifyFull"];
    for (const cmd of alignCommands) {
      const btn = this.toolbar.querySelector(`.fmt-align-group [data-command="${cmd}"]`);
      if (btn) {
        if (document.queryCommandState(cmd)) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      }
    }

    // Update font family
    // The selection's font is the box's CSS font stack; show its family.
    // Outside a text box it is the page's own font, which says nothing about
    // the selected box.
    const fontFamily = document.queryCommandValue("fontName");
    if (fontFamily && this.selectionEditable()) {
      const fontSelect = this.toolbar.querySelector(".fmt-font-select") as HTMLSelectElement;
      fontSelect.value = nearestEditorFont(fontFamily).value;
    }
  }

  /**
   * Run an editing command with CSS styling on, so it writes styled spans
   * rather than <font> elements (which the sanitizer drops), then turn it
   * off again so the style buttons keep writing <b>, <i> and so on.
   */
  private withCssStyling(run: () => void) {
    document.execCommand("styleWithCSS", false, "true");
    try {
      run();
    } catch (error) {
      // A browser can refuse a command (for example with no editable
      // selection). That must not escape the event handler as an uncaught error.
      logger.warn("Formatting command failed", error);
    } finally {
      document.execCommand("styleWithCSS", false, "false");
    }
  }

  /** The text box holding the selection, if the selection is in one. */
  private selectionEditable(): HTMLElement | null {
    const anchor = window.getSelection()?.anchorNode ?? null;
    const element =
      anchor?.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor?.parentElement;
    return (element?.closest("[contenteditable]") as HTMLElement | null) ?? null;
  }

  private getAlignmentForCommand(command: string): FormattingState["textAlign"] {
    const alignMap: Record<string, FormattingState["textAlign"]> = {
      justifyLeft: "left",
      justifyCenter: "center",
      justifyRight: "right",
      justifyFull: "justify",
    };
    return alignMap[command] ?? "left";
  }

  private applyTextAlignToActiveEditable(textAlign: FormattingState["textAlign"]) {
    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl?.isContentEditable) {
      activeEl.style.textAlign = textAlign;
      return;
    }

    const selection = window.getSelection();
    const anchorElement =
      selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? (selection.anchorNode as Element)
        : selection?.anchorNode?.parentElement;
    const editable = anchorElement?.closest("[contenteditable]") as HTMLElement | null;
    if (editable) {
      editable.style.textAlign = textAlign;
    }
  }

  private setActiveAlignmentButton(command: string) {
    if (!this.toolbar) return;

    const alignBtns = this.toolbar.querySelectorAll(".fmt-align-group .fmt-btn");
    for (const btn of alignBtns) {
      btn.classList.toggle("active", (btn as HTMLElement).dataset.command === command);
    }
  }

  /**
   * Show a text box's style in the toolbar. Anything the box leaves unset
   * shows the editor's default, so nothing carries over from the last box.
   * `pageScale` (editor pixels per PDF point) converts the space-above value
   * to the points the select lists.
   */
  updateFromAnnotation(style: ToolbarTextStyle | undefined, pageScale = 1) {
    if (!this.toolbar) return;
    const s = style ?? {};
    this.pageScale = pageScale > 0 ? pageScale : 1;

    // A font from an older session or the PDF shows as the nearest one offered.
    const font = nearestEditorFont(s.font || TEXT_BOX_DEFAULTS.font).value;
    const fontSize = Math.round(s.fontSize || TEXT_BOX_DEFAULTS.fontSize);
    const color = s.color || TEXT_BOX_DEFAULTS.color;
    const textAlign = s.textAlign || TEXT_BOX_DEFAULTS.textAlign;
    const lineHeight = s.lineHeight || TEXT_BOX_DEFAULTS.lineHeight;
    const spacingPt =
      Math.round(
        ((s.paragraphSpacing ?? TEXT_BOX_DEFAULTS.paragraphSpacing) / this.pageScale) * 10,
      ) / 10;

    this.selectValue(".fmt-font-select", font);
    this.selectValue(".fmt-size-select", fontSize.toString(), (v) => parseInt(v, 10) === fontSize);
    this.selectValue(
      ".fmt-line-height-select",
      lineHeight.toString(),
      (v) => Math.abs(parseFloat(v) - lineHeight) < 0.001,
    );
    this.selectValue(
      ".fmt-para-spacing-select",
      spacingPt.toString(),
      (v) => Math.abs(parseFloat(v) - spacingPt) < 0.05,
      `${spacingPt}pt above`,
    );

    const colorInput = this.toolbar.querySelector(".fmt-color-input") as HTMLInputElement;
    const colorIndicator = this.toolbar.querySelector(".fmt-color-indicator") as HTMLElement;
    colorInput.value = color;
    colorIndicator.style.backgroundColor = color;

    const styleButtons: Array<[string, boolean | undefined]> = [
      ["bold", s.bold],
      ["italic", s.italic],
      ["underline", s.underline],
      ["strikeThrough", s.strikethrough],
    ];
    for (const [command, on] of styleButtons) {
      this.toolbar.querySelector(`[data-command="${command}"]`)?.classList.toggle("active", !!on);
    }

    const alignMap: Record<FormattingState["textAlign"], string> = {
      left: "justifyLeft",
      center: "justifyCenter",
      right: "justifyRight",
      justify: "justifyFull",
    };
    this.setActiveAlignmentButton(alignMap[textAlign]);

    this.currentState = {
      ...this.currentState,
      bold: !!s.bold,
      italic: !!s.italic,
      underline: !!s.underline,
      strikethrough: !!s.strikethrough,
      fontFamily: font,
      fontSize,
      color,
      textAlign,
      isList: false,
      isOrderedList: false,
    };
  }

  /**
   * Choose the option matching `value` (or `matches`), adding one labelled
   * `label` when the list has no such option.
   */
  private selectValue(
    selector: string,
    value: string,
    matches: (optionValue: string) => boolean = (v) => v === value,
    label = value,
  ) {
    const select = this.toolbar?.querySelector(selector) as HTMLSelectElement;
    const existing = Array.from(select.options).find((opt) => matches(opt.value));
    if (existing) {
      select.value = existing.value;
      return;
    }
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
    select.value = value;
  }

  /**
   * Show the toolbar
   */
  show() {
    if (this.toolbar) this.toolbar.classList.remove("hidden");
  }

  /**
   * Hide the toolbar
   */
  hide() {
    if (this.toolbar) this.toolbar.classList.add("hidden");
  }

  /**
   * Report the formatting of the current selection. Font, size, colour and
   * alignment are left out: each is reported only by its own control, so a
   * style button never re-applies an old font or colour, or realigns the box
   * from a selection outside it.
   */
  private emitCurrentState() {
    // Guard against environments where execCommand APIs aren't available
    if (typeof document.queryCommandState === "function") {
      this.currentState = {
        ...this.currentState,
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        strikethrough: document.queryCommandState("strikeThrough"),
        isList: document.queryCommandState("insertUnorderedList"),
        isOrderedList: document.queryCommandState("insertOrderedList"),
      };
    }
    const { bold, italic, underline, strikethrough, isList, isOrderedList } = this.currentState;
    this.onFormatChange({ bold, italic, underline, strikethrough, isList, isOrderedList });
  }

  /**
   * Destroy the toolbar and cleanup
   */
  destroy() {
    document.removeEventListener("selectionchange", this.selectionChangeHandler);
    if (this.toolbar) {
      this.toolbar.remove();
      this.toolbar = null;
    }
  }
}

import { logger } from "../utils/logger.ts";
import {
  classifySourceFile,
  type PdfSource,
  SOURCE_ACCEPT,
  SOURCE_TYPES_LABEL,
} from "../utils/pdfFromSources.ts";
import { BaseComponent } from "./BaseComponent.ts";

export type SourcesChangeReason = "text" | "markdown" | "position" | "files" | "order" | "clear";

/** Whether the typed text goes before ("first") or after ("last") the files. */
export type SourcesTextPosition = "first" | "last";

export interface SourcesChangeDetail {
  reason: SourcesChangeReason;
  sources: PdfSource[];
  hasContent: boolean;
  fileCount: number;
  textLength: number;
}

interface PanelFile {
  id: string;
  file: File;
}

interface PanelState {
  text: string;
  markdown: boolean;
  /** Whether the typed text goes before or after the files. */
  textPosition: SourcesTextPosition;
  files: PanelFile[];
}

/**
 * State lives outside the element, keyed by its `store-key` attribute, so a
 * parent that re-renders its markup gets the same text and files back.
 * Files are kept in memory only and never saved.
 */
const stores = new Map<string, PanelState>();

const getStore = (key: string): PanelState => {
  let state = stores.get(key);
  if (!state) {
    state = { text: "", markdown: true, textPosition: "first", files: [] };
    stores.set(key, state);
  }
  return state;
};

let instanceCount = 0;
let fileCount = 0;

const ICONS = {
  upload:
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>',
  up: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>',
  down: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  remove:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
};

const MARKDOWN_HINTS = {
  on: "Markdown is on: use # for headings, **bold**, *italic*, - for lists and | for tables.",
  off: "Markdown is off: your text goes into the PDF exactly as typed.",
};

/**
 * Lets the user type text and pick files (PDF, images, text, Office and
 * more) for the PDF creator. Fires a bubbling `sources-change` event on
 * every change; read the result with `getSources()`.
 */
export class CreatorSourcesPanel extends BaseComponent {
  static readonly MAX_FILE_SIZE_MB = 100;
  static readonly MAX_TOTAL_SIZE_MB = 250;
  static readonly MAX_FILES = 50;

  private readonly uid = `kyte-sources-${++instanceCount}`;
  private errors: string[] = [];

  /** Forgets saved text and files for one panel key, or for every panel. */
  static clearStore(key?: string) {
    if (key === undefined) stores.clear();
    else stores.delete(key);
  }

  private get storeKey() {
    return this.getAttribute("store-key") || "default";
  }

  private get state() {
    return getStore(this.storeKey);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Text and files in the order they go into the PDF. */
  getSources(): PdfSource[] {
    const { text, markdown, textPosition, files } = this.state;
    const sources: PdfSource[] = files.map(({ file }) => ({ kind: "file", file }));
    if (text.trim()) {
      const typed: PdfSource = { kind: "text", text, markdown, name: "Your text" };
      if (textPosition === "first") sources.unshift(typed);
      else sources.push(typed);
    }
    return sources;
  }

  hasContent(): boolean {
    return this.state.text.trim().length > 0 || this.state.files.length > 0;
  }

  getText(): { text: string; markdown: boolean } {
    return { text: this.state.text, markdown: this.state.markdown };
  }

  /** Puts text in the box, for example from a saved draft. */
  setText(text: string, markdown = this.state.markdown) {
    this.state.text = text;
    this.state.markdown = markdown;
    const textarea = this.ref<HTMLTextAreaElement>("text");
    if (textarea) textarea.value = text;
    const toggle = this.ref<HTMLInputElement>("markdown");
    if (toggle) toggle.checked = markdown;
    this.updateTextState();
    this.emit("text");
  }

  /** Whether the typed text goes before ("first") or after ("last") the files. */
  get textPosition(): SourcesTextPosition {
    return this.state.textPosition;
  }

  /** Sets where the typed text goes, for example from a saved draft. */
  setTextPosition(position: SourcesTextPosition) {
    this.state.textPosition = position === "last" ? "last" : "first";
    const select = this.ref<HTMLSelectElement>("position");
    if (select) select.value = this.state.textPosition;
    this.emit("position");
  }

  get fileCount(): number {
    return this.state.files.length;
  }

  /**
   * Adds files that pass the type and size checks. Returns a message for
   * each file left out, and shows the same messages in the panel.
   */
  addFiles(input: Iterable<File> | ArrayLike<File>): string[] {
    const state = this.state;
    const problems: string[] = [];
    const maxFile = CreatorSourcesPanel.MAX_FILE_SIZE_MB * 1024 * 1024;
    const maxTotal = CreatorSourcesPanel.MAX_TOTAL_SIZE_MB * 1024 * 1024;
    let total = state.files.reduce((sum, item) => sum + item.file.size, 0);
    let added = 0;

    for (const file of Array.from(input)) {
      const name = file.name || "Unnamed file";
      if (!classifySourceFile(file)) {
        problems.push(`"${name}" can't be added. Use ${SOURCE_TYPES_LABEL}.`);
      } else if (file.size === 0) {
        problems.push(`"${name}" is empty.`);
      } else if (file.size > maxFile) {
        problems.push(
          `"${name}" is too large (${this.formatBytes(file.size)}). The maximum size is ${this.formatBytes(maxFile)}.`,
        );
      } else if (
        state.files.some(
          ({ file: other }) =>
            other.name === file.name &&
            other.size === file.size &&
            other.lastModified === file.lastModified,
        )
      ) {
        problems.push(`"${name}" is already in the list.`);
      } else if (state.files.length >= CreatorSourcesPanel.MAX_FILES) {
        problems.push(
          `"${name}" was not added. You can add up to ${CreatorSourcesPanel.MAX_FILES} files.`,
        );
      } else if (total + file.size > maxTotal) {
        problems.push(
          `"${name}" was not added. All files together must be under ${this.formatBytes(maxTotal)}.`,
        );
      } else {
        state.files.push({ id: `source-file-${++fileCount}`, file });
        total += file.size;
        added++;
      }
    }

    if (problems.length) logger.warn("Some files were not added to the creator", { problems });
    this.errors = problems;
    this.renderErrors();
    if (added) {
      this.renderFiles();
      this.announce(`${added} ${added === 1 ? "file" : "files"} added.`);
      this.emit("files");
    }
    return problems;
  }

  removeFile(id: string) {
    const files = this.state.files;
    const index = files.findIndex((item) => item.id === id);
    if (index < 0) return;
    const [removed] = files.splice(index, 1);
    this.renderFiles();
    const next = files[index] ?? files[index - 1];
    this.focusAction(next?.id, "remove");
    this.announce(`${removed.file.name} removed.`);
    this.emit("files");
  }

  /** Moves a file one place up (-1) or down (+1). */
  moveFile(id: string, step: -1 | 1) {
    const files = this.state.files;
    const index = files.findIndex((item) => item.id === id);
    const target = index + step;
    if (index < 0 || target < 0 || target >= files.length) return;
    [files[index], files[target]] = [files[target], files[index]];
    this.renderFiles();
    this.focusAction(id, step < 0 ? "up" : "down");
    this.announce(`${files[target].file.name} moved to position ${target + 1} of ${files.length}.`);
    this.emit("order");
  }

  /** Empties the text box and the file list. */
  clear() {
    const state = this.state;
    state.text = "";
    state.files = [];
    state.textPosition = "first";
    this.errors = [];
    if (this.isConnected) {
      this.render();
      this.setupEventListeners();
    }
    this.emit("clear");
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  render() {
    const { text, markdown, textPosition } = this.state;
    const id = this.uid;
    this.innerHTML = `
      <div class="creator-sources">
        <div class="control-group creator-sources-text">
          <div class="creator-sources-text-head">
            <label for="${id}-text">Type or paste text</label>
            <label class="creator-sources-switch">
              <input type="checkbox" role="switch" id="${id}-markdown" data-part="markdown" aria-describedby="${id}-hint" ${markdown ? "checked" : ""} />
              <span>Markdown</span>
            </label>
          </div>
          <textarea id="${id}-text" data-part="text" rows="8" placeholder="Start typing, or paste text here." aria-describedby="${id}-hint">${this.sanitize(text)}</textarea>
          <p id="${id}-hint" class="creator-sources-hint" data-part="hint">${markdown ? MARKDOWN_HINTS.on : MARKDOWN_HINTS.off}</p>
        </div>

        <div class="creator-sources-drop" data-part="drop">
          ${ICONS.upload}
          <p class="creator-sources-drop-title">Drop files here</p>
          <p class="creator-sources-drop-types">PDF, images, text, Word, Excel, PowerPoint, OpenDocument, RTF, EPUB and CSV</p>
          <button type="button" class="btn btn-secondary btn-sm" data-part="browse">Choose files</button>
          <input type="file" class="hidden" data-part="input" multiple accept="${SOURCE_ACCEPT}" tabindex="-1" />
        </div>
        <p class="creator-sources-note">Files stay on this device. Kyte keeps them in memory only, so reloading the page clears them.</p>

        <div class="creator-sources-errors hidden" role="alert" data-part="errors"></div>

        <div class="creator-sources-files">
          <div class="creator-repeatable-header">
            <h4 id="${id}-files">Files</h4>
            <span class="creator-sources-count" data-part="count"></span>
          </div>
          <p class="creator-sources-empty" data-part="empty">No files yet. Files go into the PDF in the order listed here.</p>
          <ol class="creator-sources-list" data-part="list" aria-labelledby="${id}-files"></ol>
        </div>

        <div class="control-group creator-sources-position hidden" data-part="position-group">
          <label for="${id}-position">Where should your text go?</label>
          <select id="${id}-position" data-part="position">
            <option value="first" ${textPosition === "first" ? "selected" : ""}>Before the files</option>
            <option value="last" ${textPosition === "last" ? "selected" : ""}>After the files</option>
          </select>
        </div>

        <p class="creator-sources-sr" aria-live="polite" data-part="status"></p>
      </div>
    `;
    this.renderFiles();
    this.renderErrors();
  }

  setupEventListeners() {
    const textarea = this.ref<HTMLTextAreaElement>("text") as HTMLTextAreaElement;
    textarea.addEventListener("input", () => {
      this.state.text = textarea.value;
      this.updateTextState();
      this.emit("text");
    });

    const toggle = this.ref<HTMLInputElement>("markdown") as HTMLInputElement;
    toggle.addEventListener("change", () => {
      this.state.markdown = toggle.checked;
      this.updateTextState();
      this.emit("markdown");
    });

    const position = this.ref<HTMLSelectElement>("position") as HTMLSelectElement;
    position.addEventListener("change", () => {
      this.state.textPosition = position.value === "last" ? "last" : "first";
      this.emit("position");
    });

    const input = this.ref<HTMLInputElement>("input") as HTMLInputElement;
    const drop = this.ref<HTMLElement>("drop") as HTMLElement;
    this.ref<HTMLButtonElement>("browse")?.addEventListener("click", () => input.click());
    drop.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("button, input")) return;
      input.click();
    });
    input.addEventListener("change", () => {
      if (input.files?.length) this.addFiles(input.files);
      // Lets the same file be picked again after it was removed.
      input.value = "";
    });
    drop.addEventListener("dragover", (event) => {
      event.preventDefault();
      drop.classList.add("drag-over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"));
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      drop.classList.remove("drag-over");
      const files = event.dataTransfer?.files;
      if (files?.length) this.addFiles(files);
    });

    this.ref<HTMLElement>("list")?.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button[data-action]",
      );
      const id = button?.dataset.id;
      if (!button || !id) return;
      if (button.dataset.action === "remove") this.removeFile(id);
      else this.moveFile(id, button.dataset.action === "up" ? -1 : 1);
    });

    this.ref<HTMLElement>("errors")?.addEventListener("click", (event) => {
      if (!(event.target as HTMLElement).closest("[data-action='dismiss']")) return;
      this.errors = [];
      this.renderErrors();
      this.ref<HTMLButtonElement>("browse")?.focus();
    });

    this.updateTextState();
  }

  private ref<T extends Element>(name: string): T | null {
    return this.querySelector<T>(`[data-part="${name}"]`);
  }

  private renderFiles() {
    const list = this.ref<HTMLElement>("list");
    if (!list) return;
    const { files } = this.state;
    list.innerHTML = files
      .map(({ id, file }, index) => {
        const name = this.sanitize(file.name);
        const type = classifySourceFile(file)?.label ?? "File";
        return `
          <li class="file-list-item creator-sources-item" data-id="${id}">
            <div class="file-item-details">
              <span class="creator-sources-index" aria-hidden="true">${index + 1}</span>
              <span class="file-name" title="${name}">${name}</span>
              <span class="file-size">${type} · ${this.formatBytes(file.size)}</span>
            </div>
            <div class="file-item-actions">
              <button type="button" class="action-btn" data-action="up" data-id="${id}" aria-label="Move ${name} up" ${index === 0 ? "disabled" : ""}>${ICONS.up}</button>
              <button type="button" class="action-btn" data-action="down" data-id="${id}" aria-label="Move ${name} down" ${index === files.length - 1 ? "disabled" : ""}>${ICONS.down}</button>
              <button type="button" class="action-btn remove" data-action="remove" data-id="${id}" aria-label="Remove ${name}">${ICONS.remove}</button>
            </div>
          </li>`;
      })
      .join("");

    const total = files.reduce((sum, item) => sum + item.file.size, 0);
    const count = this.ref<HTMLElement>("count");
    if (count) {
      count.textContent = files.length
        ? `${files.length} ${files.length === 1 ? "file" : "files"} · ${this.formatBytes(total)}`
        : "";
    }
    this.ref<HTMLElement>("empty")?.classList.toggle("hidden", files.length > 0);
    list.classList.toggle("hidden", files.length === 0);
    this.updateTextState();
  }

  private renderErrors() {
    const box = this.ref<HTMLElement>("errors");
    if (!box) return;
    box.classList.toggle("hidden", this.errors.length === 0);
    box.innerHTML = this.errors.length
      ? `<ul>${this.errors.map((message) => `<li>${this.sanitize(message)}</li>`).join("")}</ul>
         <button type="button" class="btn btn-secondary btn-sm" data-action="dismiss">Dismiss</button>`
      : "";
  }

  /** Syncs the hint and shows the text-position choice only when it matters. */
  private updateTextState() {
    const { text, markdown, files } = this.state;
    const hint = this.ref<HTMLElement>("hint");
    if (hint) hint.textContent = markdown ? MARKDOWN_HINTS.on : MARKDOWN_HINTS.off;
    this.ref<HTMLElement>("position-group")?.classList.toggle(
      "hidden",
      !(text.trim() && files.length),
    );
  }

  /** Keeps keyboard focus on the same control after the list is redrawn. */
  private focusAction(id: string | undefined, action: "up" | "down" | "remove") {
    const item = id ? this.querySelector<HTMLElement>(`li[data-id="${id}"]`) : null;
    if (!item) {
      this.ref<HTMLButtonElement>("browse")?.focus();
      return;
    }
    const preferred = item.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    const target =
      preferred && !preferred.disabled
        ? preferred
        : item.querySelector<HTMLButtonElement>("button:not([disabled])");
    target?.focus();
  }

  private announce(message: string) {
    const status = this.ref<HTMLElement>("status");
    if (status) status.textContent = message;
  }

  private emit(reason: SourcesChangeReason) {
    const detail: SourcesChangeDetail = {
      reason,
      sources: this.getSources(),
      hasContent: this.hasContent(),
      fileCount: this.state.files.length,
      textLength: this.state.text.length,
    };
    this.dispatchEvent(
      new CustomEvent("sources-change", { bubbles: true, composed: true, detail }),
    );
  }
}

if (!customElements.get("creator-sources-panel")) {
  customElements.define("creator-sources-panel", CreatorSourcesPanel);
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("../../utils/logger", () => ({ logger }));
// The panel only needs file types from the engine, not pdf.js.
vi.mock("../../utils/pdfConfig", () => ({
  PDFDocument: {},
  StandardFonts: {},
  rgb: () => ({}),
  degrees: () => ({}),
  pdfjsLib: {},
}));

import {
  CreatorSourcesPanel,
  type SourcesChangeDetail,
} from "../../components/CreatorSourcesPanel";

const makeFile = (name: string, size = 10, type = "", lastModified = 1) => {
  const file = new File(["x"], name, { type, lastModified });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

const MB = 1024 * 1024;

function mount(storeKey?: string) {
  const panel = document.createElement("creator-sources-panel") as CreatorSourcesPanel;
  if (storeKey) panel.setAttribute("store-key", storeKey);
  document.body.appendChild(panel);
  return panel;
}

const $ = <T extends Element>(panel: Element, selector: string) =>
  panel.querySelector(selector) as T;
const part = <T extends Element>(panel: Element, name: string) =>
  $<T>(panel, `[data-part="${name}"]`);
const names = (panel: Element) =>
  Array.from(panel.querySelectorAll(".creator-sources-item .file-name")).map(
    (el) => el.textContent,
  );

/** Collects `sources-change` events that bubbled up to the page. */
function listen() {
  const events: SourcesChangeDetail[] = [];
  document.body.addEventListener("sources-change", (event) =>
    events.push((event as CustomEvent<SourcesChangeDetail>).detail),
  );
  return events;
}

let panel: CreatorSourcesPanel;

beforeEach(() => {
  CreatorSourcesPanel.clearStore();
  panel = mount();
});

afterEach(() => {
  vi.restoreAllMocks();
  logger.warn.mockClear();
});

describe("CreatorSourcesPanel", () => {
  it("starts empty, with labelled controls", () => {
    const textarea = part<HTMLTextAreaElement>(panel, "text");
    expect(textarea.value).toBe("");
    expect($(panel, `label[for="${textarea.id}"]`).textContent).toBe("Type or paste text");
    const toggle = part<HTMLInputElement>(panel, "markdown");
    expect(toggle.getAttribute("role")).toBe("switch");
    expect(toggle.checked).toBe(true);
    expect(part(panel, "hint").textContent).toMatch(/^Markdown is on/);
    expect(part<HTMLInputElement>(panel, "input").accept).toContain(".docx");
    expect(part(panel, "empty").classList.contains("hidden")).toBe(false);
    expect(part(panel, "list").classList.contains("hidden")).toBe(true);
    expect(part(panel, "errors").classList.contains("hidden")).toBe(true);
    expect(panel.textContent).toContain("in memory only");
    expect(panel.hasContent()).toBe(false);
    expect(panel.getSources()).toEqual([]);
    expect(panel.fileCount).toBe(0);
  });

  it("reports typed text and the Markdown switch", () => {
    const events = listen();
    const textarea = part<HTMLTextAreaElement>(panel, "text");
    textarea.value = "# Hello";
    textarea.dispatchEvent(new Event("input"));
    expect(events.at(-1)).toMatchObject({ reason: "text", hasContent: true, textLength: 7 });
    expect(panel.getSources()).toEqual([
      { kind: "text", text: "# Hello", markdown: true, name: "Your text" },
    ]);

    const toggle = part<HTMLInputElement>(panel, "markdown");
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    expect(events.at(-1)?.reason).toBe("markdown");
    expect(part(panel, "hint").textContent).toMatch(/^Markdown is off/);
    expect(panel.getText()).toEqual({ text: "# Hello", markdown: false });
  });

  it("does not count blank text as content", () => {
    panel.setText("   \n ");
    expect(panel.hasContent()).toBe(false);
    expect(panel.getSources()).toEqual([]);
  });

  it("lists added files in order, with escaped names, type and size", () => {
    const events = listen();
    const problems = panel.addFiles([
      makeFile("report.docx", 2048),
      makeFile('<img src=x onerror="alert(1)">.pdf', 10),
    ]);
    expect(problems).toEqual([]);
    expect(names(panel)).toEqual(["report.docx", '<img src=x onerror="alert(1)">.pdf']);
    expect(panel.querySelector("img")).toBeNull();
    expect($(panel, ".creator-sources-item .file-size").textContent).toBe("Word · 2 KB");
    expect(part(panel, "count").textContent).toBe("2 files · 2.01 KB");
    expect(part(panel, "empty").classList.contains("hidden")).toBe(true);
    expect(part(panel, "status").textContent).toBe("2 files added.");
    expect(events.at(-1)).toMatchObject({ reason: "files", fileCount: 2, hasContent: true });
    expect(panel.getSources().map((source) => source.kind)).toEqual(["file", "file"]);

    panel.addFiles([makeFile("one.png", 5)]);
    expect(part(panel, "status").textContent).toBe("1 file added.");
  });

  it("explains each file it leaves out", () => {
    panel.addFiles([makeFile("keep.pdf", 10, "", 5)]);
    const problems = panel.addFiles([
      makeFile("virus.exe"),
      makeFile("empty.txt", 0),
      makeFile("huge.pdf", 101 * MB),
      makeFile("keep.pdf", 10, "", 5),
      makeFile("", 10, "application/x-unknown"),
    ]);
    expect(problems).toEqual([
      expect.stringMatching(/^"virus\.exe" can't be added\. Use PDF, images/),
      '"empty.txt" is empty.',
      '"huge.pdf" is too large (101 MB). The maximum size is 100 MB.',
      '"keep.pdf" is already in the list.',
      expect.stringMatching(/^"Unnamed file" can't be added/),
    ]);
    const errors = part<HTMLElement>(panel, "errors");
    expect(errors.getAttribute("role")).toBe("alert");
    expect(errors.classList.contains("hidden")).toBe(false);
    expect(errors.querySelectorAll("li")).toHaveLength(5);
    expect(panel.fileCount).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith("Some files were not added to the creator", {
      problems,
    });

    // Clicks that miss the button leave the messages in place.
    errors.querySelector("li")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(errors.classList.contains("hidden")).toBe(false);
    $<HTMLButtonElement>(errors, "[data-action='dismiss']").click();
    expect(errors.classList.contains("hidden")).toBe(true);
    expect(document.activeElement).toBe(part(panel, "browse"));
  });

  it("enforces the file count and total size limits", () => {
    const many = Array.from({ length: CreatorSourcesPanel.MAX_FILES + 1 }, (_, i) =>
      makeFile(`page-${i}.png`, 1, "", i),
    );
    const tooMany = panel.addFiles(many);
    expect(panel.fileCount).toBe(CreatorSourcesPanel.MAX_FILES);
    expect(tooMany).toEqual([`"page-50.png" was not added. You can add up to 50 files.`]);

    CreatorSourcesPanel.clearStore();
    const fresh = mount("sizes");
    const overTotal = fresh.addFiles([
      makeFile("a.pdf", 90 * MB),
      makeFile("b.pdf", 90 * MB),
      makeFile("c.pdf", 90 * MB),
    ]);
    expect(fresh.fileCount).toBe(2);
    expect(overTotal).toEqual(['"c.pdf" was not added. All files together must be under 250 MB.']);
  });

  it("moves files with the arrow buttons and keeps focus on the moved file", () => {
    const events = listen();
    panel.addFiles([makeFile("a.pdf"), makeFile("b.pdf"), makeFile("c.pdf")]);
    const buttons = (action: string) =>
      Array.from(panel.querySelectorAll<HTMLButtonElement>(`[data-action="${action}"]`));
    expect(buttons("up")[0].disabled).toBe(true);
    expect(buttons("down")[2].disabled).toBe(true);
    expect(buttons("up")[1].getAttribute("aria-label")).toBe("Move b.pdf up");

    buttons("down")[0].click();
    expect(names(panel)).toEqual(["b.pdf", "a.pdf", "c.pdf"]);
    expect(document.activeElement).toBe(buttons("down")[1]);
    expect(part(panel, "status").textContent).toBe("a.pdf moved to position 2 of 3.");
    expect(events.at(-1)?.reason).toBe("order");

    buttons("up")[1].click();
    // At the top the up button is disabled, so focus falls to the next enabled one.
    expect(names(panel)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(document.activeElement).toBe(buttons("down")[0]);

    buttons("down")[1].click();
    buttons("down")[2]?.click();
    expect(names(panel)).toEqual(["a.pdf", "c.pdf", "b.pdf"]);
    expect(document.activeElement).toBe(buttons("up")[2]);
  });

  it("removes files and moves focus sensibly", () => {
    const events = listen();
    panel.addFiles([makeFile("a.pdf"), makeFile("b.pdf")]);
    const remove = () => panel.querySelectorAll<HTMLButtonElement>('[data-action="remove"]');
    remove()[0].click();
    expect(names(panel)).toEqual(["b.pdf"]);
    expect(document.activeElement).toBe(remove()[0]);
    expect(part(panel, "status").textContent).toBe("a.pdf removed.");
    expect(events.at(-1)).toMatchObject({ reason: "files", fileCount: 1 });

    remove()[0].click();
    expect(panel.fileCount).toBe(0);
    expect(document.activeElement).toBe(part(panel, "browse"));
    expect(part(panel, "empty").classList.contains("hidden")).toBe(false);
    expect(part(panel, "count").textContent).toBe("");
  });

  it("ignores unknown ids, moves past the ends and clicks between buttons", () => {
    panel.addFiles([makeFile("a.pdf")]);
    const events = listen();
    panel.moveFile("nope", 1);
    panel.removeFile("nope");
    const id = $<HTMLElement>(panel, ".creator-sources-item").dataset.id as string;
    panel.moveFile(id, -1);
    panel.moveFile(id, 1);
    $<HTMLElement>(panel, ".file-name").click();
    expect(events).toEqual([]);
  });

  it("asks where the text goes only when there is text and files", () => {
    const group = part<HTMLElement>(panel, "position-group");
    expect(group.classList.contains("hidden")).toBe(true);
    panel.setText("Cover note");
    expect(group.classList.contains("hidden")).toBe(true);
    panel.addFiles([makeFile("a.pdf")]);
    expect(group.classList.contains("hidden")).toBe(false);
    expect(panel.getSources().map((source) => source.kind)).toEqual(["text", "file"]);

    const events = listen();
    const select = part<HTMLSelectElement>(panel, "position");
    select.value = "last";
    select.dispatchEvent(new Event("change"));
    expect(events.at(-1)?.reason).toBe("position");
    expect(panel.getSources().map((source) => source.kind)).toEqual(["file", "text"]);
    select.value = "first";
    select.dispatchEvent(new Event("change"));
    expect(panel.getSources()[0].kind).toBe("text");
  });

  it("keeps text and files when the element is rebuilt with the same key", () => {
    const first = mount("creator");
    first.setText("Keep <me> & this", false);
    first.addFiles([makeFile("a.pdf")]);
    const select = part<HTMLSelectElement>(first, "position");
    select.value = "last";
    select.dispatchEvent(new Event("change"));
    first.remove();

    const again = mount("creator");
    expect(part<HTMLTextAreaElement>(again, "text").value).toBe("Keep <me> & this");
    expect(part<HTMLInputElement>(again, "markdown").checked).toBe(false);
    expect(part<HTMLSelectElement>(again, "position").value).toBe("last");
    expect(names(again)).toEqual(["a.pdf"]);

    // Moving the same element re-renders it from the saved state too.
    again.remove();
    document.body.appendChild(again);
    expect(part<HTMLTextAreaElement>(again, "text").value).toBe("Keep <me> & this");

    expect(mount("other").hasContent()).toBe(false);
    CreatorSourcesPanel.clearStore("creator");
    expect(mount("creator").hasContent()).toBe(false);
  });

  it("clears everything", () => {
    const events = listen();
    panel.setText("text");
    panel.addFiles([makeFile("a.pdf"), makeFile("bad.exe")]);
    panel.clear();
    expect(part<HTMLTextAreaElement>(panel, "text").value).toBe("");
    expect(panel.fileCount).toBe(0);
    expect(part(panel, "errors").classList.contains("hidden")).toBe(true);
    expect(events.at(-1)).toMatchObject({ reason: "clear", hasContent: false });

    // A panel that is not on the page still clears its saved state.
    const detached = document.createElement("creator-sources-panel") as CreatorSourcesPanel;
    detached.setAttribute("store-key", "detached");
    detached.setText("x");
    detached.addFiles([makeFile("a.pdf")]);
    detached.clear();
    expect(detached.hasContent()).toBe(false);
  });

  it("adds files from the picker and lets the same file be picked again", () => {
    const input = part<HTMLInputElement>(panel, "input");
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    part<HTMLButtonElement>(panel, "browse").click();
    expect(click).toHaveBeenCalledTimes(1);
    part<HTMLElement>(panel, "drop").click();
    expect(click).toHaveBeenCalledTimes(2);

    Object.defineProperty(input, "files", { value: [makeFile("a.pdf")], configurable: true });
    input.dispatchEvent(new Event("change"));
    expect(names(panel)).toEqual(["a.pdf"]);
    expect(input.value).toBe("");

    Object.defineProperty(input, "files", { value: [], configurable: true });
    input.dispatchEvent(new Event("change"));
    expect(panel.fileCount).toBe(1);
  });

  it("accepts dropped files and shows the drop target", () => {
    const drop = part<HTMLElement>(panel, "drop");
    const dragEvent = (type: string, files?: File[]) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: files ? { files } : undefined });
      drop.dispatchEvent(event);
      return event;
    };
    expect(dragEvent("dragover").defaultPrevented).toBe(true);
    expect(drop.classList.contains("drag-over")).toBe(true);
    dragEvent("dragleave");
    expect(drop.classList.contains("drag-over")).toBe(false);

    dragEvent("dragover");
    const dropped = dragEvent("drop", [makeFile("a.png"), makeFile("b.xlsx")]);
    expect(dropped.defaultPrevented).toBe(true);
    expect(drop.classList.contains("drag-over")).toBe(false);
    expect(names(panel)).toEqual(["a.png", "b.xlsx"]);

    dragEvent("drop");
    expect(panel.fileCount).toBe(2);
  });

  it("reads and sets where the text goes, and puts it in that place", () => {
    const events = listen();
    panel.setText("Intro");
    panel.addFiles([makeFile("a.pdf")]);
    expect(panel.textPosition).toBe("first");

    panel.setTextPosition("last");

    expect(panel.textPosition).toBe("last");
    expect(part<HTMLSelectElement>(panel, "position").value).toBe("last");
    expect(events.at(-1)).toEqual(expect.objectContaining({ reason: "position" }));
    expect(panel.getSources().map((source) => source.kind)).toEqual(["file", "text"]);

    // Anything but "last" means before the files.
    panel.setTextPosition("middle" as never);
    expect(panel.textPosition).toBe("first");
    expect(panel.getSources().map((source) => source.kind)).toEqual(["text", "file"]);
  });

  it("remembers where the text goes before the panel is on the page", () => {
    const detached = document.createElement("creator-sources-panel") as CreatorSourcesPanel;
    detached.setAttribute("store-key", "detached");
    detached.setTextPosition("last");

    const shown = mount("detached");
    expect(shown.textPosition).toBe("last");
    expect(part<HTMLSelectElement>(shown, "position").value).toBe("last");
  });

  it("sets text before it is on the page", () => {
    const detached = document.createElement("creator-sources-panel") as CreatorSourcesPanel;
    detached.setAttribute("store-key", "early");
    detached.setText("Draft");
    document.body.appendChild(detached);
    expect(part<HTMLTextAreaElement>(detached, "text").value).toBe("Draft");
    expect(detached.getText()).toEqual({ text: "Draft", markdown: true });
  });
});

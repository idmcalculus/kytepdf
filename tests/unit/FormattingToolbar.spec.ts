import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import {
  type FormattingChangeCallback,
  FormattingToolbar,
  fontOptionsHtml,
} from "../../components/pdf-editor/FormattingToolbar";
import { EDITOR_FONTS } from "../../utils/richText";

// jsdom has no editing API (execCommand / queryCommand*) and no
// isContentEditable, so the tests provide small stand-ins for both.
const activeCommands = new Set<string>();
let fontNameValue = "";

const editingApi = {
  execCommand: vi.fn((_command: string, _showUi?: boolean, _value?: string) => true),
  queryCommandState: vi.fn((command: string) => activeCommands.has(command)),
  queryCommandValue: vi.fn((_command: string) => fontNameValue),
};

const installEditingApi = () => {
  for (const [name, fn] of Object.entries(editingApi)) {
    Object.defineProperty(document, name, { value: fn, configurable: true, writable: true });
  }
};

const removeEditingApi = (...names: Array<keyof typeof editingApi>) => {
  for (const name of names) delete (document as any)[name];
};

const selectText = (node: Node, start: number, end: number) => {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
};

describe("FormattingToolbar", () => {
  let onChange: Mock<FormattingChangeCallback>;
  let toolbar: FormattingToolbar;
  let toolbarEl: HTMLElement;
  let editable: HTMLElement;

  const button = (command: string) =>
    toolbarEl.querySelector(`[data-command="${command}"]`) as HTMLButtonElement;
  const select = (cls: string) => toolbarEl.querySelector(cls) as HTMLSelectElement;
  const changeSelect = (cls: string, value: string) => {
    const el = select(cls);
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const lastState = () => onChange.mock.calls.at(-1)?.[0];

  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
      configurable: true,
      get(this: HTMLElement) {
        return Boolean(this.closest('[contenteditable="true"]'));
      },
    });
  });

  afterAll(() => {
    delete (HTMLElement.prototype as any).isContentEditable;
  });

  beforeEach(() => {
    activeCommands.clear();
    fontNameValue = "";
    editingApi.execCommand.mockReset().mockReturnValue(true);
    editingApi.queryCommandState.mockClear();
    editingApi.queryCommandValue.mockClear();
    installEditingApi();

    onChange = vi.fn<FormattingChangeCallback>();
    const container = document.createElement("div");
    document.body.appendChild(container);
    toolbar = new FormattingToolbar(container, onChange);
    toolbarEl = toolbar.render();
    container.appendChild(toolbarEl);

    editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.tabIndex = 0; // jsdom only focuses elements with a tab index
    editable.textContent = "Hello world";
    document.body.appendChild(editable);
  });

  afterEach(() => {
    toolbar.destroy();
    window.getSelection()?.removeAllRanges();
    removeEditingApi("execCommand", "queryCommandState", "queryCommandValue");
  });

  it("renders every control group with the editor's default settings", () => {
    expect(toolbarEl.className).toBe("formatting-toolbar");
    expect(select(".fmt-font-select").value).toBe("Helvetica");
    expect(select(".fmt-size-select").value).toBe("14");
    expect(select(".fmt-line-height-select").value).toBe("1.4");
    expect(select(".fmt-para-spacing-select").value).toBe("0");
    expect(button("justifyLeft").classList.contains("active")).toBe(true);
    for (const command of ["bold", "italic", "underline", "strikeThrough"]) {
      expect(button(command).classList.contains("active")).toBe(false);
    }
  });

  it("cancels mousedown on every button so the text box keeps its selection", () => {
    for (const btn of toolbarEl.querySelectorAll<HTMLButtonElement>(".fmt-btn")) {
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      btn.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it("stops select mousedowns from reaching the editor's drag handlers", () => {
    const outer = vi.fn();
    toolbarEl.addEventListener("mousedown", outer);
    for (const cls of [
      ".fmt-font-select",
      ".fmt-size-select",
      ".fmt-line-height-select",
      ".fmt-para-spacing-select",
    ]) {
      select(cls).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    }
    expect(outer).not.toHaveBeenCalled();
  });

  it.each([
    ["bold", "bold"],
    ["italic", "italic"],
    ["underline", "underline"],
    ["strikeThrough", "strikethrough"],
  ] as const)("applies %s to the selection and reports it", (command, stateKey) => {
    activeCommands.add(command);

    button(command).click();

    expect(editingApi.execCommand).toHaveBeenCalledWith(command, false);
    expect(button(command).classList.contains("active")).toBe(true);
    expect(lastState()).toMatchObject({ [stateKey]: true });
  });

  it("clears a style button once the selection moves to unformatted text", () => {
    activeCommands.add("bold");
    button("bold").click();
    expect(button("bold").classList.contains("active")).toBe(true);

    activeCommands.delete("bold");
    document.dispatchEvent(new Event("selectionchange"));

    expect(button("bold").classList.contains("active")).toBe(false);
  });

  it("aligns the focused text box and marks only that alignment active", () => {
    editable.focus();

    button("justifyCenter").click();

    // Alignment is the box's; execCommand would leave per-paragraph
    // alignment in the markup, which the PDF export ignores.
    expect(editingApi.execCommand).not.toHaveBeenCalled();
    expect(editable.style.textAlign).toBe("center");
    expect(button("justifyCenter").classList.contains("active")).toBe(true);
    expect(button("justifyLeft").classList.contains("active")).toBe(false);
    expect(onChange).toHaveBeenCalledWith({ textAlign: "center" });
  });

  it("aligns the text box that holds the selection when focus is elsewhere", () => {
    selectText(editable.firstChild as Node, 0, 5);
    button("justifyRight").click();
    expect(editable.style.textAlign).toBe("right");

    // Selection anchored on the element itself rather than a text node.
    selectText(editable, 0, 1);
    button("justifyFull").click();
    expect(editable.style.textAlign).toBe("justify");
    expect(onChange).toHaveBeenLastCalledWith({ textAlign: "justify" });
  });

  it("leaves other elements alone when the selection is outside any text box", () => {
    const plain = document.createElement("p");
    plain.textContent = "not editable";
    document.body.appendChild(plain);
    selectText(plain.firstChild as Node, 0, 3);

    button("justifyCenter").click();

    expect(plain.style.textAlign).toBe("");
    expect(editable.style.textAlign).toBe("");
    expect(onChange).toHaveBeenCalledWith({ textAlign: "center" });
  });

  it("still aligns text when the browser has no execCommand", () => {
    removeEditingApi("execCommand");
    editable.focus();

    button("justifyRight").click();

    expect(editable.style.textAlign).toBe("right");
    expect(onChange).toHaveBeenCalledWith({ textAlign: "right" });
  });

  it.each([
    ["insertUnorderedList", { isList: true, isOrderedList: false }],
    ["insertOrderedList", { isList: false, isOrderedList: true }],
  ] as const)("toggles %s and reports the list state", (command, expected) => {
    activeCommands.add(command);

    button(command).click();

    expect(editingApi.execCommand).toHaveBeenCalledWith(command, false);
    expect(lastState()).toMatchObject(expected);
  });

  it("offers no indent buttons, since the PDF export cannot draw indents", () => {
    expect(toolbarEl.querySelector('[data-command="indent"]')).toBeNull();
    expect(toolbarEl.querySelector('[data-command="outdent"]')).toBeNull();
  });

  it("reports a font change for the whole box instead of marking up the selection", () => {
    selectText(editable.firstChild as Node, 0, 5);

    changeSelect(".fmt-font-select", "Times-Roman");

    // <font face> markup would be dropped by the sanitizer, so none is made.
    expect(editingApi.execCommand).not.toHaveBeenCalled();
    expect(editable.innerHTML).toBe("Hello world");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastState()).toEqual({ fontFamily: "Times-Roman" });
  });

  it("offers only the three font families the PDF can draw, by plain names", () => {
    const options = Array.from(select(".fmt-font-select").options);
    expect(options.map((o) => o.value)).toEqual(EDITOR_FONTS.map((font) => font.value));
    expect(options.map((o) => o.textContent)).toEqual(["Sans serif", "Serif", "Monospace"]);
    expect(fontOptionsHtml()).toContain('<option value="Times-Roman">Serif</option>');
  });

  /** What browsers do with CSS styling on: wrap the selection in a styled span. */
  const wrapSelectionInSpan = (property: string, value: string) => {
    const range = (window.getSelection() as Selection).getRangeAt(0);
    const span = document.createElement("span");
    span.style.setProperty(property, value);
    span.appendChild(range.extractContents());
    range.insertNode(span);
    range.selectNodeContents(span);
    return span;
  };

  it("sets the selection's size in place, keeping the selection and the browser's undo", () => {
    let marked: HTMLElement | null = null;
    let cssStyling = false;
    editingApi.execCommand.mockImplementation((command: string, _ui?: boolean, value?: string) => {
      if (command === "styleWithCSS") cssStyling = value === "true";
      if (command === "fontSize" && cssStyling)
        marked = wrapSelectionInSpan("font-size", "xxx-large");
      return true;
    });
    selectText(editable.firstChild as Node, 6, 11);

    changeSelect(".fmt-size-select", "24");

    // The browser's own span keeps its place; only its size changes.
    expect(editable.querySelector("span")).toBe(marked);
    expect((marked as unknown as HTMLElement).style.fontSize).toBe("24px");
    expect(window.getSelection()?.toString()).toBe("world");
    expect(editingApi.execCommand.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ["styleWithCSS", false, "true"],
      ["fontSize", false, "7"],
      ["styleWithCSS", false, "false"],
    ]);
    expect(lastState()).toEqual({ fontSize: 24 });

    // A second pick applies to the same, still selected, text.
    changeSelect(".fmt-size-select", "28");
    expect(editable.textContent).toBe("Hello world");
    expect(Array.from(editable.querySelectorAll("span")).at(-1)?.style.fontSize).toBe("28px");
  });

  it("leaves other sizes in the box alone", () => {
    editable.innerHTML = '<span style="font-size: 30px">Big</span> rest';
    selectText(editable.lastChild as Node, 1, 5);

    changeSelect(".fmt-size-select", "18");

    expect((editable.querySelector("span") as HTMLElement).style.fontSize).toBe("30px");
  });

  it("still records the font size when nothing is selected", () => {
    window.getSelection()?.removeAllRanges();

    changeSelect(".fmt-size-select", "18");

    expect(lastState()).toMatchObject({ fontSize: 18 });
  });

  it("colours the selection with a styled span the browser writes, keeping the selection", () => {
    let cssStyling = false;
    editingApi.execCommand.mockImplementation((command: string, _ui?: boolean, value?: string) => {
      if (command === "styleWithCSS") cssStyling = value === "true";
      if (command === "foreColor" && cssStyling) wrapSelectionInSpan("color", value as string);
      return true;
    });
    selectText(editable.firstChild as Node, 0, 5);
    const colorInput = toolbarEl.querySelector(".fmt-color-input") as HTMLInputElement;

    colorInput.value = "#ff0000";
    colorInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(editingApi.execCommand.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ["styleWithCSS", false, "true"],
      ["foreColor", false, "#ff0000"],
      ["styleWithCSS", false, "false"],
    ]);
    const span = editable.querySelector("span") as HTMLElement;
    expect(span.textContent).toBe("Hello");
    expect(span.style.color).toBe("rgb(255, 0, 0)");
    expect(window.getSelection()?.toString()).toBe("Hello");
    expect(
      (toolbarEl.querySelector(".fmt-color-indicator") as HTMLElement).style.backgroundColor,
    ).toBe("rgb(255, 0, 0)");
    expect(lastState()).toEqual({ color: "#ff0000" });
  });

  it("turns CSS styling off again even when the browser's command fails", () => {
    editingApi.execCommand.mockImplementation((command: string) => {
      if (command === "foreColor") throw new Error("not editable");
      return true;
    });
    const colorInput = toolbarEl.querySelector(".fmt-color-input") as HTMLInputElement;

    colorInput.value = "#00ff00";
    // jsdom reports an exception thrown inside a listener to window "error"
    // rather than to dispatchEvent's caller, so watch for it there.
    const uncaught = vi.fn((event: ErrorEvent) => event.preventDefault());
    window.addEventListener("error", uncaught);
    colorInput.dispatchEvent(new Event("input", { bubbles: true }));
    window.removeEventListener("error", uncaught);

    expect(uncaught).not.toHaveBeenCalled();
    expect(editingApi.execCommand).toHaveBeenLastCalledWith("styleWithCSS", false, "false");
  });

  it("updates the colour swatch even without a selection inside a text box", () => {
    const plain = document.createElement("p");
    plain.textContent = "outside";
    document.body.appendChild(plain);
    selectText(plain.firstChild as Node, 0, 3);
    const colorInput = toolbarEl.querySelector(".fmt-color-input") as HTMLInputElement;

    colorInput.value = "#00ff00";
    colorInput.dispatchEvent(new Event("input", { bubbles: true }));
    window.getSelection()?.removeAllRanges();
    colorInput.value = "#0000ff";
    colorInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(
      (toolbarEl.querySelector(".fmt-color-indicator") as HTMLElement).style.backgroundColor,
    ).toBe("rgb(0, 0, 255)");
    expect(lastState()).toMatchObject({ color: "#0000ff" });
  });

  it("sets line spacing on the focused text box and reports it", () => {
    editable.focus();

    changeSelect(".fmt-line-height-select", "2.0");

    expect(Number.parseFloat(editable.style.lineHeight)).toBe(2);
    expect(onChange).toHaveBeenCalledWith({ lineHeight: 2 });
  });

  it("reports line spacing even when the select itself has focus", () => {
    select(".fmt-line-height-select").focus();

    changeSelect(".fmt-line-height-select", "1.5");

    expect(editable.style.lineHeight).toBe("");
    expect(onChange).toHaveBeenCalledWith({ lineHeight: 1.5 });
  });

  it("reports space above in editor pixels, converting from the points it lists", () => {
    changeSelect(".fmt-para-spacing-select", "24");
    expect(onChange).toHaveBeenLastCalledWith({ paragraphSpacing: 24 });

    // A page drawn at 2 editor pixels per point: 16px of spacing is 8pt...
    toolbar.updateFromAnnotation({ paragraphSpacing: 16 }, 2);
    expect(select(".fmt-para-spacing-select").value).toBe("8");
    expect(select(".fmt-para-spacing-select").selectedOptions[0].textContent).toBe("8pt above");

    // ...and choosing 12pt there reports 24px.
    changeSelect(".fmt-para-spacing-select", "12");
    expect(onChange).toHaveBeenLastCalledWith({ paragraphSpacing: 24 });
    // The toolbar leaves the text box to the editor, which applies it.
    expect(editable.style.paddingTop).toBe("");
    expect(editable.style.paddingBottom).toBe("");
  });

  it("applies subscript and superscript, and clears formatting", () => {
    button("subscript").click();
    button("superscript").click();
    (toolbarEl.querySelector('[data-action="clearFormat"]') as HTMLButtonElement).click();

    expect(editingApi.execCommand.mock.calls.map((call) => call[0])).toEqual([
      "subscript",
      "superscript",
      "removeFormat",
    ]);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(lastState()).toMatchObject({ bold: false, italic: false });
  });

  it("never reports alignment from a style button", () => {
    activeCommands.add("justifyRight");

    button("italic").click();

    // A selection outside the box would otherwise realign the whole box.
    expect(lastState()).not.toHaveProperty("textAlign");
    expect(button("justifyRight").classList.contains("active")).toBe(true);
  });

  it("shows the family of the selection's font while it is in a text box", () => {
    selectText(editable.firstChild as Node, 0, 5);
    fontNameValue = '"courier"';
    toolbar.updateButtonStates();
    expect(select(".fmt-font-select").value).toBe("Courier");

    fontNameValue = '"Times New Roman", Times, serif';
    toolbar.updateButtonStates();
    expect(select(".fmt-font-select").value).toBe("Times-Roman");

    fontNameValue = "Wingdings";
    toolbar.updateButtonStates();
    expect(select(".fmt-font-select").value).toBe("Helvetica");

    fontNameValue = "";
    select(".fmt-font-select").value = "Courier";
    toolbar.updateButtonStates();
    expect(select(".fmt-font-select").value).toBe("Courier");
  });

  it("keeps the selected box's font when the selection moves out of text boxes", () => {
    const plain = document.createElement("p");
    plain.textContent = "page text";
    document.body.appendChild(plain);
    select(".fmt-font-select").value = "Times-Roman";
    fontNameValue = "system-ui, sans-serif";

    selectText(plain.firstChild as Node, 0, 4);
    toolbar.updateButtonStates();
    window.getSelection()?.removeAllRanges();
    toolbar.updateButtonStates();

    expect(select(".fmt-font-select").value).toBe("Times-Roman");
  });

  it("falls back to the box's own style where the browser cannot report formatting", () => {
    removeEditingApi("queryCommandState", "queryCommandValue");
    toolbar.updateFromAnnotation({ textAlign: "right", bold: true });

    expect(() => toolbar.updateButtonStates()).not.toThrow();
    button("italic").click();

    expect(lastState()).toEqual({
      bold: true,
      italic: false,
      underline: false,
      strikethrough: false,
      isList: false,
      isOrderedList: false,
    });
  });

  it("never sends font, size or colour with a style button change", () => {
    toolbar.updateFromAnnotation({ font: "Courier", fontSize: 30, color: "#ff0000" });
    changeSelect(".fmt-font-select", "Courier");

    activeCommands.add("bold");
    button("bold").click();

    const state = lastState() as Record<string, unknown>;
    expect(state.bold).toBe(true);
    expect(state).not.toHaveProperty("fontFamily");
    expect(state).not.toHaveProperty("fontSize");
    expect(state).not.toHaveProperty("color");
  });

  describe("updateFromAnnotation", () => {
    it("shows the selected annotation's font, size, colour, spacing and alignment", () => {
      toolbar.updateFromAnnotation({
        font: "Times-Roman",
        fontSize: 17.6,
        color: "#336699",
        textAlign: "center",
        lineHeight: 2,
        paragraphSpacing: 6,
        bold: true,
        underline: true,
      });

      expect(select(".fmt-line-height-select").value).toBe("2.0");
      expect(select(".fmt-para-spacing-select").value).toBe("6");
      expect(button("bold").classList.contains("active")).toBe(true);
      expect(button("underline").classList.contains("active")).toBe(true);
      expect(button("italic").classList.contains("active")).toBe(false);

      expect(select(".fmt-font-select").value).toBe("Times-Roman");
      expect(select(".fmt-size-select").value).toBe("18");
      expect((toolbarEl.querySelector(".fmt-color-input") as HTMLInputElement).value).toBe(
        "#336699",
      );
      expect(
        (toolbarEl.querySelector(".fmt-color-indicator") as HTMLElement).style.backgroundColor,
      ).toBe("rgb(51, 102, 153)");
      expect(button("justifyCenter").classList.contains("active")).toBe(true);
      expect(button("justifyLeft").classList.contains("active")).toBe(false);
    });

    it("adds a size option once for sizes the list does not offer", () => {
      const sizeSelect = select(".fmt-size-select");
      const optionCount = sizeSelect.options.length;

      toolbar.updateFromAnnotation({ fontSize: 15 });
      toolbar.updateFromAnnotation({ fontSize: 15 });

      expect(sizeSelect.options.length).toBe(optionCount + 1);
      expect(sizeSelect.value).toBe("15");
    });

    it.each([
      ["an empty style", {}],
      ["no style", undefined],
    ])("clears everything the previous box set when the next has %s", (_label, next) => {
      toolbar.updateFromAnnotation({
        font: "Courier",
        fontSize: 20,
        color: "#ff0000",
        textAlign: "center",
        lineHeight: 2,
        paragraphSpacing: 12,
        bold: true,
        italic: true,
      });

      toolbar.updateFromAnnotation(next);

      // The same defaults the editor draws an unstyled text box with.
      expect(select(".fmt-font-select").value).toBe("Helvetica");
      expect(select(".fmt-size-select").value).toBe("16");
      expect((toolbarEl.querySelector(".fmt-color-input") as HTMLInputElement).value).toBe(
        "#000000",
      );
      expect(select(".fmt-line-height-select").value).toBe("1.4");
      expect(select(".fmt-para-spacing-select").value).toBe("0");
      expect(button("justifyLeft").classList.contains("active")).toBe(true);
      expect(button("justifyCenter").classList.contains("active")).toBe(false);
      expect(button("bold").classList.contains("active")).toBe(false);
      expect(button("italic").classList.contains("active")).toBe(false);
    });

    it("shows other fonts as their nearest family and lists odd spacing values", () => {
      toolbar.updateFromAnnotation({ font: "Georgia", paragraphSpacing: 10, lineHeight: 1.33 }, 2);

      expect(select(".fmt-font-select").value).toBe("Times-Roman");
      expect(select(".fmt-font-select").options).toHaveLength(3);
      expect(select(".fmt-para-spacing-select").value).toBe("5");
      expect(select(".fmt-line-height-select").value).toBe("1.33");
    });

    it("treats a missing page scale as one pixel per point", () => {
      toolbar.updateFromAnnotation({ paragraphSpacing: 18 }, 0);
      expect(select(".fmt-para-spacing-select").value).toBe("18");
    });
  });

  it("shows and hides itself", () => {
    toolbar.hide();
    expect(toolbarEl.classList.contains("hidden")).toBe(true);
    toolbar.show();
    expect(toolbarEl.classList.contains("hidden")).toBe(false);
  });

  it("is safe to drive before it has rendered", () => {
    const unrendered = new FormattingToolbar(document.createElement("div"), vi.fn());

    expect(() => {
      unrendered.show();
      unrendered.hide();
      unrendered.updateButtonStates();
      unrendered.updateFromAnnotation({ font: "Courier" });
      unrendered.destroy();
    }).not.toThrow();
  });

  it("removes itself and stops tracking the selection when destroyed", () => {
    toolbar.destroy();
    editingApi.queryCommandState.mockClear();

    document.dispatchEvent(new Event("selectionchange"));

    expect(toolbarEl.isConnected).toBe(false);
    expect(editingApi.queryCommandState).not.toHaveBeenCalled();
  });
});

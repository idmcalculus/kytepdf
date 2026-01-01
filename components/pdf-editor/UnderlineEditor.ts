import { LineAnnotationEditor } from "./LineAnnotationEditor";
import type { ToolContext } from "./types";

export class UnderlineEditor extends LineAnnotationEditor {
  constructor(context: ToolContext) {
    super("addUnderlineBtn", context, "underline");
  }
}

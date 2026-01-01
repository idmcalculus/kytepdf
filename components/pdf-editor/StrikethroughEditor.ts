import { LineAnnotationEditor } from "./LineAnnotationEditor";
import type { ToolContext } from "./types";

export class StrikethroughEditor extends LineAnnotationEditor {
  constructor(context: ToolContext) {
    super("addStrikeBtn", context, "strikethrough");
  }
}

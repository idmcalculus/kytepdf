import type { EditorTool, ToolContext } from "./types";

export abstract class BaseTool implements EditorTool {
  public active = false;

  constructor(
    public id: string,
    protected context: ToolContext,
  ) {}

  onActivate() {
    this.active = true;
  }

  onDeactivate() {
    this.active = false;
  }

  abstract onPageClick(pageIndex: number, x: number, y: number): void;

  protected showProperties(id: string) {
    this.context.showProperties(id);
  }
}

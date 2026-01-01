import { logger } from "../../utils/logger";
import { BaseTool } from "./BaseTool";

export class ImageEditor extends BaseTool {
  constructor(context: any) {
    super("addImageBtn", context);
  }

  onPageClick() {
    // Image tool usually starts with a file pick, not a page click
    // But we satisfy the interface
  }

  async handleUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      return;
    }

    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      const id = this.context.annotationManager.addAnnotation({
        type: "image",
        pageIndex: 0,
        x: 50,
        y: 50,
        width: 150,
        height: 150,
        content: dataUrl,
        style: { opacity: 1.0, rotation: 0 },
      });

      this.context.renderAnnotation(id);
    } catch (err) {
      logger.error("Image upload failed", err);
    }
  }
}

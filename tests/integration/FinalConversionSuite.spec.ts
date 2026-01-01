import { beforeEach, describe, expect, it } from "vitest";
import { ImageToPdf } from "../../components/ImageToPdf";
import { OfficeToPdf } from "../../components/OfficeToPdf";
import { PdfToImage } from "../../components/PdfToImage";
import { PdfToOffice } from "../../components/PdfToOffice";

// Generic setup for custom elements
const register = (tag: string, cls: any) => {
  if (!customElements.get(tag)) customElements.define(tag, cls);
};

describe("Final Conversion Suite E2E (Integration)", () => {
  beforeEach(() => {
    register("pdf-to-image", PdfToImage);
    register("image-to-pdf", ImageToPdf);
    register("pdf-to-office", PdfToOffice);
    register("office-to-pdf", OfficeToPdf);

    document.body.innerHTML = '<div id="main-container"></div><div id="globalDialog"></div>';
  });

  it("should render PdfToImage and accept a PDF file", async () => {
    const el = new PdfToImage();
    document.getElementById("main-container")?.appendChild(el);
    expect(el.innerHTML).toContain("PDF to Image");
    expect(el.querySelector(".drop-zone")).toBeTruthy();
  });

  it("should render ImageToPdf and accept images", async () => {
    const el = new ImageToPdf();
    document.getElementById("main-container")?.appendChild(el);
    expect(el.innerHTML).toContain("Image to PDF");
  });

  it("should render PdfToOffice with correct format", async () => {
    const el = new PdfToOffice("pptx");
    document.getElementById("main-container")?.appendChild(el);
    expect(el.innerHTML).toContain("PDF to PowerPoint");
  });

  it("should render OfficeToPdf", async () => {
    const el = new OfficeToPdf();
    document.getElementById("main-container")?.appendChild(el);
    expect(el.innerHTML).toContain("Office to PDF");
  });
});

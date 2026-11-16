import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bootstrapKytePdf: vi.fn(),
  createIcons: vi.fn(),
  icons: { FileUp: ["svg", {}], Lock: ["svg", {}] },
}));

// main.ts only wires things together, so every module it pulls in is stubbed.
vi.mock("../../styles/main.scss", () => ({}));
vi.mock("../../components/ToolDashboard.ts", () => ({}));
vi.mock("../../components/PdfCompressor.ts", () => ({}));
vi.mock("../../components/PdfMerge.ts", () => ({}));
vi.mock("../../components/PdfSplit.ts", () => ({}));
vi.mock("../../components/PdfSign.ts", () => ({}));
vi.mock("../../components/PdfToImage.ts", () => ({}));
vi.mock("../../components/ImageToPdf.ts", () => ({}));
vi.mock("../../components/PdfToOffice.ts", () => ({}));
vi.mock("../../components/PdfToText.ts", () => ({}));
vi.mock("../../components/OfficeToPdf.ts", () => ({}));
vi.mock("../../components/PdfSecurity.ts", () => ({}));
vi.mock("../../components/PdfCreator.ts", () => ({}));
vi.mock("../../components/pdf-editor/PdfEditor.ts", () => ({}));
vi.mock("../../components/KyteDialog.ts", () => ({}));
vi.mock("../../components/AboutModal.ts", () => ({}));
vi.mock("../../components/EmailCollectionModal.ts", () => ({}));
vi.mock("../../components/AccountModal.ts", () => ({}));
vi.mock("../../components/KyteFooter.ts", () => ({}));
vi.mock("lucide", () => ({ createIcons: mocks.createIcons, icons: mocks.icons }));
vi.mock("../../utils/appBootstrap.ts", () => ({ bootstrapKytePdf: mocks.bootstrapKytePdf }));

const loadMain = async () => {
  vi.resetModules();
  await import("../../main.ts");
};

describe("main entry point", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("boots the app once with the build's production flag", async () => {
    await loadMain();
    expect(mocks.bootstrapKytePdf).toHaveBeenCalledTimes(1);
    expect(mocks.bootstrapKytePdf).toHaveBeenCalledWith({ prod: false });

    vi.stubEnv("PROD", true);
    await loadMain();
    expect(mocks.bootstrapKytePdf).toHaveBeenLastCalledWith({ prod: true });
  });

  it("exposes a lucide helper that always passes the bundled icon set", async () => {
    await loadMain();
    const { lucide } = window as any;

    lucide.createIcons();
    expect(mocks.createIcons).toHaveBeenLastCalledWith({ icons: mocks.icons });

    const root = document.createElement("div");
    lucide.createIcons({ root, attrs: { "stroke-width": 1.5 } });
    expect(mocks.createIcons).toHaveBeenLastCalledWith({
      icons: mocks.icons,
      root,
      attrs: { "stroke-width": 1.5 },
    });
  });
});

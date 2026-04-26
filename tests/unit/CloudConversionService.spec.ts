import { afterEach, describe, expect, it, vi } from "vitest";

const loadService = async (overrides: { endpoint?: string; isProd?: boolean } = {}) => {
  vi.resetModules();
  vi.doMock("../../utils/config.ts", () => ({
    config: {
      cloud: {
        apiEndpoint: overrides.endpoint ?? "",
      },
      isProd: overrides.isProd ?? false,
      logging: {
        defaultLevel: "ERROR",
        enabled: false,
        includeTimestamps: false,
      },
    },
  }));
  return await import("../../utils/CloudConversionService");
};

describe("CloudConversionService", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock("../../utils/config.ts");
  });

  it("returns mock bytes in development when no gateway is configured", async () => {
    vi.useFakeTimers();
    const { cloudConversionService } = await loadService({ isProd: false });

    const promise = cloudConversionService.convertFile(
      new File(["pdf"], "sample.pdf", { type: "application/pdf" }),
      "docx",
    );
    await vi.advanceTimersByTimeAsync(2000);

    await expect(promise).resolves.toEqual(new Uint8Array([0, 1, 2, 3]));
  });

  it("throws in production when no gateway is configured", async () => {
    const { cloudConversionService } = await loadService({ isProd: true });

    await expect(
      cloudConversionService.convertFile(
        new File(["pdf"], "sample.pdf", { type: "application/pdf" }),
        "docx",
      ),
    ).rejects.toThrow("Cloud Gateway URL not configured");
  });

  it("posts form data to the configured gateway", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([9, 8, 7]).buffer),
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);
    const { cloudConversionService } = await loadService({
      endpoint: "https://gateway.example.com/convert",
      isProd: true,
    });
    const file = new File(["pdf"], "sample.pdf", { type: "application/pdf" });

    const result = await cloudConversionService.convertFile(file, "xlsx", { ocr: true });

    expect(result).toEqual(new Uint8Array([9, 8, 7]));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.example.com/convert",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
      }),
    );
    // API key should NOT be sent from the client
    const callArgs = fetchMock.mock.calls[0][1];
    expect(callArgs.headers).toBeUndefined();
  });

  it("surfaces gateway errors and fetch failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: vi.fn().mockResolvedValue("bad gateway"),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { cloudConversionService } = await loadService({
      endpoint: "https://gateway.example.com/convert",
      isProd: true,
    });

    await expect(
      cloudConversionService.convertFile(
        new File(["pdf"], "sample.pdf", { type: "application/pdf" }),
        "docx",
      ),
    ).rejects.toThrow("Cloud Gateway Error (502): bad gateway");

    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(
      cloudConversionService.convertFile(
        new File(["pdf"], "sample.pdf", { type: "application/pdf" }),
        "docx",
      ),
    ).rejects.toThrow("network down");
  });

  it("performs OCR through convertFile", async () => {
    const { cloudConversionService } = await loadService({ isProd: false });
    const spy = vi
      .spyOn(cloudConversionService, "convertFile")
      .mockResolvedValue(new Uint8Array([1]));
    const file = new File(["pdf"], "scan.pdf", { type: "application/pdf" });

    await expect(cloudConversionService.performOcr(file, "docx")).resolves.toEqual(
      new Uint8Array([1]),
    );

    expect(spy).toHaveBeenCalledWith(file, "docx", { ocr: true });
  });
});

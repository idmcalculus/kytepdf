import { config } from "./config.ts";
import { logger } from "./logger.ts";

export type ConversionFormat = "docx" | "pptx" | "xlsx" | "pdf";

export interface ConversionOptions {
  ocr?: boolean;
  ocrLanguage?: string;
  quality?: number;
}

class CloudConversionService {
  private apiKey: string;
  private endpoint: string;

  constructor() {
    this.apiKey = config.cloud.apiKey;
    this.endpoint = config.cloud.apiEndpoint;
  }

  /**
   * Converts a file via a custom Serverless Gateway (GCP/Azure).
   * Expected API: POST [endpoint] with multipart/form-data (file, format, ocr)
   */
  async convertFile(
    file: File,
    targetFormat: ConversionFormat,
    options: ConversionOptions = {},
  ): Promise<Uint8Array> {
    // In development, if no endpoint is provided, use mock
    if (!this.endpoint || this.endpoint.includes("api.cloudconvert.com")) {
      if (!config.isProd) {
        logger.warn("Custom Cloud Gateway not configured. Using mock mode.");
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return new Uint8Array([0, 1, 2, 3]);
      }
      throw new Error(
        "Cloud Gateway URL not configured. Please add VITE_CLOUD_GATEWAY_URL to your .env file.",
      );
    }

    logger.info(`Sending to Cloud Gateway: ${file.name} -> ${targetFormat}`);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("targetFormat", targetFormat);
      formData.append("ocr", options.ocr ? "true" : "false");

      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "X-Api-Key": this.apiKey, // Optional security header
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Cloud Gateway Error (${response.status}): ${errorText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return new Uint8Array(arrayBuffer);
    } catch (err: any) {
      logger.error("Cloud Gateway Conversion Failed", err);
      throw err;
    }
  }

  /**
   * Specifically handles OCR for scanned documents.
   */
  async performOcr(file: File, targetFormat: "pdf" | "docx" = "pdf"): Promise<Uint8Array> {
    return this.convertFile(file, targetFormat, { ocr: true });
  }
}

export const cloudConversionService = new CloudConversionService();

# KytePDF Cloud Gateway (LibreOffice + OCR)

This service provides the `/convert` endpoint used by the KytePDF frontend for cloud conversions.
It runs on a Hono server with strict validation and structured logging.

## Endpoints

- `GET /health` -> `{ status: "ok" }`
- `POST /convert` -> multipart form fields:
  - `file`: input file
  - `targetFormat`: `docx | pptx | xlsx | pdf`
  - `ocr`: `true | false`

## Environment Variables

- `PORT` (default `8080`)
- `CLOUD_GATEWAY_API_KEY` (optional, checked against `X-Api-Key`)
- `MAX_FILE_SIZE_MB` (default `50`)
- `CORS_ORIGIN` (default `*`, supports comma-separated list)

## Local Run

```bash
npm install
npm run build
node dist/server.js
```

## Notes

- OCR uses `ocrmypdf` (Tesseract) and only applies to PDF input. For non-PDF input, the service first converts to PDF, then OCRs.
- LibreOffice conversions are best-effort and may not preserve complex layouts.

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
- `CLOUD_GATEWAY_API_KEY` (required in production, checked against `X-Api-Key`)
- `MAX_FILE_SIZE_MB` (default `50`)
- `CORS_ORIGIN` (required to be non-wildcard in production, supports comma-separated list)
- `RATE_LIMIT_WINDOW_MS` (default `60000`)
- `RATE_LIMIT_MAX_REQUESTS` (default `30`)
- `MAX_CONCURRENT_CONVERSIONS` (default `2`)

## Local Run

```bash
npm install
npm run build
node dist/server.js
```

Do not expose `CLOUD_GATEWAY_API_KEY` in a browser bundle. Production traffic should come through
a backend-for-frontend or an API gateway that injects the server-side key.

## Notes

- OCR uses `ocrmypdf` (Tesseract) and only applies to PDF input. For non-PDF input, the service first converts to PDF, then OCRs.
- LibreOffice conversions are best-effort and may not preserve complex layouts.

# Plan: PDF & Office Format Conversions

This plan implements local image conversions and cloud-based Office/OCR conversions, strictly adhering to KytePDF's privacy-centric design.

## Phase 1: Local Image Conversions [checkpoint: 9d88921]
Focus: Implementing high-privacy, browser-based conversions for images.

- [x] Task: Write unit tests for `PdfToImage` logic (rendering pages to canvas/blobs) a58583c
- [x] Task: Implement `PdfToImage.ts` component with thumbnail gallery and ZIP export fa0f4f7
- [x] Task: Write unit tests for `ImageToPdf` logic (embedding images in pdf-lib) 99567c6
- [x] Task: Implement `ImageToImage.ts` component with multi-file reordering fa0f4f7
- [x] Task: Conductor - User Manual Verification 'Phase 1: Local Image Conversions' (Protocol in workflow.md)

## Phase 2: Cloud Infrastructure & Privacy Gates [checkpoint: ef6e797]
Focus: Setting up the secure bridge for external API processing.

- [x] Task: Implement `CloudConsentModal.ts` component for per-session opt-in 28e2270
- [x] Task: Create `CloudConversionService.ts` utility for API communication (Vite env variables) d416749
- [x] Task: Add "Cloud" vs "Local" badging to the `ToolDashboard` UI 47f4163
- [x] Task: Conductor - User Manual Verification 'Phase 2: Cloud Infrastructure & Privacy Gates' (Protocol in workflow.md)

## Phase 3: Office & OCR Integration [checkpoint: 6763f25]
Focus: Implementing the complex document conversions and OCR.

- [x] Task: Write integration tests for PDF to Word/PPT conversion flow d68a03e
- [x] Task: Implement `PdfToOffice.ts` (handling Word and PPT directions) d550fcb
- [x] Task: Implement `OfficeToPdf.ts` (handling upload and conversion return) d550fcb
- [x] Task: Enable and verify OCR flags in the Cloud API requests for scanned documents d550fcb
- [x] Task: Conductor - User Manual Verification 'Phase 3: Office & OCR Integration' (Protocol in workflow.md)

## Phase 4: Polish & Dashboard Integration
Focus: Finalizing the user experience and ensuring all tools are live.

- [x] Task: Update `main.ts` router to handle all new conversion tool IDs 30c6775
- [x] Task: Conduct final E2E tests for the entire conversion suite d550fcb
- [x] Task: Conductor - User Manual Verification 'Phase 4: Polish & Dashboard Integration' (Protocol in workflow.md)

## Phase 5: Live Cloud API Integration
Focus: Replacing mock logic with real CloudConvert API communication.

- [ ] Task: Implement real CloudConvert job/upload/poll logic in `CloudConversionService.ts`
- [ ] Task: Add robust error handling for API failures and timeouts
- [ ] Task: Verify live conversion flow with a real PDF document
- [ ] Task: Conductor - User Manual Verification 'Phase 5: Live Cloud Integration' (Protocol in workflow.md)

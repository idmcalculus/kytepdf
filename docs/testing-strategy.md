# Testing Strategy

KytePDF uses a hard coverage gate for the browser app and cloud gateway.

For the browser app, CI enforces the 95% target on executable source coverage:

- Lines: 95%
- Statements: 95%
- Functions: 95%
- Branches: 76% ratchet baseline

The gate is enforced by `bun run test:coverage` and by GitHub Actions in `.github/workflows/ci.yml`.

Branch coverage is intentionally ratcheted from the current baseline instead of set to 95% today.
The app is a DOM-heavy Web Component codebase with many null guards, optional fallback paths, and browser capability branches. Forcing a 95% branch gate immediately would require hundreds of low-value tests or coverage annotations. The branch threshold should be raised as code is extracted into smaller workflow modules and branch-heavy UI glue shrinks.

## Current App Baseline

On April 24, 2026, the root app suite passed functionally and now meets the 95% source coverage target for statements, functions, and lines with `coverage.all` enabled:

- Statements: 95%+
- Functions: 95%+
- Lines: 95%+
- Branches: 76%+

The largest remaining branch-heavy areas are stateful Web Component tools and conversion adapters:

- `components/PdfCreator.ts`
- `components/pdf-editor/PdfEditor.ts`
- `components/PdfSecurity.ts`
- `utils/pdfCreator.ts`
- `components/BaseComponent.ts`
- `utils/pdfEngine.ts`

## Architecture Recommendation

A hard rewrite is not required before adding the gate. The current suite now covers the user-facing workflows and core PDF utilities at a high level. The main maintainability issue is that business logic, DOM rendering, persistence, file I/O, and PDF orchestration still live inside large Web Component classes, which makes branch coverage expensive and noisy.

Refactor incrementally:

1. Extract pure workflow/state modules from each tool component.
2. Keep Web Components thin: render, bind DOM events, and delegate.
3. Test extracted workflow modules with deterministic mocks for PDF, storage, and browser APIs.
4. Keep integration tests for component wiring and Playwright tests for the critical user flows.
5. Remove or finish inactive product code instead of excluding it from coverage.

Coverage exclusions should stay limited to generated output, dependencies, declarations, tests, and infrastructure outside the root app.

# Changelog

## Unreleased

### Added

- PDF to Text, PDF to Word and PDF to Sheets run in the browser. A pdf-inspector WebAssembly engine reads text, headings and tables in a worker, and reports scanned pages, tables and encoding problems.
- PDF to Text saves Markdown or plain text, with optional OCR (tesseract.js) for scanned pages.
- Office to Markdown converts Word, Excel, PowerPoint, OpenDocument, RTF, EPUB and CSV files with the anydoc WebAssembly engine.
- Create PDF can build a PDF from your own content: typed text, PDFs, images, spreadsheets, documents and presentations, joined in the order you choose, with a live preview.
- Create PDF adds payslips, invoice status and paid date, header and footer layout options, watermarks (logo, image or text) and typed signatures in a bundled handwriting font.
- The PDF editor adds a formatting toolbar (font, size, colour, bold, italic, underline, strikethrough, alignment, lists, line spacing, space above, subscript, superscript) and makes the page's own text editable.
- The service worker keeps the app and its engines available offline after first use.
- The OCI auth deployment gains parity checks against the auth server and a guard that stops a deploy when a required variable is empty.
- CI fails on an empty coverage report, checks that the build ships its engine workers and runtime files intact, and runs the built app under the production Content-Security-Policy.

### Changed

- Compression accepts PDFs up to 1 GB, tests 8 sample pages to choose its settings, and renders the document once instead of up to 12 times.
- Error dialogs show the real cause of a failure, such as a file that is too large, instead of a generic message.
- Saving in the PDF editor changes only what you edited. Untouched text and images keep their original fonts, colours and layout.
- Protect and Unlock report damaged PDFs as damaged instead of as password-protected, and skip them in batches.
- History keeps each file's type, so Markdown, text, Word and Excel results download correctly, and each tool offers only recent files it can open.
- The OCI auth deployment sends email through Resend instead of AWS SES, and compresses its start-up data to fit OCI's limit.
- The production Content-Security-Policy allows WebAssembly and the bundled font, and blocks plugins, `<base>` changes and cross-site form posts.
- Every dependency moves to its latest release, including pdf.js 6, Vite 8, Vitest 5, TypeScript 7, jsdom 31, Biome 2.6, Playwright 1.65, lucide 1, tesseract.js 7, anydoc 0.2 and pdf-inspector 1.26.
- pdf.js runs from its legacy build, so the app still works in browsers older than Chrome 147 and Safari 26.2. Dev and build copy its worker and image decoders from the installed package, instead of keeping a copy in git.
- The app loads only the 17 icons it uses, which cuts the icon bundle from 457 kB to 6 kB.
- PDF to Word keeps superscript, subscript, strikethrough and underlined text.
- Create PDF draws invoice signatures as a picture of the bundled handwriting font, so the app no longer ships fontkit, a 711 kB library.
- The OCI auth deployment moves to `@pulumi/oci` 5 and Vitest 5. Its build uses TypeScript 7, while Pulumi, which cannot run TypeScript 7 yet, loads TypeScript 6.

### Removed

- The cloud conversion gateway, its infrastructure and the cloud consent dialog. No document leaves the browser.

### Fixed

- Stored cross-site scripting through file names on the resume buttons of the compress, split, sign and PDF to Image tools.
- Saving an edited PDF no longer fails on characters the standard fonts cannot draw, or on any PDF with an image in production.
- Quick clicks on the preview arrows no longer show an "Operation Failed" dialog.
- Passing only one of `maxSizeMB` or `allowedTypes` to file validation no longer drops the other check.
- Output files no longer keep the source extension (`report.docx_extracted.md`).
- The service worker no longer reloads open tabs on update, which lost unsaved work.
- Login errors show readable messages instead of codes such as `INVALID_CREDENTIALS`, and verify and reset links work for signed-in users.
- `pulumi up` for the OCI auth deployment loads again, and its default settings pass validation.
- Pages with JBIG2, CCITT fax or JPEG 2000 images show those images in previews, thumbnails and exports.
- A PDF that fails to open no longer leaves its pdf.js worker running.
- The Sign tool's second typed style uses the bundled handwriting font, so it works offline, and typed signatures wait for their font to load before drawing.
- SheetJS comes from its own CDN at 0.20.3. The npm release stops at 0.18.5, which has known prototype-pollution and ReDoS flaws.
- The auth server's lockfile takes the security fixes its dependencies allow, which clears 8 of the 17 packages `npm audit` flagged. The other 9 are nodemailer, `@hono/node-server`, SendGrid's packages and the `@fortressauth` packages that pin them to affected versions; the server's `console` and Resend email settings never load nodemailer or SendGrid.

## Earlier changes

### Added

- Added a standalone KytePDF authentication server powered by `@fortressauth/server`, with email authentication, optional Google and GitHub OAuth support, environment templates, and local development scripts.
- Added an account modal to the KytePDF web app with login, signup, forgot password, reset password, email verification, OAuth entry points, field validation, focus trapping, and accessible modal behavior.
- Added frontend authentication utilities for API communication and auth state management.
- Added route handling for account flows, including reset-password and verify-email token flows.
- Added user account access from the dashboard and PDF Creator account button.
- Added Netlify security header updates so the frontend can connect to the configured auth API.
- Added auth-focused tests, including auth flow end-to-end coverage, auth server smoke tests, and AuthClient unit tests.
- Added localStorage and sessionStorage polyfills for the Vitest environment.
- Added Husky and lint-staged pre-commit tooling for Biome checks.
- Added structured GitHub issue templates for bug reports and feature requests.

### Changed

- Updated account-unavailable messaging to use an informational state and clarify that local PDF tools remain available without signing in.
- Updated account alert styling with neutral info-state colors and improved accessibility semantics.
- Updated CI and Playwright configuration to use a dedicated Chromium project backed by system Chrome.
- Updated the Playwright cache key for more reliable CI caching.
- Updated PDF compression validation so target sizes must be valid, positive, and smaller than the original file.
- Updated PDF compression to pass a target ratio into the compression engine when using a custom target size.
- Updated PDF Creator and PDF Compressor to participate in the new authentication lifecycle.
- Updated app bootstrap initialization to include auth startup.
- Updated Biome from `^2.3.10` to `^2.4.16`.
- Updated pull request and issue workflow documentation.

### Fixed

- Prevented PDF compression from starting when the target size is invalid or larger than the source file.
- Improved PDF compression warnings for invalid targets, oversized targets, and very aggressive compression settings.
- Reduced account modal re-renders during in-flight form actions and redundant unauthenticated state updates.

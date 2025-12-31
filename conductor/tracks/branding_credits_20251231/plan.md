# Plan: Branding, Credits, and Email Collection

This plan covers the implementation of the global footer branding and the post-operation email collection modal, adhering to TDD and Web Component standards.

## Phase 1: Global Footer Component
Focus: Creating a subtle, persistent footer with company and developer credits.

- [~] Task: Write unit tests for `KyteFooter` (renders links, copyright, and "Buy me a coffee" button)
- [ ] Task: Implement `KyteFooter` component in `components/KyteFooter.ts`
- [ ] Task: Apply subtle styling in `style.css` or component-specific CSS
- [ ] Task: Integrate `<kyte-footer>` into the main application layout (`index.html` or `main.ts`)
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Global Footer' (Protocol in workflow.md)

## Phase 2: Email Collection Modal UI
Focus: Building the reusable modal component and the signup form.

- [ ] Task: Write unit tests for `EmailCollectionModal` (open/close logic, email validation, accessibility)
- [ ] Task: Implement `EmailCollectionModal` component in `components/EmailCollectionModal.ts`
- [ ] Task: Design the modal content with required incentives (cloud storage, early access, etc.)
- [ ] Task: Ensure focus trapping and ARIA compliance for accessibility
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Email Collection Modal UI' (Protocol in workflow.md)

## Phase 3: Integration and Trigger Logic
Focus: Hooking the modal into the PDF tool workflows.

- [ ] Task: Write integration tests for tool-to-modal workflow (trigger after success)
- [ ] Task: Modify `PdfCompressor.ts`, `PdfMerge.ts`, `PdfSplit.ts`, and `PdfSign.ts` to trigger the modal before download
- [ ] Task: Implement a mock service to handle email submission (log to console)
- [ ] Task: Ensure the modal can be dismissed to allow file download without friction
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Integration and Trigger Logic' (Protocol in workflow.md)

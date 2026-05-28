## 📝 Description

<!-- 
Please include a summary of the change, which issue is fixed, and relevant motivation/context. 
List any dependencies or sub-modules required for this change.
-->

Fixes # (issue)

---

## 🛠️ Type of Change

*Please check the options that are relevant:*

- [ ] **Bug Fix** (non-breaking change which fixes an issue)
- [ ] **New Feature** (non-breaking change which adds functionality)
- [ ] **Refactoring** (clean-up or restructure of code without functional changes)
- [ ] **Performance Boost** (speed or memory footprint improvements)
- [ ] **Breaking Change** (fix or feature that would cause existing functionality to not work as expected)
- [ ] **Documentation Update** (corrections, additions, or improvements to docs)
- [ ] **CI/CD / Developer Experience** (workflow changes, test configurations, package updates)

---

## 🗂️ Affected Components

*Which parts of the KytePDF ecosystem does this PR impact?*

- [ ] **App Frontend** (styles, index.html, `/components`, `/public`)
- [ ] **Service Worker / Offline PWA** (`sw.ts` or cache handlers)
- [ ] **PDF Utilities & Engines** (`/utils`, pdf-lib, pdfjs-dist integration)
- [ ] **Cloud Conversion Gateway** (Hono web service in `/cloud-gateway`, docker setups)
- [ ] **CI & Test Suites** (Github Actions workflows, Vitest setup, Playwright spec files)

---

## 🧪 Testing & Verification

<!-- 
Please describe the tests that you ran to verify your changes. 
Provide instructions so we can reproduce. 
Include details about local, manual, or automated test configurations.
-->

### 💻 Local Automated Checks
- [ ] Biome checks pass locally (`bun run lint`)
- [ ] TypeScript compilation passes cleanly (`bun run typecheck`)
- [ ] App Unit/Integration tests pass (`bun run test:unit`)
- [ ] Cloud Gateway tests pass (`bun run test` in `cloud-gateway/`)
- [ ] Playwright End-to-End tests pass (`bun run test:e2e`)

### 🖐️ Manual Verification Steps
1. 
2. 
3. 

---

## 📷 Screenshots / Visuals (if applicable)

<!--
If your changes affect any visible components or UI behaviors, please attach before/after screenshots or screen recordings (GIFs/MP4s) to show the differences.
-->

| Before Change | After Change |
| --- | --- |
| *Insert screenshot* | *Insert screenshot* |

---

## 📋 Checklist

- [ ] My code follows the code style and formatting guidelines (`biome`) of this project
- [ ] I have performed a self-review of my own code changes
- [ ] I have commented my code, particularly in hard-to-understand or intricate sections
- [ ] I have made corresponding changes to the documentation (like `README.md` or JSDocs)
- [ ] My changes generate no new runtime warnings or console errors
- [ ] I have added tests that cover the new logic and prove it is effective
- [ ] I have verified that all existing tests continue to pass successfully

# Plan: Edit PDF Feature

## Phase 1: Foundation & Viewer [checkpoint: 492ab97]
- [x] Task: Create `PdfEditor` component structure and basic routing 92700ea
    - [ ] Subtask: Create `components/PdfEditor.ts` with basic Web Component boilerplate.
    - [ ] Subtask: Update `main.ts` or router to handle navigation to the editor view when a file is selected.
- [x] Task: Implement PDF Rendering with `pdf.js` 682a200
    - [x] Bug Fix: Fixed event listeners not working due to redundant render call 6911ddd
- [x] Task: Conductor - User Manual Verification 'Foundation & Viewer' (Protocol in workflow.md) eda57d6

## Phase 2: Text Annotations [checkpoint: 0bbe601]
- [x] Task: Implement Annotation State Management 2bdfe53
    - [x] Subtask: Write unit tests for an `AnnotationManager` class (or internal logic) that adds/removes/updates annotations.
    - [x] Subtask: Implement the logic to store annotation data (x, y, content, style) in memory.
- [x] Task: Build Text Annotation UI (Drag & Drop) c62280e
    - [x] Subtask: Create the UI toolbar with a "Add Text" button.
    - [x] Subtask: Implement drag-and-drop functionality for text elements over the PDF canvas using Vanilla JS events.
- [x] Task: Integrate `pdf-lib` for Text Saving 80635bd
    - [x] Subtask: Write tests for a function `embedTextAnnotations` in `utils/pdfEngine.ts` that takes a PDF and a list of text annotations and returns a modified PDF.
    - [x] Subtask: Connect the UI "Save/Download" button to this function.
- [x] Task: Conductor - User Manual Verification 'Text Annotations' (Protocol in workflow.md) a2e348c

## Phase 3: Image & Shape Annotations (Erasure & Masking) [checkpoint: 089f886]
- [x] Task: Implement Shape Drawing (Rectangles/White-out) 0bbe601
    - [x] Subtask: Add a "Rectangle" tool to the toolbar.
    - [x] Subtask: Implement mouse drag logic to draw rectangles on the canvas.
    - [x] Subtask: Add properties panel for fill color, border, and opacity (for masking).
    - [x] Subtask: Write tests for `embedShapeAnnotations` in `utils/pdfEngine.ts`.
- [x] Task: Implement Image Insertion 089f886
    - [x] Subtask: Add an "Upload Image" button to the toolbar.
    - [x] Subtask: Implement file reading (FileReader) to display the image on the canvas.
    - [x] Subtask: Write tests for `embedImageAnnotations` in `utils/pdfEngine.ts` using `pdf-lib`.
- [x] Task: Conductor - User Manual Verification 'Image & Shape Annotations' (Protocol in workflow.md) b35aa33

## Phase 4: Architectural Refactor & Font Fix
- [x] Task: Modularize PdfEditor
    - [x] Subtask: Create `components/pdf-editor/` directory structure.
    - [x] Subtask: Implement `TextEditor`, `RectangleToolEditor`, and `ImageEditor` as separate logic modules.
    - [x] Subtask: Refactor `PdfEditor.ts` to orchestrate these modules.
- [x] Task: Fix Font Embedding Bug
    - [x] Subtask: Update `utils/pdfEngine.ts` to dynamically embed and apply selected fonts (Helvetica, Times, Courier).
    - [x] Subtask: Add unit tests for multi-font rendering.
- [x] Task: Advanced Text & Smart Match
    - [x] Subtask: Implement a "Properties Panel" that appears when an annotation is selected.
    - [x] Subtask: Add UI controls for Font Family, Size, and Color.
    - [x] Subtask: Implement "Smart Match" - use `pdf.js` text content analysis to auto-detect font properties on click.
- [x] Task: Update Tool Dashboard de79d5c
- [x] Task: Coordinate System Refinement & Testing de79d5c
    - [x] Subtask: Verify strict alignment between DOM coordinates and PDF points across different page sizes and zoom levels.
    - [x] Subtask: Adjust math util functions if necessary and add regression tests.
- [x] Task: Conductor - User Manual Verification 'Final Polish & Integration' (Protocol in workflow.md) de79d5c

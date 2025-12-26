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

## Phase 3: Image & Shape Annotations (Erasure & Masking)
- [ ] Task: Implement Shape Drawing (Rectangles/White-out)
    - [ ] Subtask: Add a "Rectangle" tool to the toolbar.
    - [ ] Subtask: Implement mouse drag logic to draw rectangles on the canvas.
    - [ ] Subtask: Add properties panel for fill color, border, and opacity (for masking).
    - [ ] Subtask: Write tests for `embedShapeAnnotations` in `utils/pdfEngine.ts`.
- [ ] Task: Implement Image Insertion
    - [ ] Subtask: Add an "Upload Image" button to the toolbar.
    - [ ] Subtask: Implement file reading (FileReader) to display the image on the canvas.
    - [ ] Subtask: Write tests for `embedImageAnnotations` in `utils/pdfEngine.ts` using `pdf-lib`.
- [ ] Task: Conductor - User Manual Verification 'Image & Shape Annotations' (Protocol in workflow.md)

## Phase 4: Final Polish & Integration
- [ ] Task: Advanced Text & Color Matching
    - [ ] Subtask: Add Font Family and Color selection to the text annotation UI.
    - [ ] Subtask: Support 'Eyedropper' behavior or precise HEX input for background matching.
- [ ] Task: Update Tool Dashboard
    - [ ] Subtask: Update `components/ToolDashboard.ts` to set the "Edit PDF" tool to `active: true`.
- [ ] Task: Coordinate System Refinement & Testing
    - [ ] Subtask: Verify strict alignment between DOM coordinates and PDF points across different page sizes and zoom levels.
    - [ ] Subtask: Adjust math util functions if necessary and add regression tests.
- [ ] Task: Conductor - User Manual Verification 'Final Polish & Integration' (Protocol in workflow.md)

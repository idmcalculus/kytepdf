# Specification: Edit PDF Feature

## 1. Overview
The "Edit PDF" feature allows users to modify existing PDF documents by adding new elements such as text, images, and basic shapes (rectangles, circles, lines). This processing happens entirely client-side using `pdf-lib` for manipulation and `pdf.js` for rendering, ensuring user privacy.

## 2. User Stories
- **As a user**, I want to upload a PDF and see it rendered in the browser so I can identify where to make edits.
- **As a user**, I want to click a "Text" tool to add a text box, type content, and move it to a desired location on the page.
- **As a user**, I want to upload an image (JPG, PNG) and place it onto the PDF page.
- **As a user**, I want to draw shapes (rectangles) to highlight or redact areas of the document.
- **As a user**, I want to download the modified PDF with all my additions burned into the file.

## 3. Functional Requirements
### 3.1 Tool Selection
- Update `ToolDashboard.ts` to enable the "Edit PDF" card (`active: true`).
- Create a new route/view for the Editor interface.

### 3.2 PDF Rendering (Viewer)
- Use `pdf.js` to render PDF pages into a canvas or DOM container.
- Support zooming and scrolling.
- Maintain a coordinate system mapping between the screen pixels and PDF points.

### 3.3 Text Annotation
- Provide a UI control to add text.
- Allow users to specify font size and color.
- Support dragging text elements.

### 3.4 Image Insertion
- Provide a file picker to select an image.
- Render the image on the UI.
- Allow resizing and dragging of the image.

### 3.5 Shape Drawing
- Provide a tool to draw rectangles.
- Allow customization of stroke color, fill color, and stroke width.

### 3.6 PDF Generation (Save)
- Use `pdf-lib` to load the original PDF.
- Programmatically apply the user's added elements (text, images, shapes) to the corresponding pages and coordinates.
- Export the modified PDF as a Blob for download.

## 4. Technical Design
### 4.1 Architecture
- **Component:** `PdfEditor.ts` (new component).
- **State Management:** Local state within the component to track the list of annotations (type, x, y, content, style) per page.
- **Coordinate Conversion:** A utility function is needed to convert DOM coordinates (where the user clicks/drops) to PDF coordinates (points). PDF coordinates usually start from the bottom-left, while DOM starts from top-left.

### 4.2 Data Model
```typescript
interface Annotation {
  id: string;
  type: 'text' | 'image' | 'rectangle';
  pageIndex: number;
  x: number; // PDF coordinates
  y: number; // PDF coordinates
  width?: number;
  height?: number;
  content?: string; // For text or image data URL
  style?: {
    color?: string;
    fontSize?: number;
    strokeWidth?: number;
  };
}
```

### 4.3 Libraries
- `pdf-lib`: For modifying the PDF document.
- `pdf.js`: For rendering the PDF to the user for editing.
- `interact.js` (optional but recommended, or vanilla JS): For drag-and-drop and resizing logic. *Decision: Use Vanilla JS for now to keep dependencies low, as per project ethos.*

## 5. Accessibility
- All tools (Text, Image, Shape) must be keyboard accessible.
- Provide status updates to screen readers when elements are added.
- Ensure high contrast for tool icons and active states.

## 6. Security
- Verify input file types (PDF for document, PNG/JPG for images).
- Ensure no data is sent to a server; all processing is local.

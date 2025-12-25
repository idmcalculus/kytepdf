# KytePDF 🚀

**KytePDF** is a lightweight, private, and high-performance PDF toolkit built with modern web technologies. Focus on speed and privacy—all processing happens directly in your browser. Local-first architecture means your documents stay under your control.

![KytePDF Dashboard](/logo-icon.svg)

## ✨ Features

- **Compress PDF**: Shrink file sizes significantly while maintaining visual quality. Target specific file sizes (e.g., "Compress to exactly 500KB").
- **Merge PDF**: Combine multiple documents into a single file with an intuitive drag-and-drop interface.
- **Split PDF**: Extract specific pages or ranges with live thumbnails for precise selection.
- **Sign PDF**: Draw, type, or upload your signature and place it anywhere on your document.
- **Private by Design**: Your PDFs never leave your machine during processing. For your convenience, we're building optional, opt-in cloud sync for cross-device history—but your documents stay local by default.
- **Modern UI**: A premium, "Hub & Spoke" dashboard with glassmorphic aesthetics and smooth micro-animations.

## 🛠 Tech Stack

- **Core**: TypeScript, Vanilla HTML/CSS, Web Components.
- **PDF Engine**: [pdf-lib](https://pdf-lib.js.org/) and [pdf.js](https://mozilla.github.io/pdf.js/).
- **Runtime & Tooling**: [Bun](https://bun.sh/) for speed, [Vite](https://vitejs.dev/) for bundling.
- **Linting & Formatting**: [Biome](https://biomejs.dev/) for industry-leading performance.
- **Icons**: [Lucide](https://lucide.dev/).

## 🚀 Getting Started

### Prerequisites

You'll need [Bun](https://bun.sh/) installed on your machine.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/kytepdf.git
   cd kytepdf
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Start development server:
   ```bash
   bun run dev
   ```

### Development Commands

- `bun run dev`: Start Vite development server.
- `bun run build`: Create a production-ready bundle in `dist/`.
- `bun run lint`: Run Biome linting and formatting checks.
- `bun run typecheck`: Verify TypeScript type safety.

## 🤝 Contributing

We love contributions! Please read our [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before getting started.

Feel free to open an issue or submit a Pull Request.

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

Built with ❤️ for a faster, more private web.

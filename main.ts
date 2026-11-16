import "./styles/main.scss";
import "./components/ToolDashboard.ts";
import "./components/PdfCompressor.ts";
import "./components/PdfMerge.ts";
import "./components/PdfSplit.ts";
import "./components/PdfSign.ts";
import "./components/PdfToImage.ts";
import "./components/ImageToPdf.ts";
import "./components/PdfToOffice.ts";
import "./components/PdfToText.ts";
import "./components/OfficeToPdf.ts";
import "./components/PdfSecurity.ts";
import "./components/PdfCreator.ts";
import "./components/pdf-editor/PdfEditor.ts";
import "./components/KyteDialog.ts";
import "./components/AboutModal.ts";
import "./components/EmailCollectionModal.ts";
import "./components/AccountModal.ts";
import "./components/KyteFooter.ts";
import { createIcons } from "lucide";
import { bootstrapKytePdf } from "./utils/appBootstrap.ts";
import { APP_ICONS } from "./utils/appIcons.ts";

// Components call window.lucide.createIcons() after rendering; it draws only
// the icons the app registers (see utils/appIcons.ts), not lucide's full set.
(window as any).lucide = {
  createIcons: (options = {}) => createIcons({ icons: APP_ICONS, ...options }),
};

bootstrapKytePdf({ prod: import.meta.env.PROD });

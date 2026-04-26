import "./styles/main.scss";
import "./components/ToolDashboard.ts";
import "./components/PdfCompressor.ts";
import "./components/PdfMerge.ts";
import "./components/PdfSplit.ts";
import "./components/PdfSign.ts";
import "./components/PdfToImage.ts";
import "./components/ImageToPdf.ts";
import "./components/PdfToOffice.ts";
import "./components/OfficeToPdf.ts";
import "./components/PdfSecurity.ts";
import "./components/PdfCreator.ts";
import "./components/pdf-editor/PdfEditor.ts";
import "./components/KyteDialog.ts";
import "./components/AboutModal.ts";
import "./components/EmailCollectionModal.ts";
import "./components/CloudConsentModal.ts";
import "./components/KyteFooter.ts";
import * as lucide from "lucide";
import { bootstrapKytePdf } from "./utils/appBootstrap.ts";

(window as any).lucide = lucide;

bootstrapKytePdf({ prod: import.meta.env.PROD });

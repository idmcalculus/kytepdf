import {
  CloudDownload,
  Edit3,
  FileImage,
  FilePlus,
  FileSpreadsheet,
  FileText,
  FileUp,
  Image,
  Lock,
  LockOpen,
  PenTool,
  PlusSquare,
  Presentation,
  Scissors,
  Sparkles,
  Stamp,
  X,
} from "lucide";

/**
 * The lucide icons the app draws, keyed as lucide's createIcons() looks them
 * up: the PascalCase form of each `data-lucide` name ("edit-3" is Edit3).
 * Registering only these keeps the other ~4,000 icons out of the bundle.
 *
 * A name used in markup must be added here, or createIcons() skips it and
 * the icon never appears; tests/unit/lucideIcons.spec.ts checks this.
 */
export const APP_ICONS = {
  CloudDownload,
  Edit3,
  FileImage,
  FilePlus,
  FileSpreadsheet,
  FileText,
  FileUp,
  Image,
  Lock,
  LockOpen,
  PenTool,
  PlusSquare,
  Presentation,
  Scissors,
  Sparkles,
  Stamp,
  X,
};

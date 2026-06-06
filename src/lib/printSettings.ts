export type PrintSettings = {
  topMm: number;       // extra top offset where content starts
  pageMarginMm: number; // @page margin
  fontSizePx: number;
  lineHeight: number;
  headerSpaceMm: number; // spacing between top and content
};

const KEY = "print.settings.v1";

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  topMm: 0,
  pageMarginMm: 10,
  fontSizePx: 13,
  lineHeight: 1.5,
  headerSpaceMm: 0,
};

export function loadPrintSettings(): PrintSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PRINT_SETTINGS };
    return { ...DEFAULT_PRINT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PRINT_SETTINGS };
  }
}

export function savePrintSettings(s: PrintSettings) {
  localStorage.setItem(KEY, JSON.stringify(s));
  applyPrintSettings(s);
}

export function applyPrintSettings(s: PrintSettings = loadPrintSettings()) {
  const r = document.documentElement.style;
  r.setProperty("--print-top-mm", `${s.topMm}mm`);
  r.setProperty("--print-page-margin-mm", `${s.pageMarginMm}mm`);
  r.setProperty("--print-font-size-px", `${s.fontSizePx}px`);
  r.setProperty("--print-line-height", `${s.lineHeight}`);
  r.setProperty("--print-header-space-mm", `${s.headerSpaceMm}mm`);
}
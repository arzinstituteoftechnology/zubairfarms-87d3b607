import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type ActivityLogRow = {
  id: string;
  created_at: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  tenant_id: string | null;
  actor_user_id: string | null;
  actor_name?: string | null;
  metadata: any;
};

export type ParsedUserAgent = {
  browser: string;
  os: string;
  device: string;
};

// Minimal UA parser — deterministic, dependency-free, testable.
export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  const s = (ua ?? "").toString();
  if (!s) return { browser: "", os: "", device: "" };
  let browser = "Other";
  if (/Edg\//i.test(s)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(s)) browser = "Opera";
  else if (/Chrome\//i.test(s) && !/Chromium/i.test(s)) browser = "Chrome";
  else if (/Safari\//i.test(s) && !/Chrome/i.test(s)) browser = "Safari";
  else if (/Firefox\//i.test(s)) browser = "Firefox";

  let os = "Other";
  if (/Windows NT/i.test(s)) os = "Windows";
  else if (/Mac OS X/i.test(s) && !/Mobile/i.test(s)) os = "macOS";
  else if (/Android/i.test(s)) os = "Android";
  else if (/(iPhone|iPad|iOS)/i.test(s)) os = "iOS";
  else if (/Linux/i.test(s)) os = "Linux";

  let device = "Desktop";
  if (/iPad|Tablet/i.test(s)) device = "Tablet";
  else if (/Mobi|Android|iPhone/i.test(s)) device = "Mobile";
  return { browser, os, device };
}

export function summarizeAction(action: string): { module: string; verb: string } {
  // Conventions used by triggers: <table>_<op>, auth_<event>, unauthorized_action_attempt, etc.
  const raw = action ?? "";
  const authMatch = raw.match(/^auth_(.+)$/);
  if (authMatch) return { module: "authentication", verb: authMatch[1] };
  const opMatch = raw.match(/^(.*)_(insert|update|delete)$/i);
  if (opMatch) {
    const verb = opMatch[2].toLowerCase() === "insert" ? "create" : opMatch[2].toLowerCase();
    return { module: opMatch[1], verb };
  }
  return { module: raw.split("_")[0] ?? raw, verb: raw };
}

const HEADERS = [
  "Time","Actor","User ID","Module","Action","Entity","Record ID",
  "Success","IP","Browser","OS","Device","Metadata",
];

function toRow(r: ActivityLogRow): (string | number)[] {
  const meta = r.metadata ?? {};
  const { module, verb } = summarizeAction(r.action);
  const ua = parseUserAgent(meta.user_agent);
  const success = meta.success === false ? "failure" : "success";
  return [
    new Date(r.created_at).toISOString(),
    r.actor_name ?? "",
    r.actor_user_id ?? "",
    module,
    verb,
    r.entity ?? "",
    r.entity_id ?? "",
    success,
    meta.ip ?? "",
    ua.browser,
    ua.os,
    ua.device,
    JSON.stringify(meta),
  ];
}

export function activityToCSV(rows: ActivityLogRow[]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [HEADERS.map(esc).join(",")];
  rows.forEach((r) => lines.push(toRow(r).map(esc).join(",")));
  return lines.join("\n");
}

export function downloadActivityCSV(rows: ActivityLogRow[], filename = "activity_log.csv") {
  const blob = new Blob([activityToCSV(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function downloadActivityXLSX(rows: ActivityLogRow[], filename = "activity_log.xlsx") {
  const aoa = [HEADERS, ...rows.map(toRow)];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Activity Log");
  XLSX.writeFile(wb, filename);
}

export function downloadActivityPDF(rows: ActivityLogRow[], filename = "activity_log.pdf") {
  const pdf = new jsPDF({ orientation: "landscape" });
  pdf.setFontSize(14);
  pdf.text("Activity Log", 14, 14);
  pdf.setFontSize(9);
  pdf.text(`Generated ${new Date().toLocaleString()} — ${rows.length} entries`, 14, 20);
  autoTable(pdf, {
    startY: 24,
    head: [["Time","Actor","Module","Action","Entity","IP","Browser","Result"]],
    body: rows.map((r) => {
      const { module, verb } = summarizeAction(r.action);
      const ua = parseUserAgent(r.metadata?.user_agent);
      return [
        new Date(r.created_at).toLocaleString(),
        r.actor_name ?? r.actor_user_id?.slice(0,8) ?? "system",
        module,
        verb,
        [r.entity, r.entity_id].filter(Boolean).join(" · "),
        r.metadata?.ip ?? "",
        ua.browser,
        r.metadata?.success === false ? "failure" : "success",
      ];
    }),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 30, 30] },
  });
  pdf.save(filename);
}
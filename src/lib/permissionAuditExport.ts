import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type AuditRow = {
  id: string; created_at: string; actor_email: string | null; target_email: string | null;
  action: string; module: string | null; permission_action: string | null;
  previous_value: any; new_value: any; reason: string | null;
  actor_ip: string | null; actor_user_agent: string | null;
};

const HEADERS = [
  "Time", "Actor", "Target", "Action", "Module", "Perm Action",
  "Previous", "New", "Reason", "IP", "Device",
];

const toRow = (r: AuditRow) => [
  new Date(r.created_at).toISOString(),
  r.actor_email ?? "",
  r.target_email ?? "",
  r.action,
  r.module ?? "",
  r.permission_action ?? "",
  r.previous_value ? JSON.stringify(r.previous_value) : "",
  r.new_value ? JSON.stringify(r.new_value) : "",
  r.reason ?? "",
  r.actor_ip ?? "",
  r.actor_user_agent ?? "",
];

export function auditToCSV(rows: AuditRow[]): string {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [HEADERS.map(esc).join(",")];
  rows.forEach((r) => lines.push(toRow(r).map((v) => esc(String(v))).join(",")));
  return lines.join("\n");
}

export function downloadAuditCSV(rows: AuditRow[], filename = "permission_audit.csv") {
  const blob = new Blob([auditToCSV(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function downloadAuditXLSX(rows: AuditRow[], filename = "permission_audit.xlsx") {
  const aoa = [HEADERS, ...rows.map(toRow)];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Permission Audit");
  XLSX.writeFile(wb, filename);
}

export function downloadAuditPDF(rows: AuditRow[], filename = "permission_audit.pdf") {
  const pdf = new jsPDF({ orientation: "landscape" });
  pdf.setFontSize(14);
  pdf.text("Permission Audit Log", 14, 14);
  pdf.setFontSize(9);
  pdf.text(`Generated ${new Date().toLocaleString()} — ${rows.length} entries`, 14, 20);
  autoTable(pdf, {
    startY: 24,
    head: [["Time", "Actor", "Target", "Action", "Module", "Reason"]],
    body: rows.map((r) => [
      new Date(r.created_at).toLocaleString(),
      r.actor_email ?? "",
      r.target_email ?? "",
      r.action.replace(/_/g, " "),
      [r.module, r.permission_action].filter(Boolean).join(" · "),
      r.reason ?? "",
    ]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 30, 30] },
  });
  pdf.save(filename);
}
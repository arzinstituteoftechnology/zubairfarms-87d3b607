// Generic A4-friendly print report utility.
// Opens a new window with a clean, professional HTML document, then triggers the
// browser print dialog. The original app and its CSS are not affected.

export type PrintColumn<T> = {
  label: string;
  /** Cell value. Strings render as-is; numbers are right-aligned automatically unless `align` is set. */
  value: (row: T) => string | number | null | undefined;
  align?: "left" | "right" | "center";
  /** Optional CSS width, e.g. "80px" or "12%". */
  width?: string;
};

export type PrintTotal = {
  label: string;
  value: string;
};

export type PrintReportOptions<T> = {
  /** Business / company name shown at the top. */
  businessName?: string;
  /** Report title, e.g. "Supplies Report". */
  title: string;
  /** Optional subtitle line under the title. */
  subtitle?: string;
  /** Selected date (or range) shown in the header. */
  dateLabel?: string;
  columns: PrintColumn<T>[];
  rows: T[];
  /** Totals block rendered at the bottom of the table. */
  totals?: PrintTotal[];
  /** Footer note, e.g. printed at + user. */
  footer?: string;
  /** Page orientation. Default: portrait. */
  orientation?: "portrait" | "landscape";
};

const escapeHtml = (raw: unknown): string => {
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

export function printReport<T>(opts: PrintReportOptions<T>) {
  const {
    businessName = "",
    title,
    subtitle = "",
    dateLabel = "",
    columns,
    rows,
    totals = [],
    footer = "",
    orientation = "portrait",
  } = opts;

  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) {
    alert("Please allow pop-ups to print the report.");
    return;
  }

  const head = `
    <tr>
      ${columns
        .map((c) => {
          const align = c.align ?? (c.label.toLowerCase().includes("amount") || c.label.toLowerCase().includes("total") || c.label.toLowerCase().includes("weight") || c.label.toLowerCase().includes("rate") || c.label.toLowerCase().includes("balance") || c.label.toLowerCase().includes("debit") || c.label.toLowerCase().includes("credit") ? "right" : "left");
          const w = c.width ? ` style="width:${c.width}"` : "";
          return `<th class="align-${align}"${w}>${escapeHtml(c.label)}</th>`;
        })
        .join("")}
    </tr>`;

  const body = rows
    .map(
      (row) =>
        `<tr>${columns
          .map((c) => {
            const v = c.value(row);
            const isNum = typeof v === "number";
            const align = c.align ?? (isNum ? "right" : "left");
            return `<td class="align-${align}">${escapeHtml(v)}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");

  const totalsHtml = totals.length
    ? `<div class="totals">
        ${totals
          .map(
            (t) =>
              `<div class="total-row"><span class="total-label">${escapeHtml(
                t.label,
              )}</span><span class="total-value">${escapeHtml(t.value)}</span></div>`,
          )
          .join("")}
       </div>`
    : "";

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 ${orientation}; margin: 14mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #111;
      font-size: 12px;
      line-height: 1.45;
      padding: 18px 22px;
    }
    .header { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
    .business { font-size: 18px; font-weight: 700; letter-spacing: 0.2px; }
    .title { font-size: 14px; font-weight: 600; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    .subtitle { font-size: 11px; color: #555; margin-top: 2px; }
    .meta { display: flex; justify-content: space-between; align-items: flex-end; font-size: 11px; color: #333; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
    thead th { background: #f3f4f6; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; border-bottom: 1.5px solid #888; }
    tbody tr:nth-child(even) td { background: #fafafa; }
    .align-right { text-align: right; }
    .align-center { text-align: center; }
    .align-left { text-align: left; }
    .totals { margin-top: 14px; border-top: 2px solid #111; padding-top: 8px; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .total-row { display: flex; gap: 24px; min-width: 280px; justify-content: space-between; font-size: 12px; }
    .total-row:last-child { font-weight: 700; font-size: 13px; }
    .total-label { color: #444; }
    .total-value { font-variant-numeric: tabular-nums; }
    .footer { margin-top: 22px; font-size: 10px; color: #666; text-align: center; border-top: 1px dashed #ccc; padding-top: 8px; }
    .empty { text-align: center; color: #888; padding: 24px; font-style: italic; }
    @media print {
      .no-print { display: none !important; }
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    ${businessName ? `<div class="business">${escapeHtml(businessName)}</div>` : ""}
    <div class="title">${escapeHtml(title)}</div>
    ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ""}
    <div class="meta">
      <div>${dateLabel ? `<b>Date:</b> ${escapeHtml(dateLabel)}` : ""}</div>
      <div>${escapeHtml(new Date().toLocaleString())}</div>
    </div>
  </div>
  ${rows.length === 0
    ? `<div class="empty">No records to display.</div>`
    : `<table><thead>${head}</thead><tbody>${body}</tbody></table>`}
  ${totalsHtml}
  ${footer ? `<div class="footer">${escapeHtml(footer)}</div>` : ""}
  <script>
    window.addEventListener("load", function () {
      setTimeout(function () { window.focus(); window.print(); }, 150);
    });
  </script>
</body>
</html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
}
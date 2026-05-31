import { useState, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search } from "lucide-react";

interface Props<T> {
  title: string;
  subtitle?: string;
  rows: T[];
  columns: { key: string; label: string; render: (row: T) => ReactNode; className?: string }[];
  onAdd?: () => void;
  addLabel?: string;
  searchKeys: (keyof T)[];
  loading?: boolean;
  pageSize?: number;
  emptyHint?: string;
}

export function CrudPage<T extends Record<string, any>>({
  title, subtitle, rows, columns, onAdd, addLabel = "Add new", searchKeys, loading, pageSize = 10, emptyHint,
}: Props<T>) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const filtered = rows.filter((r) => {
    if (!q) return true;
    const needle = q.toLowerCase();
    return searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(needle));
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {onAdd && (
          <Button onClick={onAdd}><Plus className="h-4 w-4" /> {addLabel}</Button>
        )}
      </div>
      <Card className="p-4">
        <div className="relative mb-3 max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => <TableHead key={c.key} className={c.className}>{c.label}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={columns.length} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : pageRows.length === 0 ? (
                <TableRow><TableCell colSpan={columns.length} className="text-center py-10 text-muted-foreground">{emptyHint ?? "No records yet."}</TableCell></TableRow>
              ) : pageRows.map((r, i) => (
                <TableRow key={(r as any).id ?? i}>
                  {columns.map((c) => <TableCell key={c.key} className={c.className}>{c.render(r)}</TableCell>)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {filtered.length > pageSize && (
          <div className="flex items-center justify-between mt-3 text-sm">
            <div className="text-muted-foreground">Page {page} of {totalPages} · {filtered.length} records</div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
              <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
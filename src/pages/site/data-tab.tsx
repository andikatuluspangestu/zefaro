import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { IconAlert } from "@/components/icon-alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { defineMessages, useT } from "@/i18n";
import { common } from "@/i18n/common";
import { Masked, copyText, isSecretKey } from "./shared";
import type { Cell, Overview, RowFilter, RowsRequest, RowsResponse, TableInfo } from "./types";

const messages = defineMessages({
  en: {
    tables: "Tables",
    searchTables: "Find a table",
    noTables: "This database has no tables.",
    search: "Search this table",
    rows: (n: number) => `${n.toLocaleString("en-GB")} ${n === 1 ? "row" : "rows"}`,
    page: (p: number, n: number) => `Page ${p} of ${n}`,
    perPage: "Rows per page",
    previous: "Previous page",
    next: "Next page",
    filter: "Filter",
    addFilter: "Add filter",
    removeFilter: "Remove filter",
    ops: { "=": "equals", "!=": "is not", "<": "<", "<=": "<=", ">": ">", ">=": ">=", like: "contains", "not like": "doesn't contain", null: "is empty", "not null": "is not empty" },
    value: "Value",
    empty: "No rows match.",
    allowEdit: "Allow changes",
    allowEditHint: "Off by default so a slip can't change real data.",
    editTitle: "Changes write to this database",
    editWarnProd: "This app runs in production. Edits change real data.",
    editWarnRemote: (host: string) => `This app's database is on ${host}, not on this machine. Edits change that server.`,
    editHint: "Double-click a cell to edit it. Enter saves, Escape cancels.",
    noKey: "This table has no primary key, so its rows can't be changed.",
    saved: "Saved",
    setNull: "Set to NULL",
    deleteRow: "Delete row",
    deleteTitle: (table: string) => `Delete this row from ${table}?`,
    deleteBody: "The row is removed from the database. This can't be undone.",
    deleted: "Row deleted",
    secret: "Hidden by the model",
    model: "Model",
    code: "Same in code",
    codeCopied: "Code copied",
    openInTinker: "Open in Tinker",
    reload: "Reload",
    needsDb: "The database isn't reachable, so there is nothing to show yet.",
    hiddenColumn: "Hidden by the model",
    binary: (n: number) => `binary, ${n} bytes`,
    chars: (n: number) => `${n.toLocaleString("en-GB")} characters`,
  },
  id: {
    tables: "Tabel",
    searchTables: "Cari tabel",
    noTables: "Database ini belum punya tabel.",
    search: "Cari di tabel ini",
    rows: (n: number) => `${n.toLocaleString("id-ID")} baris`,
    page: (p: number, n: number) => `Halaman ${p} dari ${n}`,
    perPage: "Baris per halaman",
    previous: "Halaman sebelumnya",
    next: "Halaman berikutnya",
    filter: "Filter",
    addFilter: "Tambah filter",
    removeFilter: "Hapus filter",
    ops: { "=": "sama dengan", "!=": "bukan", "<": "<", "<=": "<=", ">": ">", ">=": ">=", like: "mengandung", "not like": "tidak mengandung", null: "kosong", "not null": "tidak kosong" },
    value: "Nilai",
    empty: "Tidak ada baris yang cocok.",
    allowEdit: "Izinkan mengubah data",
    allowEditHint: "Mati secara bawaan agar salah klik tidak mengubah data sungguhan.",
    editTitle: "Perubahan ditulis ke database ini",
    editWarnProd: "Aplikasi ini berjalan di production. Perubahan mengubah data sungguhan.",
    editWarnRemote: (host: string) => `Database aplikasi ini ada di ${host}, bukan di komputer ini. Perubahan mengubah server itu.`,
    editHint: "Klik dua kali sel untuk mengubahnya. Enter menyimpan, Escape membatalkan.",
    noKey: "Tabel ini tidak punya primary key, jadi barisnya tidak bisa diubah.",
    saved: "Tersimpan",
    setNull: "Isi NULL",
    deleteRow: "Hapus baris",
    deleteTitle: (table: string) => `Hapus baris ini dari ${table}?`,
    deleteBody: "Baris dihapus dari database. Ini tidak bisa dibatalkan.",
    deleted: "Baris dihapus",
    secret: "Disembunyikan model",
    model: "Model",
    code: "Setara dengan kode",
    codeCopied: "Kode disalin",
    openInTinker: "Buka di Tinker",
    reload: "Muat ulang",
    needsDb: "Database tidak terjangkau, jadi belum ada yang bisa ditampilkan.",
    hiddenColumn: "Disembunyikan model",
    binary: (n: number) => `biner, ${n} byte`,
    chars: (n: number) => `${n.toLocaleString("id-ID")} karakter`,
  },
});

const PAGE_SIZES = [25, 50, 100, 200];
const OPS = ["=", "!=", "<", "<=", ">", ">=", "like", "not like", "null", "not null"] as const;
const LOCAL_HOSTS = ["127.0.0.1", "localhost", "::1", null, ""];

const phpString = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** The query on screen as Eloquent or query-builder code, ready for Tinker. */
function codeFor(table: string, model: string | null, req: RowsRequest): string {
  const lines = [model ? `\\${model}::query()` : `\\Illuminate\\Support\\Facades\\DB::table(${phpString(table)})`];
  for (const f of req.filters) {
    if (f.op === "null") lines.push(`->whereNull(${phpString(f.column)})`);
    else if (f.op === "not null") lines.push(`->whereNotNull(${phpString(f.column)})`);
    else {
      const like = f.op === "like" || f.op === "not like";
      const value = like && !/[%_]/.test(f.value) ? `%${f.value}%` : f.value;
      lines.push(`->where(${phpString(f.column)}, ${phpString(f.op)}, ${phpString(value)})`);
    }
  }
  if (req.sort) lines.push(`->orderBy(${phpString(req.sort)}${req.direction === "desc" ? ", 'desc'" : ""})`);
  if (req.page > 1) lines.push(`->offset(${(req.page - 1) * req.perPage})`);
  lines.push(`->limit(${req.perPage})`, "->get()");
  return lines.join("\n    ");
}

export function DataTab({
  site,
  overview,
  onOpenInTinker,
}: {
  site: string;
  overview: Overview | null;
  onOpenInTinker: (code: string) => void;
}) {
  const t = useT(messages);
  const c = useT(common);
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState("");
  const [table, setTable] = useState<string | null>(null);
  const [req, setReq] = useState<Omit<RowsRequest, "table">>({ page: 1, perPage: 50, search: "", sort: null, direction: "asc", filters: [] });
  const [searchText, setSearchText] = useState("");
  const [data, setData] = useState<RowsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [cell, setCell] = useState<{ row: number; col: number; text: string } | null>(null);
  const [toDelete, setToDelete] = useState<number | null>(null);
  const requestId = useRef(0);

  const loadTables = useCallback(() => {
    setError(null);
    api
      .siteTables(site)
      .then((r) => {
        setTables(r.tables);
        setTable((cur) => cur ?? r.tables.find((x) => x.model)?.name ?? r.tables[0]?.name ?? null);
      })
      .catch((e) => {
        setTables([]);
        setError(String(e));
      });
  }, [site]);

  useEffect(loadTables, [loadTables]);

  const load = useCallback(() => {
    if (!table) return;
    const id = ++requestId.current;
    setLoading(true);
    api
      .siteRows(site, { table, ...req })
      .then((r) => {
        if (id !== requestId.current) return;
        setData(r);
        setRowsError(null);
      })
      .catch((e) => {
        if (id !== requestId.current) return;
        setData(null);
        setRowsError(String(e));
      })
      .finally(() => id === requestId.current && setLoading(false));
  }, [site, table, req]);

  useEffect(load, [load]);

  // Search as the user pauses typing.
  useEffect(() => {
    const timer = window.setTimeout(() => setReq((r) => (r.search === searchText ? r : { ...r, search: searchText, page: 1 })), 350);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const choose = (name: string) => {
    setTable(name);
    setData(null);
    setCell(null);
    setSearchText("");
    setReq((r) => ({ ...r, page: 1, search: "", sort: null, direction: "asc", filters: [] }));
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;
  const canEdit = !!data && data.primaryKey.length > 0;
  const keyOf = (row: Cell[]) => Object.fromEntries(data!.primaryKey.map((k) => [k, row[data!.columns.findIndex((col) => col.name === k)]]));

  const production = overview?.environment === "production";
  const remoteHost = overview && !LOCAL_HOSTS.includes(overview.drivers.databaseHost) ? overview.drivers.databaseHost : null;

  const sortBy = (name: string) =>
    setReq((r) => ({ ...r, page: 1, sort: name, direction: r.sort === name && r.direction === "asc" ? "desc" : "asc" }));

  const setFilter = (i: number, patch: Partial<RowFilter>) =>
    setReq((r) => ({ ...r, page: 1, filters: r.filters.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));

  const saveCell = async (value: string | null) => {
    if (!cell || !data) return;
    const row = data.rows[cell.row];
    const column = data.columns[cell.col];
    setCell(null);
    try {
      await api.siteUpdateCell(site, data.table, keyOf(row), column.name, value);
      toast.success(t.saved);
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const deleteRow = async () => {
    if (toDelete === null || !data) return;
    const row = data.rows[toDelete];
    setToDelete(null);
    try {
      await api.siteDeleteRow(site, data.table, keyOf(row));
      toast.success(t.deleted);
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const code = useMemo(() => (table && data ? codeFor(table, data.model, { table, ...req }) : ""), [table, data, req]);

  const shownTables = useMemo(
    () => (tables ?? []).filter((x) => x.name.toLowerCase().includes(tableFilter.trim().toLowerCase())),
    [tables, tableFilter],
  );

  if (tables === null) return <Skeleton className="h-72 w-full" />;
  if (error)
    return (
      <IconAlert
        icon="database"
        className="border-warning/40 text-warning *:data-[slot=alert-description]:text-muted-foreground"
        title={t.needsDb}
        action={
          <Button size="sm" variant="outline" onClick={loadTables}>
            {c.tryAgain}
          </Button>
        }
      >
        <span className="font-mono text-xs break-words whitespace-pre-wrap">{error}</span>
      </IconAlert>
    );
  if (tables.length === 0) return <p className="text-sm text-muted-foreground">{t.noTables}</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <Card className="h-fit gap-0 py-0">
        <div className="border-b p-2">
          <Input
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            placeholder={t.searchTables}
            aria-label={t.searchTables}
            className="h-8"
          />
        </div>
        <ul className="max-h-[28rem] overflow-y-auto p-1">
          {shownTables.map((x) => (
            <li key={x.name}>
              <button
                onClick={() => choose(x.name)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                  x.name === table && "bg-muted font-medium text-primary",
                )}
              >
                <Icon name={x.model ? "cube" : "table"} className="w-3.5 text-xs text-muted-foreground" />
                <span className="truncate">{x.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Icon name="magnifying-glass" className="pointer-events-none absolute top-1/2 left-2.5 w-3.5 -translate-y-1/2 text-xs text-muted-foreground" />
            <Input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder={t.search} aria-label={t.search} className="pl-8" />
          </div>
          <Button size="sm" variant="outline" onClick={() => setReq((r) => ({ ...r, page: 1, filters: [...r.filters, { column: data?.columns[0]?.name ?? "", op: "=", value: "" }] }))} disabled={!data}>
            <Icon name="filter" className="w-3" />
            {t.addFilter}
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={load} aria-label={t.reload} title={t.reload}>
            {loading ? <Spinner className="size-3.5" /> : <Icon name="rotate" className="w-3.5" />}
          </Button>
        </div>

        {req.filters.map((f, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Select value={f.column} onValueChange={(v) => setFilter(i, { column: v })}>
              <SelectTrigger className="w-44" aria-label={t.filter}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data?.columns.map((col) => (
                  <SelectItem key={col.name} value={col.name}>
                    {col.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={f.op} onValueChange={(v) => setFilter(i, { op: v as RowFilter["op"] })}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPS.map((op) => (
                  <SelectItem key={op} value={op}>
                    {t.ops[op]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {f.op !== "null" && f.op !== "not null" && (
              <Input value={f.value} onChange={(e) => setFilter(i, { value: e.target.value })} placeholder={t.value} aria-label={t.value} className="w-48" />
            )}
            <Button size="icon-sm" variant="ghost" aria-label={t.removeFilter} title={t.removeFilter} onClick={() => setReq((r) => ({ ...r, page: 1, filters: r.filters.filter((_, j) => j !== i) }))}>
              <Icon name="xmark" className="w-3" />
            </Button>
          </div>
        ))}

        {rowsError && (
          <IconAlert icon="circle-exclamation" className="border-destructive/40 text-destructive" title={rowsError} />
        )}

        {data && (
          <Card className="gap-0 overflow-hidden py-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {editing && canEdit && <TableHead className="w-8 pl-3" />}
                    {data.columns.map((col) => (
                      <TableHead key={col.name} className="whitespace-nowrap">
                        <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => sortBy(col.name)}>
                          {data.primaryKey.includes(col.name) && <Icon name="key" className="w-3 text-[10px] text-warning" />}
                          {col.name}
                          {req.sort === col.name && <Icon name={req.direction === "asc" ? "arrow-up" : "arrow-down"} className="w-3 text-[10px]" />}
                        </button>
                        {col.type && <span className="ml-1 font-mono text-[10px] font-normal normal-case text-muted-foreground/70">{col.type}</span>}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={data.columns.length + 1} className="py-8 text-center text-muted-foreground">
                        {t.empty}
                      </TableCell>
                    </TableRow>
                  )}
                  {data.rows.map((row, ri) => (
                    <TableRow key={ri}>
                      {editing && canEdit && (
                        <TableCell className="w-8 pl-3">
                          <Button size="icon-xs" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label={t.deleteRow} title={t.deleteRow} onClick={() => setToDelete(ri)}>
                            <Icon name="trash-can" className="w-3" />
                          </Button>
                        </TableCell>
                      )}
                      {row.map((value, ci) => {
                        const col = data.columns[ci];
                        const secret = data.hidden.includes(col.name) || isSecretKey(col.name);
                        const isEditing = cell?.row === ri && cell.col === ci;
                        return (
                          <TableCell
                            key={ci}
                            className={cn("max-w-64 font-mono text-xs", editing && canEdit && "cursor-text")}
                            onDoubleClick={() => {
                              if (editing && canEdit && !secret) setCell({ row: ri, col: ci, text: value === null ? "" : typeof value === "object" ? "text" in value ? value.text : "" : String(value) });
                            }}
                          >
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  autoFocus
                                  value={cell.text}
                                  onChange={(e) => setCell({ ...cell, text: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveCell(cell.text);
                                    if (e.key === "Escape") setCell(null);
                                  }}
                                  className="h-7 min-w-32 font-mono text-xs"
                                />
                                {col.nullable && (
                                  <Button size="xs" variant="ghost" onClick={() => saveCell(null)}>
                                    {t.setNull}
                                  </Button>
                                )}
                              </div>
                            ) : (
                              <CellView value={value} secret={secret} t={t} />
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
              <span>
                {t.rows(data.total)}
                {data.model && (
                  <>
                    {" · "}
                    <span title={t.model} className="font-mono">
                      {data.model}
                    </span>
                  </>
                )}
              </span>
              <div className="flex items-center gap-2">
                <Select value={String(req.perPage)} onValueChange={(v) => setReq((r) => ({ ...r, perPage: Number(v), page: 1 }))}>
                  <SelectTrigger className="h-7 w-20" aria-label={t.perPage}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="icon-xs" variant="ghost" aria-label={t.previous} disabled={req.page <= 1} onClick={() => setReq((r) => ({ ...r, page: r.page - 1 }))}>
                  <Icon name="chevron-left" className="w-3" />
                </Button>
                <span className="min-w-24 text-center">{t.page(req.page, pages)}</span>
                <Button size="icon-xs" variant="ghost" aria-label={t.next} disabled={req.page >= pages} onClick={() => setReq((r) => ({ ...r, page: r.page + 1 }))}>
                  <Icon name="chevron-right" className="w-3" />
                </Button>
              </div>
            </div>
          </Card>
        )}

        {data && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={editing} onCheckedChange={(on) => { setEditing(on); setCell(null); }} />
              <span>{t.allowEdit}</span>
              {!editing && <span className="text-xs text-muted-foreground">{t.allowEditHint}</span>}
            </label>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => copyText(code, t.codeCopied)}>
                <Icon name="code" className="w-3" />
                {t.code}
              </Button>
              <Button size="sm" variant="outline" onClick={() => onOpenInTinker(code)}>
                <Icon name="terminal" className="w-3" />
                {t.openInTinker}
              </Button>
            </div>
          </div>
        )}

        {editing && data && (
          <IconAlert
            icon={production || remoteHost ? "triangle-exclamation" : "pen"}
            className={cn(
              "*:data-[slot=alert-description]:text-muted-foreground",
              production || remoteHost ? "border-warning/40 text-warning" : "",
            )}
            title={production ? t.editWarnProd : remoteHost ? t.editWarnRemote(remoteHost) : t.editTitle}
          >
            {canEdit ? t.editHint : t.noKey}
          </IconAlert>
        )}
      </div>

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteTitle(table ?? "")}</AlertDialogTitle>
            <AlertDialogDescription>{t.deleteBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{c.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={deleteRow}>
              {t.deleteRow}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CellView({ value, secret, t }: { value: Cell; secret: boolean; t: { binary: (n: number) => string; chars: (n: number) => string; secret: string } }) {
  if (value === null) return <span className="text-muted-foreground/60 italic">NULL</span>;
  if (typeof value === "object") {
    if ("binary" in value) return <span className="text-muted-foreground">{t.binary(value.binary)}</span>;
    return (
      <span className="block truncate" title={`${t.chars(value.length)}\n\n${value.text}`}>
        {value.text}
        <span className="text-muted-foreground">… ({t.chars(value.length)})</span>
      </span>
    );
  }
  if (secret) return <Masked value={String(value)} />;
  if (typeof value === "boolean") return <span className={value ? "text-success" : "text-muted-foreground"}>{String(value)}</span>;
  if (typeof value === "number") return <span className="text-info">{value}</span>;
  return (
    <span className="block truncate" title={value}>
      {value}
    </span>
  );
}

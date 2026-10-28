import { useState } from "react";
import type { PhpExtension } from "@/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { defineMessages, useT } from "@/i18n";

const messages = defineMessages({
  en: {
    title: (v: string) => `Extensions for PHP ${v}`,
    hint: "Every extension this version ships. Zefaro writes your choices to its php.ini and checks that PHP can load each one.",
    count: (on: number, all: number) => `${on} of ${all} on`,
    search: "Find an extension",
    clear: "Clear search",
    none: (q: string) => `No extension matches ${q}.`,
    byDefault: "Default",
    zend: "Zend",
    inIni: "Loaded by your own lines in php.ini. Change it there.",
    failed: (why: string) => `PHP couldn't load it: ${why}`,
    changed: "Changes when you save",
    toggle: (name: string) => `Load ${name}`,
  },
  id: {
    title: (v: string) => `Ekstensi untuk PHP ${v}`,
    hint: "Semua ekstensi yang dibawa versi ini. Zefaro menulis pilihan Anda ke php.ini-nya dan memeriksa apakah PHP bisa memuat masing-masing.",
    count: (on: number, all: number) => `${on} dari ${all} aktif`,
    search: "Cari ekstensi",
    clear: "Hapus pencarian",
    none: (q: string) => `Tidak ada ekstensi yang cocok dengan ${q}.`,
    byDefault: "Bawaan",
    zend: "Zend",
    inIni: "Dimuat oleh baris Anda sendiri di php.ini. Ubah di sana.",
    failed: (why: string) => `PHP tidak bisa memuatnya: ${why}`,
    changed: "Berubah saat Anda menyimpan",
    toggle: (name: string) => `Muat ${name}`,
  },
});

/** Search appears once the list is long enough to need it. */
const SEARCH_FROM = 12;

/**
 * The extensions a PHP version ships, each with a switch. `draft` holds the
 * switches the user changed but hasn't saved (name → on).
 */
export function ExtensionsSection({
  version,
  extensions,
  draft,
  onToggle,
  disabled,
}: {
  version: string;
  extensions: PhpExtension[] | null;
  draft: Record<string, boolean>;
  onToggle: (name: string, on: boolean) => void;
  disabled: boolean;
}) {
  const t = useT(messages);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const isOn = (e: PhpExtension) => draft[e.name] ?? e.enabled;
  const shown = extensions?.filter((e) => !q || e.name.includes(q)) ?? [];

  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">{t.title(version)}</h3>
          <p className="text-xs text-muted-foreground">{t.hint}</p>
        </div>
        {extensions && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {t.count(extensions.filter(isOn).length, extensions.length)}
          </span>
        )}
      </div>

      {extensions && extensions.length >= SEARCH_FROM && (
        <InputGroup className="h-8">
          <InputGroupAddon>
            <Icon name="magnifying-glass" className="w-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.search}
            aria-label={t.search}
            spellCheck={false}
          />
          {query && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" onClick={() => setQuery("")} aria-label={t.clear}>
                <Icon name="xmark" className="w-3" />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
      )}

      <Card className="gap-0 overflow-hidden py-0">
        {!extensions ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">{t.none(query.trim())}</p>
        ) : (
          <ul className="grid gap-px bg-border sm:grid-cols-2">
            {shown.map((e) => {
              const on = isOn(e);
              const changed = e.name in draft;
              return (
                <li key={e.name} className="flex items-start gap-3 bg-card px-4 py-2.5">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-sm">{e.name}</span>
                      {e.defaultOn && (
                        <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-muted-foreground">
                          {t.byDefault}
                        </Badge>
                      )}
                      {e.zend && (
                        <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-muted-foreground">
                          {t.zend}
                        </Badge>
                      )}
                    </div>
                    {e.inIni && <p className="text-xs text-muted-foreground">{t.inIni}</p>}
                    {e.error && !changed && <p className="text-xs text-destructive">{t.failed(e.error)}</p>}
                    {changed && <p className="text-xs text-warning">{t.changed}</p>}
                  </div>
                  <Switch
                    checked={on}
                    onCheckedChange={(v) => onToggle(e.name, v)}
                    disabled={disabled || e.inIni}
                    aria-label={t.toggle(e.name)}
                    className={cn("mt-0.5", e.error && on && !changed && "data-[state=checked]:bg-destructive")}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}

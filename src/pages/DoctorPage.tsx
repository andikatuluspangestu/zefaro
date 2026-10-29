import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api } from "@/api";
import type { Intent, PageId } from "@/App";
import type { DoctorCheck } from "@/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { defineMessages, useT } from "@/i18n";

const messages = defineMessages({
  en: {
    title: "Diagnostics",
    description: "Zefaro checks what most often stops a local PHP setup on Windows, and says what to do about each.",
    again: "Check again",
    allGood: "Everything Zefaro checks looks right.",
    problems: (n: number) => `${n} ${n === 1 ? "thing needs" : "things need"} attention`,
    actions: {
      services: "Open Services",
      nginx: "Open Services",
      php: "Open Services",
      sites: "Open Sites",
      import: "Import projects",
      url: "Open download page",
    },
  },
  id: {
    title: "Pemeriksa",
    description: "Zefaro memeriksa hal yang paling sering membuat PHP lokal di Windows tidak jalan, dan memberi tahu cara mengatasinya.",
    again: "Periksa lagi",
    allGood: "Semua yang diperiksa Zefaro tampak beres.",
    problems: (n: number) => `${n} hal perlu ditangani`,
    actions: {
      services: "Buka Layanan",
      nginx: "Buka Layanan",
      php: "Buka Layanan",
      sites: "Buka Situs",
      import: "Impor proyek",
      url: "Buka halaman unduhan",
    },
  },
});

const LEVEL: Record<DoctorCheck["level"], { icon: string; className: string }> = {
  ok: { icon: "circle-check", className: "bg-success/10 text-success" },
  info: { icon: "circle-info", className: "bg-info/10 text-info" },
  warn: { icon: "triangle-exclamation", className: "bg-warning/10 text-warning" },
  error: { icon: "circle-xmark", className: "bg-destructive/10 text-destructive" },
};
const ORDER: DoctorCheck["level"][] = ["error", "warn", "info", "ok"];

export function DoctorPage({ onNavigate }: { onNavigate: (page: PageId, intent?: Intent) => void }) {
  const t = useT(messages);
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      setChecks(await api.doctorRun());
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  const act = (action: string) => {
    if (action.startsWith("url:")) openUrl(action.slice(4)).catch((e) => toast.error(String(e)));
    else if (action === "import") onNavigate("sites", { type: "import" });
    else if (action === "sites") onNavigate("sites");
    else onNavigate("services");
  };
  const label = (action: string) => (action.startsWith("url:") ? t.actions.url : (t.actions[action as keyof typeof t.actions] ?? t.actions.services));

  const sorted = checks ? [...checks].sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level)) : null;
  const problems = checks?.filter((c) => c.level === "error" || c.level === "warn").length ?? 0;

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          <Button variant="outline" onClick={run} disabled={running}>
            {running ? <Spinner className="size-3" /> : <Icon name="rotate" />}
            {t.again}
          </Button>
        }
      />
      {sorted === null ? (
        <Card className="gap-3 p-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </Card>
      ) : (
        <>
          <p className={cn("mb-3 flex items-center gap-2 text-sm font-medium", problems ? "text-warning" : "text-success")}>
            <Icon name={problems ? "triangle-exclamation" : "circle-check"} />
            {problems ? t.problems(problems) : t.allGood}
          </p>
          <Card className="gap-0 divide-y py-0">
            {sorted.map((c) => (
              <div key={c.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", LEVEL[c.level].className)}>
                  <Icon name={LEVEL[c.level].icon} />
                </span>
                <div className="min-w-0 flex-1 basis-60">
                  <div className="text-sm font-medium">{c.title}</div>
                  <p className="text-xs break-words text-muted-foreground">{c.detail}</p>
                </div>
                {c.action && (
                  <Button size="sm" variant={c.level === "error" ? "default" : "outline"} onClick={() => act(c.action!)}>
                    {label(c.action)}
                    <Icon name={c.action.startsWith("url:") ? "arrow-up-right-from-square" : "arrow-right"} className="w-3" />
                  </Button>
                )}
              </div>
            ))}
          </Card>
        </>
      )}
    </>
  );
}

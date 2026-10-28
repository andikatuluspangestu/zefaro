import type { ServiceStatus } from "@/types";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { common } from "@/i18n/common";

const COLOR: Record<ServiceStatus, string> = {
  running: "bg-success",
  starting: "bg-warning",
  error: "bg-destructive",
  stopped: "bg-muted-foreground/40",
};

const LABEL: Record<ServiceStatus, "running" | "starting" | "failed" | "stopped"> = {
  running: "running",
  starting: "starting",
  error: "failed",
  stopped: "stopped",
};

/** Service status indicator; pings while running or starting. */
export function StatusDot({ status }: { status: ServiceStatus }) {
  const c = useT(common);
  const live = status === "running" || status === "starting";
  return (
    <span className="relative inline-flex size-2" title={c[LABEL[status]]}>
      {live && (
        <span
          className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", COLOR[status])}
        />
      )}
      <span className={cn("relative inline-flex size-2 rounded-full", COLOR[status])} />
    </span>
  );
}

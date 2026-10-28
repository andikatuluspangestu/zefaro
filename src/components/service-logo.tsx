import type { ServiceStatus } from "@/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
// Logos from Dashboard Icons (github.com/homarr-labs/dashboard-icons, Apache-2.0),
// bundled so they show offline. The marks belong to their projects.
import dnsLogo from "@/assets/service-logos/dns.svg";
import mailpitLogo from "@/assets/service-logos/mailpit.svg";
import mariadbLogo from "@/assets/service-logos/mariadb.svg";
import nginxLogo from "@/assets/service-logos/nginx.svg";
import nodeLogo from "@/assets/service-logos/nodejs.svg";
import phpLogo from "@/assets/service-logos/php.svg";
import phpmyadminLogo from "@/assets/service-logos/phpmyadmin.svg";
import postgresqlLogo from "@/assets/service-logos/postgresql.svg";
import redisLogo from "@/assets/service-logos/redis.svg";

/**
 * `tile`: a light tile for logos drawn in dark colours (MariaDB's navy seal).
 * `wide`: landscape logos get less padding so they don't shrink to a sliver.
 */
const LOGOS: Record<string, { src: string; tile?: "light"; wide?: boolean }> = {
  nginx: { src: nginxLogo },
  php: { src: phpLogo, wide: true },
  node: { src: nodeLogo },
  dns: { src: dnsLogo },
  mariadb: { src: mariadbLogo, tile: "light" },
  postgresql: { src: postgresqlLogo },
  redis: { src: redisLogo },
  phpmyadmin: { src: phpmyadminLogo, wide: true },
  mailpit: { src: mailpitLogo },
};

/** php-8.3 → php */
const key = (id: string) => (id.startsWith("php-") ? "php" : id);

/** A service's logo on a tile; greyed while the service isn't running. */
export function ServiceLogo({ id, status, className }: { id: string; status: ServiceStatus; className?: string }) {
  const logo = LOGOS[key(id)];
  const live = status === "running" || status === "starting";
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-lg ring-1 ring-inset transition-[filter,opacity]",
        logo?.wide ? "p-0.5" : "p-1.5",
        logo?.tile === "light" ? "bg-white ring-black/5" : "bg-muted/70 ring-foreground/5",
        !live && "opacity-55 grayscale",
        className
      )}
      aria-hidden="true"
    >
      {logo ? (
        <img src={logo.src} alt="" className="size-full object-contain" draggable={false} />
      ) : (
        <Icon name="server" className="w-auto text-muted-foreground" />
      )}
    </span>
  );
}

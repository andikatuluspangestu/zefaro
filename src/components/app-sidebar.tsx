import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import type { PageId } from "@/App";
import type { UpdateInfo } from "@/types";
import { useT } from "@/i18n";
import { common } from "@/i18n/common";
import { Icon } from "@/components/icon";
import { Logo } from "@/components/logo";
import { openUpdateDialog, updateMessages } from "@/components/update-check";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";

type NavItem = { id: PageId; icon: string; brand?: boolean };
type Nav = (typeof common)["en"]["nav"];

/** The pages you work in, at the top. */
const GROUPS: { label: keyof Nav; items: NavItem[] }[] = [
  {
    label: "develop",
    items: [
      { id: "home", icon: "house" },
      { id: "sites", icon: "globe" },
    ],
  },
  {
    label: "tools",
    items: [
      { id: "services", icon: "server" },
      { id: "databases", icon: "database" },
      { id: "terminal", icon: "terminal" },
      { id: "mail", icon: "envelope" },
      { id: "logs", icon: "file-lines" },
      { id: "dumps", icon: "bug" },
    ],
  },
];

/** Help and settings, kept at the bottom out of the way of daily work. */
const FOOTER: NavItem[] = [
  { id: "doctor", icon: "stethoscope" },
  { id: "docs", icon: "book" },
  { id: "about", icon: "circle-info" },
  { id: "settings", icon: "gear" },
];

// Inactive items are muted and come forward on hover. The open page gets a light
// indigo fill and an indigo icon; its text stays the foreground colour, because
// indigo text on that fill is 4.4:1, under AA.
const ITEM =
  "h-9 gap-2.5 rounded-lg px-2.5 text-muted-foreground hover:text-sidebar-foreground [&>i]:text-muted-foreground hover:[&>i]:text-sidebar-foreground " +
  "data-active:bg-primary/10 data-active:text-sidebar-foreground data-active:hover:bg-primary/10 data-active:[&>i]:text-sidebar-primary " +
  "dark:data-active:bg-primary/20 dark:data-active:hover:bg-primary/20";

export function AppSidebar({
  active,
  onSelect,
  version,
  update,
  badges = {},
}: {
  active: PageId;
  onSelect: (id: PageId) => void;
  version?: string;
  /** A newer version on GitHub: a card at the bottom offers it. */
  update?: UpdateInfo;
  /** Counts shown beside items, e.g. unread mail. */
  badges?: Partial<Record<PageId, number>>;
}) {
  const t = useT(common);
  const u = useT(updateMessages);
  const item = (n: NavItem) => (
    <SidebarMenuItem key={n.id}>
      <SidebarMenuButton isActive={active === n.id} tooltip={t.nav[n.id]} onClick={() => onSelect(n.id)} className={ITEM}>
        <Icon name={n.icon} variant={n.brand ? "brands" : "solid"} />
        <span>{t.nav[n.id]}</span>
      </SidebarMenuButton>
      {!!badges[n.id] && (
        <SidebarMenuBadge className="top-2 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground tabular-nums">
          {badges[n.id]! > 99 ? "99+" : badges[n.id]}
        </SidebarMenuBadge>
      )}
      {/* The badge is hidden when the sidebar shows icons only; a dot keeps the signal. */}
      {!!badges[n.id] && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1 right-1 hidden size-2 rounded-full bg-primary ring-2 ring-sidebar group-data-[collapsible=icon]:block"
        />
      )}
    </SidebarMenuItem>
  );

  const getUpdate = () =>
    update?.canInstall ? openUpdateDialog(update) : update && openUrl(update.url).catch((e) => toast.error(String(e)));

  return (
    <Sidebar collapsible="icon">
      {/* As tall as the page's top bar, so both borders run as one line. */}
      <SidebarHeader className="h-12 justify-center border-b border-sidebar-border px-2 py-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={t.nav.aboutZefaro}
              onClick={() => onSelect("about")}
              className="h-9 gap-2.5 px-1.5 hover:bg-transparent group-data-[collapsible=icon]:justify-center"
            >
              <span className="relative shrink-0">
                <Logo className="size-7 rounded-md" />
                {update && (
                  <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-sidebar" />
                )}
              </span>
              <span className="flex min-w-0 items-baseline gap-1.5 group-data-[collapsible=icon]:hidden">
                <span className="truncate text-[15px] font-semibold tracking-tight text-sidebar-foreground">Zefaro</span>
                <span className="text-xs text-muted-foreground tabular-nums">{version ? `v${version}` : t.nav.localPhp}</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-0 pt-2">
        {GROUPS.map((g, i) => (
          <SidebarGroup key={g.label} className="py-1 group-data-[collapsible=icon]:py-1">
            {i > 0 && <SidebarSeparator className="mb-1 hidden group-data-[collapsible=icon]:block" />}
            <SidebarGroupLabel className="h-7 px-2.5 text-xs font-medium text-muted-foreground">{t.nav[g.label]}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">{g.items.map(item)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="gap-2 border-t border-sidebar-border">
        {update && (
          <div className="rounded-lg border border-sidebar-border p-3 group-data-[collapsible=icon]:hidden">
            <p className="text-sm font-medium">{u.available(update.latest)}</p>
            <Button size="sm" className="mt-2 w-full" onClick={getUpdate}>
              <Icon name="download" />
              {update.canInstall ? u.updateNow : u.download}
            </Button>
          </div>
        )}
        <SidebarMenu className="gap-0.5">{FOOTER.map(item)}</SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

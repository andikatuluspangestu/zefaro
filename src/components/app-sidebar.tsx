import type { PageId } from "@/App";
import { useT } from "@/i18n";
import { common } from "@/i18n/common";
import { Icon } from "@/components/icon";
import { Logo } from "@/components/logo";
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
      { id: "mail", icon: "envelope" },
      { id: "logs", icon: "file-lines" },
    ],
  },
  {
    label: "help",
    items: [
      { id: "docs", icon: "book" },
      { id: "about", icon: "circle-info" },
    ],
  },
];

export function AppSidebar({
  active,
  onSelect,
  version,
  badges = {},
}: {
  active: PageId;
  onSelect: (id: PageId) => void;
  version?: string;
  /** Counts shown beside items, e.g. unread mail. */
  badges?: Partial<Record<PageId, number>>;
}) {
  const t = useT(common);
  const item = (n: NavItem) => (
    <SidebarMenuItem key={n.id}>
      <SidebarMenuButton
        isActive={active === n.id}
        tooltip={t.nav[n.id]}
        onClick={() => onSelect(n.id)}
        className="relative before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand-gradient before:opacity-0 before:transition-opacity data-active:before:opacity-100 group-data-[collapsible=icon]:before:hidden"
      >
        <Icon name={n.icon} variant={n.brand ? "brands" : "solid"} />
        <span>{t.nav[n.id]}</span>
      </SidebarMenuButton>
      {!!badges[n.id] && (
        <SidebarMenuBadge className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground tabular-nums">
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

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip={t.nav.aboutZefaro}
              onClick={() => onSelect("about")}
              className="group-data-[collapsible=icon]:justify-center"
            >
              <Logo className="size-8 rounded-lg" />
              <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-semibold tracking-tight text-brand-gradient">Zefaro</span>
                <span className="truncate text-xs text-muted-foreground">
                  {version ? `v${version}` : t.nav.localPhp}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {GROUPS.map((g, i) => (
          <SidebarGroup key={g.label} className="group-data-[collapsible=icon]:py-1">
            {i > 0 && <SidebarSeparator className="mb-1 hidden group-data-[collapsible=icon]:block" />}
            <SidebarGroupLabel>{t.nav[g.label]}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{g.items.map(item)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>{item({ id: "settings", icon: "gear" })}</SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

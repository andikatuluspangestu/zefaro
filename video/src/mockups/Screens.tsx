// Still screens of the app for the mockups, drawn with the video's copies of the app's parts.
// Every screen is the 1100 x 700 app window. Values are examples from a sample app called shop.

import type { CSSProperties, ReactNode } from "react";
import { AppWindow, PageTitle } from "../components/AppWindow";
import { Logo } from "../components/Logo";
import { Badge, Button, Card, Dot, Icon, Mono, ServiceLogo } from "../components/ui";
import { C, MONO } from "../theme";

const RUNNING: [number, number] = [8, 8];

/* ---------- Services ---------- */

const SERVICES = [
  { name: "nginx", logo: "nginx", addr: "127.0.0.1:80" },
  { name: "PHP 8.4", logo: "php", addr: "127.0.0.1:9084" },
  { name: "DNS", logo: "dns", addr: "*.test → 127.0.0.1" },
  { name: "MariaDB", logo: "mariadb", addr: "127.0.0.1:3306" },
  { name: "PostgreSQL", logo: "postgresql", addr: "127.0.0.1:5432" },
  { name: "Redis", logo: "redis", addr: "127.0.0.1:6379" },
  { name: "phpMyAdmin", logo: "phpmyadmin", addr: "phpmyadmin.test" },
  { name: "Mailpit", logo: "mailpit", addr: "127.0.0.1:1025" },
  { name: "Node.js", logo: "nodejs", addr: "v24 active", tool: true },
];

export function ServicesScreen() {
  return (
    <AppWindow page="services" title="Services" sites={4} running={RUNNING}>
      <PageTitle
        title="Services"
        description="Start and stop the background services your sites depend on."
        actions={
          <Button variant="primary">
            <Icon name="play" style={{ fontSize: 11 }} /> Start all
          </Button>
        }
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {SERVICES.map((s) => (
          <Card key={s.name} style={{ padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ServiceLogo name={s.logo} size={34} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
                  {s.name} <Dot color={C.emerald} size={7} />
                </div>
                <div style={{ fontSize: 12, color: C.mutedFg }}>{s.tool ? "Tool" : "Running"}</div>
              </div>
            </div>
            <div style={{ fontFamily: MONO, fontSize: 12, color: C.mutedFg, margin: "12px 0 10px" }}>{s.addr}</div>
            <Button style={{ width: "100%", justifyContent: "center", boxSizing: "border-box" }}>
              <Icon name={s.tool ? "layer-group" : "stop"} style={{ fontSize: 11 }} /> {s.tool ? "Manage versions" : "Stop"}
            </Button>
          </Card>
        ))}
      </div>
    </AppWindow>
  );
}

/* ---------- Sites ---------- */

const SITES = [
  { name: "shop", url: "https://shop.test", path: "C:\\Projects\\shop", php: "8.4", secure: true },
  { name: "blog", url: "http://blog.test", path: "C:\\Projects\\blog", php: "8.3", secure: false },
  { name: "api", url: "https://api.test", path: "C:\\Projects\\api", php: "8.4", secure: true },
  { name: "docs", url: "http://docs.test", path: "C:\\Projects\\docs", php: "8.2", secure: false },
];

export function SitesScreen() {
  return (
    <AppWindow page="sites" title="Sites" sites={4} running={RUNNING}>
      <PageTitle
        title="Sites"
        description="Zefaro serves each linked folder at its own name.test address."
        actions={
          <span style={{ display: "flex", gap: 8 }}>
            <Button>
              <Icon name="folder-plus" style={{ fontSize: 11 }} /> Link folder
            </Button>
            <Button variant="primary">
              <Icon name="plus" style={{ fontSize: 11 }} /> New site
            </Button>
          </span>
        }
      />
      <Card style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1.4fr 0.5fr 0.8fr 0.5fr", padding: "10px 16px", fontSize: 12, color: C.mutedFg, borderBottom: `1px solid ${C.border}` }}>
          <span>Site</span>
          <span>Path</span>
          <span>PHP</span>
          <span>HTTPS</span>
          <span style={{ textAlign: "right" }}>Actions</span>
        </div>
        {SITES.map((s) => (
          <div key={s.name} style={{ display: "grid", gridTemplateColumns: "1.3fr 1.4fr 0.5fr 0.8fr 0.5fr", alignItems: "center", padding: "13px 16px", borderBottom: `1px solid ${C.border}` }}>
            <span>
              <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
                {s.name} <Icon name="laravel" brands style={{ fontSize: 12, color: C.mutedFg }} />
              </span>
              <Mono style={{ fontSize: 12, color: s.secure ? C.emerald : C.mutedFg }}>{s.url}</Mono>
            </span>
            <Mono style={{ fontSize: 12, color: C.mutedFg }}>{s.path}</Mono>
            <span>
              <Badge>{s.php}</Badge>
            </span>
            <span>
              {s.secure ? (
                <Badge tone="emerald">
                  <Icon name="lock" style={{ fontSize: 10 }} /> Secured
                </Badge>
              ) : (
                <Button size="xs">
                  <Icon name="lock-open" style={{ fontSize: 10 }} /> Secure
                </Button>
              )}
            </span>
            <span style={{ display: "flex", gap: 12, justifyContent: "flex-end", color: C.mutedFg }}>
              <Icon name="up-right-from-square" style={{ fontSize: 13 }} />
              <Icon name="trash" style={{ fontSize: 13 }} />
            </span>
          </div>
        ))}
      </Card>
    </AppWindow>
  );
}

/* ---------- A browser showing a site ---------- */

export function Browser({ url = "https://shop.test", width = 760, style }: { url?: string; width?: number; style?: CSSProperties }) {
  const secure = url.startsWith("https");
  return (
    <div style={{ width, borderRadius: 14, overflow: "hidden", color: C.fg, background: C.card, border: `1px solid ${C.line}`, boxShadow: `0 50px 90px -40px ${C.shadow}`, ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: C.sidebar, borderBottom: `1px solid ${C.border}` }}>
        <span style={{ display: "flex", gap: 6, color: C.mutedFg, fontSize: 13 }}>
          <Icon name="arrow-left" /> <Icon name="arrow-right" /> <Icon name="rotate-right" />
        </span>
        <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", borderRadius: 999, background: C.card, border: `1px solid ${C.border}`, fontFamily: MONO, fontSize: 14 }}>
          <Icon name={secure ? "lock" : "lock-open"} style={{ fontSize: 12, color: secure ? C.emerald : C.mutedFg }} />
          <span style={{ color: C.mutedFg }}>{secure ? "https://" : "http://"}</span>
          {url.replace(/^https?:\/\//, "")}
        </span>
      </div>
      <div style={{ padding: "34px 34px 30px" }}>
        <div style={{ fontWeight: 700, fontSize: 30, letterSpacing: "-0.03em" }}>Welcome to shop</div>
        <div style={{ color: C.mutedFg, marginTop: 6 }}>This page is served by Zefaro, on PHP 8.4.</div>
        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ flex: 1, height: 96, borderRadius: 12, background: C.muted }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <Button variant="primary">Browse</Button>
          <Button>Sign in</Button>
        </div>
      </div>
    </div>
  );
}

export function ToastCard({ title, text, style }: { title: string; text?: string; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 18px", borderRadius: 14, color: C.fg, background: C.card, border: `1px solid ${C.border}`, boxShadow: `0 20px 40px -18px ${C.shadow}`, ...style }}>
      <Icon name="circle-check" style={{ color: C.emerald, fontSize: 18, marginTop: 1 }} />
      <div>
        <div style={{ fontWeight: 600 }}>{title}</div>
        {text && <div style={{ fontSize: 13, color: C.mutedFg, marginTop: 2 }}>{text}</div>}
      </div>
    </div>
  );
}

/* ---------- New site ---------- */

function Choice({ icon, brands, label, note, on }: { icon: string; brands?: boolean; label: string; note: string; on?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 12, borderRadius: 10, border: `1px solid ${on ? C.primary : C.border}`, background: on ? C.accentSoft : C.card }}>
      <Icon name={icon} brands={brands} style={{ color: on ? C.primary : C.mutedFg, marginTop: 2 }} />
      <div>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
        <div style={{ fontSize: 11.5, color: C.mutedFg }}>{note}</div>
      </div>
    </div>
  );
}

function Field({ label, value, mono, wide }: { label: string; value: ReactNode; mono?: boolean; wide?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 13 }}>
      <span style={{ width: 110, color: C.mutedFg }}>{label}</span>
      <span style={{ width: wide ? 360 : 220, padding: "7px 11px", borderRadius: 8, border: `1px solid ${C.input}`, background: C.card, fontFamily: mono ? MONO : undefined }}>{value}</span>
    </div>
  );
}

export function NewSiteScreen() {
  return (
    <AppWindow page="sites" title="Sites" sites={4} running={RUNNING}>
      <div style={{ fontSize: 13, color: C.mutedFg, marginBottom: 8 }}>
        <Icon name="arrow-left" style={{ fontSize: 11 }} /> Sites
      </div>
      <PageTitle title="New site" description="Zefaro makes a Laravel app with the Laravel installer, links it, and points its .env at Zefaro's services." />
      <Card style={{ padding: 16, display: "grid", gap: 10 }}>
        <Field label="Name" value="shop" mono />
        <Field label="Folder" value="C:\Projects\shop" mono wide />
        <Field label="PHP version" value="PHP 8.4" />
      </Card>
      <div style={{ fontWeight: 600, margin: "16px 0 8px" }}>Starter kit</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <Choice icon="laravel" brands label="Laravel" note="The plain framework" />
        <Choice icon="react" brands label="React" note="Inertia, React and TypeScript" on />
        <Choice icon="vuejs" brands label="Vue" note="Inertia, Vue and TypeScript" />
        <Choice icon="bolt" label="Livewire" note="Blade with Livewire and Flux" />
        <Choice icon="s" label="Svelte" note="Inertia, Svelte and TypeScript" />
        <Choice icon="users" label="Community" note="Any starter kit on Packagist" />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
        <span style={{ fontWeight: 600, marginRight: 8 }}>Database</span>
        <Badge tone="outline">SQLite</Badge>
        <Badge tone="primary">MariaDB</Badge>
        <Badge tone="outline">PostgreSQL</Badge>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Badge tone="emerald">
            <Icon name="check" style={{ fontSize: 9 }} /> Pest
          </Badge>
          <Badge tone="emerald">
            <Icon name="check" style={{ fontSize: 9 }} /> Git
          </Badge>
          <Badge tone="emerald">
            <Icon name="check" style={{ fontSize: 9 }} /> HTTPS
          </Badge>
          <Button variant="primary" style={{ marginLeft: 6 }}>
            Create site
          </Button>
        </span>
      </div>
    </AppWindow>
  );
}

/* ---------- A Laravel site's page ---------- */

const TABS = ["Overview", "Data", "Configuration", "Logs", "Tinker", "Artisan", "Workers"];

function SiteHeader({ tab }: { tab: string }) {
  return (
    <>
      <div style={{ fontSize: 13, color: C.mutedFg, marginBottom: 6 }}>
        <Icon name="arrow-left" style={{ fontSize: 11 }} /> Sites
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-0.02em" }}>shop</span>
        <Badge>PHP 8.4</Badge>
        <Badge>
          <Icon name="laravel" brands style={{ fontSize: 10 }} /> Laravel
        </Badge>
        <Badge tone="outline">local</Badge>
        <span style={{ marginLeft: "auto" }}>
          <Button>
            <Icon name="up-right-from-square" style={{ fontSize: 11 }} /> Open in browser
          </Button>
        </span>
      </div>
      <div>
        <Mono style={{ fontSize: 12, color: C.mutedFg }}>C:\Projects\shop</Mono>
      </div>
      <div style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 9, background: C.muted, margin: "14px 0 16px" }}>
        {TABS.map((t) => (
          <span key={t} style={{ padding: "5px 10px", borderRadius: 7, fontSize: 12.5, background: t === tab ? C.card : "transparent", fontWeight: t === tab ? 600 : 450, boxShadow: t === tab ? `0 1px 2px ${C.line}` : "none" }}>
            {t}
          </span>
        ))}
      </div>
    </>
  );
}

function Finding({ icon, title, text, action }: { icon: string; title: string; text: string; action: string }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 12, border: `1px solid oklch(0.52 0.12 65 / 40%)`, background: "oklch(0.52 0.12 65 / 6%)", marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.amber, fontWeight: 600 }}>
        <Icon name={icon} style={{ fontSize: 13 }} /> {title}
      </div>
      <div style={{ fontSize: 13, color: C.mutedFg, margin: "3px 0 9px 24px" }}>{text}</div>
      <span style={{ marginLeft: 24 }}>
        <Button size="xs">{action}</Button>
      </span>
    </div>
  );
}

export function OverviewScreen() {
  return (
    <AppWindow page="sites" title="Sites" sites={4} running={RUNNING}>
      <SiteHeader tab="Overview" />
      <div style={{ fontWeight: 600 }}>Worth a look</div>
      <Finding icon="link-slash" title="APP_URL doesn't match the site's address" text=".env says http://localhost:8000, but Zefaro serves the site at https://shop.test." action="Set APP_URL to https://shop.test" />
      <Finding icon="envelope" title="Mail doesn't go to Mailpit" text={'The app sends mail with "log", so Mailpit won\'t show it.'} action="Point to Mailpit" />
      <Finding icon="link" title="public/storage isn't linked" text="Files saved on the public disk won't load in the browser." action="Link storage" />
    </AppWindow>
  );
}

export function TinkerScreen() {
  const k = { color: C.mutedFg };
  return (
    <AppWindow page="sites" title="Sites" sites={4} running={RUNNING}>
      <SiteHeader tab="Tinker" />
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ fontFamily: MONO, fontSize: 14, padding: "14px 16px", lineHeight: 1.7, background: C.muted, borderBottom: `1px solid ${C.border}` }}>
          <div>
            <span style={k}>1</span>&nbsp;&nbsp;$user = User::first();
          </div>
          <div>
            <span style={k}>2</span>&nbsp;&nbsp;$user-&gt;orders()-&gt;count();
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
          <Button variant="primary" size="xs">
            <Icon name="play" style={{ fontSize: 10 }} /> Run
          </Button>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: C.mutedFg }}>
            <span style={{ width: 28, height: 16, borderRadius: 99, background: C.primary, position: "relative", display: "inline-block" }}>
              <span style={{ position: "absolute", right: 2, top: 2, width: 12, height: 12, borderRadius: 99, background: "#fff" }} />
            </span>
            Roll back database changes
          </span>
          <span style={{ marginLeft: "auto", color: C.mutedFg, fontSize: 12 }}>2 queries · 3 ms</span>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 14, padding: "14px 16px", lineHeight: 1.75 }}>
          <div>
            <span style={k}>App\Models\User</span> {"{"}
          </div>
          <div style={{ paddingLeft: 22 }}>
            <span style={k}>id:</span> <span style={{ color: C.sky }}>1</span>
          </div>
          <div style={{ paddingLeft: 22 }}>
            <span style={k}>name:</span> <span style={{ color: C.emerald }}>"Sample user 1"</span>
          </div>
          <div style={{ paddingLeft: 22 }}>
            <span style={k}>email:</span> <span style={{ color: C.emerald }}>"user1@example.test"</span>
          </div>
          <div style={{ paddingLeft: 22 }}>
            <span style={k}>created_at:</span> <span style={{ color: C.amber }}>2026-10-28 09:41:07</span>
          </div>
          <div>{"}"}</div>
          <div style={{ marginTop: 8 }}>
            <span style={k}>=</span> <span style={{ color: C.sky }}>12</span>
          </div>
        </div>
      </Card>
    </AppWindow>
  );
}

export function DataScreen() {
  const tables = ["cache", "failed_jobs", "jobs", "migrations", "orders", "sessions", "users"];
  return (
    <AppWindow page="sites" title="Sites" sites={4} running={RUNNING}>
      <SiteHeader tab="Data" />
      <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 14 }}>
        <Card style={{ padding: 8 }}>
          {tables.map((tb) => (
            <div key={tb} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 7, fontSize: 13, background: tb === "users" ? C.muted : "transparent", color: tb === "users" ? C.primary : C.fg }}>
              <Icon name="table" style={{ fontSize: 11, color: C.mutedFg }} /> {tb}
            </div>
          ))}
        </Card>
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "6px 11px", borderRadius: 8, border: `1px solid ${C.input}`, fontSize: 13, color: C.mutedFg }}>
              <Icon name="magnifying-glass" style={{ fontSize: 11 }} /> Search this table
            </span>
            <Button>
              <Icon name="filter" style={{ fontSize: 11 }} /> Add filter
            </Button>
          </div>
          <Card style={{ overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "0.4fr 1.1fr 1.5fr 1fr", padding: "9px 12px", fontSize: 12, color: C.mutedFg, borderBottom: `1px solid ${C.border}` }}>
              <span>id</span>
              <span>name</span>
              <span>email</span>
              <span>password</span>
            </div>
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} style={{ display: "grid", gridTemplateColumns: "0.4fr 1.1fr 1.5fr 1fr", padding: "9px 12px", fontSize: 13, borderBottom: `1px solid ${C.border}` }}>
                <span style={{ color: C.sky }}>{n}</span>
                <span>Sample user {n}</span>
                <Mono>user{n}@example.test</Mono>
                <span style={{ color: C.mutedFg }}>••••••••</span>
              </div>
            ))}
          </Card>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, color: C.mutedFg }}>
            <span style={{ width: 28, height: 16, borderRadius: 99, background: C.input, position: "relative", display: "inline-block" }}>
              <span style={{ position: "absolute", left: 2, top: 2, width: 12, height: 12, borderRadius: 99, background: "#fff" }} />
            </span>
            Allow changes · off, so a slip can't change real data
          </div>
        </div>
      </div>
    </AppWindow>
  );
}

export function ArtisanScreen() {
  const cmds = ["about", "cache:clear", "make:controller", "make:model", "migrate", "queue:work", "route:list", "storage:link"];
  const opt = (name: string, on: boolean, note: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", fontSize: 13 }}>
      <span style={{ width: 28, height: 16, borderRadius: 99, background: on ? C.primary : C.input, position: "relative", display: "inline-block" }}>
        <span style={{ position: "absolute", [on ? "right" : "left"]: 2, top: 2, width: 12, height: 12, borderRadius: 99, background: "#fff" }} />
      </span>
      <Mono>{name}</Mono>
      <span style={{ color: C.mutedFg }}>{note}</span>
    </div>
  );
  return (
    <AppWindow page="sites" title="Sites" sites={4} running={RUNNING}>
      <SiteHeader tab="Artisan" />
      <div style={{ display: "grid", gridTemplateColumns: "170px 1fr", gap: 14 }}>
        <Card style={{ padding: 8 }}>
          {cmds.map((c) => (
            <div key={c} style={{ padding: "6px 8px", borderRadius: 7, fontFamily: MONO, fontSize: 12.5, background: c === "migrate" ? C.muted : "transparent", color: c === "migrate" ? C.primary : C.fg }}>
              {c}
            </div>
          ))}
        </Card>
        <Card style={{ padding: 16 }}>
          <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 15 }}>migrate</div>
          <div style={{ fontSize: 13, color: C.mutedFg, marginBottom: 8 }}>Run the database migrations</div>
          {opt("--seed", true, "Seed the database after migrating")}
          {opt("--step", false, "Run each migration as its own batch")}
          {opt("--pretend", false, "Show the SQL without running it")}
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0" }}>
            <Button variant="primary" size="xs">
              <Icon name="play" style={{ fontSize: 10 }} /> Run
            </Button>
            <Mono style={{ color: C.mutedFg, fontSize: 12.5 }}>php artisan migrate --seed</Mono>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 12.5, lineHeight: 1.7, padding: "10px 12px", borderRadius: 10, background: C.muted }}>
            <div>
              <span style={{ color: C.sky }}>INFO</span> Running migrations.
            </div>
            <div>create_orders_table ............ 18ms DONE</div>
            <div>
              <span style={{ color: C.sky }}>INFO</span> Seeding database.
            </div>
          </div>
        </Card>
      </div>
    </AppWindow>
  );
}

/* ---------- PHP versions ---------- */

const VERSIONS: { v: string; state: "active" | "installed" | "available" }[] = [
  { v: "8.5", state: "installed" },
  { v: "8.4", state: "active" },
  { v: "8.3", state: "installed" },
  { v: "8.2", state: "available" },
  { v: "8.1", state: "available" },
  { v: "8.0", state: "available" },
  { v: "7.4", state: "installed" },
];

export function VersionsScreen() {
  return (
    <AppWindow page="services" title="Services" sites={4} running={RUNNING}>
      <div style={{ fontSize: 13, color: C.mutedFg, marginBottom: 8 }}>
        <Icon name="arrow-left" style={{ fontSize: 11 }} /> Services
      </div>
      <PageTitle title="PHP" description="Versions side by side, from the official Windows builds. Each keeps its own limits and extensions." />
      <Card style={{ overflow: "hidden" }}>
        {VERSIONS.map((r) => (
          <div key={r.v} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}>
            <ServiceLogo name="php" size={30} live={r.state !== "available"} />
            <span style={{ fontWeight: 600, width: 80 }}>PHP {r.v}</span>
            {r.state === "active" && <Badge tone="primary">Active</Badge>}
            {r.state === "installed" && <Badge tone="emerald">Installed</Badge>}
            {r.state === "available" && <Badge tone="outline">Not installed</Badge>}
            <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              {r.state === "installed" && <Button size="xs">Make active</Button>}
              {r.state === "available" && (
                <Button size="xs">
                  <Icon name="download" style={{ fontSize: 10 }} /> Install
                </Button>
              )}
              {r.state !== "available" && (
                <Button size="xs" variant="ghost">
                  <Icon name="sliders" style={{ fontSize: 11 }} /> Settings
                </Button>
              )}
            </span>
          </div>
        ))}
      </Card>
    </AppWindow>
  );
}

/* ---------- Mail ---------- */

const MAILS = [
  { from: "My App", subject: "Reset your password", time: "10:31", unread: true, on: true },
  { from: "My App", subject: "Your order #1042 has shipped", time: "10:12", unread: true },
  { from: "My App", subject: "Welcome to My App", time: "09:58" },
  { from: "Newsletter", subject: "October product update", time: "Yesterday" },
];

export function MailScreen() {
  return (
    <AppWindow page="mail" title="Mail" sites={4} running={RUNNING} unread={2}>
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 0, height: "100%", margin: -24 }}>
        <div style={{ borderRight: `1px solid ${C.border}` }}>
          <div style={{ padding: 12 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 11px", borderRadius: 8, border: `1px solid ${C.input}`, fontSize: 13, color: C.mutedFg }}>
              <Icon name="magnifying-glass" style={{ fontSize: 11 }} /> Search, e.g. from:shop is:unread
            </span>
          </div>
          {MAILS.map((m) => (
            <div key={m.subject} style={{ padding: "12px 16px", borderTop: `1px solid ${C.border}`, background: m.on ? C.muted : "transparent", display: "flex", gap: 8 }}>
              <span style={{ marginTop: 6 }}>
                <Dot color={m.unread ? C.primary : "transparent"} size={7} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: m.unread ? 650 : 500 }}>
                  {m.from} <span style={{ color: C.mutedFg, fontWeight: 400, fontSize: 12 }}>{m.time}</span>
                </span>
                <span style={{ display: "block", fontSize: 13, color: C.mutedFg, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.subject}</span>
              </span>
            </div>
          ))}
        </div>
        <div style={{ padding: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 19, fontWeight: 650, letterSpacing: "-0.02em" }}>Reset your password</span>
            <span style={{ marginLeft: "auto" }}>
              <Badge tone="emerald">
                <Dot color={C.emerald} size={6} /> Mailpit running
              </Badge>
            </span>
          </div>
          <div style={{ fontSize: 13, color: C.mutedFg, marginTop: 6 }}>From My App &lt;hello@my-app.test&gt; · To dev@example.test</div>
          <div style={{ display: "flex", gap: 4, margin: "14px 0" }}>
            {["HTML", "Text", "Headers", "Source"].map((t, i) => (
              <span key={t} style={{ padding: "4px 10px", borderRadius: 7, fontSize: 12.5, background: i === 0 ? C.muted : "transparent" }}>
                {t}
              </span>
            ))}
          </div>
          <div style={{ borderRadius: 12, background: "#fafafa", color: "#18181b", padding: "24px 26px" }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>My App</div>
            <p style={{ fontSize: 14, lineHeight: 1.6 }}>You asked to reset your password. Click the button below to choose a new one.</p>
            <span style={{ display: "inline-block", background: "#18181b", color: "#fff", borderRadius: 6, padding: "9px 15px", fontSize: 13, fontWeight: 600 }}>Reset password</span>
            <p style={{ fontSize: 12.5, color: "#71717a", margin: "14px 0 0" }}>This link expires in 60 minutes.</p>
          </div>
        </div>
      </div>
    </AppWindow>
  );
}

/* ---------- A laptop to hold a screen ---------- */

export function Laptop({ children, width }: { children: ReactNode; width: number }) {
  // The screen holds the 1100 x 700 window; everything is sized from it.
  const bezel = 18;
  const scale = (width - bezel * 2) / 1100;
  return (
    <div style={{ width, position: "relative", color: C.fg }}>
      <div style={{ background: "oklch(0.18 0.03 285)", borderRadius: 26, padding: bezel, boxShadow: `0 60px 100px -50px ${C.shadow}` }}>
        <div style={{ width: 1100 * scale, height: 700 * scale, overflow: "hidden", borderRadius: 8, position: "relative" }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: 1100, height: 700 }}>{children}</div>
        </div>
      </div>
      <div style={{ height: width * 0.03, margin: "0 -6%", background: "linear-gradient(180deg, oklch(0.86 0.02 300), oklch(0.74 0.03 290))", borderRadius: `0 0 ${width * 0.04}px ${width * 0.04}px` }}>
        <div style={{ width: "16%", height: "38%", margin: "0 auto", background: "oklch(0.7 0.03 290)", borderRadius: "0 0 10px 10px" }} />
      </div>
    </div>
  );
}

export { Logo };

/* ---------- Home ---------- */

const HOME_SERVICES = [
  { name: "nginx", port: ":80" },
  { name: "PHP 8.4", port: ":9084" },
  { name: "DNS", port: ":53" },
  { name: "MariaDB", port: ":3306" },
  { name: "Redis", port: ":6379" },
  { name: "Mailpit", port: ":1025" },
];

function Tile({ icon, brands, label, value }: { icon: string; brands?: boolean; label: string; value: ReactNode }) {
  return (
    <Card style={{ padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ width: 38, height: 38, borderRadius: 11, background: C.muted, display: "grid", placeItems: "center", color: C.primary }}>
        <Icon name={icon} brands={brands} style={{ fontSize: 15 }} />
      </span>
      <span>
        <span style={{ display: "block", fontSize: 12, color: C.mutedFg }}>{label}</span>
        <span style={{ display: "block", fontWeight: 600 }}>{value}</span>
      </span>
    </Card>
  );
}

export function HomeScreen() {
  return (
    <AppWindow page="home" title="Home" sites={4} running={RUNNING}>
      <PageTitle
        title="Home"
        description="Your local PHP environment at a glance."
        actions={
          <span style={{ display: "flex", gap: 8 }}>
            <Button>
              <Icon name="play" style={{ fontSize: 11 }} /> Start all
            </Button>
            <Button variant="primary">
              <Icon name="plus" style={{ fontSize: 11 }} /> New site
            </Button>
          </span>
        }
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <Tile icon="server" label="Services" value="8 of 8 running" />
        <Tile icon="globe" label="Sites" value="4 sites" />
        <Tile icon="php" brands label="PHP" value={<>PHP 8.4 <Mono style={{ color: C.mutedFg, fontWeight: 400 }}>*.test</Mono></>} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <Card style={{ padding: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Services</div>
          {HOME_SERVICES.map((s) => (
            <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 13 }}>
              <Dot color={C.emerald} size={7} />
              <span style={{ flex: 1, fontWeight: 500 }}>{s.name}</span>
              <Mono style={{ color: C.mutedFg, fontSize: 12 }}>{s.port}</Mono>
              <span style={{ width: 60, textAlign: "right", color: C.mutedFg, fontSize: 12 }}>Running</span>
            </div>
          ))}
        </Card>
        <Card style={{ padding: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Your sites</div>
          {SITES.map((s) => (
            <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 13 }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: C.muted, display: "grid", placeItems: "center", color: C.mutedFg }}>
                <Icon name="laravel" brands style={{ fontSize: 12 }} />
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontWeight: 600 }}>{s.name}</span>
                <Mono style={{ fontSize: 11.5, color: C.mutedFg }}>{s.url}</Mono>
              </span>
              <Icon name="up-right-from-square" style={{ fontSize: 12, color: C.mutedFg }} />
            </div>
          ))}
        </Card>
      </div>
      <Card style={{ padding: 14, marginTop: 12, display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: C.mutedFg }}>
        <Icon name="circle-check" style={{ color: C.emerald }} /> Nothing needs your attention.
      </Card>
    </AppWindow>
  );
}

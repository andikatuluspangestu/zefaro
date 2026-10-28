import type { ReactNode } from "react";
import { usePrefs } from "../prefs";

export type TabId = "overview" | "data" | "config" | "logs" | "tinker" | "artisan" | "workers";
export const TABS: TabId[] = ["overview", "data", "config", "logs", "tinker", "artisan", "workers"];

const ENV: [string, string][] = [
  ["APP_ENV", "local"],
  ["APP_URL", "http://shop.test"],
  ["DB_CONNECTION", "sqlite"],
  ["MAIL_MAILER", "smtp"],
  ["MAIL_HOST", "127.0.0.1"],
  ["MAIL_PORT", "1025"],
];

/** What each tab of a Laravel site's page looks like. Values are examples from a sample app. */
export function ToolPanel({ id }: { id: TabId }) {
  const { t } = usePrefs();
  const T = t.tools;
  const panels: Record<TabId, ReactNode> = {
    overview: (
      <>
        <h4>{T.overview.heading}</h4>
        {T.overview.items.map((f) => (
          <div className="find" key={f.title}>
            <b>{f.title}</b>
            <p>{f.text}</p>
            <span className="mini-btn">{f.action}</span>
          </div>
        ))}
      </>
    ),
    data: (
      <>
        <h4>
          <span className="mono">{T.data.table}</span> <span className="sub">· {T.data.rows}</span>
        </h4>
        <table className="tbl">
          <thead>
            <tr>
              <th>id<small>integer</small></th>
              <th>name<small>varchar</small></th>
              <th>email<small>varchar</small></th>
              <th>password<small>varchar</small></th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3].map((n) => (
              <tr key={n}>
                <td>{n}</td>
                <td>{T.data.name} {n}</td>
                <td className="mono">user{n}@example.test</td>
                <td>••••••••</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="toggle" style={{ marginTop: 18 }}>
          <i style={{ background: "var(--input)" }} aria-hidden="true" />
          {T.data.changes}
        </div>
        <p className="sub">{T.data.changesNote}</p>
      </>
    ),
    config: (
      <>
        <h4 className="mono">{T.config.heading}</h4>
        <div className="code">{ENV.map(([k, v]) => `${k}=${v}`).join("\n")}</div>
        <p className="sub" style={{ marginTop: 12 }}>{T.config.note}</p>
      </>
    ),
    logs: (
      <>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {T.logs.filters.map((f, i) => (
            <span key={f} className="chip" style={i === 0 ? { background: "var(--secondary)" } : undefined}>{f}</span>
          ))}
        </div>
        <div className="stackv">
          {T.logs.entries.map((e) => (
            <div className="line" key={e.text}>
              <span className={`lvl ${e.level}`}>{e.label}</span>
              <span className="mono" style={{ fontSize: 12.5 }}>{e.text}</span>
              <span className="sp">{e.when}</span>
            </div>
          ))}
        </div>
      </>
    ),
    tinker: (
      <>
        <div className="code">{"App\\Models\\User::first()"}</div>
        <div className="tree">
          <div><span className="k">App\Models\User</span> {"{"}</div>
          <div>&nbsp;&nbsp;<span className="k">id:</span> <span className="n">1</span></div>
          <div>&nbsp;&nbsp;<span className="k">name:</span> <span className="s">"{T.data.name} 1"</span></div>
          <div>&nbsp;&nbsp;<span className="k">created_at:</span> <span className="t">2026-10-28 09:41:07</span></div>
          <div>{"}"}</div>
        </div>
        <p className="sub" style={{ marginTop: 18 }}>{T.tinker.note}</p>
      </>
    ),
    artisan: (
      <div className="cmds">
        <ul className="mono" aria-hidden="true">
          {["about", "cache:clear", "make:model", "migrate", "queue:work", "route:list"].map((c) => (
            <li key={c} className={c === "migrate" ? "on" : ""}>{c}</li>
          ))}
        </ul>
        <div>
          <h4 className="mono">migrate</h4>
          <div className="toggle"><i aria-hidden="true" />--seed</div>
          <div>
            <span className="mini-btn"><i className="fa-solid fa-play" aria-hidden="true" /> {T.artisan.run}</span>{" "}
            <span className="mono sub">php artisan migrate --seed</span>
          </div>
          <div className="code" style={{ marginTop: 14 }}>{T.artisan.output.join("\n")}</div>
        </div>
      </div>
    ),
    workers: (
      <>
        <h4>{T.workers.heading}</h4>
        <div className="stackv">
          {T.workers.items.map((w, i) => (
            <div className="line" key={w.name}>
              <span className={`dot ${i < 2 ? "running" : ""}`} />
              <span className="mono">{w.name}</span>
              <span className="sp">{w.state}</span>
              <span className={`mini-btn${i < 2 ? " out" : ""}`}>{i < 2 ? T.workers.stop : T.workers.start}</span>
            </div>
          ))}
        </div>
      </>
    ),
  };
  return <>{panels[id]}</>;
}

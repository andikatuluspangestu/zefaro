import { LINKS } from "../copy";
import { usePrefs } from "../prefs";
import { Magnetic } from "./Magnetic";
import { Reveal } from "./Reveal";
import { SplitWords } from "./Split";

export function Install() {
  const { t } = usePrefs();
  const g = t.get;
  return (
    <section className="install" id="install">
      <div className="wrap">
        <div className="install-card">
          <div>
            <h2 className="display">
              <SplitWords text={g.title} />
            </h2>
            <Reveal>
              <p className="brandline">{g.brandLine}</p>
              <dl className="facts">
                {g.facts.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <Magnetic>
                <a className="btn btn-light btn-lg" href={LINKS.download}>
                  <i className="fa-solid fa-download" aria-hidden="true" />
                  {g.cta}
                </a>
              </Magnetic>
              <p className="note">
                <a href={LINKS.download}>{g.verify}</a>
              </p>
              <p className="note">{g.note}</p>
            </Reveal>
          </div>
          <Reveal delay={0.12}>
            <ol className="steps">
              {g.steps.map((s) => (
                <li key={s.title}>
                  <div>
                    <b>{s.title}</b>
                    <span>{s.text}</span>
                  </div>
                </li>
              ))}
            </ol>
            <div className="reqs">
              <h3>{g.reqsTitle}</h3>
              <ul>
                {g.reqs.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

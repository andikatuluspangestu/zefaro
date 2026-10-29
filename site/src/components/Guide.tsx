import { LINKS } from "../copy";
import { guides, GUIDE_UPDATED, type Block, type Guide as GuideData } from "../guides";
import { usePrefs } from "../prefs";

function BlockView({ block }: { block: Block }) {
  if ("p" in block) return <p>{block.p}</p>;
  if ("list" in block)
    return (
      <ul>
        {block.list.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  if ("steps" in block)
    return (
      <ol>
        {block.steps.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    );
  return (
    <div className="guide-table">
      <table>
        <thead>
          <tr>
            {block.table.head.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.table.rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, i) =>
                i === 0 ? (
                  <th key={i} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={i}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A guide page: plain, readable text that answers one search topic, with the download at hand. */
export function Guide({ guide }: { guide: GuideData }) {
  const { t } = usePrefs();
  const others = guides.filter((g) => g.id !== guide.id);
  return (
    <article className="guide wrap" id="guide">
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href="/id/">Zefaro</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{guide.label}</span>
      </nav>
      <h1 className="display">{guide.h1}</h1>
      <p className="lead">{guide.lead}</p>
      <div className="guide-cta">
        <a className="btn btn-primary" href={LINKS.download}>
          <i className="fa-solid fa-download" aria-hidden="true" />
          Unduh Zefaro gratis
        </a>
        <span>{t.hero.meta}</span>
      </div>

      {guide.sections.map((s) => (
        <section key={s.h2}>
          <h2>{s.h2}</h2>
          {s.blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </section>
      ))}

      <section>
        <h2>Pertanyaan umum</h2>
        <dl className="guide-faq">
          {guide.faq.map((f) => (
            <div key={f.q}>
              <dt>{f.q}</dt>
              <dd>{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="guide-more">
        <h2>Baca juga</h2>
        <ul>
          <li>
            <a href="/id/">Zefaro: semua fitur dan cara memasangnya</a>
          </li>
          {others.map((g) => (
            <li key={g.id}>
              <a href={g.path}>{g.h1}</a>
            </li>
          ))}
          <li>
            <a href={LINKS.repo}>Kode sumber Zefaro di GitHub</a>
          </li>
        </ul>
        <p className="guide-updated">
          Diperbarui <time dateTime={GUIDE_UPDATED}>29 Oktober 2026</time>
        </p>
      </section>
    </article>
  );
}

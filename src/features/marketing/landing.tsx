import Link from "next/link";
import { ADVISORY_NOTICE } from "@/core/sprinkler/report";
import "./landing.css";

// The landing page (/): a spec sheet for the 4541 layout engine, and the way in.
// One static page, no script of its own. The fuller marketing site (pricing,
// FAQ, help) is Epic 13.

const SPECS: [string, string][] = [
  ["Rules", "NZS 4541 · versioned"],
  ["Hazards", "ELH · OH1–OH3"],
  ["Zones", "Irregular, with holes"],
  ["Runs in", "Your browser"],
];

const CHECKS: [string, string][] = [
  ["Area per head", "≤ 12.0 m²"],
  ["Max spacing", "4.0 m"],
  ["Min spacing", "2.0 m"],
  ["Max to wall", "2.0 m"],
  ["Coverage", "100%"],
];

const FEATURES: [string, string][] = [
  ["Open and calibrate", "Any PDF, in the browser. Scale from a known length or the printed scale."],
  ["Zones and uses", "Trace rooms with holes and odd shapes; the use sets the hazard class."],
  ["Automatic placement", "Spacing from the hazard class, aligned to the ceiling grid, your preferences kept."],
  ["Live checks", "Coverage overlay and rule-break markers update as you move heads by hand."],
  ["Measure and mark up", "Lengths, areas, counts, clouds, stamps, legends and your own tool sets."],
  ["Export and print", "PDF with editable markups, or flattened. Company-wide tool sets and mappings."],
];

// The example zone (an L with a hole), in the drawing's own units.
const ZONE = "40,40 360,40 360,260 200,260 200,170 40,170";
const ZONE_PATH = "M40 40H360V260H200V170H40Z M250 90V120H290V90Z";
const CORNERS: [number, number][] = [
  [40, 40],
  [360, 40],
  [360, 260],
  [200, 260],
  [200, 170],
  [40, 170],
];
const HEADS: [number, number][] = [
  [80, 75],
  [160, 75],
  [240, 75],
  [320, 75],
  [80, 140],
  [160, 140],
  [240, 140],
  [320, 140],
  [240, 215],
  [320, 215],
];

function Grid() {
  const lines = [];
  for (let v = 0; v <= 400; v += 20) lines.push(<line key={`x${v}`} x1={v} y1={0} x2={v} y2={300} />);
  for (let v = 0; v <= 300; v += 20) lines.push(<line key={`y${v}`} x1={0} y1={v} x2={400} y2={v} />);
  return <g className="lp-grid">{lines}</g>;
}

function Hole() {
  return <rect className="lp-hole" x={250} y={90} width={40} height={30} />;
}

function ZoneDrawing() {
  return (
    <svg viewBox="0 0 400 300" role="img" aria-label="A zone outlined on a plan, before any heads are placed">
      <Grid />
      <polygon className="lp-zone lp-zone-empty" points={ZONE} />
      <Hole />
      {CORNERS.map(([x, y]) => (
        <rect key={`${x},${y}`} className="lp-vertex" x={x - 4} y={y - 4} width={8} height={8} />
      ))}
      <text className="lp-svg-label" x={56} y={60}>
        USE: OFFICE → OH1
      </text>
    </svg>
  );
}

function PlacedDrawing() {
  return (
    <svg viewBox="0 0 400 300" role="img" aria-label="The same zone with ten sprinkler heads placed on a grid and their coverage shown">
      <defs>
        <clipPath id="lp-zone-clip">
          <path d={ZONE_PATH} clipRule="evenodd" />
        </clipPath>
      </defs>
      <Grid />
      <g clipPath="url(#lp-zone-clip)">
        <rect className="lp-zone-fill" x={0} y={0} width={400} height={300} />
        {HEADS.map(([x, y]) => (
          <circle key={`${x},${y}`} className="lp-coverage" cx={x} cy={y} r={50} />
        ))}
      </g>
      <polygon className="lp-zone" points={ZONE} />
      <Hole />
      {HEADS.map(([x, y]) => (
        <g key={`${x},${y}`} className="lp-head">
          <circle cx={x} cy={y} r={6} />
          <line x1={x - 3.5} y1={y} x2={x + 3.5} y2={y} />
          <line x1={x} y1={y - 3.5} x2={x} y2={y + 3.5} />
        </g>
      ))}
      <line className="lp-dim" x1={80} y1={24} x2={160} y2={24} />
      <text className="lp-svg-dim" x={120} y={18} textAnchor="middle">
        4.0 m
      </text>
    </svg>
  );
}

export function Landing() {
  return (
    <div className="lp">
      <a className="lp-skip" href="#content">
        Skip to content
      </a>
      <div className="lp-wrap">
        <header className="lp-nav">
          <Link className="lp-logo" href="/" aria-label="Plan Markup home">
            PLAN<span aria-hidden="true">/</span>MARKUP
          </Link>
          <nav aria-label="Sections" className="lp-links">
            <a href="#engine">Layout engine</a>
            <a href="#features">Features</a>
            <Link className="lp-btn lp-btn-plain" href="/sign-in">
              Sign in
            </Link>
          </nav>
        </header>

        <main id="content">
          <section className="lp-hero" aria-labelledby="lp-title">
            <div>
              <p className="lp-label">For sprinkler designers in New Zealand</p>
              <h1 id="lp-title">NZS 4541 head layouts, placed and checked for you.</h1>
              <p className="lp-lede">
                Outline a zone on your PDF and choose its use. Plan Markup places the heads to the spacing and coverage rules, aligns them to the
                ceiling grid, and reports every check.
              </p>
            </div>
            <div className="lp-ctas">
              <Link className="lp-btn lp-btn-primary" href="/sign-in">
                Sign in
              </Link>
            </div>
          </section>

          <section id="engine" aria-label="The layout engine, step by step">
            <dl className="lp-specs">
              {SPECS.map(([k, v]) => (
                <div key={k}>
                  <dt className="lp-label">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <div className="lp-panels">
              <figure className="lp-panel">
                <figcaption className="lp-panel-head">
                  <span className="lp-step">01 · ZONE</span>
                  <span className="lp-label">Office · OH1</span>
                </figcaption>
                <ZoneDrawing />
              </figure>
              <figure className="lp-panel">
                <figcaption className="lp-panel-head">
                  <span className="lp-step">02 · PLACED</span>
                  <span className="lp-label">{HEADS.length} heads</span>
                </figcaption>
                <PlacedDrawing />
              </figure>
              <figure className="lp-panel">
                <figcaption className="lp-panel-head">
                  <span className="lp-step">03 · REPORT</span>
                  <span className="lp-label lp-pass">All checks pass</span>
                </figcaption>
                <table className="lp-report">
                  <caption className="lp-sr">Example zone report</caption>
                  <tbody>
                    {CHECKS.map(([k, v]) => (
                      <tr key={k}>
                        <th scope="row">{k}</th>
                        <td>
                          {v} <span className="lp-tag">OK</span>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <th scope="row">Rule set</th>
                      <td>NZS 4541 v1</td>
                    </tr>
                  </tbody>
                </table>
              </figure>
            </div>
            <p className="lp-caption">An example zone. Your numbers come from your plan, its scale and the hazard class.</p>
          </section>

          <section id="features" className="lp-features" aria-labelledby="lp-features-title">
            <div>
              <p className="lp-label">What it does</p>
              <h2 id="lp-features-title">One tool for the layout and the markup around it.</h2>
            </div>
            <ol className="lp-speclist">
              {FEATURES.map(([title, body], i) => (
                <li key={title}>
                  <span className="lp-n" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
          </section>

          <aside className="lp-notice" aria-label="Advisory">
            <p className="lp-label lp-accent">Advisory</p>
            <p>
              {ADVISORY_NOTICE} Bluebeam and Revu are trademarks of Bluebeam, Inc. Plan Markup is not affiliated with or endorsed by Bluebeam, Inc.
            </p>
          </aside>
        </main>

        <footer className="lp-footer">
          <span>© 2026 PLAN/MARKUP · NEW ZEALAND</span>
          <Link href="/sign-in">Sign in</Link>
        </footer>
      </div>
    </div>
  );
}

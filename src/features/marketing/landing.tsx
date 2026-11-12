import type { CSSProperties } from "react";
import Link from "next/link";
import {
  FileOutput,
  Hammer,
  PenTool,
  Ruler,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { ADVISORY_NOTICE } from "@/core/sprinkler/report";
import { FlameRow, HeroScene } from "./hero-scene";
import "./landing.css";

// The landing page (/): what Plan Markup does for a sprinkler designer, and the
// way in (sign up, sign in). One static page, no script of its own. The fuller
// marketing site (pricing, FAQ, help) is Epic 13.

const vars = (v: Record<string, string>) => v as CSSProperties;

/** Embers rising behind the hero; fixed values so every render is the same. */
const EMBERS = Array.from({ length: 26 }, (_, i) => ({
  x: `${(i * 37 + 11) % 100}%`,
  s: `${3 + ((i * 5) % 4) * 2}px`,
  d: `${6 + ((i * 7) % 8)}s`,
  delay: `${-((i * 13) % 11)}s`,
  drift: `${((i * 29) % 90) - 45}px`,
  c: ["#ff6a1a", "#ffb21a", "#e3170a", "#ffe27a"][i % 4],
}));

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Sparkles,
    title: "Heads that look hand-placed",
    body: "Rows stay in line, follow the ceiling grid, and run along the head lines you draw. Drag any head afterwards and the check follows live.",
  },
  {
    icon: ShieldCheck,
    title: "A second engine checks the first",
    body: "Every head is checked for spacing, wall distance and coverage by a checker built separately from the placer. Problems are marked on the plan.",
  },
  {
    icon: Ruler,
    title: "Measure to scale",
    body: "Calibrate from one known length, then take lengths, areas, counts, angles and radii straight off the PDF.",
  },
  {
    icon: PenTool,
    title: "Mark up the way you already do",
    body: "Clouds, callouts, text, arrows, highlights, stamps, layers and a markups list, with the keyboard shortcuts you expect.",
  },
  {
    icon: Hammer,
    title: "Bring your tool sets",
    body: "Import Bluebeam .btx tool sets into your Tool Chest and keep counting devices with the symbols your team knows.",
  },
  {
    icon: FileOutput,
    title: "Ready for site",
    body: "Switch on head-to-head and head-to-wall dimensions for the installers, then export an editable or flattened PDF, or print.",
  },
];

/** Head positions of the engine picture (an L-shaped room, 96 px = 3600 mm). */
const HEADS: [number, number][] = [
  ...[85, 175].flatMap((y) =>
    [88, 184, 280, 376, 472].map((x): [number, number] => [x, y]),
  ),
  ...[265, 320].flatMap((y) =>
    [88, 184, 280].map((x): [number, number] => [x, y]),
  ),
];

function BrandMark() {
  return (
    <svg viewBox="0 0 34 34" aria-hidden="true">
      <rect
        x="1"
        y="1"
        width="32"
        height="32"
        rx="3"
        fill="#e3170a"
        stroke="#fff4ee"
        strokeWidth="2"
      />
      <path
        d="M17 6v9M9 16h16M11 16v3M17 16v3M23 16v3"
        stroke="#fff4ee"
        strokeWidth="2.6"
        fill="none"
      />
      <path
        d="M10 23v4M17 24v5M24 23v4"
        stroke="#ffe27a"
        strokeWidth="2.6"
        fill="none"
      />
    </svg>
  );
}

function PlanArt() {
  return (
    <div className="lp-plan">
      <svg
        viewBox="0 0 560 400"
        role="img"
        aria-label="A room with sprinkler heads in aligned rows, their coverage, and set-out dimensions"
      >
        {/* The room and a column. */}
        <path
          d="M40 40H520V220H320V360H40Z"
          fill="rgba(227,23,10,0.05)"
          stroke="#1c1413"
          strokeWidth="4"
        />
        <rect x="226" y="122" width="16" height="16" fill="#1c1413" />
        {/* Head lines the designer drew. */}
        <path
          d="M60 85H500M60 175H500"
          stroke="#1a8f3c"
          strokeWidth="1.5"
          strokeDasharray="7 5"
          fill="none"
        />
        {/* Coverage, then the heads. */}
        {HEADS.map(([x, y], i) => (
          <circle
            key={`c${i}`}
            className="lp-pop"
            style={vars({
              "--ox": `${x}px`,
              "--oy": `${y}px`,
              "--pdelay": `${i * 0.09}s`,
            })}
            cx={x}
            cy={y}
            r="62"
            fill="rgba(227,23,10,0.07)"
            stroke="rgba(227,23,10,0.45)"
            strokeWidth="1.2"
          />
        ))}
        {HEADS.map(([x, y], i) => (
          <g
            key={`h${i}`}
            className="lp-pop"
            style={vars({
              "--ox": `${x}px`,
              "--oy": `${y}px`,
              "--pdelay": `${i * 0.09}s`,
            })}
          >
            <circle
              cx={x}
              cy={y}
              r="7"
              fill="#ffffff"
              stroke="#e3170a"
              strokeWidth="2.5"
            />
            <path
              d={`M${x - 11} ${y}H${x + 11}M${x} ${y - 11}V${y + 11}`}
              stroke="#e3170a"
              strokeWidth="1.6"
            />
          </g>
        ))}
        {/* Set-out dimensions. */}
        <g stroke="#1d4ed8" strokeWidth="1.4" fill="none">
          <path d="M88 62H184M88 56V68M184 56V68M40 62H88M40 56V68" />
          <path d="M446 85V175M440 85H452M440 175H452" />
        </g>
        <g fill="#1d4ed8" fontSize="12" fontWeight="700" textAnchor="middle">
          <text x="136" y="56">
            3600
          </text>
          <text x="64" y="56">
            1800
          </text>
          <text x="454" y="134" textAnchor="start">
            3375
          </text>
        </g>
        <g fontSize="11" fontWeight="700" fill="#1c1413">
          <rect
            x="336"
            y="238"
            width="170"
            height="104"
            fill="#ffffff"
            stroke="#1c1413"
            strokeWidth="2"
          />
          <text x="348" y="258">
            ZONE A · OH1
          </text>
          <text x="348" y="280" fontWeight="500">
            Heads
          </text>
          <text x="494" y="280" textAnchor="end">
            16
          </text>
          <text x="348" y="300" fontWeight="500">
            Coverage
          </text>
          <text x="494" y="300" textAnchor="end">
            100 %
          </text>
          <text x="348" y="320" fontWeight="500">
            Rule breaks
          </text>
          <text x="494" y="320" textAnchor="end" fill="#1a8f3c">
            0
          </text>
        </g>
      </svg>
    </div>
  );
}

export function Landing() {
  return (
    <div className="lp">
      <a className="lp-skip" href="#content">
        Skip to content
      </a>

      <main>
        <div className="lp-hero">
          <div className="lp-embers" aria-hidden="true">
            {EMBERS.map((e, i) => (
              <span
                key={i}
                className="lp-ember"
                style={vars({
                  "--x": e.x,
                  "--s": e.s,
                  "--d": e.d,
                  "--delay": e.delay,
                  "--drift": e.drift,
                  "--c": e.c,
                })}
              />
            ))}
          </div>

          <div className="lp-wrap lp-nav">
            <Link className="lp-brand" href="/">
              <BrandMark />
              Plan Markup
            </Link>
            <nav className="lp-nav-links" aria-label="Sections">
              <a href="#how">How it works</a>
              <a href="#features">Features</a>
              <a href="#engine">The 4541 engine</a>
            </nav>
            <div className="lp-nav-cta">
              <Link href="/sign-in">Sign in</Link>
              <Link className="lp-btn lp-btn-primary lp-btn-sm" href="/sign-up">
                Create account
              </Link>
            </div>
          </div>

          <div id="content" className="lp-wrap lp-hero-grid">
            <div>
              <span className="lp-eyebrow">
                <i aria-hidden="true" />
                PDF markup for sprinkler designers
              </span>
              <h1 className="lp-display lp-h1">
                Head layouts in minutes.
                <em>Not afternoons.</em>
              </h1>
              <p className="lp-lede">
                Open a plan, set the scale and draw a zone. Plan Markup{" "}
                <strong>
                  places sprinkler heads to NZS 4541 spacing, checks every one
                </strong>
                , and exports a PDF you can open in Bluebeam Revu.
              </p>
              <div className="lp-actions">
                <Link className="lp-btn lp-btn-primary" href="/sign-up">
                  Create your account
                </Link>
                <Link className="lp-btn lp-btn-ghost" href="/sign-in">
                  Sign in
                </Link>
              </div>
              <p className="lp-note">
                Nothing to install. New accounts are approved before first use.
              </p>
            </div>
            <HeroScene />
          </div>
        </div>

        <section className="lp-strip" aria-label="At a glance">
          <div className="lp-wrap lp-strip-grid">
            <div className="lp-stat">
              <b className="lp-display">1 click</b>
              <span>
                from a drawn zone to a full head layout, placed in under half a
                second on our benchmark zones.
              </span>
            </div>
            <div className="lp-stat">
              <b className="lp-display">2 engines</b>
              <span>
                one places the heads, a separate one checks them. They are built
                apart, so one cannot hide the other&apos;s mistake.
              </span>
            </div>
            <div className="lp-stat">
              <b className="lp-display">0 dots by hand</b>
              <span>
                unless you want to. Move or add any head yourself and it stays
                put when the zone is laid out again.
              </span>
            </div>
          </div>
        </section>

        <section id="how" className="lp-section lp-paper">
          <div className="lp-wrap">
            <span className="lp-kicker">How it works</span>
            <h2 className="lp-display lp-h2">Three steps. One PDF.</h2>
            <p className="lp-sub">
              No CAD, no plug-ins and no training course. If you can mark up a
              PDF, you can lay out a floor.
            </p>
            <ol className="lp-steps">
              <li className="lp-step">
                <svg viewBox="0 0 300 130" aria-hidden="true">
                  <path d="M30 96H270" stroke="#1c1413" strokeWidth="4" />
                  <path
                    className="lp-draw"
                    pathLength={1}
                    d="M30 58H270"
                    stroke="#1d4ed8"
                    strokeWidth="2.5"
                    fill="none"
                  />
                  <path
                    d="M30 46V70M270 46V70"
                    stroke="#1d4ed8"
                    strokeWidth="2.5"
                  />
                  <rect x="112" y="24" width="76" height="24" fill="#1d4ed8" />
                  <text
                    x="150"
                    y="41"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="13"
                    fontWeight="700"
                  >
                    6000 mm
                  </text>
                  <circle cx="30" cy="96" r="6" fill="#e3170a" />
                  <circle cx="270" cy="96" r="6" fill="#e3170a" />
                </svg>
                <h3>Open and calibrate</h3>
                <p>
                  Open the PDF plan and click two points a known distance apart.
                  Everything you measure is to scale from then on.
                </p>
              </li>
              <li className="lp-step">
                <svg viewBox="0 0 300 130" aria-hidden="true">
                  <path
                    d="M34 22H266V72H170V108H34Z"
                    fill="none"
                    stroke="#1c1413"
                    strokeWidth="4"
                  />
                  <path
                    className="lp-draw"
                    pathLength={1}
                    d="M40 28H260V66H164V102H40Z"
                    fill="rgba(139,127,209,0.16)"
                    stroke="#6a5bc2"
                    strokeWidth="2.5"
                    strokeDasharray="1"
                  />
                  <rect x="176" y="80" width="100" height="24" fill="#6a5bc2" />
                  <text
                    x="226"
                    y="97"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="13"
                    fontWeight="700"
                  >
                    Office · OH1
                  </text>
                </svg>
                <h3>Draw the zone</h3>
                <p>
                  Trace the room and pick its use. The hazard class and its
                  spacing limits follow. Draw head lines where you want the rows
                  to run.
                </p>
              </li>
              <li className="lp-step">
                <svg viewBox="0 0 300 130" aria-hidden="true">
                  <path
                    d="M34 22H266V108H34Z"
                    fill="none"
                    stroke="#1c1413"
                    strokeWidth="4"
                  />
                  {[62, 120, 178, 236].flatMap((x, i) =>
                    [46, 86].map((y, j) => (
                      <g
                        key={`${x}-${y}`}
                        className="lp-pop"
                        style={vars({
                          "--ox": `${x}px`,
                          "--oy": `${y}px`,
                          "--pdelay": `${(i * 2 + j) * 0.12}s`,
                        })}
                      >
                        <circle
                          cx={x}
                          cy={y}
                          r="26"
                          fill="rgba(227,23,10,0.08)"
                          stroke="rgba(227,23,10,0.4)"
                        />
                        <circle
                          cx={x}
                          cy={y}
                          r="5"
                          fill="#ffffff"
                          stroke="#e3170a"
                          strokeWidth="2.2"
                        />
                      </g>
                    )),
                  )}
                </svg>
                <h3>Place, check, export</h3>
                <p>
                  One click places the heads. Coverage and rule breaks show on
                  the plan, and the PDF with set-out dimensions is ready for
                  site.
                </p>
              </li>
            </ol>
          </div>
        </section>

        <section id="features" className="lp-section lp-features">
          <div className="lp-wrap">
            <span className="lp-kicker">Features</span>
            <h2 className="lp-display lp-h2">
              Built for the fire side of the drawing.
            </h2>
            <p className="lp-sub">
              A full PDF markup tool, with the one job general tools leave to
              you done for you.
            </p>
            <div className="lp-cards">
              {FEATURES.map((f) => (
                <article key={f.title} className="lp-card">
                  <span className="lp-card-icon">
                    <f.icon aria-hidden="true" />
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="engine" className="lp-section lp-engine">
          <div className="lp-wrap lp-engine-grid">
            <PlanArt />
            <div>
              <span className="lp-kicker">The 4541 engine</span>
              <h2 className="lp-display lp-h2">
                It knows the spacing rules. You make the calls.
              </h2>
              <ul className="lp-checks">
                <li>
                  <span className="lp-tick" aria-hidden="true">
                    ✓
                  </span>
                  <span>
                    <b>Spacing and wall distance</b> from the hazard class of
                    each zone, around columns, shafts and odd-shaped rooms.
                  </span>
                </li>
                <li>
                  <span className="lp-tick" aria-hidden="true">
                    ✓
                  </span>
                  <span>
                    <b>Coverage you can see.</b> Switch on the overlay and gaps
                    show at once; a zone report lists every figure.
                  </span>
                </li>
                <li>
                  <span className="lp-tick" aria-hidden="true">
                    ✓
                  </span>
                  <span>
                    <b>Your layout, kept.</b> Heads you move or add by hand stay
                    where you put them when the zone is laid out again.
                  </span>
                </li>
              </ul>
              <p className="lp-advisory">{ADVISORY_NOTICE}</p>
            </div>
          </div>
        </section>

        <section className="lp-section lp-cta">
          <FlameRow />
          <div className="lp-wrap">
            <h2 className="lp-display lp-h2">Stop placing dots by hand.</h2>
            <p>
              Create an account, open your next plan, and see the first zone
              laid out before your coffee cools.
            </p>
            <div className="lp-actions">
              <Link className="lp-btn lp-btn-primary" href="/sign-up">
                Create your account
              </Link>
              <Link className="lp-btn lp-btn-ghost" href="/sign-in">
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap">
          <div className="lp-foot-row">
            <span>© 2026 Plan Markup</span>
            <Link href="/sign-in">Sign in</Link>
            <Link href="/sign-up">Create account</Link>
            <Link href="/forgot-password">Forgot password</Link>
          </div>
          <small>
            {ADVISORY_NOTICE} Bluebeam and Revu are trademarks of Bluebeam, Inc.
            Plan Markup is an independent product and is not affiliated with or
            endorsed by Bluebeam, Inc.
          </small>
        </div>
      </footer>
    </div>
  );
}

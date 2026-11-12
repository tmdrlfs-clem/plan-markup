import type { CSSProperties } from "react";

// The hero picture: a fire under a pendent sprinkler head. Its 68 °C glass bulb
// bursts, water falls, the fire dies back, and it starts again (a 10 s loop,
// all CSS: see landing.css). Decorative, so hidden from assistive technology.

const FLAME =
  "M0 0C-30-8-46-40-34-74C-28-60-22-56-18-66C-14-96-26-112-8-150C0-126 34-104 38-62C40-34 26-8 0 0Z";

const FLAMES: { x: number; s: number; d: number; delay: number }[] = [
  { x: 70, s: 0.85, d: 1.0, delay: -0.2 },
  { x: 142, s: 1.25, d: 1.3, delay: -0.7 },
  { x: 214, s: 1.0, d: 0.9, delay: -0.4 },
  { x: 290, s: 1.55, d: 1.2, delay: -0.1 },
  { x: 366, s: 1.2, d: 1.05, delay: -0.9 },
  { x: 438, s: 1.45, d: 1.35, delay: -0.5 },
  { x: 512, s: 1.0, d: 0.95, delay: -0.3 },
  { x: 580, s: 0.8, d: 1.15, delay: -0.8 },
];

const STREAMS = [-262, -205, -150, -95, -40, 40, 95, 150, 205, 262];
const MIST = [-235, -178, -122, -68, 68, 122, 178, 235];

const SHARDS: { p: string; tx: number; ty: number; tr: number }[] = [
  { p: "316,84 320,78 322,88", tx: -46, ty: -30, tr: -160 },
  { p: "322,86 326,82 325,92", tx: 52, ty: -24, tr: 200 },
  { p: "315,96 319,92 320,102", tx: -58, ty: 14, tr: -220 },
  { p: "321,98 326,96 324,106", tx: 60, ty: 22, tr: 180 },
  { p: "317,106 321,104 319,113", tx: -30, ty: 52, tr: -120 },
  { p: "321,108 325,106 324,114", tx: 34, ty: 58, tr: 140 },
];

const PUFFS: { x: number; d: number; delay: number; px: number }[] = [
  { x: 120, d: 2.4, delay: 0, px: -14 },
  { x: 196, d: 2.9, delay: -1.1, px: 10 },
  { x: 268, d: 2.2, delay: -0.5, px: -6 },
  { x: 344, d: 2.7, delay: -1.6, px: 12 },
  { x: 418, d: 2.5, delay: -0.9, px: -10 },
  { x: 492, d: 3.0, delay: -2.0, px: 16 },
];

const vars = (v: Record<string, string>) => v as CSSProperties;

export function HeroScene() {
  return (
    <div className="lp-scene">
      <div className="lp-scene-bar">
        <span className="lp-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <b>Level 17</b>
        <em>Zone A · OH1</em>
        <span className="lp-status" aria-hidden="true">
          <span className="s1">HEAT RISING</span>
          <span className="s2">HEAD OPERATED</span>
          <span className="s3">FIRE CONTROLLED</span>
        </span>
      </div>
      <svg
        viewBox="0 0 640 520"
        role="img"
        aria-label="A sprinkler head operating over a fire"
      >
        <defs>
          <radialGradient id="lp-g-glow" cx="50%" cy="100%" r="75%">
            <stop offset="0" stopColor="#ffb21a" stopOpacity="0.75" />
            <stop offset="0.45" stopColor="#e3170a" stopOpacity="0.42" />
            <stop offset="1" stopColor="#e3170a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="lp-g-pipe" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff5a4d" />
            <stop offset="0.35" stopColor="#d81a12" />
            <stop offset="1" stopColor="#7c0a0f" />
          </linearGradient>
          <linearGradient id="lp-g-brass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffe6a3" />
            <stop offset="0.5" stopColor="#d9a441" />
            <stop offset="1" stopColor="#8a5f17" />
          </linearGradient>
          <linearGradient id="lp-g-flame-out" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#ff6a1a" />
            <stop offset="0.6" stopColor="#e3170a" />
            <stop offset="1" stopColor="#8f0d12" />
          </linearGradient>
          <linearGradient id="lp-g-flame-mid" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#ffd24a" />
            <stop offset="1" stopColor="#ff6a1a" />
          </linearGradient>
        </defs>

        {/* The drawing behind: grid, walls, head symbols. */}
        <g stroke="rgba(255,244,238,0.07)" strokeWidth="1">
          {Array.from({ length: 12 }, (_, i) => (
            <line
              key={`v${i}`}
              x1={40 + i * 51}
              y1="46"
              x2={40 + i * 51}
              y2="520"
            />
          ))}
          {Array.from({ length: 9 }, (_, i) => (
            <line
              key={`h${i}`}
              x1="0"
              y1={90 + i * 51}
              x2="640"
              y2={90 + i * 51}
            />
          ))}
        </g>
        <g fill="none" stroke="rgba(255,244,238,0.16)" strokeWidth="2">
          <path d="M36 214H250V352H36M390 214H604V352H390M250 270H390" />
        </g>
        <g fill="none" stroke="rgba(255,120,90,0.4)" strokeWidth="1.5">
          {[92, 194, 446, 548].map((x) => (
            <g key={x}>
              <circle cx={x} cy="284" r="6" />
              <path d={`M${x - 10} 284H${x + 10}M${x} 274V294`} />
            </g>
          ))}
        </g>

        {/* Heat. */}
        <ellipse
          className="lp-glow"
          cx="320"
          cy="520"
          rx="330"
          ry="250"
          fill="url(#lp-g-glow)"
        />

        {/* Water: streams leave the deflector flat and fall. */}
        <g className="lp-water">
          {STREAMS.map((dx) => (
            <path
              key={dx}
              className="lp-stream"
              d={`M320 172Q${320 + dx} 177 ${320 + dx} 500`}
            />
          ))}
          {MIST.map((dx) => (
            <path
              key={dx}
              className="lp-mist"
              d={`M320 172Q${320 + dx} 182 ${320 + dx} 478`}
            />
          ))}
          <ellipse
            className="lp-cov"
            style={vars({ "--ox": "320px", "--oy": "502px" })}
            cx="320"
            cy="502"
            rx="278"
            ry="15"
            fill="rgba(111,211,255,0.14)"
            stroke="#6fd3ff"
            strokeWidth="2"
            strokeDasharray="6 6"
          />
        </g>

        {/* Steam, once the water reaches the fire. */}
        <g className="lp-steam" fill="rgba(255,244,238,0.5)">
          {PUFFS.map((p) => (
            <rect
              key={p.x}
              className="lp-puff"
              style={vars({
                "--pd": `${p.d}s`,
                "--pdelay": `${p.delay}s`,
                "--px": `${p.px}px`,
              })}
              x={p.x}
              y="430"
              width="16"
              height="16"
            />
          ))}
        </g>

        {/* The fire. */}
        <g className="lp-fire">
          {FLAMES.map((f) => (
            <g key={f.x} transform={`translate(${f.x} 520) scale(${f.s})`}>
              <g
                className="lp-flame"
                style={vars({ "--fd": `${f.d}s`, "--fdelay": `${f.delay}s` })}
              >
                <path d={FLAME} fill="url(#lp-g-flame-out)" />
                <g
                  className="lp-flame"
                  style={vars({
                    "--fd": `${f.d * 0.7}s`,
                    "--fdelay": `${f.delay * 1.7}s`,
                  })}
                >
                  <path
                    d={FLAME}
                    fill="url(#lp-g-flame-mid)"
                    transform="scale(0.66)"
                  />
                  <path d={FLAME} fill="#fff1b8" transform="scale(0.34)" />
                </g>
              </g>
            </g>
          ))}
        </g>
        <rect x="0" y="512" width="640" height="8" fill="#1b0e0f" />

        {/* The pipe and the head. */}
        <rect x="0" y="16" width="640" height="30" fill="url(#lp-g-pipe)" />
        <rect
          x="0"
          y="16"
          width="640"
          height="30"
          fill="none"
          stroke="#fff4ee"
          strokeWidth="2"
        />
        {[118, 500].map((x) => (
          <rect
            key={x}
            x={x}
            y="10"
            width="24"
            height="42"
            fill="#5c0709"
            stroke="#fff4ee"
            strokeWidth="2"
          />
        ))}
        <rect
          x="296"
          y="10"
          width="48"
          height="44"
          fill="#a50f12"
          stroke="#fff4ee"
          strokeWidth="2"
        />
        <rect
          x="309"
          y="54"
          width="22"
          height="10"
          fill="#7c0a0f"
          stroke="#fff4ee"
          strokeWidth="2"
        />
        {/* The head, drawn at 1.5x about the end of the drop pipe. */}
        <g transform="translate(320 60) scale(1.5) translate(-320 -60)">
          <rect
            x="302"
            y="62"
            width="36"
            height="12"
            fill="url(#lp-g-brass)"
            stroke="#2a1500"
            strokeWidth="1.5"
          />
          <path
            d="M307 74C296 92 299 112 313 120M333 74C344 92 341 112 327 120"
            fill="none"
            stroke="url(#lp-g-brass)"
            strokeWidth="5"
          />
          <rect x="313" y="116" width="14" height="8" fill="url(#lp-g-brass)" />
          <rect
            x="282"
            y="124"
            width="76"
            height="6"
            fill="url(#lp-g-brass)"
            stroke="#2a1500"
            strokeWidth="1"
          />
          {Array.from({ length: 10 }, (_, i) => (
            <rect
              key={i}
              x={284 + i * 7.6}
              y="130"
              width="4"
              height="5"
              fill="#d9a441"
            />
          ))}

          {/* The glass bulb: intact, then gone. */}
          <g className="lp-bulb">
            <rect
              x="315.5"
              y="76"
              width="9"
              height="40"
              rx="4"
              fill="rgba(255,255,255,0.22)"
              stroke="#fff4ee"
              strokeWidth="1.2"
            />
            <rect
              className="lp-bulb-liquid"
              x="317.5"
              y="84"
              width="5"
              height="30"
              rx="2.5"
            />
          </g>
          <g fill="#ffe9e4">
            {SHARDS.map((s) => (
              <polygon
                key={s.p}
                className="lp-shard"
                style={vars({
                  "--tx": `${s.tx}px`,
                  "--ty": `${s.ty}px`,
                  "--tr": `${s.tr}deg`,
                })}
                points={s.p}
              />
            ))}
          </g>
          <rect
            className="lp-flash"
            x="306"
            y="82"
            width="28"
            height="28"
            fill="none"
            stroke="#fff1b8"
            strokeWidth="3"
          />
        </g>
        <g className="lp-bulb">
          <path
            d="M338 114H404"
            stroke="rgba(255,244,238,0.6)"
            strokeWidth="1"
          />
          <text
            x="410"
            y="118"
            fill="#fff4ee"
            fontSize="13"
            fontWeight="700"
            letterSpacing="0.6"
          >
            68 °C GLASS BULB
          </text>
        </g>
      </svg>
    </div>
  );
}

/** A row of flames for the closing band. */
export function FlameRow() {
  const xs = Array.from({ length: 19 }, (_, i) => 30 + i * 64);
  return (
    <svg
      className="lp-cta-flames"
      viewBox="0 0 1200 150"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      {xs.map((x, i) => (
        <g
          key={x}
          transform={`translate(${x} 152) scale(${0.62 + ((i * 7) % 5) * 0.11})`}
        >
          <g
            className="lp-flame"
            style={vars({
              "--fd": `${0.9 + ((i * 3) % 5) * 0.12}s`,
              "--fdelay": `${-((i * 5) % 9) * 0.13}s`,
            })}
          >
            <path d={FLAME} fill="#ffb21a" />
            <path d={FLAME} fill="#ffe27a" transform="scale(0.6)" />
            <path d={FLAME} fill="#fff7dc" transform="scale(0.3)" />
          </g>
        </g>
      ))}
    </svg>
  );
}

// Inlines the ES modules into one self-contained dist/demo.html (no external scripts).
// The sample zones come from fixtures/zones/*.json (inlined as data into the Zones block).
// Each module becomes its own <script> block wrapped in an IIFE that returns its exports, so the
// placer and the oracle stay visibly separate (the oracle block references no other module).
// Usage: node build.mjs

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const MODULES = [
  ['rules.js', 'Rules', 'Rule set nzs4541 v1 (data)'],
  ['zones.js', 'Zones', 'Sample zones'],
  ['geometry.js', 'Geometry', 'Placer geometry kernel'],
  ['placer.js', 'Placer', 'PLACER — frame search x bay decomposition x row sweep with exact 1-D DP'],
  ['oracle.js', 'Oracle', 'ORACLE — independent checker (imports nothing; own kernel, own 100 mm lattice)'],
  ['site.js', 'Site', 'Composition layer (stands in for the engine worker)'],
];
const nsOf = Object.fromEntries(MODULES.map(([f, ns]) => [f, ns]));

function wrap(file, ns, title) {
  let src = readFileSync(path.join(root, 'src', file), 'utf8');
  if (file === 'zones.js') {
    const dir = path.join(root, '..', '..', 'fixtures', 'zones');
    const docs = readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
    src += `
export const SAMPLES = samplesFromFixtures(${JSON.stringify(docs)});
`;
  }
  const exportsList = [];
  src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*'\.\/([\w.]+)';?\s*$/gms, (_, names, from) => {
    if (!nsOf[from]) throw new Error(`${file}: unknown import ${from}`);
    return `const {${names}} = ${nsOf[from]};`;
  });
  if (/^\s*import\s/m.test(src)) throw new Error(`${file}: unhandled import`);
  src = src.replace(/^export\s+(function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (_, kind, name) => { exportsList.push(name); return `${kind} ${name}`; });
  if (/^export\s/m.test(src)) throw new Error(`${file}: unhandled export`);
  if (file === 'oracle.js' && /\b(Placer|Geometry|Site)\b/.test(src)) throw new Error('oracle must not reference other modules');
  return `<script>\n/* ===== ${title} — src/${file} ===== */\nconst ${ns} = (() => {\n${src}\nreturn { ${exportsList.join(', ')} };\n})();\n</script>`;
}

const blocks = MODULES.map(([f, ns, t]) => wrap(f, ns, t)).join('\n');
const app = `<script>\n/* ===== Demo UI — demo/app.js ===== */\n${readFileSync(path.join(root, 'demo', 'app.js'), 'utf8')}\n</script>`;
const tpl = readFileSync(path.join(root, 'demo', 'template.html'), 'utf8');
const html = tpl.replace('<!--MODULES-->', `${blocks}\n${app}`);
mkdirSync(path.join(root, 'dist'), { recursive: true });
writeFileSync(path.join(root, 'dist', 'demo.html'), html);
console.log(`dist/demo.html written (${(html.length / 1024).toFixed(0)} KB)`);

// Demo UI for the placement spike. Uses the inlined modules: Rules, Zones, Placer, Oracle, Site.
(() => {
  const RS = Rules.NZS4541_V1;
  const now = () => performance.now();
  const $ = id => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');

  // ---- state ------------------------------------------------------------------------------------
  const clone = o => JSON.parse(JSON.stringify(o));
  const samples = Zones.SAMPLES.map(s => ({ ...clone(s), results: null }));
  const S = { cur: 0, active: 0, cov: 'circle', drawing: null, drag: null, hover: null, focus: null };

  const ringOf = h => (Array.isArray(h) ? h : h.ring);   // holes: bare ring or {kind, ring}

  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  // ---- placement / checking ---------------------------------------------------------------------
  function runSample(s) {
    const zones = s.zones.map(z => ({ ...z, locked: z.lockedHeads || [] }));
    const site = Site.runSite(zones, RS, { now });
    s.results = site;
    return site;
  }
  function recheck(s) {
    for (const p of s.results) p.report = Site.checkOne(p, s.results, RS, now);
  }
  function statusOf(s) {
    if (!s.results) return { cls: 'wait', text: '…', icon: '' };
    if (s.infeasible) {
      const ok = s.results.every(p => !p.res.ok && p.res.error);
      return ok ? { cls: 'fail', text: 'no layout', icon: '✕' } : { cls: 'warn', text: 'check', icon: '⚠' };
    }
    const err = s.results.reduce((a, p) => a + (p.report ? p.report.errors : 0) + (p.res.ok ? 0 : 1), 0);
    const warn = s.results.reduce((a, p) => a + (p.report ? p.report.warnings : 0), 0);
    if (err) return { cls: 'fail', text: 'FAIL', icon: '✕' };
    if (warn) return { cls: 'warn', text: 'WARN', icon: '⚠' };
    return { cls: 'ok', text: 'PASS', icon: '✓' };
  }
  const headCount = s => (s.results ? s.results.reduce((a, p) => a + p.res.heads.length, 0) : null);

  // ---- list ---------------------------------------------------------------------------------------
  const GROUPS = { NFR9: 'NFR9 zones', named: 'Named test zones', shapes: 'Shapes & cases', infeasible: 'Infeasible inputs', custom: 'Drawn by you' };
  function renderList() {
    const ul = $('list'); ul.textContent = '';
    let lastGroup = null;
    samples.forEach((s, i) => {
      if (s.group !== lastGroup) {
        lastGroup = s.group;
        const g = document.createElement('li'); g.className = 'grp'; g.textContent = GROUPS[s.group] || s.group; ul.appendChild(g);
      }
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-current', i === S.cur ? 'true' : 'false');
      const st = statusOf(s), n = headCount(s);
      const hz = [...new Set(s.zones.map(z => z.hazard))].join(' + ');
      b.innerHTML = `<span class="nm"></span><span class="chip ${st.cls}">${st.icon} ${st.text}</span><span class="meta"></span>`;
      b.querySelector('.nm').textContent = s.name;
      b.querySelector('.meta').textContent = `${hz} · ${n == null ? '…' : n + ' head' + (n === 1 ? '' : 's')}`;
      b.addEventListener('click', () => select(i));
      li.appendChild(b); ul.appendChild(li);
    });
  }

  function select(i) {
    S.cur = i; S.active = 0; S.focus = null;
    const s = samples[i];
    if (!s.results) { busy(true); setTimeout(() => { runSample(s); busy(false); refresh(true); }, 20); }
    refresh(true);
  }
  function busy(on) { $('busy').hidden = !on; }

  // ---- controls -----------------------------------------------------------------------------------
  function activeZone() { return samples[S.cur].zones[S.active]; }
  function syncControls() {
    const z = activeZone(); if (!z) return;
    const f = RS.hazards[z.hazard];
    $('hazard').value = z.hazard;
    $('pattern').value = z.pattern || 'rectangular';
    const sp = $('sp'), wd = $('wd');
    sp.min = f.Smin * 1000; sp.max = f.Smax * 1000;
    wd.min = Math.max(100, f.Wmin * 1000); wd.max = f.Wmax * 1000;
    $('spOn').checked = !!z.prefs?.spacing; $('wdOn').checked = !!z.prefs?.wallDist;
    sp.value = z.prefs?.spacing || Math.round(f.Smax * 800); wd.value = z.prefs?.wallDist || Math.round(f.Wmax * 600);
    sp.disabled = !$('spOn').checked; wd.disabled = !$('wdOn').checked;
    $('spOut').textContent = $('spOn').checked ? (sp.value / 1000).toFixed(2) + ' m' : 'auto';
    $('wdOut').textContent = $('wdOn').checked ? (wd.value / 1000).toFixed(2) + ' m' : 'auto';
  }
  function readControls() {
    const z = activeZone();
    z.hazard = $('hazard').value;
    z.pattern = $('pattern').value;
    const f = RS.hazards[z.hazard];
    const sp = $('sp'), wd = $('wd');
    sp.min = f.Smin * 1000; sp.max = f.Smax * 1000; wd.max = f.Wmax * 1000;
    z.prefs = { spacing: $('spOn').checked ? +sp.value : null, wallDist: $('wdOn').checked ? +wd.value : null };
    syncControls();
  }
  ['hazard', 'pattern'].forEach(id => $(id).addEventListener('change', () => { readControls(); place(); }));
  ['spOn', 'wdOn'].forEach(id => $(id).addEventListener('change', () => { readControls(); place(); }));
  ['sp', 'wd'].forEach(id => {
    $(id).addEventListener('input', () => { readControls(); });
    $(id).addEventListener('change', () => { readControls(); place(); });
  });
  $('cov').addEventListener('change', e => { S.cov = e.target.value; draw(); });
  $('place').addEventListener('click', () => place());
  $('reset').addEventListener('click', () => { samples[S.cur].zones.forEach(z => { z.lockedHeads = []; }); place(); });
  $('draw').addEventListener('click', () => (S.drawing ? cancelDraw() : startDraw()));

  function place() {
    const s = samples[S.cur];
    busy(true);
    setTimeout(() => { runSample(s); busy(false); refresh(false); }, 20);
  }

  // ---- view transform -------------------------------------------------------------------------------
  let view = { s: 0.05, cx: 0, cy: 0, w: 0, h: 0 };
  function fit() {
    const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.w = r.width; view.h = r.height;
    let pts;
    if (S.drawing) pts = [{ x: 0, y: 0 }, { x: 24000, y: 16000 }];
    else pts = samples[S.cur].zones.flatMap(z => z.outer);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const pad = 46;
    view.s = Math.min((view.w - 2 * pad) / Math.max(x1 - x0, 1000), (view.h - 2 * pad - 20) / Math.max(y1 - y0, 1000));
    view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2;
    view.box = { x0, y0, x1, y1 };
  }
  const W2S = p => ({ x: view.w / 2 + (p.x - view.cx) * view.s, y: (view.h - 20) / 2 - (p.y - view.cy) * view.s });
  const S2W = (x, y) => ({ x: view.cx + (x - view.w / 2) / view.s, y: view.cy - (y - (view.h - 20) / 2) / view.s });

  // ---- drawing -------------------------------------------------------------------------------------
  function path(ring) { ring.forEach((p, i) => { const q = W2S(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.closePath(); }

  function draw() {
    const C = { bg: cssVar('--bg'), zone: cssVar('--zone'), wall: cssVar('--wall'), hole: cssVar('--hole'), grid: cssVar('--grid'),
      muted: cssVar('--muted'), fg: cssVar('--fg'), cov: cssVar('--cov'), covLine: cssVar('--cov-line'), head: cssVar('--head'),
      warn: cssVar('--warn'), danger: cssVar('--danger'), accent: cssVar('--accent'), line: cssVar('--line') };
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, view.w, view.h);
    drawGrid(C);
    if (S.drawing) { drawDraft(C); drawScale(C); return; }
    const s = samples[S.cur];
    s.zones.forEach((z, zi) => {
      ctx.beginPath(); path(z.outer); (z.holes || []).forEach(h => path(ringOf(h)));
      ctx.fillStyle = C.zone; ctx.fill('evenodd');
      if (z.grid) drawTiles(z, C);
    });
    // coverage overlay (per-head polygons from the oracle module; visual only)
    if (s.results && S.cov !== 'off') {
      s.results.forEach(p => {
        if (!p.res.heads.length) return;
        const frame = (p.res.notes?.frameDeg || 0) * Math.PI / 180;
        const polys = Oracle.coveragePolygons(p.zone, p.res.heads, RS, p.zone.hazard, S.cov, frame, 72);
        ctx.fillStyle = C.cov; ctx.strokeStyle = C.covLine; ctx.lineWidth = 0.8;
        for (const poly of polys) { ctx.beginPath(); path(poly.pts); ctx.fill(); ctx.stroke(); }
      });
    }
    s.zones.forEach((z, zi) => {
      // holes
      (z.holes || []).forEach(h => { ctx.beginPath(); path(ringOf(h)); ctx.fillStyle = C.hole; ctx.fill(); ctx.strokeStyle = C.wall; ctx.lineWidth = 1.5; ctx.stroke(); });
      // walls (open edges dashed)
      const r = z.outer;
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length];
        const open = (z.openEdges || []).some(o => near(a, o) && near(b, o));
        const A = W2S(a), B = W2S(b);
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
        ctx.setLineDash(open ? [6, 5] : []);
        ctx.strokeStyle = open ? C.muted : C.wall; ctx.lineWidth = open ? 1.2 : (zi === S.active && s.zones.length > 1 ? 2.6 : 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      if (s.zones.length > 1) {
        const c = W2S(centroid(z.outer));
        ctx.fillStyle = C.muted; ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`${z.zoneId} · ${z.hazard}`, c.x, c.y);
      }
    });
    drawDims(C);
    if (s.results) {
      s.results.forEach(p => {
        for (const h of p.res.heads) drawHead(h, C, S.drag && S.drag.h === h, S.hover === h);
        // flags
        if (p.report) for (const f of p.report.flags) if (f.where) drawFlag(f, C);
        if (!p.res.ok && p.res.error) {
          const pts = (p.res.error.where || []).slice(0, 20);
          for (const w of pts) drawCross(W2S(w), C.danger, 7);
          if (p.res.error.outline) { ctx.beginPath(); path(p.res.error.outline); ctx.strokeStyle = C.danger; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]); }
        }
      });
    }
    if (S.focus) { const q = W2S(S.focus); ctx.beginPath(); ctx.arc(q.x, q.y, 16, 0, Math.PI * 2); ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.stroke(); }
    drawScale(C);
  }
  function near(p, o) {
    const dx = o.b.x - o.a.x, dy = o.b.y - o.a.y, L2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((p.x - o.a.x) * dx + (p.y - o.a.y) * dy) / L2));
    return Math.hypot(o.a.x + t * dx - p.x, o.a.y + t * dy - p.y) < 2;
  }
  function centroid(r) { let x = 0, y = 0; r.forEach(p => { x += p.x; y += p.y; }); return { x: x / r.length, y: y / r.length }; }

  function drawGrid(C) {
    // 1 m drafting grid
    const a = S2W(0, view.h), b = S2W(view.w, 0);
    const step = view.s * 1000 < 8 ? 5000 : 1000;
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(a.x / step) * step; x <= b.x; x += step) { const q = W2S({ x, y: 0 }); ctx.moveTo(Math.round(q.x) + 0.5, 0); ctx.lineTo(Math.round(q.x) + 0.5, view.h); }
    for (let y = Math.ceil(a.y / step) * step; y <= b.y; y += step) { const q = W2S({ x: 0, y }); ctx.moveTo(0, Math.round(q.y) + 0.5); ctx.lineTo(view.w, Math.round(q.y) + 0.5); }
    ctx.stroke();
  }
  function drawTiles(z, C) {
    const g = z.grid;
    ctx.save(); ctx.beginPath(); path(z.outer); ctx.clip();
    ctx.strokeStyle = C.line; ctx.lineWidth = 0.7; ctx.beginPath();
    const bb = view.box;
    for (let x = g.originX + Math.floor((bb.x0 - g.originX) / g.pitchX) * g.pitchX; x <= bb.x1; x += g.pitchX) { const p = W2S({ x, y: bb.y0 }), q = W2S({ x, y: bb.y1 }); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }
    for (let y = g.originY + Math.floor((bb.y0 - g.originY) / g.pitchY) * g.pitchY; y <= bb.y1; y += g.pitchY) { const p = W2S({ x: bb.x0, y }), q = W2S({ x: bb.x1, y }); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }
    ctx.stroke(); ctx.restore();
  }
  function drawHead(h, C, dragging, hover) {
    const q = W2S(h);
    const r = Math.max(4, Math.min(7, view.s * 120));
    ctx.lineWidth = 1.6;
    if (h.kind === 'gapFill') {
      ctx.fillStyle = C.warn; ctx.fillRect(q.x - r, q.y - r, 2 * r, 2 * r);
      ctx.strokeStyle = C.bg; ctx.strokeRect(q.x - r, q.y - r, 2 * r, 2 * r);
    } else {
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      ctx.fillStyle = C.head; ctx.fill(); ctx.strokeStyle = C.bg; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(q.x - r * 0.55, q.y); ctx.lineTo(q.x + r * 0.55, q.y); ctx.moveTo(q.x, q.y - r * 0.55); ctx.lineTo(q.x, q.y + r * 0.55);
      ctx.strokeStyle = C.bg; ctx.lineWidth = 1.2; ctx.stroke();
    }
    if (h.kind === 'locked') { ctx.beginPath(); ctx.arc(q.x, q.y, r + 3.5, 0, Math.PI * 2); ctx.strokeStyle = C.fg; ctx.lineWidth = 1.6; ctx.stroke(); }
    if (dragging || hover) {
      ctx.beginPath(); ctx.arc(q.x, q.y, r + 6, 0, Math.PI * 2); ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = C.fg; ctx.font = '500 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`${(h.x / 1000).toFixed(2)}, ${(h.y / 1000).toFixed(2)} m`, q.x + r + 8, q.y - r - 4);
    }
  }
  function drawCross(q, color, r) {
    ctx.beginPath(); ctx.moveTo(q.x - r, q.y - r); ctx.lineTo(q.x + r, q.y + r); ctx.moveTo(q.x + r, q.y - r); ctx.lineTo(q.x - r, q.y + r);
    ctx.strokeStyle = cssVar('--bg'); ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.stroke();
  }
  function drawFlag(f, C) {
    const q = W2S(f.where);
    if (f.severity === 'error') drawCross(q, C.danger, 7);
    else if (f.code !== 'AREA_ZONE') {
      ctx.fillStyle = C.warn; ctx.font = '700 13px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('⚠', q.x + 11, q.y - 8);
    }
  }
  function drawDims(C) {
    const b = view.box;
    const A = W2S({ x: b.x0, y: b.y0 }), B = W2S({ x: b.x1, y: b.y0 }), T = W2S({ x: b.x0, y: b.y1 });
    ctx.strokeStyle = C.muted; ctx.fillStyle = C.muted; ctx.lineWidth = 1;
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    const yb = A.y + 18;
    ctx.beginPath(); ctx.moveTo(A.x, yb); ctx.lineTo(B.x, yb); ctx.moveTo(A.x, yb - 4); ctx.lineTo(A.x, yb + 4); ctx.moveTo(B.x, yb - 4); ctx.lineTo(B.x, yb + 4); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillText(`${((b.x1 - b.x0) / 1000).toFixed(2)} m`, (A.x + B.x) / 2, yb - 4);
    const xl = A.x - 18;
    ctx.beginPath(); ctx.moveTo(xl, A.y); ctx.lineTo(xl, T.y); ctx.moveTo(xl - 4, A.y); ctx.lineTo(xl + 4, A.y); ctx.moveTo(xl - 4, T.y); ctx.lineTo(xl + 4, T.y); ctx.stroke();
    ctx.save(); ctx.translate(xl - 4, (A.y + T.y) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(`${((b.y1 - b.y0) / 1000).toFixed(2)} m`, 0, 0); ctx.restore();
  }
  function drawScale(C) {
    const target = 120 / view.s;
    const opts = [500, 1000, 2000, 5000, 10000];
    const len = opts.reduce((a, v) => (Math.abs(v - target) < Math.abs(a - target) ? v : a), opts[0]);
    const px = len * view.s, x = 12, y = view.h - 12;
    ctx.fillStyle = C.fg; ctx.strokeStyle = C.fg; ctx.lineWidth = 1;
    ctx.fillRect(x, y - 5, px / 2, 5); ctx.strokeRect(x + 0.5, y - 5.5, px, 5);
    ctx.font = '500 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`0`, x, y - 9); ctx.textAlign = 'right'; ctx.fillText(`${len / 1000} m`, x + px, y - 9);
  }

  // ---- drawing your own zone -------------------------------------------------------------------------
  function startDraw() {
    S.drawing = { pts: [], cursor: null };
    $('draw').setAttribute('aria-pressed', 'true'); $('draw').textContent = 'Cancel drawing';
    refresh(true);
  }
  function cancelDraw() {
    S.drawing = null;
    $('draw').setAttribute('aria-pressed', 'false'); $('draw').textContent = 'Draw zone';
    refresh(true);
  }
  function finishDraw() {
    const pts = S.drawing.pts;
    if (pts.length < 3) return;
    const hazard = $('hazard').value;
    const n = samples.filter(s => s.group === 'custom').length + 1;
    const s = { id: `MY${n}`, name: `My zone ${n}`, group: 'custom', results: null,
      zones: [{ zoneId: `MY${n}`, hazard, pattern: $('pattern').value, outer: pts.map(p => ({ ...p })) }] };
    samples.push(s);
    cancelDraw();
    select(samples.length - 1);
  }
  function drawDraft(C) {
    const d = S.drawing;
    const pts = d.cursor ? d.pts.concat([d.cursor]) : d.pts;
    if (pts.length) {
      ctx.beginPath(); pts.forEach((p, i) => { const q = W2S(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
      ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.stroke();
      d.pts.forEach(p => { const q = W2S(p); ctx.fillStyle = C.accent; ctx.fillRect(q.x - 3, q.y - 3, 6, 6); });
    }
    if (d.cursor) {
      const q = W2S(d.cursor);
      ctx.fillStyle = C.fg; ctx.font = '500 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'left';
      let t = `${(d.cursor.x / 1000).toFixed(1)}, ${(d.cursor.y / 1000).toFixed(1)} m`;
      const l = d.pts[d.pts.length - 1];
      if (l) t += `  ·  segment ${(Math.hypot(d.cursor.x - l.x, d.cursor.y - l.y) / 1000).toFixed(2)} m`;
      ctx.fillText(t, q.x + 10, q.y - 10);
    }
  }

  // ---- pointer interaction ------------------------------------------------------------------------------
  function hitHead(mx, my) {
    const s = samples[S.cur]; if (!s.results) return null;
    let best = null, bd = 14;
    s.results.forEach((p, zi) => p.res.heads.forEach(h => { const q = W2S(h); const d = Math.hypot(q.x - mx, q.y - my); if (d < bd) { bd = d; best = { h, p, zi }; } }));
    return best;
  }
  const snap = (v, g) => Math.round(v / g) * g;
  function local(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  let rafPending = false;
  function scheduleRecheck() {
    if (rafPending) return; rafPending = true;
    requestAnimationFrame(() => { rafPending = false; recheck(samples[S.cur]); renderReport(); draw(); });
  }
  cv.addEventListener('pointerdown', e => {
    const m = local(e);
    if (S.drawing) {
      const w = S2W(m.x, m.y), p = { x: snap(w.x, 100), y: snap(w.y, 100) };
      const pts = S.drawing.pts;
      if (pts.length >= 3 && Math.hypot(W2S(pts[0]).x - m.x, W2S(pts[0]).y - m.y) < 10) { finishDraw(); return; }
      const l = pts[pts.length - 1];
      if (!l || l.x !== p.x || l.y !== p.y) pts.push(p);
      draw(); return;
    }
    const hit = hitHead(m.x, m.y);
    if (hit) {
      S.drag = hit; S.active = hit.zi; cv.setPointerCapture(e.pointerId); syncControls(); renderTabs();
      return;
    }
    // click a zone to make it active (multi-zone samples)
    const w = S2W(m.x, m.y);
    const zi = samples[S.cur].zones.findIndex(z => Geometry.pointInRing(w, z.outer));
    if (zi >= 0 && zi !== S.active) { S.active = zi; syncControls(); renderTabs(); renderReport(); draw(); }
  });
  cv.addEventListener('pointermove', e => {
    const m = local(e);
    if (S.drawing) { const w = S2W(m.x, m.y); S.drawing.cursor = { x: snap(w.x, 100), y: snap(w.y, 100) }; draw(); return; }
    if (S.drag) {
      const w = S2W(m.x, m.y);
      S.drag.h.x = snap(w.x, 10); S.drag.h.y = snap(w.y, 10);
      draw(); scheduleRecheck(); return;
    }
    const hit = hitHead(m.x, m.y);
    const h = hit ? hit.h : null;
    cv.style.cursor = h ? 'grab' : 'default';
    if (h !== S.hover) { S.hover = h; draw(); }
  });
  cv.addEventListener('pointerup', () => {
    if (!S.drag) return;
    const { h, p } = S.drag;
    h.kind = 'locked';
    p.zone.lockedHeads = p.res.heads.filter(x => x.kind === 'locked').map(x => ({ id: x.id, x: x.x, y: x.y }));
    samples[S.cur].zones[S.drag.zi].lockedHeads = p.zone.lockedHeads;
    S.drag = null;
    recheck(samples[S.cur]); renderReport(); renderList(); draw();
  });
  cv.addEventListener('dblclick', e => { if (S.drawing) { e.preventDefault(); finishDraw(); } });
  window.addEventListener('keydown', e => {
    if (!S.drawing) return;
    if (e.key === 'Enter') finishDraw();
    else if (e.key === 'Escape') cancelDraw();
    else if (e.key === 'Backspace') { S.drawing.pts.pop(); draw(); }
  });

  // ---- report ---------------------------------------------------------------------------------------------
  const m2 = v => (v == null || !isFinite(v) ? '–' : v.toFixed(2));
  function renderTabs() {
    const s = samples[S.cur], el = $('zonetabs');
    el.hidden = s.zones.length < 2 || !!S.drawing;
    el.textContent = '';
    if (el.hidden) return;
    const lab = document.createElement('span'); lab.textContent = 'Zone:'; lab.style.color = 'var(--muted)'; el.appendChild(lab);
    s.zones.forEach((z, i) => {
      const b = document.createElement('button'); b.type = 'button';
      b.textContent = `${z.zoneId} (${z.hazard})`; b.setAttribute('aria-pressed', i === S.active ? 'true' : 'false');
      b.addEventListener('click', () => { S.active = i; syncControls(); renderTabs(); renderReport(); draw(); });
      el.appendChild(b);
    });
  }
  function renderReport() {
    const el = $('report'); el.textContent = '';
    const s = samples[S.cur];
    if (S.drawing) {
      el.innerHTML = `<p class="empty">Click on the plan to add corners (snapped to 100 mm on the 1 m grid). Double-click, press Enter or click the first corner to close the outline. Backspace removes the last corner, Escape cancels. Heads are placed with the hazard and pattern chosen above.</p>`;
      return;
    }
    if (!s.results) { el.innerHTML = '<p class="empty">Placing heads…</p>'; return; }
    const p = s.results[S.active] || s.results[0];
    const z = p.zone, r = p.report, res = p.res, f = RS.hazards[z.hazard];
    const errs = r ? r.flags.filter(x => x.severity === 'error') : [];
    const warns = r ? r.flags.filter(x => x.severity === 'warning') : [];
    const v = document.createElement('div');
    if (!res.ok && res.error && !res.heads.length) {
      v.className = 'verdict fail';
      v.innerHTML = `<span class="big">✕</span><span>No layout · ${res.error.code}<small></small></span>`;
      v.querySelector('small').textContent = res.error.message;
    } else if (errs.length || !res.ok) {
      v.className = 'verdict fail';
      v.innerHTML = `<span class="big">✕</span><span>Checker: ${errs.length} error${errs.length === 1 ? '' : 's'}<small>Hard rules broken; see the ✕ marks on the plan.</small></span>`;
    } else if (warns.length) {
      v.className = 'verdict warn';
      v.innerHTML = `<span class="big">⚠</span><span>Pass with ${warns.length} warning${warns.length === 1 ? '' : 's'}<small>All hard rules met. Area-per-head warnings are advisory.</small></span>`;
    } else {
      v.className = 'verdict ok';
      v.innerHTML = `<span class="big">✓</span><span>Pass<small>Independent checker found no errors or warnings.</small></span>`;
    }
    el.appendChild(v);

    const dl = (title, rows) => {
      const sec = document.createElement('div'); sec.className = 'sec'; sec.textContent = title; el.appendChild(sec);
      const d = document.createElement('dl');
      for (const [k, val, cls] of rows) { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = val; if (cls) dd.className = cls; d.append(dt, dd); }
      el.appendChild(d);
    };
    const Rc = 0.5 * Math.sqrt(f.Smax ** 2 + (f.Amax / f.Smax) ** 2);
    dl(`Rules · ${z.hazard} · ${RS.id} v${RS.version}${RS.verified ? ' (verified)' : ''}`, [
      ['Max area / head', `${f.Amax} m²`], ['Spacing', `${f.Smin.toFixed(2)} – ${f.Smax.toFixed(2)} m`],
      ['Wall distance', `${(f.Wmin * 1000).toFixed(0)} mm – ${f.Wmax.toFixed(2)} m`], ['Coverage radius Rc', `${Rc.toFixed(2)} m`],
    ]);
    if (r && res.heads.length) {
      const lb = Math.ceil(r.areaM2 / f.Amax - 1e-9);
      dl('Layout', [
        ['Heads', `${r.headCount}  (area bound ${lb})`],
        ['Zone area', `${m2(r.areaM2)} m²`],
        ['Area / head', `${m2(r.areaPerHeadM2)} m²`, r.areaPerHeadM2 > f.Amax ? 'near' : ''],
        ['Largest local cell', `${m2(r.maxLocalAreaM2)} m²`, r.maxLocalAreaM2 > f.Amax ? 'near' : ''],
        ['Spacing min / max', `${m2(r.minSpacingM)} / ${m2(r.maxNNSpacingM)} m`, (r.minSpacingM != null && r.minSpacingM < f.Smin - 0.001) || (r.maxNNSpacingM > f.Smax + 0.001) ? 'bad' : ''],
        ['Wall distance worst', isFinite(r.worstWallDistM) ? `${m2(r.worstWallDistM)} m` : 'no head in reach', r.worstWallDistM > f.Wmax + 0.001 ? 'bad' : ''],
        ['Closest to a wall', `${r.minWallDistM == null ? '–' : (r.minWallDistM * 1000).toFixed(0) + ' mm'}`, r.minWallDistM != null && r.minWallDistM < f.Wmin - 0.001 ? 'bad' : ''],
        ['Coverage (sampled)', `${(r.coverage * 100).toFixed(1)} %`, r.coverage < 1 ? 'bad' : ''],
      ]);
      const n = res.notes || {};
      const rows = [
        ['Placement time', `${p.ms.toFixed(0)} ms`], ['Check time', `${(r.checkMs || 0).toFixed(0)} ms`],
        ['Frame / bays', `${n.frameDeg != null ? n.frameDeg.toFixed(1) + '°' : '–'} · ${n.decomposition || '–'} (${n.bays || 0})`],
        ['Rows', `${n.rows ?? '–'}`],
        ['Moved (locked) heads', `${res.heads.filter(h => h.kind === 'locked').length}`],
        ['Gap-fill heads', `${n.exceptions?.gapFill ?? 0}`, n.exceptions?.gapFill ? 'near' : ''],
      ];
      if (n.tileAligned) rows.push(['On tile centres', `${n.tileAligned.onStop} / ${n.tileAligned.total}` + (n.tileAligned.extraHeadsVsUnaligned != null ? ` (+${n.tileAligned.extraHeadsVsUnaligned} vs free)` : '')]);
      dl('Engine', rows);
    }
    const sec = document.createElement('div'); sec.className = 'sec'; sec.textContent = 'Checker findings'; el.appendChild(sec);
    const all = errs.concat(warns);
    if (!res.ok && res.error && res.heads.length) all.unshift({ severity: 'error', code: res.error.code, message: res.error.message, where: res.error.where?.[0] });
    if (!res.heads.length && res.error) all.unshift({ severity: 'error', code: res.error.code, message: res.error.message, where: res.error.where?.[0] });
    if (!all.length) { const pe = document.createElement('p'); pe.className = 'empty'; pe.textContent = 'None. Drag a head to see the checker react.'; el.appendChild(pe); }
    else {
      const ul = document.createElement('ul'); ul.className = 'flags';
      all.slice(0, 40).forEach(fl => {
        const li = document.createElement('li'); const b = document.createElement('button'); b.type = 'button';
        b.className = fl.severity === 'error' ? 'e' : 'w';
        b.innerHTML = `<span class="ic">${fl.severity === 'error' ? '✕' : '⚠'}</span><span><span class="code"></span><br><span class="msg"></span></span>`;
        b.querySelector('.code').textContent = `${fl.severity === 'error' ? 'Error' : 'Warning'} · ${fl.code}` + (fl.where ? ` · at ${(fl.where.x / 1000).toFixed(2)}, ${(fl.where.y / 1000).toFixed(2)} m` : '');
        b.querySelector('.msg').textContent = fl.message;
        b.addEventListener('click', () => { S.focus = fl.where || null; draw(); });
        li.appendChild(b); ul.appendChild(li);
      });
      if (all.length > 40) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = `…and ${all.length - 40} more`; ul.appendChild(li); }
      el.appendChild(ul);
    }
    const lg = document.createElement('div'); lg.className = 'legend';
    lg.innerHTML = '<span class="l-row">Head on a branch row</span><span class="l-lock">Moved by you (kept on re-run)</span><span class="l-gap">Gap-fill exception</span>';
    el.appendChild(lg);
  }

  function hint() {
    const h = $('hint');
    if (S.drawing) h.textContent = 'Drawing: click corners · double-click / Enter to close · Esc to cancel';
    else h.textContent = 'Drag a head to move it; the checker re-runs live. Moved heads stay put on “Place heads”.';
  }

  function refresh(refit) {
    if (refit) fit();
    syncControls(); renderList(); renderTabs(); renderReport(); hint(); draw();
  }

  new ResizeObserver(() => { fit(); draw(); }).observe(cv);
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener?.('change', () => draw());
  new MutationObserver(() => draw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // boot: place the first sample synchronously, then the rest in the background so the list fills in
  S.cur = samples.findIndex(s => s.id === 'Z2');
  if (S.cur < 0) S.cur = 0;
  runSample(samples[S.cur]);
  refresh(true);
  let k = 0;
  (function next() {
    while (k < samples.length && samples[k].results) k++;
    if (k >= samples.length) return;
    runSample(samples[k]); renderList();
    if (k === S.cur) refresh(false);
    setTimeout(next, 30);
  })();
})();

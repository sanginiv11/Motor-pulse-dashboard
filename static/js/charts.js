import { hexA, clamp } from './util.js';

export const PADL = 62, PADR_SINGLE = 16, PADR_DUAL = 58;
const GRID = 'rgba(148,174,200,.11)', AXIS = '#7d8fa3', FONT = '10.5px "JetBrains Mono", ui-monospace, monospace';

function setup(c) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return null;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  return { g, w, h };
}
function bsearch(a, x) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; }
function niceTicks(lo, hi, n) {
  const span = hi - lo || 1, raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p, out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
function xTicks(tmin, tp, W) {
  const step = W <= 6 ? 1 : W <= 12 ? 2 : 5, out = [];
  for (let t = Math.ceil(tmin / step) * step; t <= tp; t += step) out.push(t);
  return out;
}

/** Scrolling multi-trace time-series chart with optional dual axis, colour-segmented traces, bands and hover read-out. */
export class TimeChart {
  constructor(canvas, o) {
    this.c = canvas;
    this.o = Object.assign({ window: 10, axes: [{ fmt: v => v.toFixed(2), pad: .15 }], gridY: 4, dual: false }, o);
    this.tr = this.o.traces.map(t => ({ ...t, t: [], v: [], k: [] }));
    this.bands = []; this.rng = this.o.axes.map(() => null); this.mx = null; this.W = this.o.window;
    canvas.addEventListener('mousemove', e => { const r = canvas.getBoundingClientRect(); this.mx = e.clientX - r.left; });
    canvas.addEventListener('mouseleave', () => this.mx = null);
  }
  setWindow(w) { this.W = w; }
  clear() { this.tr.forEach(t => { t.t.length = 0; t.v.length = 0; t.k.length = 0; }); this.bands.length = 0; this.rng = this.rng.map(() => null); }
  push(i, t, v, k = 0) { const s = this.tr[i]; s.t.push(t); s.v.push(v); s.k.push(k); }
  pushMany(i, ts, vs, k = 0) { const s = this.tr[i]; for (let j = 0; j < ts.length; j++) { s.t.push(ts[j]); s.v.push(vs[j]); s.k.push(k); } }
  band(t0, t1, color, alpha = .13) { const b = { t0, t1, color, alpha }; this.bands.push(b); return b; }
  trim(tp) {
    const cut = tp - 26;
    for (const s of this.tr) { if (s.t.length > 8 && s.t[0] < cut) { const n = bsearch(s.t, cut); if (n > 0) { s.t.splice(0, n); s.v.splice(0, n); s.k.splice(0, n); } } }
    while (this.bands.length && this.bands[0].t1 < cut) this.bands.shift();
  }
  draw(tp) {
    const S = setup(this.c); if (!S) return; const { g, w, h } = S; const W = this.W;
    const padR = this.o.dual ? PADR_DUAL : PADR_SINGLE, x0 = PADL, pw = w - x0 - padR, y0 = 8, ph = h - y0 - 22, tmin = tp - W;
    this.trim(tp);
    // --- y ranges ---
    this.o.axes.forEach((ax, ai) => {
      let lo = Infinity, hi = -Infinity;
      if (ax.min != null && ax.max != null) { lo = ax.min; hi = ax.max; }
      else {
        for (const s of this.tr) { if ((s.axis || 0) !== ai || s.noRange) continue; const a = Math.max(0, bsearch(s.t, tmin) - 1), b = bsearch(s.t, tp); const st = Math.max(1, ((b - a) / 500) | 0); for (let i = a; i < b; i += st) { const v = s.v[i]; if (v < lo) lo = v; if (v > hi) hi = v; } }
        if (!isFinite(lo)) { lo = 0; hi = 1; }
        let sp = hi - lo; if (ax.minSpan && sp < ax.minSpan) { const m = (hi + lo) / 2; lo = m - ax.minSpan / 2; hi = m + ax.minSpan / 2; sp = ax.minSpan; }
        if (sp < 1e-9) { lo -= 1; hi += 1; sp = 2; }
        if (ax.zero) { lo = 0; hi += sp * (ax.pad ?? .15); } else { lo -= sp * (ax.pad ?? .15); hi += sp * (ax.pad ?? .15); }
      }
      const r = this.rng[ai]; if (!r) this.rng[ai] = { lo, hi }; else { r.lo += (lo - r.lo) * .1; r.hi += (hi - r.hi) * .1; }
    });
    const X = t => x0 + (t - tmin) / W * pw;
    // --- bands ---
    for (const b of this.bands) { const a = Math.max(b.t0, tmin), z = Math.min(b.t1, tp); if (z <= a) continue; g.fillStyle = hexA(b.color, b.alpha); g.fillRect(X(a), y0, Math.max(1, X(z) - X(a)), ph); }
    // --- grid ---
    g.font = FONT; g.lineWidth = 1; g.textBaseline = 'middle';
    const r0 = this.rng[0];
    for (const v of niceTicks(r0.lo, r0.hi, this.o.gridY)) {
      const y = y0 + ph - (v - r0.lo) / (r0.hi - r0.lo) * ph; g.strokeStyle = GRID; g.beginPath(); g.moveTo(x0, y + .5); g.lineTo(x0 + pw, y + .5); g.stroke();
      g.fillStyle = AXIS; g.textAlign = 'right'; g.fillText(this.o.axes[0].fmt(v), x0 - 8, y);
    }
    if (this.o.dual) { const r1 = this.rng[1]; g.textAlign = 'left'; for (const v of niceTicks(r1.lo, r1.hi, this.o.gridY)) { const y = y0 + ph - (v - r1.lo) / (r1.hi - r1.lo) * ph; g.fillStyle = this.o.axes[1].color || AXIS; g.fillText(this.o.axes[1].fmt(v), x0 + pw + 8, y); } }
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (const t of xTicks(tmin, tp, W)) { const x = Math.round(X(t)) + .5; g.strokeStyle = GRID; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + ph); g.stroke(); g.fillStyle = AXIS; g.fillText((t - tp).toFixed(0) + 's', x, y0 + ph + 6); }
    // --- axis titles ---
    g.save(); g.fillStyle = AXIS; g.font = '600 10px Inter,sans-serif'; g.textAlign = 'center';
    g.translate(11, y0 + ph / 2); g.rotate(-Math.PI / 2); g.fillStyle = this.o.axes[0].color || AXIS; g.fillText(this.o.axes[0].label || '', 0, 0); g.restore();
    if (this.o.dual) { g.save(); g.font = '600 10px Inter,sans-serif'; g.translate(w - 8, y0 + ph / 2); g.rotate(Math.PI / 2); g.textAlign = 'center'; g.fillStyle = this.o.axes[1].color || AXIS; g.fillText(this.o.axes[1].label || '', 0, 0); g.restore(); }
    // --- traces ---
    g.save(); g.beginPath(); g.rect(x0, y0 - 2, pw, ph + 4); g.clip();
    for (const s of this.tr) this._trace(g, s, tp, tmin, W, x0, pw, y0, ph);
    g.restore();
    // --- hover ---
    if (this.mx != null && this.mx > x0 && this.mx < x0 + pw) {
      const th = tmin + (this.mx - x0) / pw * W; g.strokeStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.moveTo(this.mx + .5, y0); g.lineTo(this.mx + .5, y0 + ph); g.stroke();
      const lines = []; for (const s of this.tr) { if (!s.t.length || s.hidden) continue; let i = bsearch(s.t, th); i = clamp(i, 0, s.t.length - 1); if (i > 0 && Math.abs(s.t[i - 1] - th) < Math.abs(s.t[i] - th)) i--; if (Math.abs(s.t[i] - th) < .6) lines.push([s.color || '#fff', s.name, s.v[i], s.unit || '', s.dec ?? 2]); }
      if (lines.length) {
        g.font = '11px "JetBrains Mono",monospace'; const bw = 156, bh = 10 + lines.length * 17; let bx = this.mx + 12; if (bx + bw > x0 + pw) bx = this.mx - bw - 12; g.fillStyle = 'rgba(6,10,16,.92)'; g.strokeStyle = 'rgba(148,174,200,.3)'; g.beginPath(); g.roundRect(bx, y0 + 6, bw, bh, 8); g.fill(); g.stroke();
        g.textAlign = 'left'; g.textBaseline = 'middle'; lines.forEach((l, j) => { const y = y0 + 6 + 14 + j * 17; g.fillStyle = l[0]; g.fillRect(bx + 9, y - 4, 8, 8); g.fillStyle = '#c4d2e0'; g.fillText(`${l[1]}`, bx + 23, y); g.textAlign = 'right'; g.fillStyle = '#fff'; g.fillText(`${l[2].toFixed(l[4])}${l[3]}`, bx + bw - 8, y); g.textAlign = 'left'; });
      }
    }
  }
  _trace(g, s, tp, tmin, W, x0, pw, y0, ph) {
    if (s.hidden) return; const t = s.t, n = t.length; if (n < 2) return;
    const lo = Math.max(0, bsearch(t, tmin) - 1), hi = bsearch(t, tp), cnt = hi - lo; if (cnt < 2) return;
    const ax = this.rng[s.axis || 0]; const X = tt => x0 + (tt - tmin) / W * pw, Y = v => y0 + ph - (v - ax.lo) / (ax.hi - ax.lo) * ph;
    const px = [], py = [], pk = [];
    if (cnt > pw * 2) {
      const nb = Math.max(1, Math.floor(pw / 1.2)), per = cnt / nb;
      for (let b = 0; b < nb; b++) {
        const a = lo + Math.floor(b * per), z = Math.min(hi, lo + Math.floor((b + 1) * per)); if (z <= a) continue;
        let mn = a, mx = a; for (let i = a; i < z; i++) { if (s.v[i] < s.v[mn]) mn = i; if (s.v[i] > s.v[mx]) mx = i; }
        const f = mn < mx ? [mn, mx] : [mx, mn]; for (const i of f) { px.push(X(t[i])); py.push(Y(s.v[i])); pk.push(s.k[z - 1]); }
      }
    } else for (let i = lo; i < hi; i++) { px.push(X(t[i])); py.push(Y(s.v[i])); pk.push(s.k[i]); }
    g.lineWidth = s.width || 1.4; g.lineJoin = 'round'; g.setLineDash(s.dash || []);
    let start = 0; const col = k => s.palette ? s.palette[k] : s.color;
    const stroke = (a, z) => { if (z - a < 1) return; g.beginPath(); g.moveTo(px[a], py[a]); for (let i = a + 1; i <= z; i++) g.lineTo(px[i], py[i]); g.strokeStyle = col(pk[z]); g.shadowColor = s.glow ? col(pk[z]) : 'transparent'; g.shadowBlur = s.glow ? 6 : 0; g.stroke(); };
    for (let i = 1; i < px.length; i++) if (pk[i] !== pk[i - 1]) { stroke(start, i); start = i; }
    stroke(start, px.length - 1); g.shadowBlur = 0; g.setLineDash([]);
  }
}

/** Horizontal segment strips (e.g. simulator truth vs AI diagnosis). */
export class Strips {
  constructor(canvas, o) { this.c = canvas; this.o = Object.assign({ window: 10 }, o); this.W = this.o.window; this.rows = o.rows.map(r => ({ ...r, segs: [] })); }
  setWindow(w) { this.W = w; }
  clear() { this.rows.forEach(r => r.segs.length = 0); }
  add(row, t0, t1, color, text) { const r = this.rows[row], l = r.segs[r.segs.length - 1]; if (l && l.text === text && l.color === color && t0 - l.t1 < 0.6) l.t1 = t1; else r.segs.push({ t0, t1, color, text }); }
  draw(tp) {
    const S = setup(this.c); if (!S) return; const { g, w, h } = S; const W = this.W, tmin = tp - W, x0 = PADL, pw = w - x0 - (this.o.padR ?? PADR_SINGLE), n = this.rows.length, gap = 3, rh = (h - gap * (n - 1)) / n;
    const X = t => x0 + (t - tmin) / W * pw;
    this.rows.forEach((r, i) => {
      const y = i * (rh + gap);
      g.fillStyle = 'rgba(255,255,255,.035)'; g.beginPath(); g.roundRect(x0, y, pw, rh, 5); g.fill();
      g.font = '600 9.5px Inter,sans-serif'; g.fillStyle = '#7d8fa3'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(r.label, x0 - 8, y + rh / 2);
      while (r.segs.length && r.segs[0].t1 < tmin - 2) r.segs.shift();
      g.save(); g.beginPath(); g.roundRect(x0, y, pw, rh, 5); g.clip();
      for (const s of r.segs) {
        const a = Math.max(s.t0, tmin), z = Math.min(s.t1, tp); if (z <= a) continue; const xa = X(a), xz = X(z);
        g.fillStyle = hexA(s.color, .78); g.fillRect(xa, y, Math.max(1, xz - xa), rh);
        g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(xa, y, Math.max(1, xz - xa), 1);
        if (xz - xa > 78 && s.text) { g.font = '700 10.5px Rajdhani,Inter,sans-serif'; g.fillStyle = '#06101a'; g.textAlign = 'left'; g.fillText(s.text.toUpperCase(), Math.max(xa, x0) + 8, y + rh / 2 + .5); }
      }
      g.restore();
    });
  }
}

/** Probability heat-map: one row per class, one column per AI inference (4 Hz). */
export class Heat {
  constructor(canvas, o) { this.c = canvas; this.o = Object.assign({ window: 10 }, o); this.W = this.o.window; this.cells = []; }
  setWindow(w) { this.W = w; }
  clear() { this.cells.length = 0; }
  add(t0, t1, probs) { this.cells.push({ t0, t1, probs }); }
  draw(tp) {
    const S = setup(this.c); if (!S) return; const { g, w, h } = S; const W = this.W, tmin = tp - W, x0 = PADL, pw = w - x0 - PADR_SINGLE, cl = this.o.classes, n = cl.length, rh = h / n;
    const X = t => x0 + (t - tmin) / W * pw;
    while (this.cells.length && this.cells[0].t1 < tmin - 1) this.cells.shift();
    g.font = '600 9.5px Inter,sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'right';
    cl.forEach((c, i) => { g.fillStyle = 'rgba(255,255,255,.03)'; g.fillRect(x0, i * rh + 1, pw, rh - 2); g.fillStyle = c.color; g.fillText(c.short, x0 - 8, i * rh + rh / 2); });
    g.save(); g.beginPath(); g.rect(x0, 0, pw, h); g.clip();
    for (const c of this.cells) { const a = Math.max(c.t0, tmin), z = Math.min(c.t1, tp); if (z <= a) continue; const xa = X(a), wd = Math.max(1, X(z) - xa + .6); cl.forEach((k, i) => { const p = c.probs[i]; if (p < .01) return; g.fillStyle = hexA(k.color, .12 + .88 * Math.pow(p, .75)); g.fillRect(xa, i * rh + 1, wd, rh - 2); }); }
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.moveTo(x0 + pw - .5, 0); g.lineTo(x0 + pw - .5, h); g.stroke();
  }
}

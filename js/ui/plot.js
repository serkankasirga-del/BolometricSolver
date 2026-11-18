/* Minimal dependency-free canvas line plot (linear / log axes, several series, markers, reference lines). */
(function (root) {
  'use strict';

  function niceTicks(min, max, n) {
    const span = max - min || Math.abs(max) || 1;
    const step0 = span / Math.max(1, n);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return ticks;
  }

  function fmt(v) {
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e4 || a < 1e-2) return (+v.toPrecision(2)).toExponential().replace('e+', 'e');
    return String(+v.toPrecision(3));
  }

  function css(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  /**
   * draw(canvas, {series:[{x:[],y:[],label,color,dash,markers}], xlabel, ylabel, logx, logy,
   *               hlines:[{y,label,color}], vlines:[{x,label,color}], title})
   */
  function draw(canvas, spec) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const fg = css('--fg', '#222'), muted = css('--muted', '#777'), grid = css('--grid', '#e5e5e5');
    ctx.font = '11px system-ui, sans-serif';

    const series = (spec.series || []).filter((s) => s.x && s.x.length);
    if (!series.length) {
      ctx.fillStyle = muted; ctx.textAlign = 'center';
      ctx.fillText(spec.empty || 'No data yet', W / 2, H / 2);
      return;
    }
    const tx = (v) => (spec.logx ? Math.log10(v) : v);
    const ty = (v) => (spec.logy ? Math.log10(Math.abs(v)) : v);
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const s of series) for (let i = 0; i < s.x.length; i++) {
      const X = tx(s.x[i]), Y = ty(s.y[i]);
      if (!isFinite(X) || !isFinite(Y)) continue;
      xmin = Math.min(xmin, X); xmax = Math.max(xmax, X); ymin = Math.min(ymin, Y); ymax = Math.max(ymax, Y);
    }
    for (const h of spec.hlines || []) { const Y = ty(h.y); if (isFinite(Y)) { ymin = Math.min(ymin, Y); ymax = Math.max(ymax, Y); } }
    if (ymin === ymax) { ymin -= 1; ymax += 1; }
    if (xmin === xmax) { xmin -= 1; xmax += 1; }
    const pad = (ymax - ymin) * 0.06; ymin -= pad; ymax += pad;

    const L = 58, R = 12, T = spec.title ? 22 : 10, B = 36;
    const px = (X) => L + ((X - xmin) / (xmax - xmin)) * (W - L - R);
    const py = (Y) => H - B - ((Y - ymin) / (ymax - ymin)) * (H - T - B);

    ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.fillStyle = muted;
    const xt = spec.logx ? logTicks(xmin, xmax) : niceTicks(xmin, xmax, 6).map((v) => [v, fmt(v)]);
    const yt = spec.logy ? logTicks(ymin, ymax) : niceTicks(ymin, ymax, 5).map((v) => [v, fmt(v)]);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const [v, lab] of xt) { const X = px(v); if (X < L - 1 || X > W - R + 1) continue; ctx.beginPath(); ctx.moveTo(X, T); ctx.lineTo(X, H - B); ctx.stroke(); ctx.fillText(lab, X, H - B + 4); }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const [v, lab] of yt) { const Y = py(v); if (Y < T - 1 || Y > H - B + 1) continue; ctx.beginPath(); ctx.moveTo(L, Y); ctx.lineTo(W - R, Y); ctx.stroke(); ctx.fillText(lab, L - 4, Y); }
    ctx.strokeStyle = muted; ctx.strokeRect(L, T, W - L - R, H - T - B);

    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    if (spec.xlabel) ctx.fillText(spec.xlabel, L + (W - L - R) / 2, H - 2);
    if (spec.title) { ctx.textBaseline = 'top'; ctx.font = '600 12px system-ui, sans-serif'; ctx.fillText(spec.title, L + (W - L - R) / 2, 4); ctx.font = '11px system-ui, sans-serif'; }
    if (spec.ylabel) { ctx.save(); ctx.translate(12, T + (H - T - B) / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText(spec.ylabel, 0, 0); ctx.restore(); }

    ctx.save(); ctx.beginPath(); ctx.rect(L, T, W - L - R, H - T - B); ctx.clip();
    for (const h of spec.hlines || []) {
      const Y = py(ty(h.y)); ctx.strokeStyle = h.color || muted; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(L, Y); ctx.lineTo(W - R, Y); ctx.stroke(); ctx.setLineDash([]);
      if (h.label) { ctx.fillStyle = h.color || muted; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(h.label, W - R - 4, Y - 2); }
    }
    for (const v of spec.vlines || []) {
      const X = px(tx(v.x)); ctx.strokeStyle = v.color || muted; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X, T); ctx.lineTo(X, H - B); ctx.stroke(); ctx.setLineDash([]);
      if (v.label) { ctx.fillStyle = v.color || muted; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(v.label, X + 3, T + 3); }
    }
    series.forEach((s, k) => {
      ctx.strokeStyle = s.color || css(`--s${(k % 4) + 1}`, '#36c'); ctx.lineWidth = 2; ctx.setLineDash(s.dash || []);
      ctx.beginPath(); let started = false;
      for (let i = 0; i < s.x.length; i++) {
        const X = tx(s.x[i]), Y = ty(s.y[i]);
        if (!isFinite(X) || !isFinite(Y)) { started = false; continue; }
        if (!started) { ctx.moveTo(px(X), py(Y)); started = true; } else ctx.lineTo(px(X), py(Y));
      }
      ctx.stroke(); ctx.setLineDash([]);
      if (s.markers) {
        ctx.fillStyle = ctx.strokeStyle;
        for (let i = 0; i < s.x.length; i++) { const X = tx(s.x[i]), Y = ty(s.y[i]); if (isFinite(X) && isFinite(Y)) { ctx.beginPath(); ctx.arc(px(X), py(Y), 3, 0, 7); ctx.fill(); } }
      }
    });
    ctx.restore();

    const labelled = series.filter((s) => s.label);
    if (labelled.length > 1 || spec.legend) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      let y = T + 10;
      labelled.forEach((s) => {
        const k = series.indexOf(s);
        ctx.strokeStyle = s.color || css(`--s${(k % 4) + 1}`, '#36c'); ctx.lineWidth = 2; ctx.setLineDash(s.dash || []);
        ctx.beginPath(); ctx.moveTo(L + 8, y); ctx.lineTo(L + 24, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = fg; ctx.fillText(s.label, L + 28, y); y += 14;
      });
    }
  }

  function logTicks(lmin, lmax) {
    const out = [];
    for (let e = Math.floor(lmin); e <= Math.ceil(lmax); e++) out.push([e, fmt(Math.pow(10, e))]);
    return out;
  }

  root.BS = root.BS || {};
  root.BS.plot = { draw };
})(typeof globalThis !== 'undefined' ? globalThis : this);

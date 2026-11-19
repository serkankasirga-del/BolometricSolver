/*
 * Temperature-dependent resistivity models.
 * Every model exposes relChange(T) = ρ(T)/ρ(T0) − 1, the fractional change of the
 * local resistivity relative to the measurement (ambient) temperature T0.
 *
 *  - 'tcr'        : ρ = ρ0 [1 + α (T − T0)]                       (metals, linear TCR)
 *  - 'activation' : ρ = ρ0 exp[(E_A/k_B)(1/T − 1/T0)]             (thermally activated)
 *  - 'rt'         : ρ(T)/ρ(T0) = R(T)/R(T0) from measured R–T data (PCHIP interpolation)
 */
(function (root) {
  'use strict';
  const KB_EV = 8.617333262e-5; // eV/K

  /** Parse pasted R–T text: two numeric columns (T [K], R [Ω]); headers/comments are ignored. */
  function parseRT(text) {
    const pts = [];
    for (const line of String(text).split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#') || s.startsWith('%')) continue;
      const parts = s.split(/[\s,;]+/).map(Number);
      if (parts.length >= 2 && isFinite(parts[0]) && isFinite(parts[1])) pts.push([parts[0], parts[1]]);
    }
    pts.sort((p, q) => p[0] - q[0]);
    // merge duplicates in T by averaging
    const out = [];
    for (const p of pts) {
      const last = out[out.length - 1];
      if (last && Math.abs(last[0] - p[0]) < 1e-12) { last[1] = (last[1] * last[2] + p[1]) / (last[2] + 1); last[2]++; }
      else out.push([p[0], p[1], 1]);
    }
    return out.map((p) => [p[0], p[1]]);
  }

  /** Monotone piecewise-cubic Hermite (Fritsch–Carlson) interpolant; linear extrapolation outside. */
  function pchip(xs, ys) {
    const n = xs.length;
    if (n < 2) throw new Error('R–T data needs at least two points');
    const h = [], d = [];
    for (let i = 0; i < n - 1; i++) { h.push(xs[i + 1] - xs[i]); d.push((ys[i + 1] - ys[i]) / h[i]); }
    const m = new Array(n);
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m[i] = 0;
      else {
        const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
        m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
      }
    }
    function f(x) {
      if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
      if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] > x) hi = mid; else lo = mid; }
      const hh = h[lo], s = (x - xs[lo]) / hh;
      const s2 = s * s, s3 = s2 * s;
      return (2 * s3 - 3 * s2 + 1) * ys[lo] + (s3 - 2 * s2 + s) * hh * m[lo] + (-2 * s3 + 3 * s2) * ys[lo + 1] + (s3 - s2) * hh * m[lo + 1];
    }
    f.deriv = (x) => (f(x + 1e-4) - f(x - 1e-4)) / 2e-4;
    return f;
  }

  /**
   * Create a resistivity model.
   * spec: { type: 'tcr', alpha, T0 } | { type: 'activation', EA, T0 } |
   *       { type: 'rt', data: [[T,R],...] | text, T0, subtractRc (Ω, optional) }
   */
  function makeModel(spec) {
    const T0 = spec.T0;
    if (spec.type === 'tcr') {
      const a = spec.alpha;
      return { type: 'tcr', T0, alpha: a, relChange: (T) => a * (T - T0), describe: `linear TCR α = ${a} K⁻¹` };
    }
    if (spec.type === 'activation') {
      const EA = spec.EA;
      const alpha = -EA / (KB_EV * T0 * T0);
      return {
        type: 'activation', T0, alpha,
        relChange: (T) => Math.expm1((EA / KB_EV) * (1 / T - 1 / T0)),
        describe: `thermally activated, E_A = ${EA} eV (α(T0) = ${alpha.toExponential(3)} K⁻¹)`,
      };
    }
    if (spec.type === 'rt') {
      let data = typeof spec.data === 'string' ? parseRT(spec.data) : spec.data.slice();
      const rc = spec.subtractRc || 0;
      if (rc) data = data.map(([T, R]) => [T, R - rc]);
      if (data.length < 2) throw new Error('R–T data needs at least two (T, R) rows');
      const xs = data.map((p) => p[0]), ys = data.map((p) => p[1]);
      const f = pchip(xs, ys);
      const R0 = f(T0);
      if (!(R0 > 0)) throw new Error('Interpolated R(T0) is not positive — check R–T data / contact resistance');
      const alpha = f.deriv(T0) / R0;
      const outside = T0 < xs[0] || T0 > xs[xs.length - 1];
      return {
        type: 'rt', T0, alpha, R0, data, interp: f, outside,
        relChange: (T) => f(T) / R0 - 1,
        describe: `R–T data (${data.length} pts), R(T0) = ${R0.toPrecision(5)} Ω, local α(T0) = ${alpha.toExponential(3)} K⁻¹`,
      };
    }
    throw new Error('Unknown resistivity model: ' + spec.type);
  }

  const api = { makeModel, parseRT, pchip, KB_EV };
  root.BS = root.BS || {};
  root.BS.resistivity = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

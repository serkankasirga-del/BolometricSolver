// Run with:  npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sp = require('../js/math/special.js');
const thermal = require('../js/physics/thermal.js');
const electrical = require('../js/physics/electrical.js');
const resistivity = require('../js/physics/resistivity.js');
const B = require('../js/physics/bolometer.js');

const um = 1e-6;
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b)), `${msg}: ${a} vs ${b}`);

test('special functions', () => {
  close(sp.E1(0.5), 0.5597735947761608, 1e-12, 'E1(0.5)');
  close(sp.E1(3), 0.013048381094197, 1e-10, 'E1(3)');
  close(sp.E1(20), 9.835525290649882e-11, 1e-9, 'E1(20)');
  close(sp.Ein(1.5) - sp.EULER_GAMMA - Math.log(1.5), sp.E1(1.5), 1e-12, 'Ein identity');
  close(sp.besselK0(1), 0.42102443824070834, 1e-6, 'K0(1)');
  close(sp.besselK1(2.5), 0.07389081634774707, 1e-6, 'K1(2.5)');
  close(sp.besselJ0(10), -0.2459357644513483, 1e-6, 'J0(10)');
  close(sp.besselJ1(3), 0.33905895852593645, 1e-6, 'J1(3)');
  // K_n table vs recurrence of direct values
  const t = sp.lnKnTable(1.7, 5);
  const K2 = sp.besselK0(1.7) + (2 / 1.7) * sp.besselK1(1.7);
  close(Math.exp(t.lnK[2]), K2, 1e-6, 'K2 from table');
});

/** Independent 1D radial finite-volume solution for a centred source. */
function radialFV(p) {
  const a = p.hole.a, beta = Math.sqrt(p.G / (p.kappaSup * p.t));
  const R = a + 25 / beta + 6 * p.source.r0, N = 40000, h = R / N;
  const S0 = p.Q / (Math.PI * p.source.r0 ** 2 * p.t);
  const A = new Float64Array(N), Bd = new Float64Array(N), C = new Float64Array(N), D = new Float64Array(N);
  const k = (r) => (r < a ? p.kappa : p.kappaSup);
  for (let i = 0; i < N; i++) {
    const r = (i + 0.5) * h, rw = i * h, re = (i + 1) * h;
    const cw = i > 0 ? (rw * k(rw - h / 2 + 1e-30)) / h : 0;
    const ce = i < N - 1 ? (re * (re < a ? p.kappa : p.kappaSup)) / h : (2 * re * p.kappaSup) / h;
    const hh = r < a ? 0 : p.G / p.t;
    A[i] = -cw; C[i] = i < N - 1 ? -ce : 0; Bd[i] = cw + ce + hh * r * h; D[i] = S0 * Math.exp(-r * r / p.source.r0 ** 2) * r * h;
  }
  for (let i = 1; i < N; i++) { const m = A[i] / Bd[i - 1]; Bd[i] -= m * C[i - 1]; D[i] -= m * D[i - 1]; }
  const T = new Float64Array(N); T[N - 1] = D[N - 1] / Bd[N - 1];
  for (let i = N - 2; i >= 0; i--) T[i] = (D[i] - C[i] * T[i + 1]) / Bd[i];
  return (r) => T[Math.min(N - 1, Math.max(0, Math.round(r / h - 0.5)))];
}

test('concentric source: closed form agrees with radial finite volumes', () => {
  for (const c of [{ r0: 300e-9, a: 1e-6, kappa: 13, G: 5e7, t: 30e-9 }, { r0: 20e-9, a: 2e-6, kappa: 5, G: 1e8, t: 30e-9 }, { r0: 400e-9, a: 1e-6, kappa: 100, G: 2e6, t: 5e-9 }]) {
    const p = { hole: { cx: 0, cy: 0, a: c.a }, source: { x: 0, y: 0, r0: c.r0 }, Q: 1e-6, t: c.t, kappa: c.kappa, kappaSup: c.kappa, G: c.G, model: 'fourier' };
    const s = thermal.solve(p), fv = radialFV(p);
    assert.equal(s.nModes, 0);
    for (const f of [0, 0.5, 0.98, 1.02, 1.5]) {
      const err = Math.abs(s.rise(f * c.a, 0) - fv(f * c.a));
      assert.ok(err < 2e-3 * s.peakRise, `r = ${f}a: ${s.rise(f * c.a, 0)} vs ${fv(f * c.a)}`);
    }
  }
});

test('energy balance: heat sunk into the substrate equals Q (centred and off-centre)', () => {
  for (const off of [0, 0.5e-6, 0.95e-6, 1.6e-6]) {
    const p = { hole: { cx: 0, cy: 0, a: 1e-6 }, source: { x: off, y: 0.1e-6 * (off > 0), r0: 250e-9 }, Q: 2e-6, t: 30e-9, kappa: 10, kappaSup: 15, G: 3e7, model: 'fourier' };
    const s = thermal.solve(p);
    // ∫ G ΔT dA over the supported region (polar quadrature around the hole centre)
    const Rmax = 1e-6 + 30 / s.beta + 2e-6;
    const nr = 1500, nt = 360;
    let P = 0;
    for (let i = 0; i < nr; i++) {
      const r = 1e-6 + (i + 0.5) * (Rmax - 1e-6) / nr;
      for (let j = 0; j < nt; j++) {
        const th = (2 * Math.PI * (j + 0.5)) / nt;
        P += p.G * s.rise(r * Math.cos(th), r * Math.sin(th)) * r * ((Rmax - 1e-6) / nr) * (2 * Math.PI / nt);
      }
    }
    close(P, p.Q, 1.5e-2, `power balance, offset ${off}`);
  }
});

test('off-centre source agrees with a 2D finite-volume solution', () => {
  const p = { hole: { cx: 0, cy: 0, a: 1e-6 }, source: { x: 0.45e-6, y: 0.2e-6, r0: 200e-9 }, Q: 1e-6, t: 30e-9, kappa: 8, kappaSup: 8, G: 3e7, model: 'fourier' };
  const s = thermal.solve(p);
  // 2D FV, Dirichlet ΔT = 0 at |x|,|y| = L
  const L = 2.2e-6, N = 220, h = (2 * L) / N, S0 = p.Q / (Math.PI * p.source.r0 ** 2 * p.t);
  const n = N * N, T = new Float64Array(n), rhs = new Float64Array(n), sink = new Float64Array(n), kap = new Float64Array(n);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -L + (i + 0.5) * h, y = -L + (j + 0.5) * h, c = j * N + i;
    const inside = x * x + y * y < p.hole.a ** 2;
    kap[c] = inside ? p.kappa : p.kappaSup; sink[c] = inside ? 0 : p.G / p.t * h * h;
    rhs[c] = S0 * Math.exp(-((x - p.source.x) ** 2 + (y - p.source.y) ** 2) / p.source.r0 ** 2) * h * h;
  }
  const face = (a, b) => (2 * kap[a] * kap[b]) / (kap[a] + kap[b]);
  const apply = (v, out) => {
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const c = j * N + i; let s2 = sink[c] * v[c];
      const nb = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
      for (const [ii, jj] of nb) {
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) { s2 += 2 * kap[c] * v[c]; continue; }
        const m = jj * N + ii; s2 += face(c, m) * (v[c] - v[m]);
      }
      out[c] = s2;
    }
  };
  // CG
  const r = rhs.slice(), pp = r.slice(), Ap = new Float64Array(n);
  let rr = r.reduce((s2, v) => s2 + v * v, 0); const r0n = Math.sqrt(rr);
  for (let it = 0; it < 5000 && Math.sqrt(rr) > 1e-10 * r0n; it++) {
    apply(pp, Ap); let pAp = 0; for (let k = 0; k < n; k++) pAp += pp[k] * Ap[k];
    const al = rr / pAp; let rn = 0;
    for (let k = 0; k < n; k++) { T[k] += al * pp[k]; r[k] -= al * Ap[k]; rn += r[k] * r[k]; }
    const be = rn / rr; rr = rn; for (let k = 0; k < n; k++) pp[k] = r[k] + be * pp[k];
  }
  const at = (x, y) => T[Math.floor((y + L) / h) * N + Math.floor((x + L) / h)];
  const pts = [[0.45e-6, 0.2e-6], [0, 0], [-0.5e-6, 0], [0.8e-6, 0.3e-6], [0.2e-6, -0.6e-6]];
  for (const [x, y] of pts) {
    const xc = -L + (Math.floor((x + L) / h) + 0.5) * h, yc = -L + (Math.floor((y + L) / h) + 0.5) * h;
    close(s.rise(xc, yc), at(x, y), 0.02, `(${x}, ${y})`);
  }
  assert.ok(s.nModes > 5);
});

test('Guyer–Krumhansl: l → 0 recovers Fourier; hot spot adds (l²/κ)S0 at the source', () => {
  const base = { hole: { cx: 0, cy: 0, a: 2e-6 }, source: { x: 0, y: 0, r0: 20e-9 }, Q: 1e-7, t: 30e-9, kappa: 10, kappaSup: 10, G: 5e7 };
  const f = thermal.solve(Object.assign({ model: 'fourier' }, base));
  const g0 = thermal.solve(Object.assign({ model: 'gk', l: 0 }, base));
  close(g0.peakRise, f.peakRise, 1e-12, 'l = 0');
  const l = 50e-9;
  const g = thermal.solve(Object.assign({ model: 'gk', l }, base));
  const S0 = base.Q / (Math.PI * base.source.r0 ** 2 * base.t);
  close(g.peakRise - f.peakRise, (l * l / base.kappa) * S0, 1e-9, 'GK hot spot');
  close(g.rise(1.5e-6, 0), f.rise(1.5e-6, 0), 1e-6, 'far field unchanged');
});

test('electrical: bar resistance, four-probe, reciprocity weights', () => {
  const d = electrical.solveDevice({ crystal: rect(0, 0, 10 * um, 2 * um), contacts: [{ poly: rect(-1 * um, -1 * um, 2 * um, 3 * um), role: 'I+' }, { poly: rect(8 * um, -1 * um, 11 * um, 3 * um), role: 'I-' }], resolution: 200 });
  close(d.Runit, 3, 1e-5, '2T squares');
  close(d.wSum, d.Runit, 1e-6, 'Σw = R');
  const d4 = electrical.solveDevice({ crystal: rect(0, 0, 14 * um, 2 * um), contacts: [{ poly: rect(-1 * um, -1 * um, 2 * um, 3 * um), role: 'I+' }, { poly: rect(12 * um, -1 * um, 15 * um, 3 * um), role: 'I-' }, { poly: rect(4 * um, -1 * um, 5 * um, 3 * um), role: 'V+' }, { poly: rect(9 * um, -1 * um, 10 * um, 3 * um), role: 'V-' }], resolution: 200 });
  close(d4.Runit, 2, 1e-4, '4T squares');
  close(d4.wSum, d4.Runit, 1e-4, 'Σw = R (4T)');
});

test('resistivity models', () => {
  const lin = resistivity.makeModel({ type: 'tcr', alpha: 0.003, T0: 300 });
  close(lin.relChange(301), 0.003, 1e-12, 'TCR');
  const rt = resistivity.makeModel({ type: 'rt', data: '# T R\n280 97\n290 98.5\n300 100\n310 101.5\n320 103', T0: 300 });
  close(rt.relChange(301), 0.0015, 1e-3, 'R–T linear');
  close(rt.alpha, 0.0015, 1e-3, 'R–T local α');
  const rc = resistivity.makeModel({ type: 'rt', data: [[290, 110], [300, 120]], T0: 300, subtractRc: 20 });
  close(rc.R0, 100, 1e-12, 'Rc subtraction');
  const act = resistivity.makeModel({ type: 'activation', EA: 0.1, T0: 300 });
  assert.ok(act.relChange(301) < 0);
});

function baseCfg() {
  return {
    T0: 295, nModes: 160,
    geometry: {
      crystal: rect(-6 * um, -3 * um, 6 * um, 3 * um),
      contacts: [{ poly: rect(-8 * um, -4 * um, -2.5 * um, 4 * um), role: 'I+', Rc: 0 }, { poly: rect(2.5 * um, -4 * um, 8 * um, 4 * um), role: 'I-', Rc: 0 }],
      hole: { cx: 0, cy: 0, a: 1 * um }, source: { x: 0, y: 0 }, resolution: 120,
    },
    material: { t: 32e-9, kappa: 13.2, kappaSup: 13.2, tieKappa: true, G: 5e7, model: 'fourier', l: 0 },
    heating: { method: 'optical', optical: { P: 10e-6, absorbance: 0.3, r0: 300e-9 }, mechanical: { mode: 'contactTemp', Q: 1e-7, dTc: 1, Ttip: 300, Gts: 1e-7, r0: 20e-9 } },
    electrical: { rhoKind: 'resistivity', rho0: 4e-6, model: { type: 'tcr', alpha: 0.0025 }, biasMode: 'cv', V: 0.05, I: 1e-4, bandwidth: 1 },
  };
}

test('bolometer: fit recovers κ, contact resistance scaling, MBT modes', () => {
  const cfg = baseCfg();
  const dev = B.buildDevice(cfg.geometry);
  const r = B.evaluate(cfg, dev);
  assert.ok(r.dR > 0 && r.Ibolo < 0, 'positive TCR → positive δR, negative photoresponse');
  const fit = B.fitKappa(cfg, dev, B.evaluate(cfg, dev, { kappa: 7.5 }).dR);
  assert.equal(fit.roots.length, 1);
  close(fit.roots[0], 7.5, 1e-5, 'fitted κ');

  // contact resistance reduces the CV signal by (R_s/R_tot)^2 while δR is unchanged
  const c2 = baseCfg(); c2.geometry.contacts.forEach((c) => { c.Rc = r.Rs / 2; });
  const r2 = B.evaluate(c2, dev);
  close(r2.dR, r.dR, 1e-12, 'δR independent of R_c');
  close(r2.Ibolo / r.Ibolo, 0.25, 1e-3, 'I_bolo ∝ (R_s/R_tot)²');
  // photocurrent → δR conversion is consistent
  const es = B.electricalState(c2, dev, B.makeResistivityModel(c2));
  close(B.measuredDeltaR(c2, es, { kind: 'photocurrent', value: r2.Ibolo }), r2.dR, 1e-9, 'I_PC → δR');

  // MBT: contact-temperature mode pins the peak rise
  const m = baseCfg(); m.heating.method = 'mechanical';
  const rm = B.evaluate(m, dev);
  close(rm.peakRise, 1, 1e-9, 'δT* = 1 K');
  m.heating.mechanical.mode = 'conductance';
  const rc = B.evaluate(m, dev);
  assert.ok(rc.peakRise > 0 && rc.peakRise < 5, 'tip conductance model');
  close(rc.Q, m.heating.mechanical.Gts * (5 - rc.peakRise), 1e-6, 'Q = G_TS (T_tip − T_contact)');
});

test('bolometer: off-centre δR approaches centred value as offset → 0 and is symmetric', () => {
  const cfg = baseCfg();
  const dev = B.buildDevice(cfg.geometry);
  const r0 = B.evaluate(cfg, dev);
  const rA = B.evaluate(cfg, dev, { source: { x: 0.3e-6, y: 0 } });
  const rB = B.evaluate(cfg, dev, { source: { x: -0.3e-6, y: 0 } });
  close(rA.dR, rB.dR, 2e-3, 'mirror symmetry');
  const rS = B.evaluate(cfg, dev, { source: { x: 1e-9, y: 0 } });
  close(rS.dR, r0.dR, 1e-3, 'continuity at the centre');
});

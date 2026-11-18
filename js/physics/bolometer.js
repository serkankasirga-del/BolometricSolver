/*
 * Bolometric thermometry model: couples the analytical temperature field
 * (thermal.js), the device current distribution (electrical.js) and the
 * resistivity model (resistivity.js) to predict the bolometric resistance change,
 * the measured signal (current or voltage), noise floor, and to fit κ.
 *
 * Units: SI everywhere inside this module (m, W, K, Ω, V, A).
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const thermal = isNode ? require('./thermal.js') : root.BS.thermal;
  const electrical = isNode ? require('./electrical.js') : root.BS.electrical;
  const resistivity = isNode ? require('./resistivity.js') : root.BS.resistivity;

  const KB = 1.380649e-23, QE = 1.602176634e-19;

  /** Electrical device solve (depends on geometry only — cache it). */
  function buildDevice(geometry) {
    return electrical.solveDevice({ crystal: geometry.crystal, contacts: geometry.contacts, resolution: geometry.resolution || 160 });
  }

  function sourceRadius(cfg) {
    const h = cfg.heating;
    return h.method === 'optical' ? h.optical.r0 : h.mechanical.r0;
  }

  /** Thermal parameters for a given κ (κ' follows κ when tied). */
  function thermalParams(cfg, kappa, source) {
    const m = cfg.material;
    return {
      hole: cfg.geometry.hole,
      source: { x: source.x, y: source.y, r0: sourceRadius(cfg) },
      Q: 1,
      t: m.t,
      kappa,
      kappaSup: m.tieKappa ? kappa : m.kappaSup,
      G: m.G,
      model: m.model,
      l: m.l,
      nModes: cfg.nModes || 160,
    };
  }

  /** Absorbed / delivered power for the chosen heat-delivery method; peakUnit = peak rise per W. */
  function deliveredPower(cfg, peakUnit) {
    const h = cfg.heating;
    if (h.method === 'optical') return h.optical.absorbance * h.optical.P;
    const mc = h.mechanical;
    if (mc.mode === 'power') return mc.Q;
    if (mc.mode === 'contactTemp') return mc.dTc / peakUnit;
    if (mc.mode === 'conductance') {
      const dTip = mc.Ttip - cfg.T0;
      return (mc.Gts * dTip) / (1 + mc.Gts * peakUnit);
    }
    throw new Error('Unknown mechanical heating mode ' + mc.mode);
  }

  /** Integrate δρ/ρ0 over every crystal cell with adaptive sub-sampling near the source and hole edge. */
  function integrate(dev, sol, Q, rmodel, T0, hole, src, r0) {
    const { nx, ny, dx, x0, y0, label, w } = dev;
    const beta = sol.beta;
    let sum = 0, holeSum = 0, holeN = 0;
    const near = 6 * r0 + dx;
    for (let j = 0; j < ny; j++) {
      const yc = y0 + (j + 0.5) * dx;
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        if (label[c] !== 0 || w[c] === 0) continue;
        const xc = x0 + (i + 0.5) * dx;
        const rH = Math.hypot(xc - hole.cx, yc - hole.cy);
        const rS = Math.hypot(xc - src.x, yc - src.y);
        if (rH > hole.a + dx && beta * (rH - hole.a - dx) > 45 && beta * (rS - dx) > 45) continue;
        let m = 1;
        if (rS < near) m = Math.min(48, Math.max(3, Math.ceil(dx / (r0 / 3))));
        else if (Math.abs(rH - hole.a) < dx) m = 4;
        else if (rS < 4 * near) m = 2;
        let acc = 0, accT = 0;
        const h = dx / m;
        for (let q = 0; q < m; q++) {
          const ys = y0 + j * dx + (q + 0.5) * h;
          for (let pq = 0; pq < m; pq++) {
            const xs = x0 + i * dx + (pq + 0.5) * h;
            const dT = Q * sol.rise(xs, ys);
            acc += rmodel.relChange(T0 + dT);
            accT += dT;
          }
        }
        const mm = m * m;
        sum += w[c] * acc / mm;
        if (rH < hole.a) { holeSum += accT / mm; holeN++; }
      }
    }
    return { sumRel: sum, meanHoleRise: holeN ? holeSum / holeN : 0 };
  }

  /** Sample-resistance bookkeeping: returns ρ0 and the resistances in Ω. */
  function electricalState(cfg, dev, rmodel) {
    const e = cfg.electrical, t = cfg.material.t;
    let rho0;
    if (e.rhoKind === 'resistivity') rho0 = e.rho0;
    else if (e.rhoKind === 'resistance') rho0 = (e.Rsample * t) / dev.Runit;
    else if (e.rhoKind === 'rtdata') {
      if (rmodel.type !== 'rt') throw new Error('"Use R(T0) from R–T data" requires the R–T resistivity model.');
      rho0 = (rmodel.R0 * t) / dev.Runit;
    } else throw new Error('Unknown resistance specification');
    const Rs = (rho0 / t) * dev.Runit; // between sense terminals (or current terminals for 2T)
    const R2 = (rho0 / t) * dev.R2unit; // between current terminals
    const cI = cfg.geometry.contacts.filter((c) => c.role === 'I+' || c.role === 'I-');
    const RcTot = cI.reduce((s, c) => s + (c.Rc || 0), 0);
    return { rho0, Rs, R2, RcTot, Rtot: R2 + RcTot };
  }

  function makeResistivityModel(cfg) {
    return resistivity.makeModel(Object.assign({ T0: cfg.T0 }, cfg.electrical.model));
  }

  /**
   * Forward model.
   * @returns predicted δR, temperatures, measured signal, noise floor, SNR, …
   */
  function evaluate(cfg, dev, opts) {
    opts = opts || {};
    const kappa = opts.kappa != null ? opts.kappa : cfg.material.kappa;
    const src = opts.source || cfg.geometry.source;
    const rmodel = opts.rmodel || makeResistivityModel(cfg);
    const tp = thermalParams(cfg, kappa, src);
    const sol = thermal.solve(tp);
    const peakUnit = sol.peakRise;
    const Q = deliveredPower(cfg, peakUnit);
    const es = opts.es || electricalState(cfg, dev, rmodel);
    const t = cfg.material.t;
    const integ = integrate(dev, sol, Q, rmodel, cfg.T0, cfg.geometry.hole, src, tp.source.r0);
    const dR = (es.rho0 / t) * integ.sumRel;

    const out = {
      kappa, kappaEff: sol.kappaEff, Q, peakRise: Q * peakUnit, meanHoleRise: integ.meanHoleRise,
      dR, dRrel: dR / es.Rs, rho0: es.rho0, Rs: es.Rs, R2: es.R2, RcTot: es.RcTot, Rtot: es.Rtot,
      fourProbe: dev.fourProbe, nModes: sol.nModes, beta: sol.beta, sol, alphaT0: rmodel.alpha,
    };
    Object.assign(out, signals(cfg, out));
    return out;
  }

  /** Measured signal, Joule power and intrinsic noise (Johnson + shot) for the bias configuration. */
  function signals(cfg, r) {
    const e = cfg.electrical;
    const T = cfg.T0, df = e.bandwidth || 1;
    const s = {};
    if (!r.fourProbe && e.biasMode === 'cv') {
      const V = e.V;
      const I0 = V / r.Rtot;
      s.mode = 'Two-terminal, constant voltage';
      s.I0 = I0;
      s.Veff = (V * r.R2) / r.Rtot;
      s.Ibolo = V / (r.Rtot + r.dR) - I0;
      s.joule = I0 * I0 * r.R2;
      const iN = Math.sqrt((4 * KB * T * df) / r.Rtot + 2 * QE * Math.abs(I0) * df);
      s.noise = iN; s.noiseUnit = 'A';
      s.signal = s.Ibolo; s.signalUnit = 'A';
      s.dRfloor = (iN * r.Rtot * r.Rtot) / Math.abs(V);
    } else {
      const I = e.I;
      const Rm = r.fourProbe ? r.Rs : r.Rtot;
      s.mode = r.fourProbe ? 'Four-terminal, constant current' : 'Two-terminal, constant current';
      s.I0 = I;
      s.V0 = I * (r.fourProbe ? r.Rs : r.Rtot);
      s.Vbolo = I * r.dR;
      s.joule = I * I * r.R2;
      const vN = Math.sqrt(4 * KB * T * Rm * df + 2 * QE * Math.abs(I) * df * Rm * Rm);
      s.noise = vN; s.noiseUnit = 'V';
      s.signal = s.Vbolo; s.signalUnit = 'V';
      s.dRfloor = vN / Math.abs(I);
    }
    s.snr = Math.abs(s.signal) / s.noise;
    return s;
  }

  /** Convert a measured quantity into δR_M. kind: 'dR' | 'photocurrent' | 'voltage'. */
  function measuredDeltaR(cfg, es, meas) {
    if (meas.kind === 'dR') return meas.value;
    if (meas.kind === 'photocurrent') {
      // δR = V/(I0 + I_bolo) − V/I0  (exact form of δR ≈ −R² I_PC / V_B)
      const V = cfg.electrical.V, I0 = V / es.Rtot;
      return V / (I0 + meas.value) - V / I0;
    }
    if (meas.kind === 'voltage') return meas.value / cfg.electrical.I;
    throw new Error('Unknown measurement kind');
  }

  /** δR vs κ sweep (log-spaced). */
  function sweepKappa(cfg, dev, kmin, kmax, n, opts) {
    const rmodel = makeResistivityModel(cfg);
    const es = electricalState(cfg, dev, rmodel);
    const out = [];
    for (let i = 0; i < n; i++) {
      const k = kmin * Math.pow(kmax / kmin, i / (n - 1));
      const r = evaluate(cfg, dev, Object.assign({}, opts, { kappa: k, rmodel, es }));
      out.push({ kappa: k, dR: r.dR, peak: r.peakRise, signal: r.signal });
    }
    return out;
  }

  /**
   * Fit κ such that predicted δR = measured δR_M. Returns all roots found in [kmin,kmax]
   * (normally exactly one) and an uncertainty interval from ±σ on δR_M.
   */
  function fitKappa(cfg, dev, dRM, opts) {
    opts = opts || {};
    const kmin = opts.kmin || 0.01, kmax = opts.kmax || 1e4;
    const rmodel = makeResistivityModel(cfg);
    const es = electricalState(cfg, dev, rmodel);
    const f = (k) => evaluate(cfg, dev, { kappa: k, rmodel, es }).dR;
    const N = 33;
    const ks = [], fs = [];
    for (let i = 0; i < N; i++) {
      const k = kmin * Math.pow(kmax / kmin, i / (N - 1));
      ks.push(k); fs.push(f(k));
    }
    function rootsFor(target) {
      const roots = [];
      for (let i = 0; i < N - 1; i++) {
        const a = fs[i] - target, b = fs[i + 1] - target;
        if (a === 0) { roots.push(ks[i]); continue; }
        if (a * b < 0) {
          let lo = Math.log(ks[i]), hi = Math.log(ks[i + 1]), flo = a;
          for (let it = 0; it < 50; it++) {
            const mid = 0.5 * (lo + hi);
            const fm = f(Math.exp(mid)) - target;
            if (fm * flo <= 0) hi = mid; else { lo = mid; flo = fm; }
            if (hi - lo < 1e-7) break;
          }
          roots.push(Math.exp(0.5 * (lo + hi)));
        }
      }
      return roots;
    }
    const roots = rootsFor(dRM);
    let interval = null;
    if (opts.sigma && roots.length === 1) {
      const r1 = rootsFor(dRM + opts.sigma), r2 = rootsFor(dRM - opts.sigma);
      const cand = r1.concat(r2);
      if (cand.length) interval = [Math.min(...cand, roots[0]), Math.max(...cand, roots[0])];
    }
    return { roots, interval, curve: ks.map((k, i) => ({ kappa: k, dR: fs[i] })), range: [Math.min(...fs), Math.max(...fs)] };
  }

  /** δR as the heat source is scanned along a line (cf. SPCM line traces). */
  function lineScan(cfg, dev, p1, p2, n) {
    const rmodel = makeResistivityModel(cfg);
    const es = electricalState(cfg, dev, rmodel);
    const L = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const out = [];
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1);
      const src = { x: p1.x + s * (p2.x - p1.x), y: p1.y + s * (p2.y - p1.y) };
      const r = evaluate(cfg, dev, { source: src, rmodel, es });
      out.push({ pos: s * L, dR: r.dR, peak: r.peakRise, signal: r.signal });
    }
    return out;
  }

  /** δR vs phonon mean free path (Guyer–Krumhansl or ballistic model). */
  function sweepMFP(cfg, dev, lmin, lmax, n) {
    const rmodel = makeResistivityModel(cfg);
    const es = electricalState(cfg, dev, rmodel);
    const out = [];
    for (let i = 0; i < n; i++) {
      const l = lmin * Math.pow(lmax / lmin, i / (n - 1));
      const c = JSON.parse(JSON.stringify(cfg));
      c.material.l = l;
      if (c.material.model === 'fourier') c.material.model = 'gk';
      const r = evaluate(c, dev, { rmodel, es });
      out.push({ l, dR: r.dR, peak: r.peakRise });
    }
    return out;
  }

  const api = {
    buildDevice, evaluate, fitKappa, sweepKappa, lineScan, sweepMFP, measuredDeltaR,
    electricalState, makeResistivityModel, thermalParams, deliveredPower, KB, QE,
  };
  root.BS = root.BS || {};
  root.BS.bolometer = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

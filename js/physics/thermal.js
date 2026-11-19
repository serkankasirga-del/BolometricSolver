/*
 * Analytical steady-state temperature field of a thin crystal partly suspended
 * over a circular substrate hole and heated by a Gaussian source
 * (focused laser = optical bolometric thermometry, OBT; or a hot AFM tip =
 * mechanical bolometric thermometry, MBT).
 *
 * Governing equations (Çakıroğlu et al., 2D Mater. 2020; Kasırga & Köker, IJHMT 2025):
 *
 *   suspended,  r < a :  κ ∇²T + S(ρ)                    = 0      (Fourier)
 *                         κ ∇²T + S(ρ) − l² ∇²S(ρ)       = 0      (Guyer–Krumhansl, steady)
 *   supported,  r ≥ a :  κ' ∇²T − (G/t)(T − T0) + S(ρ)   = 0
 *
 *   S(ρ) = S0 exp(−ρ²/r0²),   S0 = Q / (π r0² t),   ρ = |x − x_source|
 *
 * The source may sit anywhere (not only at the hole centre). The solution is
 * built exactly as
 *     T = P_in(ρ)  + Σ_n A_n (r/a)^n          e^{inθ}   (r < a)
 *     T = P_out(ρ) + Σ_n B_n K_n(βr)/K_n(βa)  e^{inθ}   (r ≥ a),   β² = G/(κ' t)
 * where P_in / P_out are free-space particular solutions centred on the source
 * and the angular coefficients follow from continuity of T and of the radial
 * heat flux at r = a.  For a source at the hole centre only n = 0 survives and
 * the result reduces to the closed form of the 2D Materials paper:
 *     T1 = c1 + c2 ln r − (S0 r0²/4κ) E1(r²/r0²) ,  T2 = c3 I0(βr) + c4 K0(βr) + T0.
 *
 * Particular solutions (closed form / Hankel transform):
 *   P_in(ρ)   = −(S0 r0²/4κ) Ein(ρ²/r0²)              [+ (l²/κ) S(ρ) for GK]
 *   P_in'(ρ)  = −(S0 r0²/2κρ) (1 − e^{−ρ²/r0²})
 *   P_out(ρ)  =  (S0 r0²/2κ') ∫ u J0(uρ/r0) e^{−u²/4} /(u² + β²r0²) du
 *             →  (Q/2πκ't) e^{β²r0²/4} K0(βρ)         (ρ ≫ r0, exponentially exact)
 *
 * In the Guyer–Krumhansl case (∇·q = S, q − l²∇²q = −κ∇T) the flux is
 * q = −κ∇T + l²∇S, so the l² part of T carries no net flux: it adds a localised
 * hot spot (l²/κ) S(ρ) while flux matching uses the Fourier part only.
 */
(function (root) {
  'use strict';
  const sp = (typeof module !== 'undefined' && module.exports) ? require('../math/special.js') : root.BS.special;

  const NEAR_EXP = 46; // exp(-46) ~ 1e-20: far-field formula is exact beyond this

  /** Effective in-plane conductivity of the suspended part for a given transport model. */
  function effectiveKappa(kappa, model, l, holeRadius) {
    if (model === 'ballistic') {
      // Ballistic–diffusive (EPRT-type) suppression with Knudsen number Kn = l / L, L = hole diameter
      const Kn = l / (2 * holeRadius);
      return kappa / (1 + (4 / 3) * Kn);
    }
    return kappa;
  }

  /**
   * Build the exterior (supported) particular solution P_out per unit S0:
   * returns { val(ρ), der(ρ) }.
   */
  function buildOuterParticular(r0, beta, kappaSup) {
    const b = beta * r0;
    const C = r0 * r0 / (2 * kappaSup); // per unit S0
    const shift = b * b / 4;
    const rhoSw = r0 * Math.sqrt(shift + NEAR_EXP);
    const uMax = 2 * Math.sqrt(NEAR_EXP + 4);

    function hankel(rho) {
      const s = rho / r0;
      const nInt = Math.max(800, Math.ceil(uMax * s * 6) * 2);
      const v = sp.simpson((u) => u * sp.besselJ0(u * s) * Math.exp(-u * u / 4) / (u * u + b * b), 0, uMax, nInt);
      const d = sp.simpson((u) => -u * u * sp.besselJ1(u * s) * Math.exp(-u * u / 4) / (u * u + b * b), 0, uMax, nInt);
      return [C * v, C * d / r0];
    }

    // Near-field table (cubic Hermite interpolation)
    const M = 200;
    const h = rhoSw / M;
    const tv = new Float64Array(M + 1), td = new Float64Array(M + 1);
    for (let i = 0; i <= M; i++) {
      const [v, d] = hankel(i * h);
      tv[i] = v; td[i] = d;
    }

    function far(rho) {
      const x = beta * rho;
      const ex = Math.exp(shift - x);
      return [C * sp.besselK0e(x) * ex, -C * beta * sp.besselK1e(x) * ex];
    }

    function evalBoth(rho) {
      if (rho >= rhoSw) return far(rho);
      const f = rho / h;
      const i = Math.min(M - 1, Math.floor(f));
      const s = f - i;
      const s2 = s * s, s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
      const v = h00 * tv[i] + h10 * h * td[i] + h01 * tv[i + 1] + h11 * h * td[i + 1];
      // derivative of the Hermite interpolant
      const d00 = (6 * s2 - 6 * s) / h, d10 = 3 * s2 - 4 * s + 1, d01 = (-6 * s2 + 6 * s) / h, d11 = 3 * s2 - 2 * s;
      const d = d00 * tv[i] + d10 * td[i] + d01 * tv[i + 1] + d11 * td[i + 1];
      return [v, d];
    }
    return { evalBoth, rhoSw, _hankel: hankel, _far: far };
  }

  /**
   * Solve the thermal problem.
   * @param {object} p
   *   hole: {cx, cy, a}            hole centre and radius [m]
   *   source: {x, y, r0}           source centre and 1/e radius [m]  (S ∝ exp(−ρ²/r0²))
   *   Q                            absorbed power [W]
   *   t                            thickness [m]
   *   kappa                        in-plane thermal conductivity of suspended part [W/mK]
   *   kappaSup                     thermal conductivity of supported part [W/mK]
   *   G                            thermal boundary conductance to the substrate [W/m²K]
   *   model                        'fourier' | 'gk' | 'ballistic'
   *   l                            phonon mean free path [m] (GK / ballistic)
   *   nModes                       max angular modes (default 192)
   * @returns solution with rise(x,y) [K above T0], linear in Q (see .scaled(Q))
   */
  function solve(p) {
    const a = p.hole.a;
    const t = p.t;
    const r0 = p.source.r0;
    const model = p.model || 'fourier';
    const l = p.l || 0;
    const kIn = effectiveKappa(p.kappa, model, l, a);
    const kOut = p.kappaSup;
    const G = Math.max(p.G, 1e-6);
    const beta = Math.sqrt(G / (kOut * t));
    const gkCoef = model === 'gk' ? (l * l) / kIn : 0;

    // Per unit S0; scaled by S0 = Q/(π r0² t) at the end
    const S0unit = 1;
    const cIn = -S0unit * r0 * r0 / (4 * kIn);
    const outer = buildOuterParticular(r0, beta, kOut);

    function pin(rho) { // value (incl. GK hot spot) and Fourier derivative
      const x = (rho * rho) / (r0 * r0);
      const v = cIn * sp.Ein(x) + gkCoef * S0unit * Math.exp(-x);
      const d = rho < 1e-14 * r0 ? 0 : (2 * cIn / rho) * (-Math.expm1(-x));
      return [v, d];
    }

    const sx = p.source.x - p.hole.cx, sy = p.source.y - p.hole.cy;
    const sDist = Math.hypot(sx, sy);
    const concentric = sDist < 1e-9 * a;
    let Nmax = concentric ? 0 : (p.nModes || 192);

    // ---- angular decomposition of particular solutions on r = a ----
    const Ns = concentric ? 1 : Math.max(64, 2 * Nmax + 2);
    const fin = new Float64Array(Ns), gin = new Float64Array(Ns), fout = new Float64Array(Ns), gout = new Float64Array(Ns);
    for (let j = 0; j < Ns; j++) {
      const th = (2 * Math.PI * j) / Ns;
      const ct = Math.cos(th), st = Math.sin(th);
      const px = a * ct - sx, py = a * st - sy; // vector from source to boundary point
      const rho = Math.hypot(px, py);
      const proj = rho > 0 ? (px * ct + py * st) / rho : 1; // ∂ρ/∂r
      const [vi, di] = pin(rho);
      const [vo, dd] = outer.evalBoth(rho);
      fin[j] = vi; gin[j] = di * proj; fout[j] = vo; gout[j] = dd * proj;
    }
    const lnTabA = sp.lnKnTable(beta * a, Math.max(Nmax, 1));

    const Ac = new Float64Array(Nmax + 1), As = new Float64Array(Nmax + 1);
    const Bc = new Float64Array(Nmax + 1), Bs = new Float64Array(Nmax + 1);
    for (let n = 0; n <= Nmax; n++) {
      let fic = 0, fis = 0, gic = 0, gis = 0, foc = 0, fos = 0, goc = 0, gos = 0;
      for (let j = 0; j < Ns; j++) {
        const th = (2 * Math.PI * j * n) / Ns;
        const c = Math.cos(th), s = Math.sin(th);
        fic += fin[j] * c; fis += fin[j] * s; gic += gin[j] * c; gis += gin[j] * s;
        foc += fout[j] * c; fos += fout[j] * s; goc += gout[j] * c; gos += gout[j] * s;
      }
      const norm = n === 0 ? 1 / Ns : 2 / Ns;
      const L = beta * lnTabA.dlog[n];
      const den = kIn * n / a - kOut * L;
      const solveMode = (Pin, dPin, Pout, dPout) => {
        const A = (kOut * dPout - kIn * dPin + kOut * L * (Pin - Pout)) / den;
        return [A, Pin - Pout + A];
      };
      [Ac[n], Bc[n]] = solveMode(fic * norm, gic * norm, foc * norm, goc * norm);
      if (n > 0) [As[n], Bs[n]] = solveMode(fis * norm, gis * norm, fos * norm, gos * norm);
    }
    // Truncate negligible modes
    let nEff = 0;
    const scale = Math.abs(Ac[0]) + Math.abs(Bc[0]) + 1e-300;
    for (let n = Nmax; n > 0; n--) {
      if (Math.abs(Ac[n]) + Math.abs(As[n]) + Math.abs(Bc[n]) + Math.abs(Bs[n]) > 1e-10 * scale) { nEff = n; break; }
    }

    const S0 = p.Q / (Math.PI * r0 * r0 * t);

    /** Temperature rise above T0 at (x, y) for the actual Q. */
    function rise(x, y) {
      const dx = x - p.hole.cx, dy = y - p.hole.cy;
      const r = Math.hypot(dx, dy);
      const rho = Math.hypot(x - p.source.x, y - p.source.y);
      let T;
      if (r < a) {
        T = pin(rho)[0] + Ac[0];
        if (nEff > 0) {
          const ct = r > 0 ? dx / r : 1, st = r > 0 ? dy / r : 0;
          const q = r / a;
          let qn = 1, cn = 1, sn = 0;
          for (let n = 1; n <= nEff; n++) {
            qn *= q;
            const c2 = cn * ct - sn * st; sn = sn * ct + cn * st; cn = c2;
            T += qn * (Ac[n] * cn + As[n] * sn);
            if (qn < 1e-16) break;
          }
        }
      } else {
        T = outer.evalBoth(rho)[0];
        const tab = nEff > 0 ? sp.lnKnTable(beta * r, nEff) : null;
        const lnK0r = tab ? tab.lnK[0] : Math.log(sp.besselK0e(beta * r)) - beta * r;
        T += Bc[0] * Math.exp(lnK0r - lnTabA.lnK[0]);
        if (nEff > 0) {
          const ct = dx / r, st = dy / r;
          let cn = 1, sn = 0;
          for (let n = 1; n <= nEff; n++) {
            const c2 = cn * ct - sn * st; sn = sn * ct + cn * st; cn = c2;
            const ratio = Math.exp(tab.lnK[n] - lnTabA.lnK[n]);
            if (ratio < 1e-18) break;
            T += ratio * (Bc[n] * cn + Bs[n] * sn);
          }
        }
      }
      return S0 * T;
    }

    return {
      rise,
      Q: p.Q,
      S0,
      beta,
      kappaEff: kIn,
      nModes: nEff,
      concentric,
      peakRise: rise(p.source.x, p.source.y),
      params: p,
    };
  }

  /** Convenience: solution rescaled to absorbed power Q (field is linear in Q). */
  function withPower(p, Q) { return solve(Object.assign({}, p, { Q })); }

  const api = { solve, withPower, effectiveKappa, buildOuterParticular };
  root.BS = root.BS || {};
  root.BS.thermal = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

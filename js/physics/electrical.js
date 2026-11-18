/*
 * Electrical model of the drawn device: current flow in an arbitrarily shaped
 * thin crystal with metal contacts underneath (finite-volume, unit sheet conductance).
 *
 * The heat-transport part of the solver is analytical; the drawn crystal and
 * contact shapes are generally not, so the cold current distribution is computed
 * once on a grid.  The bolometric resistance change then follows from the exact
 * first-order (reciprocity / Joule-power) perturbation formula
 *
 *     δR = (1 / I I') Σ_faces  δg · ΔV ΔV'         (discrete form of  δR = ∫ δρ J·J' dV / (I I'))
 *
 * where V is the field for current injected through I+/I− and V' the field for
 * current injected through V+/V− (V' = V for a two-terminal measurement).
 * Each crystal cell therefore receives a weight w such that
 *
 *     δR = (ρ0 / t) Σ_cells w_cell · δρ_cell/ρ0 ,        R_sample = (ρ0 / t) · R_unit .
 *
 * Contacts are metal pads under the flake: current contacts are equipotential
 * (Dirichlet) and all other pads are floating, highly conductive regions.
 */
(function (root) {
  'use strict';

  const SIGMA_METAL = 1e5;

  function pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function bbox(poly) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x0, y0, x1, y1 };
  }

  /** Preconditioned conjugate gradients for a symmetric 5-point operator. */
  function solveCG(n, applyA, b, diag, x, tol, maxIt) {
    const r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n);
    applyA(x, Ap);
    let bn = 0;
    for (let i = 0; i < n; i++) { r[i] = b[i] - Ap[i]; bn += b[i] * b[i]; }
    bn = Math.sqrt(bn) || 1;
    for (let i = 0; i < n; i++) { z[i] = r[i] / diag[i]; p[i] = z[i]; }
    let rz = 0;
    for (let i = 0; i < n; i++) rz += r[i] * z[i];
    let it = 0, rn = 0;
    for (; it < maxIt; it++) {
      applyA(p, Ap);
      let pAp = 0;
      for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
      const alpha = rz / pAp;
      rn = 0;
      for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; rn += r[i] * r[i]; }
      if (Math.sqrt(rn) < tol * bn) break;
      let rzNew = 0;
      for (let i = 0; i < n; i++) { z[i] = r[i] / diag[i]; rzNew += r[i] * z[i]; }
      const beta = rzNew / rz;
      rz = rzNew;
      for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    }
    return { iterations: it, residual: Math.sqrt(rn) / bn };
  }

  /**
   * Build the grid and solve.
   * @param {object} g { crystal: [[x,y],...] (m), contacts: [{poly, role}], resolution: cells on long side }
   *   roles: 'I+', 'I-', 'V+', 'V-', 'none'.  If no V± are given → two-terminal.
   */
  function solveDevice(g) {
    const crystal = g.crystal;
    if (!crystal || crystal.length < 3) throw new Error('Draw the crystal boundary first (≥ 3 points).');
    const contacts = g.contacts || [];
    const iPlus = contacts.findIndex((c) => c.role === 'I+');
    const iMinus = contacts.findIndex((c) => c.role === 'I-');
    if (iPlus < 0 || iMinus < 0) throw new Error('Assign one contact as I+ (source) and one as I− (drain).');
    const vPlus = contacts.findIndex((c) => c.role === 'V+');
    const vMinus = contacts.findIndex((c) => c.role === 'V-');
    const fourProbe = vPlus >= 0 && vMinus >= 0;

    const bb = bbox(crystal);
    const N = g.resolution || 160;
    const dx = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) / N;
    const nx = Math.max(3, Math.ceil((bb.x1 - bb.x0) / dx));
    const ny = Math.max(3, Math.ceil((bb.y1 - bb.y0) / dx));
    const x0 = bb.x0, y0 = bb.y0;
    const nc = nx * ny;

    // cell labels: -1 outside, 0 crystal, k+1 → contact k (inside crystal)
    const label = new Int32Array(nc).fill(-1);
    const cbb = contacts.map((c) => bbox(c.poly));
    for (let j = 0; j < ny; j++) {
      const y = y0 + (j + 0.5) * dx;
      for (let i = 0; i < nx; i++) {
        const x = x0 + (i + 0.5) * dx;
        if (!pointInPolygon(x, y, crystal)) continue;
        let lab = 0;
        for (let k = 0; k < contacts.length; k++) {
          const b = cbb[k];
          if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
          if (pointInPolygon(x, y, contacts[k].poly)) { lab = k + 1; break; }
        }
        label[j * nx + i] = lab;
      }
    }
    const counts = new Array(contacts.length).fill(0);
    let nCrystal = 0;
    for (let c = 0; c < nc; c++) { if (label[c] > 0) counts[label[c] - 1]++; if (label[c] === 0) nCrystal++; }
    for (const k of [iPlus, iMinus].concat(fourProbe ? [vPlus, vMinus] : [])) {
      if (counts[k] === 0) throw new Error(`Contact "${contacts[k].name || k + 1}" (${contacts[k].role}) does not overlap the crystal.`);
    }
    if (nCrystal === 0) throw new Error('No free crystal area between contacts.');

    const sigma = new Float64Array(nc);
    for (let c = 0; c < nc; c++) sigma[c] = label[c] < 0 ? 0 : label[c] === 0 ? 1 : SIGMA_METAL;
    const faceG = (a, b) => (sigma[a] > 0 && sigma[b] > 0 ? (2 * sigma[a] * sigma[b]) / (sigma[a] + sigma[b]) : 0);

    function fieldFor(kHigh, kLow) {
      // Dirichlet: contact kHigh → V = 1, kLow → V = 0
      const fixed = new Int8Array(nc);
      const V = new Float64Array(nc);
      for (let c = 0; c < nc; c++) {
        if (label[c] === kHigh + 1) { fixed[c] = 1; V[c] = 1; }
        else if (label[c] === kLow + 1) { fixed[c] = 1; V[c] = 0; }
      }
      // unknown indexing
      const idx = new Int32Array(nc).fill(-1);
      const cells = [];
      for (let c = 0; c < nc; c++) if (sigma[c] > 0 && !fixed[c]) { idx[c] = cells.length; cells.push(c); }
      const n = cells.length;
      const diag = new Float64Array(n), rhs = new Float64Array(n);
      const nb = new Int32Array(4 * n).fill(-1), nbG = new Float64Array(4 * n);
      for (let u = 0; u < n; u++) {
        const c = cells[u], i = c % nx, j = (c / nx) | 0;
        const neigh = [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, j > 0 ? c - nx : -1, j < ny - 1 ? c + nx : -1];
        for (let q = 0; q < 4; q++) {
          const m = neigh[q];
          if (m < 0) continue;
          const gf = faceG(c, m);
          if (gf === 0) continue;
          diag[u] += gf;
          if (fixed[m]) rhs[u] += gf * V[m];
          else { nb[4 * u + q] = idx[m]; nbG[4 * u + q] = gf; }
        }
        if (diag[u] === 0) diag[u] = 1; // isolated island (should not happen)
      }
      const applyA = (xv, out) => {
        for (let u = 0; u < n; u++) {
          let s = diag[u] * xv[u];
          for (let q = 0; q < 4; q++) { const m = nb[4 * u + q]; if (m >= 0) s -= nbG[4 * u + q] * xv[m]; }
          out[u] = s;
        }
      };
      const xsol = new Float64Array(n).fill(0.5);
      const info = solveCG(n, applyA, rhs, diag, xsol, 1e-11, 20000);
      for (let u = 0; u < n; u++) V[cells[u]] = xsol[u];
      // injected current: flux out of the high contact
      let I = 0;
      for (let c = 0; c < nc; c++) {
        if (label[c] !== kHigh + 1) continue;
        const i = c % nx, j = (c / nx) | 0;
        for (const m of [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, j > 0 ? c - nx : -1, j < ny - 1 ? c + nx : -1]) {
          if (m < 0 || label[m] === kHigh + 1) continue;
          I += faceG(c, m) * (V[c] - V[m]);
        }
      }
      return { V, I, info };
    }

    const A = fieldFor(iPlus, iMinus);
    const B = fourProbe ? fieldFor(vPlus, vMinus) : A;

    // Cell weights from face sensitivities: ∂g/∂σ_a = 2σ_b²/(σ_a+σ_b)²; δσ_a = −σ_a δ_a (δ = δρ/ρ)
    const w = new Float64Array(nc);
    const norm = 1 / (A.I * B.I);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        if (sigma[c] <= 0) continue;
        for (const m of [i < nx - 1 ? c + 1 : -1, j < ny - 1 ? c + nx : -1]) {
          if (m < 0 || sigma[m] <= 0) continue;
          const sa = sigma[c], sb = sigma[m], s = sa + sb;
          const prod = (A.V[c] - A.V[m]) * (B.V[c] - B.V[m]) * norm;
          if (label[c] === 0) w[c] += (2 * sb * sb / (s * s)) * sa * prod;
          if (label[m] === 0) w[m] += (2 * sa * sa / (s * s)) * sb * prod;
        }
      }
    }
    // Cold resistance in units of (ρ0/t)
    let Runit;
    if (fourProbe) {
      const avgV = (k) => { let s = 0, n = 0; for (let c = 0; c < nc; c++) if (label[c] === k + 1) { s += A.V[c]; n++; } return s / n; };
      Runit = (avgV(vPlus) - avgV(vMinus)) / A.I;
    } else Runit = 1 / A.I;
    const R2unit = 1 / A.I; // between current contacts (always available)

    let wSum = 0;
    for (let c = 0; c < nc; c++) wSum += w[c];

    return {
      nx, ny, dx, x0, y0, label, w, Vsrc: A.V, Vsense: B.V, Iunit: A.I,
      Runit, R2unit, fourProbe, wSum,
      solverInfo: { current: A.info, sense: B.info },
      cellCenter: (c) => [x0 + ((c % nx) + 0.5) * dx, y0 + (((c / nx) | 0) + 0.5) * dx],
    };
  }

  const api = { solveDevice, pointInPolygon, bbox };
  root.BS = root.BS || {};
  root.BS.electrical = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

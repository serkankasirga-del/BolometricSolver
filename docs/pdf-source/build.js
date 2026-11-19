const fs = require('fs');
const katex = require('katex');
const D = JSON.parse(fs.readFileSync('data.json', 'utf8'));
let src = fs.readFileSync('content.html', 'utf8');

// ---------------- math ----------------
src = src.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => katex.renderToString(m, { displayMode: true, throwOnError: true, trust: true }));
src = src.replace(/\$([^$\n]+?)\$/g, (_, m) => katex.renderToString(m, { displayMode: false, throwOnError: true }));

// ---------------- plotting (SVG) ----------------
const C = ['#1d4ed8', '#d97706', '#059669', '#9333ea', '#dc2626'];
function nice(min, max, n) {
  const span = max - min, st0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(st0))), r = st0 / mag;
  const st = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag; const t = [];
  for (let v = Math.ceil(min / st - 1e-9) * st; v <= max + st * 1e-9; v += st) t.push(+v.toPrecision(10));
  return t;
}
const fmt = (v) => { const a = Math.abs(v); if (v === 0) return '0'; if (a >= 1e4 || a < 1e-3) return v.toExponential(0).replace('e+', 'e'); return String(+v.toPrecision(3)); };
function plot(o) {
  const W = o.w || 340, H = o.h || 230, L = 52, R = 10, T = 22, B = 40;
  const tx = (v) => (o.logx ? Math.log10(v) : v), ty = (v) => (o.logy ? Math.log10(v) : v);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of o.series) s.x.forEach((x, i) => { const X = tx(x), Y = ty(s.y[i]); if (!isFinite(X) || !isFinite(Y)) return; x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); });
  if (o.ymin != null) y0 = ty(o.ymin); if (o.ymax != null) y1 = ty(o.ymax);
  if (!o.logy) { const p = (y1 - y0) * 0.05; y1 += p; if (y0 !== 0) y0 -= p; }
  const px = (X) => L + (X - x0) / (x1 - x0) * (W - L - R), py = (Y) => H - B - (Y - y0) / (y1 - y0) * (H - T - B);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif" font-size="10">`;
  const xt = o.logx ? range(Math.ceil(x0), Math.floor(x1)).map((e) => [e, '10' + sup(e)]) : nice(x0, x1, 5).map((v) => [v, fmt(v)]);
  const yt = o.logy ? range(Math.ceil(y0), Math.floor(y1)).map((e) => [e, '10' + sup(e)]) : nice(y0, y1, 5).map((v) => [v, fmt(v)]);
  for (const [v, lab] of xt) { const X = px(v); s += `<line x1="${X}" y1="${T}" x2="${X}" y2="${H - B}" stroke="#e5e7eb"/><text x="${X}" y="${H - B + 13}" text-anchor="middle" fill="#374151">${lab}</text>`; }
  for (const [v, lab] of yt) { const Y = py(v); if (Y < T - 1 || Y > H - B + 1) continue; s += `<line x1="${L}" y1="${Y}" x2="${W - R}" y2="${Y}" stroke="#e5e7eb"/><text x="${L - 4}" y="${Y + 3}" text-anchor="end" fill="#374151">${lab}</text>`; }
  for (const v of o.vlines || []) { const X = px(tx(v.x)); s += `<line x1="${X}" y1="${T}" x2="${X}" y2="${H - B}" stroke="#6b7280" stroke-dasharray="3 3"/>${v.label ? `<text x="${X + 3}" y="${o.vlabelTop ? T + 10 : H - B - 4}" fill="#6b7280" font-size="9">${v.label}</text>` : ''}`; }
  s += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="none" stroke="#6b7280"/>`;
  s += `<clipPath id="c${o.id}"><rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/></clipPath><g clip-path="url(#c${o.id})">`;
  o.series.forEach((se, k) => {
    const pts = se.x.map((x, i) => [tx(x), ty(se.y[i])]).filter(([X, Y]) => isFinite(X) && isFinite(Y)).map(([X, Y]) => `${px(X).toFixed(2)},${py(Y).toFixed(2)}`).join(' ');
    s += `<polyline points="${pts}" fill="none" stroke="${se.color || C[k]}" stroke-width="1.8" ${se.dash ? `stroke-dasharray="${se.dash}"` : ''}/>`;
  });
  s += '</g>';
  s += `<text x="${L + (W - L - R) / 2}" y="${H - 8}" text-anchor="middle" fill="#111" font-size="11">${o.xlabel}</text>`;
  s += `<text transform="translate(13 ${T + (H - T - B) / 2}) rotate(-90)" text-anchor="middle" fill="#111" font-size="11">${o.ylabel}</text>`;
  if (o.panel) s += `<text x="4" y="13" font-weight="700" font-size="12">${o.panel}</text>`;
  const nLeg = o.series.filter((x) => x.label).length;
  let ly = o.legendBottom ? H - B - 8 - 12 * (nLeg - 1) : T + 12; const lx = o.legendRight ? W - R - 150 : L + 8;
  o.series.forEach((se, k) => { if (!se.label) return; s += `<line x1="${lx}" y1="${ly - 3}" x2="${lx + 16}" y2="${ly - 3}" stroke="${se.color || C[k]}" stroke-width="1.8" ${se.dash ? `stroke-dasharray="${se.dash}"` : ''}/><text x="${lx + 20}" y="${ly}" fill="#111" font-size="9.5">${se.label}</text>`; ly += 12; });
  return s + '</svg>';
}
function range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }
function sup(e) { const m = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' }; return String(e).split('').map((c) => m[c]).join(''); }

function figure(content, n, caption) {
  return `<figure><div class="figrow">${content}</div><figcaption><b>Figure ${n}.</b> ${caption}</figcaption></figure>`;
}

// ---------------- schematic ----------------
const schematic = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 230" width="360" height="230" font-family="Helvetica, Arial, sans-serif" font-size="10">
  <defs><linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ef4444" stop-opacity="0.1"/><stop offset="1" stop-color="#ef4444" stop-opacity="0.75"/></linearGradient></defs>
  <text x="4" y="13" font-weight="700" font-size="12">a</text>
  <text x="180" y="14" text-anchor="middle" fill="#374151">cross-section (OBT: laser · MBT: AFM tip)</text>
  <polygon points="150,30 210,30 186,118 174,118" fill="url(#beam)"/>
  <text x="214" y="42" fill="#b91c1c">laser, P</text>
  <path d="M232 70 L262 70 L262 78 L246 78 L240 112 L236 78 L232 78 Z" fill="#6b7280"/>
  <text x="266" y="76" fill="#374151">or hot tip, Q</text>
  <rect x="20" y="130" width="320" height="70" fill="#d1d5db"/>
  <rect x="140" y="130" width="80" height="45" fill="#ffffff"/>
  <rect x="30" y="122" width="70" height="10" fill="#d4a628"/><rect x="260" y="122" width="70" height="10" fill="#d4a628"/>
  <rect x="45" y="116" width="270" height="6" fill="#3b6fc4"/>
  <text x="65" y="145" fill="#111">Au (I+)</text><text x="275" y="145" fill="#111">Au (I−)</text>
  <text x="180" y="190" text-anchor="middle" fill="#374151">substrate</text>
  <line x1="140" y1="170" x2="220" y2="170" stroke="#111"/><line x1="140" y1="165" x2="140" y2="175" stroke="#111"/><line x1="220" y1="165" x2="220" y2="175" stroke="#111"/><text x="180" y="166" text-anchor="middle">2a</text>
  <text x="322" y="114" fill="#1e3a8a">flake, t</text>
  <text x="104" y="112" fill="#374151" font-size="9">supported: κ′, G</text>
  <text x="180" y="150" text-anchor="middle" fill="#374151" font-size="9">suspended: κ (l)</text>
  <text x="180" y="218" text-anchor="middle" fill="#374151">V_B or I  →  lock-in  →  δR</text>
</svg>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 230" width="300" height="230" font-family="Helvetica, Arial, sans-serif" font-size="10">
  <text x="4" y="13" font-weight="700" font-size="12">b</text>
  <text x="150" y="14" text-anchor="middle" fill="#374151">top view (drawn in the GUI)</text>
  <polygon points="45,150 245,165 255,70 60,60" fill="#3b6fc4" fill-opacity="0.25" stroke="#2f5ea8" stroke-width="1.5"/>
  <rect x="20" y="40" width="70" height="145" fill="#d4a628" fill-opacity="0.7" stroke="#94700c"/>
  <rect x="215" y="40" width="70" height="145" fill="#d4a628" fill-opacity="0.7" stroke="#94700c"/>
  <circle cx="152" cy="110" r="30" fill="#111" fill-opacity="0.12" stroke="#333" stroke-dasharray="5 3"/>
  <circle cx="160" cy="105" r="7" fill="none" stroke="#dc2626" stroke-width="1.6"/><line x1="148" y1="105" x2="172" y2="105" stroke="#dc2626"/><line x1="160" y1="93" x2="160" y2="117" stroke="#dc2626"/>
  <line x1="152" y1="110" x2="182" y2="110" stroke="#333"/><text x="168" y="121" font-size="9">a</text>
  <text x="55" y="115" text-anchor="middle" font-weight="600">C1 · I+</text><text x="250" y="115" text-anchor="middle" font-weight="600">C2 · I−</text>
  <text x="152" y="76" text-anchor="middle" fill="#1e3a8a">crystal boundary</text>
  <text x="168" y="98" fill="#dc2626" font-size="9">source (x_s, y_s)</text>
  <text x="152" y="152" text-anchor="middle" fill="#333" font-size="9">substrate hole</text>
  <line x1="40" y1="205" x2="260" y2="205" stroke="#8a3ab9" stroke-dasharray="3 3"/><text x="150" y="220" text-anchor="middle" fill="#8a3ab9" font-size="9">optional scan line</text>
</svg>`;

// ---------------- flowchart ----------------
function box(x, y, w, h, title, lines, fill) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="#4b5563"/><text x="${x + w / 2}" y="${y + 15}" text-anchor="middle" font-weight="700" font-size="10.5">${title}</text>` +
    lines.map((l, i) => `<text x="${x + w / 2}" y="${y + 29 + i * 12}" text-anchor="middle" font-size="9.2" fill="#374151">${l}</text>`).join('');
}
const arrow = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#374151" stroke-width="1.4" marker-end="url(#ah)"/>`;
const flow = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 300" width="680" height="300" font-family="Helvetica, Arial, sans-serif">
<defs><marker id="ah" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#374151"/></marker></defs>
${box(10, 10, 200, 70, 'Drawn geometry', ['crystal polygon, contact pads + roles,', 'hole (centre, a), source, scan line'], '#e0ecff')}
${box(240, 10, 200, 70, 'Material & transport', ['t, κ, κ′, G, T₀', 'Fourier · Guyer–Krumhansl (l) · ballistic'], '#e0ecff')}
${box(470, 10, 200, 70, 'Heat delivery', ['Optical: Q = A·P, r₀', 'AFM tip: Q, δT* or (T_tip, G_TS), r₀'], '#e0ecff')}
${box(10, 115, 200, 80, 'Electrical solve (once)', ['rasterise, CG solve ∇·(σ∇V) = 0', 'reciprocity weights w_c, R_unit', '(2- or 4-terminal) — cached'], '#fff3d6')}
${box(240, 115, 200, 80, 'Analytical thermal field', ['particular solutions P_in, P_out', 'angular modes A_n, B_n (Eq. 9)', 'ΔT(x, y) per unit Q → θ, Q'], '#fff3d6')}
${box(470, 115, 200, 80, 'ρ(T) model', ['TCR α · activation E_A', 'R–T data (PCHIP), R_c subtraction', 'ρ₀ from ρ, R_sample or R(T₀)'], '#fff3d6')}
${box(150, 225, 380, 65, 'δR = (ρ₀/t) Σ w_c ⟨δρ/ρ₀⟩_c   (adaptive sub-cell sampling)', ['signals: I_bolo or V_bolo, R_c effect, Johnson + shot noise, SNR', 'outputs: maps, profiles · κ fit (log-bisection) · sweeps · line scans'], '#dcfce7')}
${arrow(110, 80, 110, 113)}${arrow(340, 80, 340, 113)}${arrow(570, 80, 570, 113)}
${arrow(210, 50, 238, 50)}${arrow(470, 50, 442, 50)}
${arrow(110, 195, 230, 223)}${arrow(340, 195, 340, 223)}${arrow(570, 195, 450, 223)}
</svg>`;

// ---------------- data figures ----------------
const prof = plot({ id: 1, panel: 'a', xlabel: 'x (µm)', ylabel: 'ΔT (K)', series: D.profiles.map((p) => ({ x: p.x, y: p.y, label: p.label })), vlines: [{ x: -1, label: 'hole edge' }, { x: 1 }], w: 300 });
const prof2 = plot({ id: 2, panel: 'b', xlabel: 'x (µm)', ylabel: 'ΔT (K)', series: [{ x: D.profiles[0].x, y: D.profiles[0].y, label: 'centred source' }, { x: D.offc.x, y: D.offc.y, label: 'off-centre, x_s = 0.6 µm' }], vlines: [{ x: -1 }, { x: 1 }], w: 300 });
const k1 = plot({ id: 3, panel: 'a', logx: true, logy: true, xlabel: 'κ (W m⁻¹ K⁻¹)', ylabel: 'δR (Ω)', series: D.kG.map((g) => ({ x: g.data.map((d) => d.kappa), y: g.data.map((d) => d.dR), label: g.label.replace('×10^', '×10').replace(/×10(\d)/, (m, e) => '×10' + sup(e)) })), legendBottom: true, vlabelTop: true, vlines: [{ x: 13.2, label: 'κ = 13.2' }], w: 300 });
const k2 = plot({ id: 4, panel: 'b', logx: true, logy: true, xlabel: 'κ (W m⁻¹ K⁻¹)', ylabel: 'δR (Ω)', series: [{ x: D.kOBT.map((d) => d.kappa), y: D.kOBT.map((d) => d.dR), label: 'OBT, Q = 3 µW' }, { x: D.kMBT.map((d) => d.kappa), y: D.kMBT.map((d) => d.dR), label: 'MBT, δT* = 1 K' }], legendRight: true, w: 300 });
const sc = plot({ id: 5, xlabel: 'source position along the crystal axis (µm)', ylabel: 'δR (mΩ)', series: [{ x: D.scan.map((d) => d.pos * 1e6 - 6.5), y: D.scan.map((d) => d.dR * 1e3), label: 'δR' }, { x: D.scan.map((d) => d.pos * 1e6 - 6.5), y: D.scan.map((d) => d.peak * 10), label: 'peak ΔT × 10 (K)', dash: '4 3' }], vlabelTop: true, vlines: [{ x: -1, label: 'hole' }, { x: 1 }, { x: -3, label: 'contact' }, { x: 3 }], w: 560, h: 230 });
const gui = `<img src="data:image/png;base64,${fs.readFileSync('gui.png').toString('base64')}" style="width:100%; border:1px solid #d1d5db; border-radius:4px">`;

const figs = {
  schematic: figure(schematic, 1, '(a) Device cross-section: a flake of thickness t is supported on contact pads and substrate and suspended over a hole of radius a. Heat is delivered by a focused laser (OBT) or a hot AFM tip (MBT), and the bolometric change δR is read out with a lock-in amplifier. (b) Top view of the quantities drawn in the GUI.'),
  flow: figure(flow, 2, 'Solver data flow. The electrical solution depends only on geometry and is cached, so fits, sweeps and line scans re-evaluate only the analytical temperature field and the weighted sum of Eq. (14).'),
  gui: figure(gui, 3, 'The GUI with the built-in example. Left: geometry editor with the temperature-rise overlay. Middle: material, transport model, heat delivery, electrical and measurement inputs. Right: results table, warnings and plots.'),
  profiles: figure(prof + prof2, 4, `(a) Temperature profiles through a centred optical source (Q = 3 µW, r₀ = 300 nm, a = 1 µm, 2H-TaS₂-like parameters). The Fourier solution is compared with Guyer–Krumhansl transport for increasing mean free path, which adds the localised term (l²/κ)S of Eq. (11). (b) The same Fourier problem with the source moved 0.6 µm off-centre, solved by the angular-mode expansion of Eq. (7) (${D.offc.modes} angular modes retained).`),
  kappa: figure(k1 + k2, 5, '(a) Predicted δR against κ for the example device under optical heating, for G spanning a factor of 20. The weak dependence on G near the physically relevant κ reflects Eq. (6) and matches Fig. 3c of [1]. (b) Optical heating at constant power compared with mechanical heating at a fixed contact temperature (r₀ = 20 nm). With δT* fixed, δR rises with κ, because a better conductor spreads the same peak temperature over a larger area.'),
  scan: figure(sc, 6, 'Simulated line scan along the device axis (cf. the SPCM line trace in Fig. 1g of [1]). The response is strongly enhanced over the suspended region and suppressed over the metal pads, where the current density vanishes. The source position is measured from the hole centre.'),
};
src = src.replace(/\{\{FIG:(\w+)\}\}/g, (_, k) => figs[k]);

// ---------------- tables ----------------
const e = D.example, m = D.exMBT;
const exTable = `<table class="nice"><thead><tr><th>Quantity</th><th>Optical (OBT)</th><th>Mechanical (MBT)</th></tr></thead><tbody>
<tr><td>Delivered power Q</td><td>${(e.Q * 1e6).toFixed(2)} µW</td><td>${(m.Q * 1e9).toFixed(0)} nW</td></tr>
<tr><td>Peak ΔT at the source</td><td>${e.peak.toFixed(3)} K</td><td>1.000 K (pinned)</td></tr>
<tr><td>Mean ΔT over the suspended area</td><td>${e.mean.toFixed(3)} K</td><td>—</td></tr>
<tr><td>Thermal healing length √(κ′t/G)</td><td colspan="2" style="text-align:center">${(e.heal * 1e9).toFixed(1)} nm</td></tr>
<tr><td>Sample resistance R<sub>s</sub> / with contacts R<sub>tot</sub></td><td colspan="2" style="text-align:center">${e.Rs.toFixed(1)} Ω / ${e.Rtot.toFixed(1)} Ω</td></tr>
<tr><td>δR</td><td>${(e.dR * 1e3).toFixed(2)} mΩ</td><td>${(m.dR * 1e3).toFixed(2)} mΩ</td></tr>
<tr><td>δR / R<sub>s</sub></td><td>${(e.dRrel * 1e6).toFixed(0)} ppm</td><td>${(m.dRrel * 1e6).toFixed(1)} ppm</td></tr>
<tr><td>Bolometric current at V<sub>B</sub> = 50 mV</td><td>${(e.Ibolo * 1e9).toFixed(1)} nA</td><td>—</td></tr>
<tr><td>SNR (Δf = 1 Hz)</td><td>${e.snr.toExponential(1)}</td><td>${m.snr.toExponential(1)}</td></tr>
</tbody></table>`;
const en = D.energy;
const valTable = `<table class="nice"><thead><tr><th>Test</th><th>Reference</th><th>Result</th></tr></thead><tbody>
<tr><td>Special functions</td><td>Tabulated values of E₁, Ein, J₀, J₁, K₀, K₁, K<sub>n</sub></td><td>Relative error ≤ 10⁻⁶</td></tr>
<tr><td>Centred closed form (Eq. 4)</td><td>Independent radial finite-volume solution (40 000 shells)</td><td>Deviation &lt; 0.2 % of the peak at r = 0, 0.5a, 0.98a, 1.02a, 1.5a, for three (r₀, κ, G, t) sets</td></tr>
<tr><td>Off-centre source (Eq. 7–9)</td><td>2D finite-volume solution, 220 × 220 grid</td><td>Agreement within 2 % at five points inside and outside the hole</td></tr>
<tr><td>Energy conservation</td><td>∫ G ΔT dA over the supported region = Q</td><td>${en.map((x) => x.ratio.toFixed(5)).join(' / ')} (source at 0, 0.5 µm, and 1.6 µm, i.e. on the support)</td></tr>
<tr><td>Small-spot limit</td><td>Eq. (6)</td><td>1.787 K, equal to the full solution (§10)</td></tr>
<tr><td>Guyer–Krumhansl</td><td>l → 0 limit; hot-spot amplitude l²S₀/κ</td><td>Identical to Fourier at l = 0; amplitude within 10⁻⁹; far field unchanged</td></tr>
<tr><td>Electrical solver</td><td>Bar of 3 squares; 4-terminal bar of 2 squares</td><td>R = ${D.bar.R.toFixed(7)}, Σw = ${D.bar.w.toFixed(7)}; 4-terminal 2.00000</td></tr>
<tr><td>ρ(T) models</td><td>Linear R–T data, R<sub>c</sub> subtraction</td><td>α and R(T₀) recovered exactly</td></tr>
<tr><td>κ fit round trip</td><td>Synthetic δR at κ = 7.5 W m⁻¹ K⁻¹</td><td>κ = ${D.fit.k.toFixed(6)} (in ${(D.fit.ms / 1000).toFixed(1)} s)</td></tr>
<tr><td>Contact resistance</td><td>R<sub>c</sub> = R<sub>s</sub>/2 per contact</td><td>δR unchanged; I<sub>bolo</sub> scaled by 0.250 = (R<sub>s</sub>/R<sub>tot</sub>)²; I<sub>PC</sub> → δR inverse exact</td></tr>
<tr><td>MBT heat specification</td><td>δT* and G<sub>TS</sub> modes</td><td>Peak = δT* exactly; Q = G<sub>TS</sub>(T<sub>tip</sub> − T<sub>contact</sub>)</td></tr>
<tr><td>Symmetry and continuity</td><td>Source at ±0.3 µm; source offset → 0</td><td>Mirror-symmetric δR within 0.2 %; continuous at the centre</td></tr>
</tbody></table>`;
src = src.replace('{{TABLE:example}}', exTable).replace('{{TABLE:validation}}', valTable);
src = src.replace('{{DATE}}', 'November 2026');

const katexCss = fs.readFileSync('node_modules/katex/dist/katex.min.css', 'utf8').replace(/url\(fonts\//g, 'url(node_modules/katex/dist/fonts/');
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Bolometric Thermometry Solver — Theory and Implementation</title>
<style>${katexCss}</style><style>${fs.readFileSync('doc.css', 'utf8')}</style></head><body>${src}</body></html>`;
fs.writeFileSync('doc.html', html);
console.log('ok', html.length);

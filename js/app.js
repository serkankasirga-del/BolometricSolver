/* Application controller: state, form binding, computation pipeline, overlays and plots. */
(function () {
  'use strict';
  const BS = window.BS;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const um = 1e-6;

  // ------------------------------------------------------------------ state
  function exampleRT() {
    // Synthetic metallic R–T curve (≈ 2H-TaS2-like slope) for demonstration only.
    const rows = ['# T (K)   R (Ohm)   -- example data, replace with your measurement'];
    for (let T = 250; T <= 340; T += 10) rows.push(`${T}\t${(100 * (1 + 0.0025 * (T - 295) + 2e-6 * (T - 295) ** 2)).toFixed(4)}`);
    return rows.join('\n');
  }

  function exampleGeom() {
    return {
      crystal: [[-7, -2.6], [6.5, -3.0], [7.2, 2.4], [-6.2, 3.1]],
      contacts: [
        { name: 'C1', poly: [[-9, -4], [-3, -4], [-3, 4], [-9, 4]], role: 'I+', Rc: 20, rect: true },
        { name: 'C2', poly: [[3, -4], [9, -4], [9, 4], [3, 4]], role: 'I-', Rc: 20, rect: true },
      ],
      hole: { cx: 0, cy: 0, a: 1 },
      source: [0, 0],
      scan: { p1: [-6, 0], p2: [6, 0] },
    };
  }

  const defaults = {
    preset: '2H-TaS2', t_nm: 32, T0: 295, kappa: 13.2, kappaSup: 13.2, tieKappa: true, G: '5e7',
    model: 'fourier', l_nm: 50,
    heatMethod: 'optical', P_uW: 10, absorbance: 0.3, spot_nm: 300, spotKind: 'r0', wavelength_nm: 642,
    tip_r0_nm: 20, mechMode: 'contactTemp', dTc: 1, Q_nW: 500, Ttip: 300, Gts: '1e-7',
    rModel: 'tcr', alpha: '0.0025', EA: 0.1, rtText: exampleRT(), rtIncludesRc: false,
    rhoKind: 'resistivity', rho_uOhmcm: '400', Rsample: '100',
    biasMode: 'cv', V_mV: 50, I_uA: 100, bandwidth: 1, resolution: 160,
    measKind: 'dR', measValue: '', measSigma: '',
  };

  const state = {
    geom: exampleGeom(),
    p: Object.assign({}, defaults),
    last: null,
    plots: { kappa: null, scan: null, mfp: null, fit: null },
  };

  // ------------------------------------------------------------------ editor
  const editor = new BS.Editor($('#canvas'), state.geom, onGeomChange, onSelect);
  editor.onCursor = (w) => { $('#cursorReadout').textContent = `x = ${w[0].toFixed(3)} µm, y = ${w[1].toFixed(3)} µm`; };

  const hints = {
    select: 'Click to select · drag to move · drag handles to reshape · drag empty space to pan · wheel to zoom · Del deletes',
    'crystal-poly': 'Click crystal-boundary vertices · double-click / Enter / click first point to close · Esc cancels',
    'crystal-rect': 'Drag to draw the crystal as a rectangle',
    'contact-rect': 'Drag to draw a contact pad (first two contacts get I+ and I−)',
    'contact-poly': 'Click contact vertices · double-click / Enter to close',
    hole: 'Drag from the hole centre outwards to set its radius',
    source: 'Click to place the laser spot / AFM tip',
    scan: 'Drag to define the line-scan path',
  };
  $$('#toolbar [data-tool]').forEach((b) => b.addEventListener('click', () => {
    $$('#toolbar [data-tool]').forEach((x) => x.classList.toggle('active', x === b));
    editor.setTool(b.dataset.tool);
    $('#hint').textContent = hints[b.dataset.tool] || '';
  }));
  $('#hint').textContent = hints.select;
  $('#btnDelete').addEventListener('click', () => editor.deleteSelected());
  $('#btnFit').addEventListener('click', () => editor.fit());
  $('#snap').addEventListener('change', (e) => { editor.snap = e.target.checked; });
  $('#overlay').addEventListener('change', () => { updateOverlay(); editor.render(); });

  function onGeomChange() {
    state.plots.scan = null;
    syncGeomInputs();
    renderContacts();
    schedule();
  }
  function onSelect(sel) {
    $$('#contactsTable tbody tr').forEach((tr, i) => tr.classList.toggle('sel', !!(sel && sel.type === 'contact' && sel.index === i)));
  }

  // ------------------------------------------------------------------ contacts table
  function renderContacts() {
    const tb = $('#contactsTable tbody');
    tb.innerHTML = '';
    state.geom.contacts.forEach((c, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><input type="text" value="${c.name}"></td>
        <td><select>${['I+', 'I-', 'V+', 'V-', 'none'].map((r) => `<option value="${r}" ${r === c.role ? 'selected' : ''}>${r.replace('-', '−')}</option>`).join('')}</select></td>
        <td><input type="number" step="any" min="0" value="${c.Rc || 0}"></td>
        <td><button class="small" title="Delete contact">✕</button></td>`;
      const [nameI, roleS, rcI, del] = [tr.querySelector('input[type=text]'), tr.querySelector('select'), tr.querySelector('input[type=number]'), tr.querySelector('button')];
      nameI.addEventListener('change', () => { c.name = nameI.value || c.name; editor.render(); });
      roleS.addEventListener('change', () => {
        const r = roleS.value;
        if (r !== 'none') state.geom.contacts.forEach((o) => { if (o !== c && o.role === r) o.role = 'none'; });
        c.role = r; renderContacts(); editor.render(); schedule();
      });
      rcI.addEventListener('change', () => { c.Rc = Math.max(0, parseFloat(rcI.value) || 0); schedule(); });
      del.addEventListener('click', () => { state.geom.contacts.splice(i, 1); editor.selected = null; renderContacts(); editor.render(); schedule(); });
      tr.addEventListener('click', (e) => { if (e.target.tagName === 'TR' || e.target.tagName === 'TD') { editor.selected = { type: 'contact', index: i }; onSelect(editor.selected); editor.render(); } });
      tb.appendChild(tr);
    });
    if (!state.geom.contacts.length) tb.innerHTML = '<tr><td colspan="4" class="muted">Draw contacts with the Contact tools.</td></tr>';
  }

  // ------------------------------------------------------------------ geometry inputs
  function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
  function setPath(obj, path, v) { const ks = path.split('.'); const last = ks.pop(); const o = ks.reduce((a, k) => a[k], obj); o[last] = v; }
  function syncGeomInputs() {
    $$('[data-geom]').forEach((el) => {
      const v = getPath(state.geom, el.dataset.geom);
      el.disabled = v === undefined;
      if (document.activeElement !== el) el.value = v === undefined ? '' : +(+v).toFixed(4);
    });
  }
  $$('[data-geom]').forEach((el) => el.addEventListener('change', () => {
    const v = parseFloat(el.value);
    if (!isFinite(v) || getPath(state.geom, el.dataset.geom) === undefined) return;
    if (el.dataset.geom === 'hole.a' && v <= 0) return;
    setPath(state.geom, el.dataset.geom, v);
    editor.render(); schedule();
  }));
  $('#btnCenterSource').addEventListener('click', () => {
    if (!state.geom.hole) return;
    state.geom.source = [state.geom.hole.cx, state.geom.hole.cy];
    syncGeomInputs(); editor.render(); schedule();
  });

  // ------------------------------------------------------------------ parameter form
  const presetSel = $('#preset');
  Object.keys(BS.materials).forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = k; presetSel.appendChild(o); });

  function bindForm() {
    $$('[data-key]').forEach((el) => {
      const k = el.dataset.key, v = state.p[k];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'radio') el.checked = el.value === v;
      else el.value = v == null ? '' : v;
    });
    updateVisibility();
  }
  function readEl(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'radio') return el.value;
    if (el.type === 'number') { const v = parseFloat(el.value); return isFinite(v) ? v : el.value; }
    return el.value;
  }
  $$('[data-key]').forEach((el) => {
    const ev = el.tagName === 'TEXTAREA' || el.type === 'text' ? 'input' : 'change';
    el.addEventListener(ev, () => {
      if (el.type === 'radio' && !el.checked) return;
      const k = el.dataset.key;
      state.p[k] = readEl(el);
      if (el.hasAttribute('data-num')) el.classList.toggle('bad', el.value.trim() !== '' && !isFinite(Number(el.value)));
      if (k === 'preset') applyPreset(state.p.preset);
      if (k === 'tieKappa' || (k === 'kappa' && state.p.tieKappa)) { if (state.p.tieKappa) { state.p.kappaSup = state.p.kappa; bindForm(); } }
      updateVisibility();
      if (!/^meas/.test(k)) { state.plots.kappa = state.plots.scan = state.plots.mfp = null; state.plots.fit = null; $('#fitOut').innerHTML = ''; }
      schedule();
    });
  });
  function applyPreset(name) {
    const m = BS.materials[name];
    if (!m) return;
    if (m.kappa != null) Object.assign(state.p, {
      kappa: m.kappa, kappaSup: m.kappa, rho_uOhmcm: String(m.rho0_uOhmcm), alpha: String(m.tcr),
      absorbance: m.absorbance, G: String(m.G), T0: m.T0, t_nm: m.thickness_nm,
    });
    bindForm();
  }
  function updateVisibility() {
    $$('[data-show]').forEach((el) => {
      const cond = el.dataset.show;
      const neg = cond.includes('!=');
      const [k, v] = cond.split(neg ? '!=' : '=');
      const ok = neg ? String(state.p[k]) !== v : String(state.p[k]) === v;
      el.toggleAttribute('hidden-by-show', !ok);
    });
    $('[data-key=kappaSup]').disabled = !!state.p.tieKappa;
    const m = BS.materials[state.p.preset];
    $('#presetNote').textContent = m ? m.note : '';
    $('#modelNote').innerHTML = {
      fourier: 'Steady Fourier conduction: κ∇²T + S = 0 over the hole; κ′∇²T − (G/t)(T − T₀) + S = 0 on the substrate (Çakıroğlu et al. 2020).',
      gk: 'Steady Guyer–Krumhansl, q − l²∇²q = −κ∇T with ∇·q = S ⇒ κ∇²T + S − l²∇²S = 0 (Kasırga &amp; Köker 2025). Gives an extra localised hot spot (l²/κ)S; valid while l ≲ hole radius.',
      ballistic: 'Ballistic–diffusive (EPRT-type) suppression of the suspended-region conductivity: κ_eff = κ / (1 + 4Kn/3), Kn = l / 2a. The fit returns the intrinsic κ.',
    }[state.p.model];
    editor.sourceRadius = (state.p.heatMethod === 'optical' ? spotR0nm() : state.p.tip_r0_nm) * 1e-3;
    editor.render();
  }
  function spotR0nm() {
    const s = +state.p.spot_nm;
    return state.p.spotKind === 'w' ? s / Math.SQRT2 : state.p.spotKind === 'fwhm' ? s / (2 * Math.sqrt(Math.LN2)) : s;
  }

  $('#rtFile').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { state.p.rtText = rd.result; bindForm(); schedule(); };
    rd.readAsText(f);
    e.target.value = '';
  });

  // ------------------------------------------------------------------ config
  function num(v, name) {
    const x = typeof v === 'number' ? v : Number(String(v).trim());
    if (!isFinite(x)) throw new Error(`"${name}" is not a valid number.`);
    return x;
  }
  function buildConfig() {
    const g = state.geom, p = state.p;
    if (!g.crystal) throw new Error('Draw the crystal boundary (Crystal tools).');
    if (!g.hole) throw new Error('Draw the substrate hole (Hole tool).');
    if (!g.source) g.source = [g.hole.cx, g.hole.cy];
    const scale = (poly) => poly.map(([x, y]) => [x * um, y * um]);
    const contacts = g.contacts.map((c) => ({ name: c.name, role: c.role, Rc: +c.Rc || 0, poly: scale(c.poly) }));
    const RcTot = contacts.filter((c) => c.role === 'I+' || c.role === 'I-').reduce((s, c) => s + c.Rc, 0);
    let model;
    if (p.rModel === 'tcr') model = { type: 'tcr', alpha: num(p.alpha, 'TCR α') };
    else if (p.rModel === 'activation') model = { type: 'activation', EA: num(p.EA, 'E_A') };
    else model = { type: 'rt', data: p.rtText, subtractRc: p.rtIncludesRc ? RcTot : 0 };
    const t = num(p.t_nm, 'thickness') * 1e-9;
    if (!(t > 0)) throw new Error('Thickness must be positive.');
    const kappa = num(p.kappa, 'κ');
    if (!(kappa > 0)) throw new Error('κ must be positive.');
    return {
      T0: num(p.T0, 'T0'),
      nModes: 160,
      geometry: {
        crystal: scale(g.crystal), contacts,
        hole: { cx: g.hole.cx * um, cy: g.hole.cy * um, a: g.hole.a * um },
        source: { x: g.source[0] * um, y: g.source[1] * um },
        resolution: Math.round(Math.min(400, Math.max(40, num(p.resolution, 'grid cells')))),
      },
      material: {
        t, kappa, kappaSup: p.tieKappa ? kappa : num(p.kappaSup, 'κ′'), tieKappa: !!p.tieKappa,
        G: num(p.G, 'G'), model: p.model, l: num(p.l_nm, 'mean free path') * 1e-9,
      },
      heating: {
        method: p.heatMethod,
        optical: { P: num(p.P_uW, 'P') * 1e-6, absorbance: num(p.absorbance, 'absorbance'), r0: spotR0nm() * 1e-9 },
        mechanical: {
          mode: p.mechMode, Q: num(p.Q_nW, 'Q') * 1e-9, dTc: num(p.dTc, 'δT*'), Ttip: num(p.Ttip, 'T_tip'),
          Gts: num(p.Gts, 'G_TS'), r0: num(p.tip_r0_nm, 'tip radius') * 1e-9,
        },
      },
      electrical: {
        model, rhoKind: p.rhoKind, rho0: num(p.rho_uOhmcm, 'ρ0') * 1e-8, Rsample: num(p.Rsample, 'R_sample'),
        biasMode: p.biasMode, V: num(p.V_mV, 'V_B') * 1e-3, I: num(p.I_uA, 'I') * 1e-6, bandwidth: num(p.bandwidth, 'Δf'),
      },
    };
  }

  let devCache = { key: null, dev: null };
  function getDevice(cfg) {
    const key = JSON.stringify([cfg.geometry.crystal, cfg.geometry.contacts.map((c) => [c.poly, c.role]), cfg.geometry.resolution]);
    if (devCache.key !== key) devCache = { key, dev: BS.bolometer.buildDevice(cfg.geometry) };
    return devCache.dev;
  }

  // ------------------------------------------------------------------ compute
  let timer = null;
  function schedule() {
    if (!$('#autoRun').checked) { setStatus('parameters changed — press Compute'); return; }
    clearTimeout(timer);
    timer = setTimeout(compute, 250);
  }
  function setStatus(s) { $('#status').textContent = s; }

  function compute() {
    const t0 = performance.now();
    $('#warnings').innerHTML = '';
    try {
      const cfg = buildConfig();
      const dev = getDevice(cfg);
      const res = BS.bolometer.evaluate(cfg, dev);
      state.last = { cfg, dev, res };
      renderResults(cfg, dev, res);
      renderWarnings(cfg, dev, res);
      updateOverlay();
      drawPlots();
      setStatus(`computed in ${Math.round(performance.now() - t0)} ms`);
    } catch (e) {
      state.last = null;
      editor.overlay = null; editor.render();
      $('#resultsTable').innerHTML = '';
      $('#warnings').innerHTML = `<div class="err">${escapeHtml(e.message)}</div>`;
      setStatus('');
      drawPlots();
    }
  }
  $('#btnRun').addEventListener('click', compute);

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // SI formatting with prefixes
  function si(v, unit, digits) {
    if (v == null || !isFinite(v)) return '—';
    if (v === 0) return `0 ${unit}`;
    const pre = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];
    const a = Math.abs(v);
    for (const [f, s] of pre) if (a >= f * 0.9995) return `${(v / f).toPrecision(digits || 4)} ${s}${unit}`;
    return `${v.toExponential(3)} ${unit}`;
  }

  function renderResults(cfg, dev, r) {
    const rows = [];
    const grp = (t) => rows.push(`<tr class="group"><td colspan="2">${t}</td></tr>`);
    const row = (k, v) => rows.push(`<tr><td>${k}</td><td>${v}</td></tr>`);
    const m = cfg.material;
    grp('Thermal');
    row(cfg.heating.method === 'optical' ? 'Absorbed power Q = A·P' : 'Tip → sample power Q', si(r.Q, 'W'));
    row('Peak temperature rise ΔT (at source)', `${r.peakRise.toPrecision(4)} K`);
    row('Mean ΔT over suspended area', `${r.meanHoleRise.toPrecision(4)} K`);
    row('Peak ΔT per unit power', `${(r.peakRise / r.Q * 1e-6).toPrecision(4)} K/µW`);
    if (m.model === 'ballistic') row('κ_eff (suspended)', `${r.kappaEff.toPrecision(4)} W/m·K`);
    row('Thermal healing length √(κ′t/G)', si(1 / r.beta, 'm'));
    row('Angular modes (off-centre source)', r.nModes === 0 ? '0 (concentric, closed form)' : String(r.nModes));
    grp('Electrical');
    row('Resistivity ρ₀', `${(r.rho0 * 1e8).toPrecision(4)} µΩ·cm`);
    row(dev.fourProbe ? 'Sample resistance (V+ → V−)' : 'Sample resistance (I+ → I−)', si(r.Rs, 'Ω'));
    if (!dev.fourProbe) row('Total with contacts R_s + ΣR_c', si(r.Rtot, 'Ω'));
    row('Effective α(T₀)', `${r.alphaT0.toExponential(3)} K⁻¹`);
    grp('Bolometric response');
    row('δR', si(r.dR, 'Ω'));
    row('δR / R', `${(r.dRrel * 1e6).toPrecision(4)} ppm`);
    row('Measurement', r.mode);
    if (r.Ibolo != null) {
      row('Dark current I₀', si(r.I0, 'A'));
      row('Effective sample bias V_eff', si(r.Veff, 'V'));
      row('Bolometric current I_bolo', si(r.Ibolo, 'A'));
    } else {
      row('Bias current I', si(r.I0, 'A'));
      row('Bolometric voltage V_bolo', si(r.Vbolo, 'V'));
    }
    row('DC Joule power in sample', si(r.joule, 'W'));
    row(`Intrinsic noise (Johnson + shot, Δf = ${cfg.electrical.bandwidth} Hz)`, si(r.noise, r.noiseUnit));
    row('δR noise floor', si(r.dRfloor, 'Ω'));
    row('Signal-to-noise ratio', r.snr >= 1e4 ? r.snr.toExponential(2) : r.snr.toPrecision(3));
    $('#resultsTable').innerHTML = rows.join('');
  }

  function renderWarnings(cfg, dev, r) {
    const W = [];
    const pip = BS.electrical.pointInPolygon;
    const g = cfg.geometry;
    if (!pip(g.hole.cx, g.hole.cy, g.crystal)) W.push('The hole centre is not under the crystal.');
    if (!pip(g.source.x, g.source.y, g.crystal)) W.push('The heat source is outside the crystal: the thermal model assumes the flake covers the source.');
    const dS = Math.hypot(g.source.x - g.hole.cx, g.source.y - g.hole.cy);
    if (dS > g.hole.a) W.push('Source is on the supported region — the solution is still exact, but the response is dominated by the substrate conductance G.');
    for (const c of g.contacts) {
      const cs = c.poly;
      if (pip(g.hole.cx, g.hole.cy, cs)) W.push(`Contact ${c.name} covers the hole centre.`);
      void cs;
    }
    if (!dev.fourProbe && cfg.electrical.biasMode === 'cv' && r.RcTot > 0.2 * r.R2) {
      const f = (r.R2 / r.Rtot) ** 2;
      W.push(`Contact resistance is significant: bolometric current reduced to ${(100 * f).toFixed(1)} % of the contact-free value ((R_s/R_tot)²). Use constant-current or four-terminal read-out to remove it.`);
    }
    if (r.snr < 3) W.push(`Signal-to-noise ratio is only ${r.snr.toPrecision(2)} — increase bias, heating power or integration time.`);
    if (Math.abs(r.peakRise) > Math.min(20, 0.1 * cfg.T0)) W.push(`Large peak ΔT (${r.peakRise.toPrecision(3)} K): κ, G and α are taken as temperature-independent in the thermal solution.`);
    const rm = BS.bolometer.makeResistivityModel(cfg);
    if (rm.type === 'rt') {
      if (rm.outside) W.push('T₀ lies outside the R–T data range (extrapolated).');
      const Tmax = rm.data[rm.data.length - 1][0], Tmin = rm.data[0][0];
      const Tpk = cfg.T0 + r.peakRise;
      if (Tpk > Tmax || Tpk < Tmin) W.push('Peak sample temperature lies outside the R–T data range (extrapolated).');
      $('#rtInfo').textContent = rm.describe;
    }
    if (cfg.material.model === 'gk' && cfg.material.l > g.hole.a) W.push('Mean free path exceeds the hole radius: the Guyer–Krumhansl description is outside its validity (quasi-ballistic regime).');
    if (rm.type === 'activation' && cfg.heating.method === 'optical') W.push('Semiconductors: photoconductive / photovoltaic currents can add to the bolometric signal under illumination (see the 2D Mater. paper).');
    if (Math.abs(r.joule) > 10 * Math.abs(r.Q)) W.push(`DC Joule power (${si(r.joule, 'W')}) ≫ heater power: the device runs above T₀; adjust T₀ accordingly.`);
    if (Math.abs(r.dRrel) < 1e-7) W.push('δR/R below 0.1 ppm — likely unmeasurable.');
    $('#warnings').innerHTML = W.map((w) => `<div class="warn">${escapeHtml(w)}</div>`).join('');
  }

  // ------------------------------------------------------------------ overlay
  const CMAPS = {
    inferno: [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]],
    viridis: [[68, 1, 84], [70, 50, 127], [54, 92, 141], [39, 127, 142], [31, 161, 135], [74, 194, 109], [159, 218, 58], [253, 231, 37]],
  };
  function cmap(name, t) {
    const s = CMAPS[name];
    t = Math.min(1, Math.max(0, t)) * (s.length - 1);
    const i = Math.min(s.length - 2, Math.floor(t)), f = t - i;
    return s[i].map((v, k) => Math.round(v + f * (s[i + 1][k] - v)));
  }
  function barCanvas(name) {
    const c = document.createElement('canvas'); c.width = 1; c.height = 128;
    const x = c.getContext('2d'), im = x.createImageData(1, 128);
    for (let j = 0; j < 128; j++) { const [r, g, b] = cmap(name, 1 - j / 127); im.data.set([r, g, b, 255], j * 4); }
    x.putImageData(im, 0, 0); return c;
  }

  function updateOverlay() {
    const kind = $('#overlay').value;
    const L = state.last;
    if (!L || kind === 'none') { editor.overlay = null; editor.render(); return; }
    const { cfg, dev, res } = L;
    const bb = BS.electrical.bbox(cfg.geometry.crystal);
    let cv, vmin = 0, vmax = 0, label, unitScale = 1;
    if (kind === 'temp') {
      const N = 200;
      const dx = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) / N;
      const nx = Math.ceil((bb.x1 - bb.x0) / dx), ny = Math.ceil((bb.y1 - bb.y0) / dx);
      const vals = new Float64Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const v = res.Q * res.sol.rise(bb.x0 + (i + 0.5) * dx, bb.y0 + (j + 0.5) * dx);
        vals[j * nx + i] = v; vmax = Math.max(vmax, v); vmin = Math.min(vmin, v);
      }
      vmax = Math.max(vmax, res.peakRise);
      if (Math.abs(vmin) < 1e-6 * Math.abs(vmax)) vmin = 0;
      const nrm = (v) => (vmax > vmin ? (v - vmin) / (vmax - vmin) : 0);
      cv = paint(vals, nx, ny, nrm, 'inferno', (v) => Math.round(255 * Math.min(1, Math.sqrt(Math.abs(nrm(v))) * 1.4)));
      label = 'ΔT (K)';
      editor.overlay = { canvas: cv, x0: bb.x0 / um, y0: bb.y0 / um, x1: (bb.x0 + nx * dx) / um, y1: (bb.y0 + ny * dx) / um, bar: barCanvas('inferno'), label, maxLabel: vmax.toPrecision(3), minLabel: vmin.toPrecision(2) };
    } else {
      const { nx, ny, label: lab, Vsrc, w, dx } = dev;
      const vals = new Float64Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        if (lab[c] < 0) continue;
        if (kind === 'current') {
          if (lab[c] !== 0) continue;
          const gx = (i > 0 && i < nx - 1 && lab[c - 1] >= 0 && lab[c + 1] >= 0) ? (Vsrc[c + 1] - Vsrc[c - 1]) / 2 : (i < nx - 1 && lab[c + 1] >= 0 ? Vsrc[c + 1] - Vsrc[c] : (i > 0 && lab[c - 1] >= 0 ? Vsrc[c] - Vsrc[c - 1] : 0));
          const gy = (j > 0 && j < ny - 1 && lab[c - nx] >= 0 && lab[c + nx] >= 0) ? (Vsrc[c + nx] - Vsrc[c - nx]) / 2 : (j < ny - 1 && lab[c + nx] >= 0 ? Vsrc[c + nx] - Vsrc[c] : (j > 0 && lab[c - nx] >= 0 ? Vsrc[c] - Vsrc[c - nx] : 0));
          vals[c] = Math.hypot(gx, gy);
        } else vals[c] = w[c];
        vmax = Math.max(vmax, vals[c]); vmin = Math.min(vmin, vals[c]);
      }
      if (kind === 'current') {
        // J = |∇V| σ / (I_unit) per unit current → A/m² for 1 A: divide by thickness later; show relative
        unitScale = 1 / vmax; label = 'J / J_max';
      } else { unitScale = 1 / vmax; label = 'w / w_max'; }
      cv = paint(vals, nx, ny, (v) => (vmax > vmin ? (v - Math.min(0, vmin)) / (vmax - Math.min(0, vmin)) : 0), 'viridis');
      editor.overlay = { canvas: cv, x0: dev.x0 / um, y0: dev.y0 / um, x1: (dev.x0 + nx * dx) / um, y1: (dev.y0 + ny * dx) / um, bar: barCanvas('viridis'), label, maxLabel: (vmax * unitScale).toPrecision(2), minLabel: (Math.min(0, vmin) * unitScale).toPrecision(2) };
    }
    editor.render();
  }
  function paint(vals, nx, ny, norm, name, alphaFn) {
    const c = document.createElement('canvas'); c.width = nx; c.height = ny;
    const x = c.getContext('2d'), im = x.createImageData(nx, ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const [r, g, b] = cmap(name, norm(vals[j * nx + i]));
      const a = alphaFn ? alphaFn(vals[j * nx + i]) : 255;
      im.data.set([r, g, b, a], ((ny - 1 - j) * nx + i) * 4); // flip: world y up
    }
    x.putImageData(im, 0, 0); return c;
  }

  // ------------------------------------------------------------------ plots
  function drawPlots() {
    const L = state.last;
    // temperature profile
    if (L) {
      const { cfg, res } = L;
      const dir = $('#profileDir').value;
      const bb = BS.electrical.bbox(cfg.geometry.crystal);
      const s = cfg.geometry.source, h = cfg.geometry.hole;
      const lo = dir === 'x' ? bb.x0 : bb.y0, hi = dir === 'x' ? bb.x1 : bb.y1;
      const xs = [], ys = [];
      for (let i = 0; i <= 400; i++) {
        const u = lo + (hi - lo) * i / 400;
        xs.push(u / um);
        ys.push(res.Q * res.sol.rise(dir === 'x' ? u : s.x, dir === 'x' ? s.y : u));
      }
      const c0 = dir === 'x' ? h.cx : h.cy, off = dir === 'x' ? Math.abs(s.y - h.cy) : Math.abs(s.x - h.cx);
      const vl = [];
      if (off < h.a) { const half = Math.sqrt(h.a * h.a - off * off); vl.push({ x: (c0 - half) / um, label: 'hole edge' }, { x: (c0 + half) / um }); }
      BS.plot.draw($('#plotProfile'), { series: [{ x: xs, y: ys, label: 'ΔT' }], xlabel: `${dir} (µm)`, ylabel: 'ΔT (K)', vlines: vl });
    } else BS.plot.draw($('#plotProfile'), { series: [] });

    const meas = measuredDR();
    const hl = meas != null ? [{ y: meas * 1e3, label: 'measured', color: getComputedStyle(document.documentElement).getPropertyValue('--s2') }] : [];
    const K = state.plots.kappa;
    const fit = state.plots.fit;
    const series = [];
    const neg = K && K.every((d) => d.dR < 0);
    const sameSign = K && (neg || K.every((d) => d.dR > 0));
    if (K) series.push({ x: K.map((d) => d.kappa), y: K.map((d) => (neg ? -1 : 1) * d.dR * 1e3), label: 'δR(κ)' });
    BS.plot.draw($('#plotKappa'), {
      series, logx: true, logy: !!sameSign, xlabel: 'κ (W/m·K)', ylabel: neg ? '−δR (mΩ)' : 'δR (mΩ)',
      hlines: K ? hl.map((h) => Object.assign({}, h, { y: (neg ? -1 : 1) * h.y })).filter((h) => !sameSign || h.y > 0) : [],
      vlines: fit && fit.roots.length ? fit.roots.map((k) => ({ x: k, label: `κ = ${k.toPrecision(3)}` })) : [],
      empty: 'Press “Sweep κ” or “Fit κ”',
    });
    const S = state.plots.scan;
    BS.plot.draw($('#plotScan'), {
      series: S ? [{ x: S.map((d) => d.pos / um), y: S.map((d) => d.dR * 1e3), label: 'δR', markers: false }] : [],
      xlabel: 'position along scan line (µm)', ylabel: 'δR (mΩ)', empty: 'Draw a scan line (optional) and press “Run scan”',
    });
    const M = state.plots.mfp;
    BS.plot.draw($('#plotMFP'), {
      series: M ? [{ x: M.map((d) => d.l * 1e9), y: M.map((d) => d.dR * 1e3), label: 'δR(l)' }] : [],
      logx: true, xlabel: 'phonon mean free path l (nm)', ylabel: 'δR (mΩ)', hlines: M ? hl : [],
      empty: 'Press “Sweep l” (Guyer–Krumhansl unless ballistic model is selected)',
    });
  }
  $('#profileDir').addEventListener('change', drawPlots);

  function measuredDR(withSigma) {
    const p = state.p;
    const v = Number(String(p.measValue).trim());
    if (String(p.measValue).trim() === '' || !isFinite(v)) return null;
    const L = state.last;
    if (!L) return null;
    const conv = { dR: 1e-3, photocurrent: 1e-9, voltage: 1e-6 }[p.measKind];
    const es = BS.bolometer.electricalState(L.cfg, L.dev, BS.bolometer.makeResistivityModel(L.cfg));
    const toDR = (val) => BS.bolometer.measuredDeltaR(L.cfg, es, { kind: p.measKind, value: val * conv });
    const dR = toDR(v);
    if (!withSigma) return dR;
    const s = Number(String(p.measSigma).trim());
    const sigma = isFinite(s) && s > 0 ? Math.abs(toDR(v + s) - dR) : 0;
    return { dR, sigma };
  }

  function busy(btn, fn) {
    if (!state.last) { compute(); if (!state.last) return; }
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = 'Working…'; setStatus('working…');
    setTimeout(() => {
      const t0 = performance.now();
      try { fn(); setStatus(`done in ${((performance.now() - t0) / 1000).toFixed(1)} s`); }
      catch (e) { $('#warnings').insertAdjacentHTML('afterbegin', `<div class="err">${escapeHtml(e.message)}</div>`); setStatus(''); }
      btn.disabled = false; btn.textContent = old; drawPlots();
    }, 30);
  }

  $('#btnSweepK').addEventListener('click', (e) => busy(e.target, () => {
    const { cfg, dev } = state.last;
    state.plots.kappa = BS.bolometer.sweepKappa(cfg, dev, 0.1, 3000, 36);
  }));
  $('#btnScan').addEventListener('click', (e) => busy(e.target, () => {
    const { cfg, dev } = state.last;
    let p1, p2;
    if (state.geom.scan) { p1 = state.geom.scan.p1; p2 = state.geom.scan.p2; }
    else {
      const bb = BS.electrical.bbox(state.geom.crystal);
      p1 = [bb.x0, state.geom.hole.cy]; p2 = [bb.x1, state.geom.hole.cy];
      state.geom.scan = { p1, p2 }; editor.render();
    }
    state.plots.scan = BS.bolometer.lineScan(cfg, dev, { x: p1[0] * um, y: p1[1] * um }, { x: p2[0] * um, y: p2[1] * um }, 61);
  }));
  $('#btnSweepL').addEventListener('click', (e) => busy(e.target, () => {
    const { cfg, dev } = state.last;
    state.plots.mfp = BS.bolometer.sweepMFP(cfg, dev, 1e-9, Math.max(2e-6, 2 * cfg.geometry.hole.a), 28);
  }));
  $('#btnFitKappa').addEventListener('click', (e) => busy(e.target, () => {
    const m = measuredDR(true);
    if (!m) throw new Error('Enter a measured value to fit.');
    const { cfg, dev } = state.last;
    const fit = BS.bolometer.fitKappa(cfg, dev, m.dR, { sigma: m.sigma, kmin: 0.01, kmax: 1e4 });
    state.plots.fit = fit;
    state.plots.kappa = fit.curve;
    const out = $('#fitOut');
    if (!fit.roots.length) {
      out.innerHTML = `<div class="err">No κ in 0.01–10⁴ W/m·K reproduces δR_M = ${si(m.dR, 'Ω')}. Model range: ${si(fit.range[0], 'Ω')} … ${si(fit.range[1], 'Ω')}. Check sign of α, power, absorbance or G.</div>`;
      return;
    }
    const k = fit.roots[0];
    const iv = fit.interval ? ` <span class="muted">(${fit.interval[0].toPrecision(3)} – ${fit.interval[1].toPrecision(3)})</span>` : '';
    out.innerHTML = `δR_M = ${si(m.dR, 'Ω')} ⇒ <span class="big">κ = ${k.toPrecision(4)} W/m·K</span>${iv}` +
      (fit.roots.length > 1 ? `<div class="warn">Multiple solutions: ${fit.roots.map((x) => x.toPrecision(3)).join(', ')} W/m·K (non-monotonic response).</div>` : '') +
      ` <button class="small" id="btnUseK">Use κ</button>`;
    $('#btnUseK').addEventListener('click', () => {
      state.p.kappa = +k.toPrecision(5);
      if (state.p.tieKappa) state.p.kappaSup = state.p.kappa;
      bindForm(); compute();
    });
  }));
  ['measValue', 'measKind', 'measSigma'].forEach((k) => $(`[data-key=${k}]`).addEventListener('input', drawPlots));

  // ------------------------------------------------------------------ save / load / misc
  $('#btnSave').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'BolometricSolver', version: 1, geom: state.geom, params: state.p }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bolometric-project.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#fileLoad').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        loadProject(d.geom, Object.assign({}, defaults, d.params));
      } catch (err) { $('#warnings').innerHTML = `<div class="err">Could not load project: ${escapeHtml(err.message)}</div>`; }
    };
    rd.readAsText(f); e.target.value = '';
  });
  function loadProject(geom, params) {
    Object.keys(state.geom).forEach((k) => delete state.geom[k]);
    Object.assign(state.geom, { crystal: null, contacts: [], hole: null, source: null, scan: null }, geom);
    state.p = params;
    state.plots = { kappa: null, scan: null, mfp: null, fit: null };
    $('#fitOut').innerHTML = '';
    editor.selected = null;
    bindForm(); renderContacts(); syncGeomInputs(); editor.fit(); compute();
  }
  $('#btnExample').addEventListener('click', () => loadProject(exampleGeom(), Object.assign({}, defaults)));
  $('#btnClear').addEventListener('click', () => loadProject({ crystal: null, contacts: [], hole: null, source: null, scan: null }, Object.assign({}, state.p)));
  $('#btnTheme').addEventListener('click', () => {
    const r = document.documentElement;
    const cur = r.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    r.dataset.theme = cur === 'dark' ? 'light' : 'dark';
    editor.render(); drawPlots();
  });
  $('#btnTheory').addEventListener('click', () => { $('#theoryBody').innerHTML = THEORY; $('#theory').showModal(); });
  window.addEventListener('resize', () => drawPlots());

  const THEORY = `
<h2>Model summary</h2>
<p>The measured quantity is the bolometric resistance change δR of an electrically contacted flake when a local heater
(focused laser — <b>optical bolometric thermometry</b>; or a hot AFM tip — <b>mechanical bolometric thermometry</b>) sits on the part
suspended over a substrate hole. κ is obtained by matching the predicted δR to the measured one.</p>
<h3>1 · Heat transport (analytical)</h3>
<span class="eq">r &lt; a (suspended):   κ∇²T + S − l²∇²S = 0          (l = 0 → Fourier; l &gt; 0 → Guyer–Krumhansl)
r ≥ a (supported):   κ′∇²T − (G/t)(T − T₀) + S = 0
S = S₀ exp(−ρ²/r₀²),  S₀ = Q/(π r₀² t),  ρ = distance from the heat source</span>
<p>For a source at the hole centre the solution is the closed form of Çakıroğlu <i>et al.</i>:
<code>T₁ = c₁ + c₂ ln r + (S₀r₀²/4κ)·Ei(−r²/r₀²)</code>, <code>T₂ = c₃I₀(γ) + c₄K₀(γ) + T₀</code>, γ = r√(G/κ′t),
with T and κ∂T/∂r continuous at r = a. For an arbitrary source position the solver uses the exact generalisation
<code>T = P(ρ) + Σₙ [Aₙ(r/a)ⁿ | BₙKₙ(βr)/Kₙ(βa)] e^{inθ}</code>, where P is the free-space Gaussian-source solution
(closed form inside, Hankel transform outside) and every angular mode is matched at the hole edge.</p>
<p>Guyer–Krumhansl (steady): with ∇·q = S and q − l²∇²q = −κ∇T the temperature gains the localised term (l²/κ)S while the
net heat flux crossing the hole edge is unchanged. Ballistic–diffusive option: κ_eff = κ/(1 + 4Kn/3), Kn = l/2a.</p>
<h3>2 · Heat delivery</h3>
<p><b>Optical:</b> Q = A·P (absorbance × incident power), Gaussian volumetric heating with 1/e radius r₀ (FWHM = 2r₀√ln2).<br>
<b>Mechanical:</b> effective tip thermal radius r₀ (~20 nm) and either (i) a fixed contact temperature rise δT* = T*_AFM − T_amb,
(ii) a fixed power Q, or (iii) a tip at T_tip coupled through a tip–sample conductance G_TS:
Q = G_TS (T_tip − T₀)/(1 + G_TS θ), θ = peak rise per watt.</p>
<h3>3 · Resistance change</h3>
<p>ρ(T) from a TCR (ρ₀[1 + α(T − T₀)]), from measured R–T data (ρ(T)/ρ(T₀) = R(T)/R(T₀), monotone cubic interpolation),
or thermally activated. The drawn crystal/contact geometry is solved once for the cold current distribution J (finite volumes);
δR then follows exactly to first order from reciprocity:
<code>δR = (1/I I′) ∫ δρ(T(x,y)) J·J′ dV</code> (J′ = J for two terminals; J′ from V+/V− injection for four terminals).</p>
<h3>4 · Contacts, bias and noise</h3>
<p>Two-terminal constant voltage: I₀ = V_B/(R_s + ΣR_c), I_bolo = V_B/(R_tot + δR) − I₀, i.e. δR_M ≈ −R_tot² I_PC/V_B;
contact resistance reduces the signal by (R_s/R_tot)². Constant current (two- or four-terminal): V_bolo = I·δR, independent of R_c.
Noise floor: Johnson √(4k_BTRΔf) and shot √(2qIΔf).</p>
<h3>References</h3>
<p>O. Çakıroğlu, N. Mehmood, M. M. Çiçek, A. Aikebaier, H. R. Rasouli, E. Durgun, T. S. Kasırga,
“Thermal conductivity measurements in nanosheets via bolometric effect”, <i>2D Materials</i> 7, 035003 (2020), arXiv:2001.00368.<br>
T. S. Kasırga, B. Köker, “An extensive thermal conductivity measurement method based on atomic force microscopy”,
<i>Int. J. Heat Mass Transfer</i> (2025), arXiv:2501.18384.</p>
<p>Full derivations, figures and validation: <a href="docs/Bolometric_Solver_Theory.pdf" target="_blank" rel="noopener">technical note (PDF)</a> · docs/THEORY.md.</p>
<p class="muted">Bolometric Thermometry Solver by Talip Serkan Kasırga · released under the MIT License.</p>`;

  // ------------------------------------------------------------------ init
  bindForm();
  renderContacts();
  syncGeomInputs();
  requestAnimationFrame(() => { editor.resize(); editor.fit(); compute(); });
})();

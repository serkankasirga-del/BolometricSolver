/*
 * Canvas geometry editor. World units are micrometres; y axis points up.
 * Tools: select/move, crystal polygon, crystal rectangle, contact rectangle,
 * contact polygon, substrate hole (circle), heat-source position, scan line.
 */
(function (root) {
  'use strict';

  const HANDLE = 6;

  class Editor {
    constructor(canvas, geom, onChange, onSelect) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.geom = geom;
      this.onChange = onChange;
      this.onSelect = onSelect || (() => {});
      this.tool = 'select';
      this.snap = true;
      this.snapStep = 0.1;
      this.view = { scale: 40, cx: 0, cy: 0 };
      this.selected = null; // {type:'crystal'|'contact'|'hole'|'source'|'scan', index}
      this.draft = null;
      this.drag = null;
      this.overlay = null; // {canvas, x0,y0,x1,y1, label, min, max}
      this.sourceRadius = 0.3;
      this.cursor = null;
      this._bind();
      this.resize();
    }

    // ---------- coordinates ----------
    w2s(x, y) { return [this.W / 2 + (x - this.view.cx) * this.view.scale, this.H / 2 - (y - this.view.cy) * this.view.scale]; }
    s2w(px, py) { return [this.view.cx + (px - this.W / 2) / this.view.scale, this.view.cy - (py - this.H / 2) / this.view.scale]; }
    snapPt(p, ev) {
      if (!this.snap || (ev && ev.altKey)) return p;
      const s = this.snapStep;
      return [Math.round(p[0] / s) * s, Math.round(p[1] / s) * s].map((v) => +v.toFixed(6));
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      this.W = this.canvas.clientWidth; this.H = this.canvas.clientHeight;
      this.canvas.width = this.W * dpr; this.canvas.height = this.H * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.render();
    }

    fit() {
      const pts = [];
      const g = this.geom;
      if (g.crystal) pts.push(...g.crystal);
      g.contacts.forEach((c) => pts.push(...c.poly));
      if (g.hole) pts.push([g.hole.cx - g.hole.a, g.hole.cy - g.hole.a], [g.hole.cx + g.hole.a, g.hole.cy + g.hole.a]);
      if (!pts.length) { this.view = { scale: 40, cx: 0, cy: 0 }; this.render(); return; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      this.view.cx = (x0 + x1) / 2; this.view.cy = (y0 + y1) / 2;
      this.view.scale = 0.85 * Math.min(this.W / Math.max(x1 - x0, 1e-3), this.H / Math.max(y1 - y0, 1e-3));
      this.render();
    }

    setTool(t) {
      this.tool = t; this.draft = null;
      this.canvas.style.cursor = t === 'select' ? 'default' : 'crosshair';
      this.render();
    }

    // ---------- hit testing ----------
    hit(px, py) {
      const g = this.geom;
      const near = (x, y) => { const [sx, sy] = this.w2s(x, y); return Math.hypot(sx - px, sy - py) <= HANDLE + 2; };
      if (g.scan) {
        if (near(g.scan.p1[0], g.scan.p1[1])) return { type: 'scan', handle: 'p1' };
        if (near(g.scan.p2[0], g.scan.p2[1])) return { type: 'scan', handle: 'p2' };
      }
      if (g.source && near(g.source[0], g.source[1])) return { type: 'source' };
      if (g.hole) {
        const [sx, sy] = this.w2s(g.hole.cx, g.hole.cy);
        const d = Math.hypot(sx - px, sy - py), rr = g.hole.a * this.view.scale;
        if (Math.abs(d - rr) < HANDLE) return { type: 'hole', handle: 'radius' };
      }
      // vertices of selected polygon first
      const sel = this.selected;
      const polys = [];
      g.contacts.forEach((c, i) => polys.push({ type: 'contact', index: i, poly: c.poly }));
      if (g.crystal) polys.push({ type: 'crystal', poly: g.crystal });
      if (sel) polys.sort((a, b) => (this._isSel(b) ? 1 : 0) - (this._isSel(a) ? 1 : 0));
      for (const P of polys) {
        for (let k = 0; k < P.poly.length; k++) if (near(P.poly[k][0], P.poly[k][1])) return { type: P.type, index: P.index, vertex: k };
      }
      const w = this.s2w(px, py);
      if (g.hole && Math.hypot(w[0] - g.hole.cx, w[1] - g.hole.cy) < g.hole.a && (!sel || sel.type !== 'crystal')) {
        // hole body only if not clicking inside a selected crystal
        const inContact = g.contacts.some((c) => root.BS.electrical.pointInPolygon(w[0], w[1], c.poly));
        if (!inContact) return { type: 'hole', handle: 'move' };
      }
      for (let i = g.contacts.length - 1; i >= 0; i--) if (root.BS.electrical.pointInPolygon(w[0], w[1], g.contacts[i].poly)) return { type: 'contact', index: i };
      if (g.crystal && root.BS.electrical.pointInPolygon(w[0], w[1], g.crystal)) return { type: 'crystal' };
      return null;
    }
    _isSel(P) { const s = this.selected; return s && s.type === P.type && (s.index === P.index || P.type === 'crystal'); }

    // ---------- events ----------
    _bind() {
      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => this._down(e));
      c.addEventListener('pointermove', (e) => this._move(e));
      c.addEventListener('pointerup', (e) => this._up(e));
      c.addEventListener('dblclick', (e) => { e.preventDefault(); this._finishPolygon(); });
      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        const before = this.s2w(px, py);
        this.view.scale *= Math.exp(-e.deltaY * 0.0015);
        this.view.scale = Math.min(5000, Math.max(2, this.view.scale));
        const after = this.s2w(px, py);
        this.view.cx += before[0] - after[0]; this.view.cy += before[1] - after[1];
        this.render();
      }, { passive: false });
      c.addEventListener('contextmenu', (e) => e.preventDefault());
      window.addEventListener('keydown', (e) => {
        if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
        if (e.key === 'Escape') { this.draft = null; this.render(); }
        else if (e.key === 'Enter') this._finishPolygon();
        else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) { e.preventDefault(); this.deleteSelected(); }
      });
      if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(c);
    }

    _pos(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

    _down(e) {
      const [px, py] = this._pos(e);
      this.canvas.setPointerCapture(e.pointerId);
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey && this.tool === 'select')) {
        this.drag = { kind: 'pan', start: [px, py], view: Object.assign({}, this.view) };
        return;
      }
      const w = this.snapPt(this.s2w(px, py), e);
      const g = this.geom;
      switch (this.tool) {
        case 'select': {
          const h = this.hit(px, py);
          this.selected = h ? { type: h.type, index: h.index } : null;
          this.onSelect(this.selected);
          if (h) this.drag = { kind: 'move', hit: h, start: w, orig: JSON.parse(JSON.stringify(g)) };
          else this.drag = { kind: 'pan', start: [px, py], view: Object.assign({}, this.view) };
          break;
        }
        case 'crystal-rect': case 'contact-rect':
          this.drag = { kind: 'rect', start: w, end: w }; break;
        case 'crystal-poly': case 'contact-poly':
          if (!this.draft) this.draft = { pts: [w] };
          else {
            const f = this.draft.pts[0];
            const [fx, fy] = this.w2s(f[0], f[1]);
            if (this.draft.pts.length >= 3 && Math.hypot(fx - px, fy - py) < HANDLE + 2) { this._finishPolygon(); return; }
            this.draft.pts.push(w);
          }
          break;
        case 'hole':
          this.drag = { kind: 'hole', start: w, end: w }; break;
        case 'source':
          g.source = w; this.selected = { type: 'source' }; this.onSelect(this.selected); this.onChange('source');
          this.drag = { kind: 'move', hit: { type: 'source' }, start: w, orig: JSON.parse(JSON.stringify(g)) };
          break;
        case 'scan':
          this.drag = { kind: 'scan', start: w, end: w }; break;
      }
      this.render();
    }

    _move(e) {
      const [px, py] = this._pos(e);
      const wRaw = this.s2w(px, py);
      this.cursor = wRaw;
      const w = this.snapPt(wRaw, e);
      const d = this.drag;
      if (this.onCursor) this.onCursor(wRaw);
      if (!d) { if (this.draft) { this.draft.hover = w; this.render(); } return; }
      const g = this.geom;
      if (d.kind === 'pan') {
        this.view.cx = d.view.cx - (px - d.start[0]) / this.view.scale;
        this.view.cy = d.view.cy + (py - d.start[1]) / this.view.scale;
      } else if (d.kind === 'rect' || d.kind === 'hole' || d.kind === 'scan') {
        d.end = w;
      } else if (d.kind === 'move') {
        const dx = w[0] - d.start[0], dy = w[1] - d.start[1];
        const h = d.hit, o = d.orig;
        const shift = (poly) => poly.map(([x, y]) => [+(x + dx).toFixed(6), +(y + dy).toFixed(6)]);
        if (h.type === 'crystal') {
          if (h.vertex != null) g.crystal[h.vertex] = [o.crystal[h.vertex][0] + dx, o.crystal[h.vertex][1] + dy];
          else g.crystal = shift(o.crystal);
        } else if (h.type === 'contact') {
          const c = g.contacts[h.index], oc = o.contacts[h.index];
          if (h.vertex != null) {
            c.poly[h.vertex] = [oc.poly[h.vertex][0] + dx, oc.poly[h.vertex][1] + dy];
            if (c.rect) { // keep rectangles rectangular
              const k = h.vertex, P = c.poly; // vertex order [bl, br, tr, tl]
              const sx = (k === 0 || k === 3) ? [0, 3] : [1, 2]; // vertices sharing x
              const sy = (k === 0 || k === 1) ? [0, 1] : [2, 3]; // vertices sharing y
              for (const i of sx) P[i][0] = P[k][0];
              for (const i of sy) P[i][1] = P[k][1];
            }
          } else c.poly = shift(oc.poly);
        } else if (h.type === 'hole') {
          if (h.handle === 'radius') g.hole.a = Math.max(0.05, +Math.hypot(w[0] - g.hole.cx, w[1] - g.hole.cy).toFixed(4));
          else { g.hole.cx = +(o.hole.cx + dx).toFixed(6); g.hole.cy = +(o.hole.cy + dy).toFixed(6); }
        } else if (h.type === 'source') {
          g.source = [o.source[0] + dx, o.source[1] + dy];
        } else if (h.type === 'scan') {
          g.scan[h.handle] = [o.scan[h.handle][0] + dx, o.scan[h.handle][1] + dy];
        }
        d.moved = true;
      }
      this.render();
    }

    _up() {
      const d = this.drag; this.drag = null;
      if (!d) return;
      const g = this.geom;
      if (d.kind === 'rect') {
        const [x0, y0] = d.start, [x1, y1] = d.end;
        if (Math.abs(x1 - x0) > 1e-3 && Math.abs(y1 - y0) > 1e-3) {
          const poly = [[Math.min(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.max(y0, y1)], [Math.min(x0, x1), Math.max(y0, y1)]];
          if (this.tool === 'crystal-rect') { g.crystal = poly; this.selected = { type: 'crystal' }; this.onChange('crystal'); }
          else { this._addContact(poly, true); }
        }
      } else if (d.kind === 'hole') {
        const a = Math.hypot(d.end[0] - d.start[0], d.end[1] - d.start[1]);
        if (a > 0.02) { g.hole = { cx: d.start[0], cy: d.start[1], a: +a.toFixed(4) }; this.selected = { type: 'hole' }; this.onChange('hole'); }
      } else if (d.kind === 'scan') {
        if (Math.hypot(d.end[0] - d.start[0], d.end[1] - d.start[1]) > 0.05) { g.scan = { p1: d.start, p2: d.end }; this.onChange('scan'); }
      } else if (d.kind === 'move' && d.moved) {
        this.onChange(d.hit.type);
      }
      this.onSelect(this.selected);
      this.render();
    }

    _addContact(poly, rect) {
      const g = this.geom;
      const used = new Set(g.contacts.map((c) => c.role));
      const role = !used.has('I+') ? 'I+' : !used.has('I-') ? 'I-' : 'none';
      let n = g.contacts.length + 1;
      while (g.contacts.some((c) => c.name === 'C' + n)) n++;
      g.contacts.push({ name: 'C' + n, poly, role, Rc: 0, rect: !!rect });
      this.selected = { type: 'contact', index: g.contacts.length - 1 };
      this.onChange('contact');
    }

    _finishPolygon() {
      if (!this.draft || this.draft.pts.length < 3) return;
      const pts = this.draft.pts;
      this.draft = null;
      if (this.tool === 'crystal-poly') { this.geom.crystal = pts; this.selected = { type: 'crystal' }; this.onChange('crystal'); }
      else if (this.tool === 'contact-poly') this._addContact(pts, false);
      this.onSelect(this.selected);
      this.render();
    }

    deleteSelected() {
      const s = this.selected, g = this.geom;
      if (!s) return;
      if (s.type === 'crystal') g.crystal = null;
      else if (s.type === 'contact') g.contacts.splice(s.index, 1);
      else if (s.type === 'hole') g.hole = null;
      else if (s.type === 'scan') g.scan = null;
      else return;
      this.selected = null; this.onSelect(null); this.onChange('delete'); this.render();
    }

    // ---------- rendering ----------
    render() {
      const ctx = this.ctx, W = this.W, H = this.H;
      if (!W) return;
      const st = getComputedStyle(document.documentElement);
      const col = (n, f) => (st.getPropertyValue(n).trim() || f);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = col('--canvas-bg', '#fafafa'); ctx.fillRect(0, 0, W, H);

      // grid
      const target = 60 / this.view.scale;
      const mag = Math.pow(10, Math.floor(Math.log10(target)));
      const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= target) || mag * 10;
      const [wx0, wy1] = this.s2w(0, 0), [wx1, wy0] = this.s2w(W, H);
      ctx.strokeStyle = col('--grid', '#e8e8e8'); ctx.lineWidth = 1; ctx.beginPath();
      for (let x = Math.ceil(wx0 / step) * step; x <= wx1; x += step) { const [sx] = this.w2s(x, 0); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
      for (let y = Math.ceil(wy0 / step) * step; y <= wy1; y += step) { const [, sy] = this.w2s(0, y); ctx.moveTo(0, sy); ctx.lineTo(W, sy); }
      ctx.stroke();

      const g = this.geom;
      const path = (poly) => { ctx.beginPath(); poly.forEach(([x, y], i) => { const [sx, sy] = this.w2s(x, y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }); ctx.closePath(); };

      // substrate hole (drawn below the crystal: it is in the substrate)
      if (g.hole) {
        const [sx, sy] = this.w2s(g.hole.cx, g.hole.cy);
        ctx.fillStyle = col('--hole', 'rgba(0,0,0,0.18)');
        ctx.beginPath(); ctx.arc(sx, sy, g.hole.a * this.view.scale, 0, 7); ctx.fill();
      }
      // crystal
      if (g.crystal) {
        path(g.crystal);
        ctx.fillStyle = col('--crystal', 'rgba(90,130,200,0.25)'); ctx.fill();
      }
      // overlay (temperature / current), clipped to crystal
      if (this.overlay && g.crystal) {
        const o = this.overlay;
        ctx.save(); path(g.crystal); ctx.clip();
        const [ax, ay] = this.w2s(o.x0, o.y1), [bx, by] = this.w2s(o.x1, o.y0);
        ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 0.92;
        ctx.drawImage(o.canvas, ax, ay, bx - ax, by - ay);
        ctx.restore();
      }
      if (g.crystal) {
        path(g.crystal);
        ctx.strokeStyle = col('--crystal-edge', '#3a64b0'); ctx.lineWidth = this._selIs('crystal') ? 2.5 : 1.5; ctx.stroke();
      }
      if (g.hole) {
        const [sx, sy] = this.w2s(g.hole.cx, g.hole.cy);
        ctx.setLineDash([6, 4]); ctx.strokeStyle = col('--hole-edge', '#333'); ctx.lineWidth = this._selIs('hole') ? 2.5 : 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, g.hole.a * this.view.scale, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      }
      // contacts
      g.contacts.forEach((c, i) => {
        path(c.poly);
        ctx.fillStyle = col('--contact', 'rgba(212,165,40,0.55)'); ctx.fill();
        const sel = this.selected && this.selected.type === 'contact' && this.selected.index === i;
        ctx.strokeStyle = col('--contact-edge', '#9a7410'); ctx.lineWidth = sel ? 2.5 : 1.2; ctx.stroke();
        let cx = 0, cy = 0; c.poly.forEach(([x, y]) => { cx += x; cy += y; });
        const [sx, sy] = this.w2s(cx / c.poly.length, cy / c.poly.length);
        ctx.fillStyle = col('--fg', '#222'); ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`${c.name}${c.role !== 'none' ? ' · ' + c.role.replace('-', '−') : ''}`, sx, sy);
      });
      // vertex handles for selection
      const s = this.selected;
      const handles = (poly) => poly.forEach(([x, y]) => { const [sx, sy] = this.w2s(x, y); ctx.fillStyle = '#fff'; ctx.strokeStyle = col('--accent', '#2a6'); ctx.lineWidth = 1.5; ctx.fillRect(sx - 4, sy - 4, 8, 8); ctx.strokeRect(sx - 4, sy - 4, 8, 8); });
      if (s && s.type === 'crystal' && g.crystal) handles(g.crystal);
      if (s && s.type === 'contact' && g.contacts[s.index]) handles(g.contacts[s.index].poly);

      // scan line
      if (g.scan) {
        const [ax, ay] = this.w2s(...g.scan.p1), [bx, by] = this.w2s(...g.scan.p2);
        ctx.strokeStyle = col('--scan', '#8a3ab9'); ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
        const ang = Math.atan2(by - ay, bx - ax);
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - 10 * Math.cos(ang - 0.4), by - 10 * Math.sin(ang - 0.4)); ctx.lineTo(bx - 10 * Math.cos(ang + 0.4), by - 10 * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
        ctx.beginPath(); ctx.arc(ax, ay, 4, 0, 7); ctx.fill();
      }
      // heat source
      if (g.source) {
        const [sx, sy] = this.w2s(g.source[0], g.source[1]);
        const rr = Math.max(5, this.sourceRadius * this.view.scale);
        ctx.strokeStyle = col('--source', '#d62728'); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx, sy, rr, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx - rr - 6, sy); ctx.lineTo(sx + rr + 6, sy); ctx.moveTo(sx, sy - rr - 6); ctx.lineTo(sx, sy + rr + 6); ctx.stroke();
      }

      // drafts
      const d = this.drag;
      ctx.strokeStyle = col('--accent', '#2a6'); ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      if (d && d.kind === 'rect') { const [ax, ay] = this.w2s(...d.start), [bx, by] = this.w2s(...d.end); ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)); }
      if (d && d.kind === 'hole') { const [ax, ay] = this.w2s(...d.start); ctx.beginPath(); ctx.arc(ax, ay, Math.hypot(d.end[0] - d.start[0], d.end[1] - d.start[1]) * this.view.scale, 0, 7); ctx.stroke(); }
      if (d && d.kind === 'scan') { const [ax, ay] = this.w2s(...d.start), [bx, by] = this.w2s(...d.end); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
      if (this.draft) {
        const pts = this.draft.hover ? this.draft.pts.concat([this.draft.hover]) : this.draft.pts;
        ctx.beginPath(); pts.forEach(([x, y], i) => { const [sx, sy] = this.w2s(x, y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }); ctx.stroke();
        this.draft.pts.forEach(([x, y]) => { const [sx, sy] = this.w2s(x, y); ctx.fillStyle = col('--accent', '#2a6'); ctx.fillRect(sx - 3, sy - 3, 6, 6); });
      }
      ctx.setLineDash([]);

      // scale bar
      const barW = step * this.view.scale;
      ctx.strokeStyle = col('--fg', '#222'); ctx.fillStyle = col('--fg', '#222'); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(14, H - 14); ctx.lineTo(14 + barW, H - 14); ctx.stroke();
      ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(`${+step.toPrecision(3)} µm`, 14, H - 18);

      // colour bar for overlay
      if (this.overlay && this.overlay.bar) {
        const o = this.overlay, bw = 12, bh = Math.min(160, H - 60), bx = W - 78, by = 16;
        ctx.drawImage(o.bar, bx, by, bw, bh);
        ctx.strokeStyle = col('--muted', '#777'); ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, bh);
        ctx.fillStyle = col('--fg', '#222'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(o.maxLabel, bx + bw + 3, by + 4); ctx.fillText(o.minLabel, bx + bw + 3, by + bh - 4);
        ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(o.label, bx + 6, by + bh + 4);
      }
    }
    _selIs(t) { return this.selected && this.selected.type === t; }
  }

  root.BS = root.BS || {};
  root.BS.Editor = Editor;
})(typeof globalThis !== 'undefined' ? globalThis : this);

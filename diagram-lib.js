/**
 * diagram-lib.js
 * ──────────────────────────────────────────────────────────────
 * StateTransitionDiagram — D3-based HMM visualisation library
 *
 * Public API:
 *   new StateTransitionDiagram(containerId, inspectorId, config)
 *   .feedIteration({ A, B, pi, iteration, log_likelihood })
 *   .onComplete()
 *   .wireControls({ btnFirst, btnBack, btnPlay, ... })
 *   .seekTo(index)
 *   .play() / .pause() / .stepForward() / .stepBack()
 *   .saveSVG() / .savePNG()
 *   .reset()
 *
 * Requires: D3 v7 (loaded before this file)
 * ──────────────────────────────────────────────────────────────
 */

// #region §7 StateTransitionDiagram Library

const STD_DEFAULT_STATE_COLORS = [
  { base: '#F59E0B', light: '#FDE68A', dark: '#92400E', grad: ['#FBBF24', '#D97706'] },
  { base: '#3B82F6', light: '#93C5FD', dark: '#1E3A8A', grad: ['#60A5FA', '#2563EB'] },
  { base: '#10B981', light: '#6EE7B7', dark: '#064E3B', grad: ['#34D399', '#059669'] },
  { base: '#F43F5E', light: '#FDA4AF', dark: '#881337', grad: ['#FB7185', '#E11D48'] },
  { base: '#8B5CF6', light: '#C4B5FD', dark: '#4C1D95', grad: ['#A78BFA', '#7C3AED'] },
  { base: '#06B6D4', light: '#67E8F9', dark: '#155E75', grad: ['#22D3EE', '#0891B2'] },
  { base: '#EC4899', light: '#F9A8D4', dark: '#831843', grad: ['#F472B6', '#DB2777'] },
  { base: '#14B8A6', light: '#5EEAD4', dark: '#134E4A', grad: ['#2DD4BF', '#0D9488'] },
  { base: '#F97316', light: '#FDBA74', dark: '#7C2D12', grad: ['#FB923C', '#EA580C'] },
  { base: '#6366F1', light: '#A5B4FC', dark: '#3730A3', grad: ['#818CF8', '#4F46E5'] },
  { base: '#84CC16', light: '#BEF264', dark: '#3F6212', grad: ['#A3E635', '#65A30D'] },
  { base: '#E879F9', light: '#F0ABFC', dark: '#701A75', grad: ['#D946EF', '#C026D3'] },
];
const STD_DEFAULT_OBS_COLOR = { fill: '#F1F5F9', stroke: '#94A3B8', dark: '#334155' };
const STD_DEFAULT_PI_COLOR  = { fill: '#F5F3FF', stroke: '#8B5CF6', dark: '#5B21B6' };

class StateTransitionDiagram {
  constructor(containerId, inspectorId, config) {
    const cfg = config || {};
    this.STATE_COLORS = cfg.stateColors || STD_DEFAULT_STATE_COLORS;
    this.OBS_COLOR    = cfg.obsColor    || STD_DEFAULT_OBS_COLOR;
    this.PI_COLOR     = cfg.piColor     || STD_DEFAULT_PI_COLOR;
    this.fontFamily   = cfg.fontFamily  || "'Inter', system-ui, sans-serif";
    this.monoFont     = cfg.monoFontFamily || "'JetBrains Mono', monospace";
    this.container    = document.querySelector(containerId);
    this.inspectorEl  = inspectorId ? document.querySelector(inspectorId) : null;
    this.history      = [];
    this.currentIdx   = -1;
    this.isPlaying    = false;
    this.playTimer    = null;
    this.playSpeed    = cfg.animationSpeed || 1;
    this.particlesOn  = cfg.particlesEnabled !== undefined ? cfg.particlesEnabled : true;
    this.decongestionOn = cfg.decongestionEnabled !== undefined ? cfg.decongestionEnabled : false;
    this.isScrubbing  = false;
    this.followLatest = true;
    this.built        = false;
    this.particles    = [];
    this.animFrame    = null;
    this.svg          = null;
    this.N = 0; this.M = 0; this._ctrl = null;
  }

  /* ── Public API ───────────────────────────────────────────── */
  feedIteration(data) {
    this.history.push({ A: data.A, B: data.B, pi: data.pi,
      iteration: data.iteration, log_likelihood: data.log_likelihood });
    if (!this.built) { this._build(data.A, data.B, data.pi); this.built = true; }
    if (!this.isScrubbing && this.followLatest) {
      this.currentIdx = this.history.length - 1;
      this._render(this.currentIdx);
    }
    this._updateControls();
  }
  onComplete()  { this.pause(); this._updateControls(); }
  seekTo(i) {
    if (i < 0 || i >= this.history.length) return;
    this.currentIdx   = i;
    this.followLatest = i >= this.history.length - 1;
    this._render(i);
    this._updateControls();
  }
  play() {
    if (!this.history.length) return;
    this.followLatest = true;
    this.isPlaying    = true;
    this._updateControls();
    this._playStep();
  }
  pause() {
    this.isPlaying = false;
    if (this.playTimer) clearTimeout(this.playTimer);
    this.playTimer = null;
    this._updateControls();
  }
  stepForward() {
    this.pause();
    if (this.currentIdx < this.history.length - 1) {
      this.currentIdx++;
      this._render(this.currentIdx);
    }
    this._updateControls();
  }
  stepBack() {
    this.pause();
    if (this.currentIdx > 0) {
      this.currentIdx--;
      this.followLatest = false;
      this._render(this.currentIdx);
    }
    this._updateControls();
  }
  goFirst()     { this.pause(); this.seekTo(0); }
  goLast()      { this.pause(); this.followLatest = true; this.seekTo(this.history.length - 1); }
  setSpeed(s)   { this.playSpeed = s; }
  toggleParticles(on) { this.particlesOn = on; if (!on) this._clearParticles(); }
  toggleDecongestion(on) {
    this.decongestionOn = typeof on === 'boolean' ? on : !this.decongestionOn;
    if (this.currentIdx >= 0) this._render(this.currentIdx);
    this._updateControls();
  }
  toggle3D()    { this.container.classList.toggle('view-3d'); }
  reset() {
    this.pause();
    this.history = []; this.currentIdx = -1; this.built = false;
    this.isScrubbing = false; this.followLatest = true;
    this._clearParticles();
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    if (this.container) { this.container.innerHTML = ''; this.container.style.height = ''; }
    this._updateControls();
  }

  /* ── Save / Download ──────────────────────────────────────── */
  saveSVG(filename) {
    if (!this.svg) return;
    const sr = new XMLSerializer();
    let sv = sr.serializeToString(this.svg.node());
    if (!sv.includes('xmlns="http://www.w3.org/2000/svg"'))
      sv = sv.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    const url = URL.createObjectURL(new Blob([sv], { type: 'image/svg+xml;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename || 'state_transition_diagram.svg' });
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }
  savePNG(filename, scale) {
    if (!this.svg) return;
    scale = scale || 2;
    const sn = this.svg.node();
    const w = +sn.getAttribute('width'), h = +sn.getAttribute('height');
    const sr = new XMLSerializer();
    let sv = sr.serializeToString(sn);
    if (!sv.includes('xmlns="http://www.w3.org/2000/svg"'))
      sv = sv.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    const ca = document.createElement('canvas');
    ca.width = w * scale; ca.height = h * scale;
    const ctx = ca.getContext('2d');
    const url = URL.createObjectURL(new Blob([sv], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = '#0f1018';
      ctx.fillRect(0, 0, ca.width, ca.height);
      ctx.drawImage(img, 0, 0, ca.width, ca.height);
      URL.revokeObjectURL(url);
      ca.toBlob(blob => {
        const a = Object.assign(document.createElement('a'),
          { href: URL.createObjectURL(blob), download: filename || 'state_transition_diagram.png' });
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
      }, 'image/png');
    };
    img.src = url;
  }

  /* ── Build (called once on first feedIteration) ───────────── */
  _build(A, B, pi) {
    this.container.innerHTML = '';
    this.N = A.length; this.M = B[0].length;
    const N = this.N, M = this.M;
    const SC = this.STATE_COLORS, OC = this.OBS_COLOR, PC = this.PI_COLOR;

    const baseRadius  = 40;
    const R           = N <= 4 ? baseRadius : Math.max(18, baseRadius - (N - 4) * 3.5);
    this._R = R;

    const stateGapIdeal = Math.max(R * 2.5, 110);
    const containerW    = this.container.clientWidth || 860;
    const W             = Math.max(containerW, (N - 1) * stateGapIdeal + 2 * R + 120, (M - 1) * Math.max(80, 100) + 160);
    const maxArcH       = Math.min(120, 30 + Math.sqrt((N - 1) * stateGapIdeal) * 4);
    const emissionGap   = 140 + Math.max(0, N - 2) * 25;
    const H             = Math.max(390, 50 + 18 + maxArcH + R + 60 + R * 1.7 + emissionGap - 24);
    this.container.style.height = H + 'px';
    this._svgW = W; this._svgH = H;

    this.svg = d3.select(this.container).append('svg')
      .attr('width', W).attr('height', H)
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .style('font-family', this.fontFamily);

    const defs = this.svg.append('defs');

    // Radial gradients for state nodes
    for (let i = 0; i < N; i++) {
      const c = SC[i % SC.length];
      const g = defs.append('radialGradient').attr('id', `sg${i}`)
        .attr('cx', '35%').attr('cy', '35%').attr('r', '65%');
      g.append('stop').attr('offset', '0%').attr('stop-color', c.light).attr('stop-opacity', 0.85);
      g.append('stop').attr('offset', '100%').attr('stop-color', c.grad[1]);
    }

    // Arrowhead markers (per-state colour)
    for (let i = 0; i < N; i++) {
      const c = SC[i % SC.length];
      defs.append('marker').attr('id', `ah${i}`)
        .attr('viewBox', '0 -3 6 6').attr('refX', 5).attr('refY', 0)
        .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
        .append('path').attr('d', 'M0,-2.5L6,0L0,2.5Z').attr('fill', c.dark);
    }
    defs.append('marker').attr('id', 'ah-pi')
      .attr('viewBox', '0 -3 6 6').attr('refX', 5).attr('refY', 0)
      .attr('markerWidth', 4.5).attr('markerHeight', 4.5).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-2L6,0L0,2Z').attr('fill', PC.dark);
    defs.append('marker').attr('id', 'ah-em')
      .attr('viewBox', '0 -3 6 6').attr('refX', 5).attr('refY', 0)
      .attr('markerWidth', 4.5).attr('markerHeight', 4.5).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-2L6,0L0,2Z').attr('fill', OC.dark);

    // Drop shadow
    const f = defs.append('filter').attr('id', 'shd')
      .attr('x', '-15%').attr('y', '-15%').attr('width', '130%').attr('height', '130%');
    f.append('feDropShadow').attr('dx', 0).attr('dy', 1).attr('stdDeviation', 3)
      .attr('flood-color', 'rgba(0,0,0,0.4)');

    /* ── Layout ── */
    const piY       = 50;
    const stateGap  = (W - 120) / Math.max(N, 1);
    const stateX0   = (W - (N - 1) * stateGap) / 2;
    const arcClear  = Math.min(120, 30 + Math.sqrt((N - 1) * stateGap) * 4);
    const stateY    = piY + 18 + arcClear + R + 30;
    this._sp = Array.from({ length: N }, (_, i) => ({ x: stateX0 + i * stateGap, y: stateY }));

    const obsGap = Math.min(120, (W - 100) / Math.max(M, 1));
    const obsX0  = (W - (M - 1) * obsGap) / 2;
    const obsW   = Math.max(50, 80 - Math.max(0, M - 4) * 5);
    const obsH   = Math.max(30, 40 - Math.max(0, M - 6) * 2);
    const obsY   = Math.min(Math.max(stateY + R + emissionGap, H * 0.9), H - obsH / 2 - 18);
    this._op = Array.from({ length: M }, (_, k) => ({ x: obsX0 + k * obsGap, y: obsY }));

    /* ── Z-ordered layer groups ── */
    this._gLayer4 = this.svg.append('g').attr('class', 'layer-4');
    this._gLayer3 = this.svg.append('g').attr('class', 'layer-3');
    this._gLayer2 = this.svg.append('g').attr('class', 'layer-2');
    this._gLayer1 = this.svg.append('g').attr('class', 'layer-1');
    this._emG = this._gLayer4; this._obsG = this._gLayer4;
    this._stateG = this._gLayer3;
    this._edG = this._gLayer2; this._ptG = this._gLayer2;
    this._piG = this._gLayer1;

    /* ── Layer labels ── */
    const lblSz = N > 8 ? '8px' : '10px';
    const lbl = (x, y, t) => this.svg.append('text').attr('x', x).attr('y', y)
      .attr('fill', '#4e5a72').attr('font-size', lblSz)
      .attr('font-weight', '600').attr('letter-spacing', '0.05em').text(t);
    lbl(20, piY + 4, 'START');
    lbl(20, stateY - R - 20, 'HIDDEN STATES');
    lbl(20, obsY - obsH / 2 - 20, 'OBSERVATIONS');

    /* ── START node ── */
    this._piG.append('rect')
      .attr('x', W / 2 - 50).attr('y', piY - 18).attr('width', 100).attr('height', 36)
      .attr('rx', 18).attr('fill', PC.fill).attr('stroke', PC.stroke)
      .attr('stroke-width', 2).attr('filter', 'url(#shd)');
    this._piG.append('text').attr('x', W / 2).attr('y', piY)
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .attr('font-size', '13px').attr('font-weight', '700').attr('fill', PC.dark).text('START');

    /* ── π arrows ── */
    const piFontSz = N > 8 ? '8px' : N > 5 ? '9px' : '11px';
    this._piA = [];
    for (let i = 0; i < N; i++) {
      const s = this._sp[i];
      const sx = W / 2, sy = piY + 18, ex = s.x, ey = s.y - R - 3;
      const bend = (ex - sx) * 0.06;
      const mx = (sx + ex) / 2 + bend, my = (sy + ey) / 2;
      const d = `M${sx},${sy} Q${mx},${my} ${ex},${ey}`;
      const path = this._piG.append('path').attr('d', d)
        .attr('fill', 'none').attr('stroke', PC.stroke)
        .attr('stroke-width', 1.2).attr('stroke-dasharray', '4 3')
        .attr('marker-end', 'url(#ah-pi)').attr('opacity', 0.5);
      const hit = this._piG.append('path').attr('d', d)
        .attr('fill', 'none').attr('stroke', 'rgba(0,0,0,0)')
        .attr('stroke-width', 5).style('pointer-events', 'stroke').attr('cursor', 'pointer');
      const lx = sx * 0.25 + mx * 0.5 + ex * 0.25;
      const ly = sy * 0.25 + my * 0.5 + ey * 0.25 - 4;
      const label = this._piG.append('text').attr('x', lx).attr('y', ly)
        .attr('text-anchor', 'middle').attr('font-size', piFontSz)
        .attr('font-family', this.monoFont).attr('font-weight', '600')
        .attr('fill', PC.dark).text(`π=${pi[i].toFixed(2)}`);
      this._piA.push({ path, hit, label });
      path.on('mouseover', ev => this._showTip(ev, `π[${i}]`)).on('mouseout', () => this._hideTip());
      hit.on('mouseover',  ev => this._showTip(ev, `π[${i}]`)).on('mouseout', () => this._hideTip());
    }

    /* ── Observation nodes ── */
    const obsFontSz = M > 8 ? '11px' : M > 5 ? '13px' : '16px';
    for (let k = 0; k < M; k++) {
      const o = this._op[k];
      this._obsG.append('rect')
        .attr('x', o.x - obsW / 2).attr('y', o.y - obsH / 2)
        .attr('width', obsW).attr('height', obsH).attr('rx', 5)
        .attr('fill', OC.fill).attr('stroke', OC.stroke)
        .attr('stroke-width', 1.2).attr('filter', 'url(#shd)');
      this._obsG.append('text').attr('x', o.x).attr('y', o.y)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('font-size', obsFontSz).attr('font-weight', '700').attr('fill', OC.dark)
        .text(`O${k}`);
    }

    /* ── Emission arrows ── */
    const emFontSz = N > 8 ? '8px' : N > 5 ? '9px' : '11px';
    const emStroke = N > 6 ? 1.5 : 2;
    this._emR = {};
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < M; k++) {
        const sp = this._sp[i], op = this._op[k];
        const col = SC[i % SC.length];
        const sx = sp.x, sy = sp.y + R, ex = op.x, ey = op.y - obsH / 2;
        const dist = ey - sy;
        const c1x = sx, c1y = sy + dist * 0.5, c2x = ex, c2y = ey - dist * 0.5;
        const pathD = `M${sx},${sy} C${c1x},${c1y} ${c2x},${c2y} ${ex},${ey}`;
        const path = this._emG.append('path').attr('d', pathD)
          .attr('fill', 'none').attr('stroke', col.base)
          .attr('stroke-width', emStroke).attr('opacity', 0.4)
          .attr('stroke-dasharray', '4 3').attr('marker-end', 'url(#ah-em)');
        const hit = this._emG.append('path').attr('d', pathD)
          .attr('fill', 'none').attr('stroke', 'rgba(0,0,0,0)')
          .attr('stroke-width', 5).style('pointer-events', 'stroke').attr('cursor', 'pointer');
        const label = this._emG.append('text')
          .attr('x', (sx + ex) / 2).attr('y', (sy + ey) / 2)
          .attr('text-anchor', 'middle').attr('font-size', emFontSz)
          .attr('font-family', this.monoFont).attr('font-weight', '600')
          .attr('fill', col.dark).attr('opacity', 0).text('');
        this._emR[`em-${i}-${k}`] = { path, hit, label, sx, sy, c1x, c1y, c2x, c2y, ex, ey,
          baseC1x: c1x, baseC1y: c1y, baseC2x: c2x, baseC2y: c2y };
        path.on('mouseover', ev => this._showTip(ev, `B[${i}][${k}]`)).on('mouseout', () => this._hideTip());
        hit.on('mouseover',  ev => this._showTip(ev, `B[${i}][${k}]`)).on('mouseout', () => this._hideTip());
      }
    }

    /* ── Transition arrows ── */
    this._trR = {}; this._slR = {};
    const trStroke = N > 6 ? 1.5 : 2;
    const trFontSz = N > 8 ? '8px' : N > 5 ? '9px' : '11px';
    const bgW = N > 8 ? 24 : 30, bgH = N > 8 ? 13 : 16;

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const key = `${i}-${j}`;
        const col = SC[i % SC.length];

        if (i === j) {
          // Self-loop
          const sp = this._sp[i];
          const lW = R * 0.5, lH = R * 1.25;
          const sl_sx = sp.x + lW, sl_sy = sp.y - R + 5;
          const sl_ex = sp.x - lW, sl_ey = sp.y - R + 5;
          const sl_c1x = sp.x + lW + R * 0.5, sl_c1y = sp.y - R - lH;
          const sl_c2x = sp.x - lW - R * 0.5, sl_c2y = sp.y - R - lH;
          const dLoop = `M${sl_sx},${sl_sy} C${sl_c1x},${sl_c1y} ${sl_c2x},${sl_c2y} ${sl_ex},${sl_ey}`;
          const path = this._edG.append('path').attr('d', dLoop)
            .attr('fill', 'none').attr('stroke', col.base)
            .attr('stroke-width', trStroke).attr('opacity', 0.5)
            .attr('marker-end', `url(#ah${i})`);
          const hit = this._edG.append('path').attr('d', dLoop)
            .attr('fill', 'none').attr('stroke', 'rgba(0,0,0,0)')
            .attr('stroke-width', 5).style('pointer-events', 'stroke').attr('cursor', 'pointer');
          const slLblSz = N > 8 ? '8px' : N > 5 ? '9px' : '11px';
          const label = this._edG.append('text')
            .attr('x', sp.x).attr('y', sp.y - R - lH)
            .attr('text-anchor', 'middle').attr('font-size', slLblSz)
            .attr('font-weight', '600').attr('fill', col.dark).text('0.00');
          this._slR[key] = { path, hit, label };
          hit.on('mouseover', ev => this._showTip(ev, `A[${i}][${j}]`)).on('mouseout', () => this._hideTip());

        } else {
          // Inter-state arc — forward arcs above, reverse arcs below
          const src = this._sp[i], tgt = this._sp[j];
          const dist = Math.abs(tgt.x - src.x);
          const arcH = Math.min(120, 30 + Math.sqrt(dist) * 4);
          const midX = (src.x + tgt.x) / 2;
          let sx, sy, ex, ey, cx, cy;
          if (i < j) {
            sx = src.x + R * 0.5; sy = src.y - R * 0.8;
            ex = tgt.x - R * 0.5; ey = tgt.y - R * 0.8;
            cx = midX; cy = Math.min(src.y, tgt.y) - R - arcH;
          } else {
            sx = src.x - R * 0.5; sy = src.y + R * 0.8;
            ex = tgt.x + R * 0.5; ey = tgt.y + R * 0.8;
            cx = midX; cy = Math.max(src.y, tgt.y) + R + arcH * 0.45;
          }
          const d = `M${sx},${sy} Q${cx},${cy} ${ex},${ey}`;
          const path = this._edG.append('path').attr('d', d)
            .attr('fill', 'none').attr('stroke', col.base)
            .attr('stroke-width', trStroke).attr('opacity', 0.35)
            .attr('marker-end', `url(#ah${i})`);
          const hit = this._edG.append('path').attr('d', d)
            .attr('fill', 'none').attr('stroke', 'rgba(0,0,0,0)')
            .attr('stroke-width', 5).style('pointer-events', 'stroke').attr('cursor', 'pointer');
          const lx = 0.25 * sx + 0.5 * cx + 0.25 * ex;
          const lyOff = i < j ? -5 : 5;
          const ly = 0.25 * sy + 0.5 * cy + 0.25 * ey + lyOff;
          const bg = this._edG.append('rect')
            .attr('x', lx - bgW / 2).attr('y', ly - bgH / 2)
            .attr('width', bgW).attr('height', bgH).attr('rx', 8)
            .attr('fill', 'rgba(10,10,20,0.85)').attr('stroke', '#2a2a3a')
            .attr('stroke-width', 0.5).attr('opacity', 0);
          const label = this._edG.append('text')
            .attr('x', lx).attr('y', ly)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
            .attr('font-size', trFontSz).attr('font-weight', '700')
            .attr('font-family', this.monoFont).attr('fill', col.base).attr('opacity', 0).text('');
          this._trR[key] = { path, hit, label, bg, sx, sy, cx, cy, ex, ey,
            baseCy: cy, yDir: i < j ? -1 : 1 };
          path.on('mouseover', ev => this._showTip(ev, `A[${i}][${j}]`)).on('mouseout', () => this._hideTip());
          hit.on('mouseover',  ev => this._showTip(ev, `A[${i}][${j}]`)).on('mouseout', () => this._hideTip());
        }
      }
    }

    /* ── State circles ── */
    const stateFontSz = N > 10 ? '11px' : N > 6 ? '14px' : '20px';
    this._sn = [];
    for (let i = 0; i < N; i++) {
      const s = this._sp[i], c = SC[i % SC.length];
      const circle = this._stateG.append('circle')
        .attr('cx', s.x).attr('cy', s.y).attr('r', R)
        .attr('fill', `url(#sg${i})`).attr('stroke', c.dark)
        .attr('stroke-width', N > 8 ? 1.5 : 2).attr('filter', 'url(#shd)').attr('cursor', 'pointer');
      this._stateG.append('text').attr('x', s.x).attr('y', s.y)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('font-size', stateFontSz).attr('font-weight', '700').attr('fill', '#fff')
        .attr('pointer-events', 'none').style('text-shadow', '0 1px 2px rgba(0,0,0,0.6)')
        .text(`S${i}`);
      this._sn.push(circle);
      circle.on('click', () => this._inspect(i))
        .on('mouseover', function () { d3.select(this).attr('stroke-width', 3); })
        .on('mouseout',  function () { d3.select(this).attr('stroke-width', 2); });
    }

    /* ── Tooltip div ── */
    this._tip = d3.select(this.container).append('div')
      .style('position', 'absolute').style('display', 'none')
      .style('background', 'rgba(7,8,15,0.95)').style('color', '#e2e8f0')
      .style('padding', '3px 8px').style('border-radius', '5px')
      .style('font-family', this.monoFont).style('font-size', '10px')
      .style('pointer-events', 'none').style('z-index', '50')
      .style('border', '1px solid #2a2a3a');

    this._startParticleLoop();
  }

  /* ── Render (called every seekTo / feedIteration) ─────────── */
  _render(idx) {
    if (idx < 0 || idx >= this.history.length || !this.built) return;
    const { A, B, pi } = this.history[idx];
    const N = this.N, M = this.M;
    const isFiltered = this.decongestionOn;

    // Compute which transitions/emissions are "prominent"
    const promTr = Array.from({ length: N }, () => new Set());
    const promEm = Array.from({ length: N }, () => new Set());
    const trLane = Array.from({ length: N }, () => ({}));
    const emLane = Array.from({ length: N }, () => ({}));

    for (let i = 0; i < N; i++) {
      const ranked = [];
      for (let j = 0; j < N; j++) if (i !== j) ranked.push({ j, v: A[i][j] });
      ranked.sort((a, b) => b.v - a.v);
      if (isFiltered) {
        ranked.slice(0, 2).forEach(({ j }) => promTr[i].add(j));
        ranked.forEach(({ j, v }) => { if (v >= 0.35) promTr[i].add(j); });
      } else {
        ranked.filter(({ j }) => i < j).forEach(({ j }, li) => { trLane[i][j] = li; });
        ranked.filter(({ j }) => i > j).forEach(({ j }, li) => { trLane[i][j] = li; });
      }
      const rankedEm = [];
      for (let k = 0; k < M; k++) rankedEm.push({ k, v: B[i][k] });
      rankedEm.sort((a, b) => b.v - a.v);
      if (isFiltered) {
        rankedEm.slice(0, 2).forEach(({ k }) => promEm[i].add(k));
        rankedEm.forEach(({ k, v }) => { if (v >= 0.35) promEm[i].add(k); });
      } else {
        rankedEm.forEach(({ k }, li) => { emLane[i][k] = li; });
      }
    }

    // π arrows
    for (let i = 0; i < N; i++) {
      const r = this._piA[i], v = pi[i];
      r.path.transition().duration(180)
        .attr('stroke-width', 1.5 + v * 5)
        .attr('opacity', Math.max(0.25, 0.2 + v * 0.7));
      r.label.text(`π=${v.toFixed(2)}`).attr('font-size', '12px').attr('font-weight', '800');
    }

    // Transition arcs
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const v = A[i][j], key = `${i}-${j}`;
      if (i === j) {
        const r = this._slR[key]; if (!r) continue;
        r.path.transition().duration(180)
          .attr('stroke-width', 1 + v * 6)
          .attr('opacity', Math.max(0.12, 0.10 + v * 0.8));
        r.label.text(v.toFixed(2));
      } else {
        const r = this._trR[key]; if (!r) continue;
        const laneOff  = isFiltered ? 0 : (trLane[i][j] || 0) * 10;
        const valOff   = isFiltered ? 0 : (1 - v) * 18;
        const dynCy    = r.baseCy + r.yDir * (laneOff + valOff);
        const dynPath  = `M${r.sx},${r.sy} Q${r.cx},${dynCy} ${r.ex},${r.ey}`;
        const lyOff    = r.yDir < 0 ? -5 : 5;
        const ly       = 0.25 * r.sy + 0.5 * dynCy + 0.25 * r.ey + lyOff;
        const isProm   = !isFiltered || promTr[i].has(j);
        const opacity  = isFiltered ? (isProm ? Math.max(0.22, 0.2 + v * 0.7) : 0.04) : Math.max(0.16, 0.14 + v * 0.72);
        const sw       = isFiltered ? (isProm ? 1 + v * 6 : 0.8) : 0.9 + v * 5;
        r.path.transition().duration(180).attr('d', dynPath).attr('stroke-width', sw).attr('opacity', opacity);
        if (r.hit) r.hit.attr('d', dynPath);
        r.cy = dynCy;
        const showLbl = isFiltered ? (isProm && v > 0.02) : v > 0.08;
        r.label.text(v.toFixed(2)).attr('x', r.cx).attr('y', ly).attr('opacity', showLbl ? 1 : 0)
          .attr('font-size', '11px').attr('font-weight', '700');
        r.bg.attr('x', r.cx - 15).attr('y', ly - 8).attr('opacity', showLbl ? 1 : 0);
      }
    }

    // Emission curves
    for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) {
      const v = B[i][k], r = this._emR[`em-${i}-${k}`]; if (!r) continue;
      const laneOff = isFiltered ? 0 : (emLane[i][k] || 0) * 8;
      const strOff  = isFiltered ? 0 : (1 - v) * 14;
      const dir     = r.ex >= r.sx ? 1 : -1;
      const spread  = laneOff + strOff;
      const dc1x = isFiltered ? r.baseC1x : r.baseC1x + dir * spread * 0.4;
      const dc2x = isFiltered ? r.baseC2x : r.baseC2x + dir * spread * 0.9;
      const dc1y = isFiltered ? r.baseC1y : r.baseC1y + spread * 0.55;
      const dc2y = isFiltered ? r.baseC2y : r.baseC2y - spread * 0.15;
      const dp   = `M${r.sx},${r.sy} C${dc1x},${dc1y} ${dc2x},${dc2y} ${r.ex},${r.ey}`;
      const lx   = 0.125 * r.sx + 0.375 * dc1x + 0.375 * dc2x + 0.125 * r.ex;
      const ly   = 0.125 * r.sy + 0.375 * dc1y + 0.375 * dc2y + 0.125 * r.ey;
      r.c1x = dc1x; r.c1y = dc1y; r.c2x = dc2x; r.c2y = dc2y;
      const isProm  = !isFiltered || promEm[i].has(k);
      const opacity = isFiltered ? (isProm ? Math.max(0.35, 0.35 + v * 0.6) : 0.03) : Math.max(0.18, 0.2 + v * 0.55);
      const sw      = isFiltered ? (isProm ? 1 + v * 5 : 0.7) : 0.8 + v * 4;
      r.path.transition().duration(180).attr('d', dp).attr('stroke-width', sw).attr('opacity', opacity);
      if (r.hit) r.hit.attr('d', dp);
      const showLbl = isFiltered ? (isProm && v > 0.08) : v > 0.12;
      r.label.text(showLbl ? v.toFixed(2) : '').attr('x', lx).attr('y', ly)
        .attr('opacity', showLbl ? 1 : 0).attr('font-size', '11px').attr('font-weight', '700');
    }

    this._rebuildParticles(A);
    if (this.inspectorEl?.classList.contains('visible')) this._renderInspector(idx);
  }

  /* ── Particles ────────────────────────────────────────────── */
  _rebuildParticles(A) {
    this._clearParticles();
    if (!this.particlesOn) return;
    const SC = this.STATE_COLORS;
    const isFiltered = this.decongestionOn;
    const promTr = Array.from({ length: this.N }, () => new Set());
    if (isFiltered) {
      for (let i = 0; i < this.N; i++) {
        const ranked = [];
        for (let j = 0; j < this.N; j++) if (i !== j) ranked.push({ j, v: A[i][j] });
        ranked.sort((a, b) => b.v - a.v);
        ranked.slice(0, 2).forEach(({ j }) => promTr[i].add(j));
        ranked.forEach(({ j, v }) => { if (v >= 0.35) promTr[i].add(j); });
      }
    }
    for (let i = 0; i < this.N; i++) for (let j = 0; j < this.N; j++) {
      if (i === j) continue;
      const v = A[i][j];
      if (isFiltered ? (!promTr[i].has(j) || v < 0.03) : v < 0.02) continue;
      const r = this._trR[`${i}-${j}`]; if (!r) continue;
      const c = SC[i % SC.length];
      const n = Math.max(1, Math.round(v * 3));
      for (let p = 0; p < n; p++) {
        this.particles.push({
          t: p / n, speed: 0.002 + v * 0.004,
          el: this._ptG.append('circle').attr('r', 2).attr('fill', c.base)
            .attr('opacity', 0.85)
            .style('filter', `drop-shadow(0 0 3px ${c.base})`)
            .attr('pointer-events', 'none'),
          ref: r,
        });
      }
    }
  }

  _startParticleLoop() {
    const tick = () => {
      this.animFrame = requestAnimationFrame(tick);
      if (!this.particlesOn) return;
      for (const p of this.particles) {
        p.t += p.speed;
        if (p.t > 1) p.t -= 1;
        const t = p.t, m = 1 - t, m2 = m * m, t2 = t * t;
        const r = p.ref;
        if (r.cx !== undefined) {
          // Quadratic bezier (transition arcs)
          p.el.attr('cx', m2 * r.sx + 2 * m * t * r.cx + t2 * r.ex);
          p.el.attr('cy', m2 * r.sy + 2 * m * t * (r.cy ?? r.baseCy) + t2 * r.ey);
        } else {
          // Cubic bezier (emission curves — particles not used here but handles gracefully)
          const m3 = m2 * m, t3 = t2 * t;
          p.el.attr('cx', m3 * r.sx + 3 * m2 * t * r.c1x + 3 * m * t2 * r.c2x + t3 * r.ex);
          p.el.attr('cy', m3 * r.sy + 3 * m2 * t * r.c1y + 3 * m * t2 * r.c2y + t3 * r.ey);
        }
      }
    };
    tick();
  }

  _clearParticles() {
    for (const p of this.particles) p.el.remove();
    this.particles = [];
  }

  /* ── Replay ───────────────────────────────────────────────── */
  _playStep() {
    if (!this.isPlaying) return;
    if (this.currentIdx < this.history.length - 1) {
      this.currentIdx++;
      this._render(this.currentIdx);
      this._updateControls();
      this.playTimer = setTimeout(() => this._playStep(), Math.max(50, 500 / this.playSpeed));
    } else {
      this.pause();
    }
  }

  /* ── Inspector ────────────────────────────────────────────── */
  _inspect(si) {
    if (!this.inspectorEl || this.currentIdx < 0) return;
    this.inspectorEl.classList.add('visible');
    this._renderInspector(this.currentIdx, si);
  }

  _renderInspector(ii, hl) {
    if (!this.inspectorEl) return;
    const d = this.history[ii]; if (!d) return;
    const N = d.A.length, M = d.B[0].length, SC = this.STATE_COLORS;
    let h = `<h4>Iteration ${d.iteration} &nbsp;|&nbsp; log P(O|λ) = ${d.log_likelihood.toFixed(4)}</h4>`;
    h += `<div style="margin-bottom:6px"><strong style="color:#94a3b8">π:</strong> [${
      d.pi.map((v, i) => `<span style="color:${SC[i % SC.length].base}">${v.toFixed(4)}</span>`).join(', ')
    }]</div>`;
    h += `<div style="margin-bottom:6px"><strong style="color:#94a3b8">A (Transitions):</strong>
      <table><tr><th></th>${Array.from({ length: N }, (_, j) => `<th>S${j}</th>`).join('')}</tr>`;
    for (let i = 0; i < N; i++) {
      h += `<tr${i === hl ? ' style="background:rgba(124,58,237,0.15)"' : ''}><th>S${i}</th>`;
      for (let j = 0; j < N; j++) {
        const v = d.A[i][j];
        h += `<td style="${v > 0.3 ? 'font-weight:700;' : ''}color:${SC[i % SC.length].base}">${v.toFixed(4)}</td>`;
      }
      h += `</tr>`;
    }
    h += `</table></div><strong style="color:#94a3b8">B (Emissions):</strong>
      <table><tr><th></th>${Array.from({ length: M }, (_, k) => `<th>O${k}</th>`).join('')}</tr>`;
    for (let i = 0; i < N; i++) {
      h += `<tr${i === hl ? ' style="background:rgba(6,182,212,0.1)"' : ''}><th>S${i}</th>`;
      for (let k = 0; k < M; k++) {
        const v = d.B[i][k];
        h += `<td style="${v > 0.3 ? 'font-weight:700;' : ''}color:${SC[i % SC.length].light}">${v.toFixed(4)}</td>`;
      }
      h += `</tr>`;
    }
    h += `</table>`;
    this.inspectorEl.innerHTML = h;
  }

  /* ── Tooltip ──────────────────────────────────────────────── */
  _showTip(ev, txt) {
    if (!this._tip) return;
    let label = txt;
    if (this.currentIdx >= 0) {
      const d  = this.history[this.currentIdx];
      const mA = txt.match(/^A\[(\d+)\]\[(\d+)\]$/);
      const mB = txt.match(/^B\[(\d+)\]\[(\d+)\]$/);
      const mP = txt.match(/^π\[(\d+)\]$/);
      if (mA) label = `${txt} = ${d.A[+mA[1]][+mA[2]].toFixed(6)}`;
      else if (mB) label = `${txt} = ${d.B[+mB[1]][+mB[2]].toFixed(6)}`;
      else if (mP) label = `${txt} = ${d.pi[+mP[1]].toFixed(6)}`;
    }
    const rect = this.container.getBoundingClientRect();
    this._tip.style('display', 'block').text(label)
      .style('left', (ev.clientX - rect.left + 10) + 'px')
      .style('top',  (ev.clientY - rect.top  - 22) + 'px');
  }
  _hideTip() { if (this._tip) this._tip.style('display', 'none'); }

  /* ── Wire controls ────────────────────────────────────────── */
  wireControls(c) {
    this._ctrl = c;
    c.btnFirst?.addEventListener('click',   () => this.goFirst());
    c.btnBack?.addEventListener('click',    () => this.stepBack());
    c.btnForward?.addEventListener('click', () => this.stepForward());
    c.btnLast?.addEventListener('click',    () => this.goLast());

    c.btnPlay?.addEventListener('click', () => {
      if (this.isPlaying) this.pause();
      else {
        if (this.currentIdx >= this.history.length - 1) this.currentIdx = 0;
        this.play();
      }
    });

    // Speed selector
    const syncSpeed = () => {
      if (!c.speedSelect) return;
      const s = parseFloat(c.speedSelect.value);
      if (Number.isFinite(s) && s > 0) this.setSpeed(s);
    };
    c.speedSelect?.addEventListener('change', syncSpeed);
    syncSpeed();

    // Timeline scrubber
    const scrubToIdx = idx => {
      const si = Number(idx);
      if (Number.isFinite(si)) this.seekTo(Math.round(si));
    };
    const scrubAtX = clientX => {
      if (!c.timeline || !this.history.length) return;
      const rect  = c.timeline.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
      const idx   = Math.round(ratio * Math.max(0, this.history.length - 1));
      c.timeline.value = String(idx);
      this.seekTo(idx);
    };
    const beginScrub = () => { this.isScrubbing = true; this.followLatest = false; this.pause(); };
    const endScrub   = () => { this.isScrubbing = false; };

    c.timeline?.addEventListener('pointerdown', e => { beginScrub(); scrubAtX(e.clientX); });
    c.timeline?.addEventListener('pointermove', e => {
      if (!this.isScrubbing) return;
      if ((e.buttons & 1) !== 1) { endScrub(); return; }
      scrubAtX(e.clientX);
    });
    c.timeline?.addEventListener('mousedown', beginScrub);
    c.timeline?.addEventListener('touchstart', e => {
      beginScrub();
      const t = e.touches?.[0];
      if (t) scrubAtX(t.clientX);
    }, { passive: true });
    c.timeline?.addEventListener('touchmove', e => {
      if (!this.isScrubbing) return;
      const t = e.touches?.[0];
      if (t) scrubAtX(t.clientX);
    }, { passive: true });
    c.timeline?.addEventListener('input',  e => scrubToIdx(e.target.value));
    c.timeline?.addEventListener('change', e => { endScrub(); scrubToIdx(e.target.value); });
    c.timeline?.addEventListener('pointerup', endScrub);
    window.addEventListener('pointerup',  endScrub);
    window.addEventListener('mouseup',    endScrub);
    window.addEventListener('touchend',   endScrub, { passive: true });

    // Particle / decongestion toggles
    c.btnParticles?.addEventListener('click', () => {
      this.particlesOn = !this.particlesOn;
      if (!this.particlesOn) this._clearParticles();
      else if (this.currentIdx >= 0) this._rebuildParticles(this.history[this.currentIdx].A);
      c.btnParticles.classList.toggle('active', this.particlesOn);
    });
    c.btnDecongestion?.addEventListener('click', () => this.toggleDecongestion());

    // Fullscreen change handler
    document.addEventListener('fullscreenchange',       () => this._handleFSChange());
    document.addEventListener('webkitfullscreenchange', () => this._handleFSChange());
  }

  _handleFSChange() {
    if (!this.svg) return;
    const sn = this.svg.node();
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (isFs) {
      sn.removeAttribute('width');
      sn.removeAttribute('height');
      this.container.style.height = '';
    } else {
      sn.setAttribute('width',  this._svgW);
      sn.setAttribute('height', this._svgH);
      this.container.style.height = this._svgH + 'px';
    }
  }

  _updateControls() {
    const c = this._ctrl; if (!c) return;
    const l = this.history.length, i = this.currentIdx;
    if (c.btnFirst)   c.btnFirst.disabled   = i <= 0;
    if (c.btnBack)    c.btnBack.disabled     = i <= 0;
    if (c.btnForward) c.btnForward.disabled  = i >= l - 1;
    if (c.btnLast)    c.btnLast.disabled     = i >= l - 1;
    if (c.btnPlay) {
      c.btnPlay.innerHTML = this.isPlaying ? '⏸' : '▶';
      c.btnPlay.disabled  = l === 0;
    }
    if (c.btnDecongestion) c.btnDecongestion.classList.toggle('active', this.decongestionOn);
    if (c.decongestionLabel) c.decongestionLabel.textContent = this.decongestionOn ? 'Filtered' : 'All';
    if (c.timeline) {
      c.timeline.max   = Math.max(0, l - 1);
      c.timeline.value = Math.max(0, i);
      c.timeline.style.setProperty('--progress', l > 1 ? (i / (l - 1)) * 100 + '%' : '0%');
    }
    if (c.iterLabel) c.iterLabel.textContent = l > 0 ? `Step ${i + 1} / ${l}` : 'No data';
  }
}

// Backward-compatibility alias
const HMMDiagram = StateTransitionDiagram;
if (typeof window !== 'undefined') {
  window.StateTransitionDiagram = StateTransitionDiagram;
  window.HMMDiagram = HMMDiagram;
}

// #endregion

/**
 * app.js
 * ──────────────────────────────────────────────────────────────
 * Baum-Welch HMM — UI, charts, and entry points
 *
 * Contents:
 *   §3  Chart helpers     buildConvChart, buildGammaChart, buildAlphaChart
 *   §4  Diagram           initDiagram() — wires StateTransitionDiagram
 *   §5  UI helpers        heatColor, renderMatrix
 *   §6  Entry points      runBaumWelch(), loadExample()
 *
 * Depends on: diagram-lib.js, hmm-core.js (load those first)
 * ──────────────────────────────────────────────────────────────
 */

// #region §3 Chart Helpers

let convChart  = null;
let gammaChart = null;
let alphaChart = null;

const PALETTE = ['#7c3aed', '#06b6d4', '#f59e0b', '#10b981', '#ec4899', '#f472b6'];

function destroyCharts() {
  [convChart, gammaChart, alphaChart].forEach(c => { if (c) c.destroy(); });
  convChart = gammaChart = alphaChart = null;
}

/** Shared Chart.js axis/plugin defaults for the dark theme. */
const baseOpts = (xLabel, yLabel) => ({
  animation: false,
  responsive: true,
  plugins: {
    legend: { labels: { color: '#7a8599', font: { family: 'JetBrains Mono', size: 10 } } },
  },
  scales: {
    x: {
      ticks: { color: '#4e5a6e', font: { family: 'JetBrains Mono', size: 9 } },
      grid:  { color: 'rgba(255,255,255,0.025)' },
      title: { display: true, text: xLabel, color: '#4e5a6e', font: { size: 11 } },
    },
    y: {
      ticks: { color: '#4e5a6e', font: { family: 'JetBrains Mono', size: 9 } },
      grid:  { color: 'rgba(255,255,255,0.03)' },
      title: { display: true, text: yLabel, color: '#4e5a6e', font: { size: 11 } },
    },
  },
});

function buildConvChart(history) {
  const ctx = document.getElementById('conv-chart').getContext('2d');
  convChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map((_, i) => i + 1),
      datasets: [{
        label: 'log P(O|λ)',
        data: history,
        borderColor: '#7c3aed',
        backgroundColor: 'rgba(124,58,237,0.08)',
        fill: true,
        tension: 0.35,
        pointRadius: history.length < 30 ? 4 : 1,
        borderWidth: 2,
      }],
    },
    options: baseOpts('Iteration', 'log P(O|λ)'),
  });
}

function buildGammaChart(gamma, N) {
  const T   = gamma.length;
  const ctx = document.getElementById('gamma-chart').getContext('2d');
  gammaChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array.from({ length: T }, (_, i) => i),
      datasets: Array.from({ length: N }, (_, i) => ({
        label: `Hidden State ${i}`,
        data: gamma.map(g => g[i]),
        borderColor: PALETTE[i % PALETTE.length],
        backgroundColor: PALETTE[i % PALETTE.length] + '18',
        fill: true, tension: 0.2, pointRadius: 0, borderWidth: 1.5,
      })),
    },
    options: {
      ...baseOpts('Time step t', 'γₜ(i) — State Probability'),
      scales: {
        x: baseOpts('Time step t', '').scales.x,
        y: {
          min: 0, max: 1,
          ticks: { color: '#4e5a6e', font: { family: 'JetBrains Mono', size: 9 } },
          grid:  { color: 'rgba(255,255,255,0.03)' },
          title: { display: true, text: 'γₜ(i)', color: '#4e5a6e' },
        },
      },
    },
  });
}

function buildAlphaChart(logAlpha, N) {
  const T   = logAlpha.length;
  const ctx = document.getElementById('alpha-chart').getContext('2d');
  alphaChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array.from({ length: T }, (_, i) => i),
      datasets: Array.from({ length: N }, (_, i) => ({
        label: `State ${i}`,
        data: logAlpha.map(r => r[i]),
        borderColor: PALETTE[i % PALETTE.length],
        backgroundColor: 'transparent',
        tension: 0.2, pointRadius: 0, borderWidth: 1.5,
      })),
    },
    options: baseOpts('Time step t', 'log αₜ(i)'),
  });
}

// #endregion


// ══════════════════════════════════════════════════════════════
// §4  DIAGRAM  (StateTransitionDiagram wiring)
// ══════════════════════════════════════════════════════════════

// #region §4 Diagram

let stdDiagram = null;

/** Instantiate and wire the StateTransitionDiagram with dark-theme colours. */
function initDiagram() {
  if (stdDiagram) stdDiagram.reset();

  stdDiagram = new StateTransitionDiagram('#std-canvas', '#std-inspector', {
    stateColors: [
      { base: '#7c3aed', light: '#c4b5fd', dark: '#4c1d95', grad: ['#a78bfa', '#7c3aed'] },
      { base: '#06b6d4', light: '#67e8f9', dark: '#155e75', grad: ['#22d3ee', '#0891b2'] },
      { base: '#f59e0b', light: '#fde68a', dark: '#92400e', grad: ['#fbbf24', '#d97706'] },
      { base: '#10b981', light: '#6ee7b7', dark: '#064e3b', grad: ['#34d399', '#059669'] },
      { base: '#ec4899', light: '#f9a8d4', dark: '#831843', grad: ['#f472b6', '#db2777'] },
      { base: '#6366f1', light: '#a5b4fc', dark: '#3730a3', grad: ['#818cf8', '#4f46e5'] },
    ],
    obsColor:           { fill: '#1a1a2e', stroke: '#06b6d4', dark: '#67e8f9' },
    piColor:            { fill: '#1e1a2e', stroke: '#7c3aed', dark: '#c4b5fd' },
    particlesEnabled:   true,
    decongestionEnabled: false,
    animationSpeed:     1,
    fontFamily:         "'Lato', sans-serif",
    monoFontFamily:     "'JetBrains Mono', monospace",
  });

  stdDiagram.wireControls({
    btnFirst:          document.getElementById('btn-first'),
    btnBack:           document.getElementById('btn-back'),
    btnPlay:           document.getElementById('btn-play'),
    btnForward:        document.getElementById('btn-fwd'),
    btnLast:           document.getElementById('btn-last'),
    speedSelect:       document.getElementById('speed-select'),
    timeline:          document.getElementById('std-timeline'),
    iterLabel:         document.getElementById('iter-label'),
    btnParticles:      document.getElementById('btn-particles'),
    btnDecongestion:   document.getElementById('btn-decongestion'),
    decongestionLabel: document.getElementById('decongestion-label'),
  });

  document.getElementById('btn-save-svg')?.addEventListener('click', () => stdDiagram?.saveSVG());
  document.getElementById('btn-save-png')?.addEventListener('click', () => stdDiagram?.savePNG());
}

// #endregion


// ══════════════════════════════════════════════════════════════
// §5  UI HELPERS
// ══════════════════════════════════════════════════════════════

// #region §5 UI Helpers

/**
 * Maps a probability value [0,1] to a purple heat-map colour.
 * Higher value → more vivid purple.
 */
function heatColor(v) {
  const r = Math.round(v * 124 + (1 - v) * 16);
  const g = Math.round(v * 58  + (1 - v) * 30);
  const b = Math.round(v * 237 + (1 - v) * 60);
  return `rgba(${r},${g},${b},${(0.18 + v * 0.72).toFixed(2)})`;
}

/** Render a probability matrix as an HTML table with heat-map cells. */
function renderMatrix(el, data, rowLabels, colLabels) {
  let h = `<table><thead><tr><th></th>`;
  colLabels.forEach(c => { h += `<th>${c}</th>`; });
  h += `</tr></thead><tbody>`;
  data.forEach((row, i) => {
    h += `<tr><th>${rowLabels[i]}</th>`;
    row.forEach(v => {
      h += `<td><span class="heat-cell" style="background:${heatColor(v)}">${v.toFixed(4)}</span></td>`;
    });
    h += `</tr>`;
  });
  h += `</tbody></table>`;
  el.innerHTML = h;
}

// #endregion


// ══════════════════════════════════════════════════════════════
// §6  ENTRY POINTS
// ══════════════════════════════════════════════════════════════

// #region §6 Entry Points

/** Main button handler — reads inputs, runs training, renders results. */
function runBaumWelch() {
  // ── Parse inputs ──────────────────────────────────────────────
  const raw = document.getElementById('obs-input').value;
  const obs = raw.split(/[\s,]+/).map(Number).filter(v => !isNaN(v));
  if (obs.length < 3) { alert('Please enter at least 3 observations.'); return; }

  const N       = parseInt(document.getElementById('n-states').value);
  const maxIter = parseInt(document.getElementById('max-iter').value);
  const epsilon = parseFloat(document.getElementById('epsilon').value);
  const seed    = parseInt(document.getElementById('seed').value);
  let   M       = parseInt(document.getElementById('m-symbols').value);
  if (!M || isNaN(M)) M = Math.max(...obs) + 1;

  // ── Reset UI ──────────────────────────────────────────────────
  destroyCharts();
  ['results-header', 'conv-card', 'matrix-section', 'diagram-section', 'prob-section']
    .forEach(id => { document.getElementById(id).style.display = ''; });

  const logBox = document.getElementById('log-output');
  logBox.innerHTML = '';
  document.getElementById('stat-loglik').textContent    = '...';
  document.getElementById('stat-iters').textContent     = '...';
  document.getElementById('stat-converged').textContent = '...';

  // ── Initialise diagram ────────────────────────────────────────
  initDiagram();

  // ── Train ─────────────────────────────────────────────────────
  const hmm = new HMM(obs, N, M, { maxIter, epsilon, seed });

  hmm.train((msg, iter, done) => {
    // Log output line
    const line = document.createElement('div');
    line.className = done ? 'log-ok' : (iter === 0 ? 'log-info' : '');
    line.textContent = msg;
    logBox.appendChild(line);
    logBox.scrollTop = logBox.scrollHeight;

    // Progress bar
    document.getElementById('progress-fill').style.width =
      Math.min(100, (iter + 1) / maxIter * 100) + '%';

    // Push current model state to the diagram on every iteration
    const ll = hmm.logLikeHistory[hmm.logLikeHistory.length - 1] ?? 0;
    stdDiagram.feedIteration({
      A:              hmm.A.map(r => [...r]),
      B:              hmm.B.map(r => [...r]),
      pi:             [...hmm.pi],
      iteration:      iter + 1,
      log_likelihood: ll,
    });
  });

  stdDiagram.onComplete();

  // ── Render results ────────────────────────────────────────────
  const finalLL = hmm.logLikeHistory.at(-1);
  document.getElementById('stat-loglik').textContent = finalLL.toFixed(4);
  document.getElementById('stat-iters').textContent  = hmm.iterations;

  const sv = document.getElementById('stat-converged');
  sv.textContent = hmm.converged ? 'Converged ✓' : 'Max Iters Reached';
  sv.className   = 'stat-value ' + (hmm.converged ? 'converged' : 'not-converged');

  document.getElementById('progress-fill').style.width = '100%';

  // Charts
  buildConvChart(hmm.logLikeHistory);
  buildGammaChart(hmm.finalGamma, N);
  buildAlphaChart(hmm.finalAlpha, N);

  // Matrix tables
  const stateLabels = Array.from({ length: N }, (_, i) => `S${i}`);
  const obsLabels   = Array.from({ length: M }, (_, k) => `sym-${k}`);
  renderMatrix(document.getElementById('A-table'), hmm.A, stateLabels, stateLabels);
  renderMatrix(document.getElementById('B-table'), hmm.B, stateLabels, obsLabels);

  // π row
  let ph = `<table><thead><tr>` + stateLabels.map(s => `<th>${s}</th>`).join('') + `</tr></thead><tbody><tr>`;
  hmm.pi.forEach(v => {
    ph += `<td><span class="heat-cell" style="background:${heatColor(v)}">${v.toFixed(4)}</span></td>`;
  });
  ph += `</tr></tbody></table>`;
  document.getElementById('pi-table').innerHTML = ph;
}

/** Load the built-in weather example into the input fields. */
function loadExample() {
  document.getElementById('obs-input').value = '0 0 1 1 2 0 0 1 2 2 1 0 0 0 1 1 2 1 0 0 1 2 0 0 1';
  document.getElementById('n-states').value  = '2';
  document.getElementById('m-symbols').value = '3';
  document.getElementById('max-iter').value  = '100';
  document.getElementById('epsilon').value   = '1e-7';
  document.getElementById('seed').value      = '7';
}

// #endregion

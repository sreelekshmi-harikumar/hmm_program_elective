/**
 * hmm-core.js
 * ──────────────────────────────────────────────────────────────
 * Baum-Welch HMM — core math
 *
 * Contents:
 *   §1  mulberry32   Seeded PRNG
 *   §2  logSumExp    Numerically stable log-sum-exp
 *   §3  class HMM    Scaled forward/backward EM (Rabiner 1989)
 *       _forward()   Scaled α pass → logLik, no underflow
 *       _backward()  Scaled β pass
 *       _estep()     Compute γ and ξ
 *       _mstep()     Re-estimate A, B, π
 *       train()      Full EM loop with convergence check
 * ──────────────────────────────────────────────────────────────
 */

// #region §1 Utilities

/**
 * Mulberry32 — fast seeded pseudo-random number generator.
 * Returns a function that produces floats in [0, 1).
 */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * logSumExp — numerically stable log(Σ exp(xᵢ)).
 * Avoids overflow/underflow when summing log-probabilities.
 */
function logSumExp(arr) {
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
  if (!isFinite(max)) return -Infinity;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += Math.exp(arr[i] - max);
  return max + Math.log(s);
}

// #endregion


// ══════════════════════════════════════════════════════════════
// §2  HMM CORE
// ══════════════════════════════════════════════════════════════
//
// Uses Rabiner (1989) scaled forward/backward to avoid underflow.
// All computation stays in probability space — no log-domain mixing.
// logAlpha is reconstructed at the end of _forward() solely for the
// UI charts; the training loop itself never touches log values.
//
// ══════════════════════════════════════════════════════════════

// #region §2 HMM Core

class HMM {

  // ── §2.1 Initialisation ──────────────────────────────────────
  constructor(obs, N, M, opts = {}) {
    this.O = obs;
    this.T = obs.length;
    this.N = N;
    this.M = M;
    this.maxIter = opts.maxIter || 100;
    this.epsilon  = opts.epsilon  || 1e-6;

    const rand = mulberry32(opts.seed || 42);

    // Dirichlet-like init: uniform(0,1) + 0.2 floor prevents zero entries
    this.pi = this._randRow(N, rand);
    this.A  = Array.from({ length: N }, () => this._randRow(N, rand));
    this.B  = Array.from({ length: N }, () => this._randRow(M, rand));

    this.logLikeHistory = [];
    this.iterations     = 0;
    this.converged      = false;
    this.finalAlpha     = null;
    this.finalGamma     = null;
  }

  /** Returns a random normalised row of length k (always sums to 1, no zeros). */
  _randRow(k, rand) {
    const v = Array.from({ length: k }, () => rand() + 0.2);
    const s = v.reduce((a, b) => a + b, 0);
    return v.map(x => x / s);
  }


  // ── §2.2 Forward pass ────────────────────────────────────────
  /**
   * Scaled forward algorithm.
   *
   * Returns:
   *   alpha[t][i]  — scaled α (rows always sum to 1)
   *   c[t]         — scale factor = 1 / Σᵢ α_unscaled[t][i]
   *   logLik       — log P(O|λ) = −Σₜ log c[t]
   *   logAlpha     — unscaled log α, used only for UI charts
   */
  _forward() {
    const { T, N, O, pi, A, B } = this;
    const alpha    = Array.from({ length: T }, () => new Float64Array(N));
    const c        = new Float64Array(T);
    const logAlpha = Array.from({ length: T }, () => new Float64Array(N));

    // t = 0
    let sum = 0;
    for (let i = 0; i < N; i++) {
      alpha[0][i] = pi[i] * (B[i][O[0]] || 1e-300);
      sum += alpha[0][i];
    }
    c[0] = sum > 0 ? 1 / sum : 1;
    for (let i = 0; i < N; i++) alpha[0][i] *= c[0];

    // t = 1 … T−1
    for (let t = 1; t < T; t++) {
      sum = 0;
      for (let j = 0; j < N; j++) {
        let acc = 0;
        for (let i = 0; i < N; i++) acc += alpha[t - 1][i] * A[i][j];
        alpha[t][j] = acc * (B[j][O[t]] || 1e-300);
        sum += alpha[t][j];
      }
      c[t] = sum > 0 ? 1 / sum : 1;
      for (let j = 0; j < N; j++) alpha[t][j] *= c[t];
    }

    // log P(O|λ) = −Σₜ log c[t]
    let logLik = 0;
    for (let t = 0; t < T; t++) logLik -= Math.log(c[t] > 0 ? c[t] : 1e-300);

    // Reconstruct log α for charts (scaled alpha → unscaled log alpha)
    for (let t = 0; t < T; t++) {
      const logUnscale = -Math.log(c[t] > 0 ? c[t] : 1e-300);
      for (let i = 0; i < N; i++) {
        logAlpha[t][i] = Math.log(alpha[t][i] > 0 ? alpha[t][i] : 1e-300) + logUnscale;
      }
    }

    return { alpha, c, logLik, logAlpha };
  }


  // ── §2.3 Backward pass ───────────────────────────────────────
  /**
   * Scaled backward algorithm.
   * Uses the same scale factors c[] produced by _forward().
   */
  _backward(c) {
    const { T, N, O, A, B } = this;
    const beta = Array.from({ length: T }, () => new Float64Array(N));

    // t = T−1: initialise scaled β = 1 · c[T−1]
    for (let i = 0; i < N; i++) beta[T - 1][i] = c[T - 1];

    for (let t = T - 2; t >= 0; t--) {
      for (let i = 0; i < N; i++) {
        let acc = 0;
        for (let j = 0; j < N; j++) {
          acc += A[i][j] * (B[j][O[t + 1]] || 1e-300) * beta[t + 1][j];
        }
        beta[t][i] = acc * c[t];
      }
    }
    return beta;
  }


  // ── §2.4 E-step ──────────────────────────────────────────────
  /**
   * Compute γ (state occupancy) and ξ (transition occupancy)
   * from the scaled α and β matrices.
   *
   * γ[t][i]    = P(qₜ=Sᵢ | O, λ)
   * ξ[t][i][j] = P(qₜ=Sᵢ, qₜ₊₁=Sⱼ | O, λ)
   */
  _estep(alpha, beta) {
    const { T, N, O, A, B } = this;

    const gamma = Array.from({ length: T }, (_, t) => {
      const g = new Float64Array(N);
      let s = 0;
      for (let i = 0; i < N; i++) {
        g[i] = alpha[t][i] * beta[t][i];
        s += g[i];
      }
      if (s > 0) for (let i = 0; i < N; i++) g[i] /= s;
      return g;
    });

    const xi = Array.from({ length: T - 1 }, (_, t) => {
      const mat = Array.from({ length: N }, () => new Float64Array(N));
      let s = 0;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          mat[i][j] = alpha[t][i] * A[i][j] * (B[j][O[t + 1]] || 1e-300) * beta[t + 1][j];
          s += mat[i][j];
        }
      }
      if (s > 0) {
        for (let i = 0; i < N; i++)
          for (let j = 0; j < N; j++)
            mat[i][j] /= s;
      }
      return mat;
    });

    return { gamma, xi };
  }


  // ── §2.5 M-step ──────────────────────────────────────────────
  /**
   * Re-estimate A, B, π from the soft counts in γ and ξ.
   * All output rows are renormalised to guard against float drift.
   */
  _mstep(gamma, xi) {
    const { T, N, M, O } = this;

    const pi = Array.from(gamma[0]);

    const newA = Array.from({ length: N }, (_, i) => {
      let den = 0;
      for (let t = 0; t < T - 1; t++) den += gamma[t][i];
      den = den || 1e-300;
      return Array.from({ length: N }, (_, j) => {
        let num = 0;
        for (let t = 0; t < T - 1; t++) num += xi[t][i][j];
        return num / den;
      });
    });

    const newB = Array.from({ length: N }, (_, i) => {
      let den = 0;
      for (let t = 0; t < T; t++) den += gamma[t][i];
      den = den || 1e-300;
      return Array.from({ length: M }, (_, k) => {
        let num = 0;
        for (let t = 0; t < T; t++) if (O[t] === k) num += gamma[t][i];
        return num / den;
      });
    });

    const normalise = row => {
      const s = row.reduce((a, b) => a + b, 0) || 1;
      return row.map(x => x / s);
    };

    return {
      pi: normalise(pi),
      A:  newA.map(normalise),
      B:  newB.map(normalise),
    };
  }


  // ── §2.6 Training loop ───────────────────────────────────────
  /**
   * Run Baum-Welch EM until convergence or maxIter.
   * logCallback(message, iterIndex, isDone?) is called each step.
   */
  train(logCallback) {
    let prevLL = -Infinity;

    for (let iter = 0; iter < this.maxIter; iter++) {
      const { alpha, c, logLik, logAlpha } = this._forward();
      const beta            = this._backward(c);
      const { gamma, xi }  = this._estep(alpha, beta);
      const { pi, A, B }   = this._mstep(gamma, xi);

      this.pi = pi;
      this.A  = A;
      this.B  = B;
      this.logLikeHistory.push(logLik);
      this.iterations = iter + 1;

      const delta    = logLik - prevLL;
      const deltaStr = !isFinite(prevLL) ? '+∞' : delta.toFixed(8);

      if (logCallback)
        logCallback(`Iter ${iter + 1}:  log P(O|λ) = ${logLik.toFixed(6)}   Δ = ${deltaStr}`, iter);

      if (iter > 0 && Math.abs(delta) < this.epsilon) {
        this.converged = true;
        const f  = this._forward();
        const fb = this._backward(f.c);
        const fg = this._estep(f.alpha, fb);
        this.finalAlpha = f.logAlpha;
        this.finalGamma = fg.gamma;
        if (logCallback) logCallback(`✓ Converged at iteration ${iter + 1}`, iter, true);
        break;
      }
      prevLL = logLik;
    }

    // Store final matrices for charts even if we hit the iteration cap
    if (!this.converged) {
      const f  = this._forward();
      const fb = this._backward(f.c);
      const fg = this._estep(f.alpha, fb);
      this.finalAlpha = f.logAlpha;
      this.finalGamma = fg.gamma;
    }
  }
}

// #endregion

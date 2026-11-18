/*
 * Special functions used by the analytical heat-transport solutions.
 *
 *  - E1(x)            exponential integral  E1(x) = -Ei(-x)
 *  - Ein(x)           entire exponential integral  ln(x) + E1(x) + gamma  (finite at x = 0)
 *  - besselJ0/J1      Bessel functions of the first kind (Hankel transforms)
 *  - besselI0/I1      modified Bessel functions of the first kind
 *  - besselK0/K1      modified Bessel functions of the second kind
 *  - besselK0e/K1e    exponentially scaled  e^x K(x)  (no underflow for large x)
 *  - lnKnTable        ln K_n(x) and K_n'(x)/K_n(x) for n = 0..N (log-space, no overflow)
 *
 * Polynomial / rational approximations follow Abramowitz & Stegun and
 * Numerical Recipes (relative accuracy ~1e-7 .. 1e-9, ample for this purpose).
 */
(function (root) {
  'use strict';

  const EULER_GAMMA = 0.5772156649015329;

  /** Exponential integral E1(x), x > 0. */
  function E1(x) {
    if (x <= 0) return Infinity;
    if (x < 1) {
      // Power series: E1(x) = -gamma - ln x - sum_{k>=1} (-x)^k / (k k!)
      let sum = 0, term = 1;
      for (let k = 1; k < 60; k++) {
        term *= -x / k;
        const add = term / k;
        sum += add;
        if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
      }
      return -EULER_GAMMA - Math.log(x) - sum;
    }
    // Continued fraction (modified Lentz), converges well for x >= 1
    const tiny = 1e-300;
    let b = x + 1, c = 1 / tiny, d = 1 / b, h = d;
    for (let i = 1; i < 500; i++) {
      const a = -i * i;
      b += 2;
      d = 1 / (a * d + b);
      c = b + a / c;
      const del = c * d;
      h *= del;
      if (Math.abs(del - 1) < 1e-16) break;
    }
    return h * Math.exp(-x);
  }

  /**
   * Ein(x) = sum_{k>=1} (-1)^{k+1} x^k / (k k!) = gamma + ln x + E1(x).
   * Entire function, used for the regular part of the Gaussian-source solution:
   *   ln(x) + E1(x) = Ein(x) - gamma
   */
  function Ein(x) {
    if (x === 0) return 0;
    if (x < 2) {
      let sum = 0, term = 1;
      for (let k = 1; k < 80; k++) {
        term *= -x / k;
        const add = -term / k;
        sum += add;
        if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
      }
      return sum;
    }
    return EULER_GAMMA + Math.log(x) + E1(x);
  }

  // ---------- Bessel J (Numerical Recipes rational approximations) ----------
  function besselJ0(x) {
    const ax = Math.abs(x);
    if (ax < 8.0) {
      const y = x * x;
      const a1 = 57568490574.0 + y * (-13362590354.0 + y * (651619640.7 + y * (-11214424.18 + y * (77392.33017 + y * (-184.9052456)))));
      const a2 = 57568490411.0 + y * (1029532985.0 + y * (9494680.718 + y * (59272.64853 + y * (267.8532712 + y * 1.0))));
      return a1 / a2;
    }
    const z = 8.0 / ax, y = z * z, xx = ax - 0.785398164;
    const a1 = 1.0 + y * (-0.1098628627e-2 + y * (0.2734510407e-4 + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
    const a2 = -0.1562499995e-1 + y * (0.1430488765e-3 + y * (-0.6911147651e-5 + y * (0.7621095161e-6 - y * 0.934935152e-7)));
    return Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * a1 - z * Math.sin(xx) * a2);
  }

  function besselJ1(x) {
    const ax = Math.abs(x);
    if (ax < 8.0) {
      const y = x * x;
      const a1 = x * (72362614232.0 + y * (-7895059235.0 + y * (242396853.1 + y * (-2972611.439 + y * (15704.48260 + y * (-30.16036606))))));
      const a2 = 144725228442.0 + y * (2300535178.0 + y * (18583304.74 + y * (99447.43394 + y * (376.9991397 + y * 1.0))));
      return a1 / a2;
    }
    const z = 8.0 / ax, y = z * z, xx = ax - 2.356194491;
    const a1 = 1.0 + y * (0.183105e-2 + y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * (-0.240337019e-6))));
    const a2 = 0.04687499995 + y * (-0.2002690873e-3 + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
    const ans = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * a1 - z * Math.sin(xx) * a2);
    return x < 0 ? -ans : ans;
  }

  // ---------- Modified Bessel I, K (A&S 9.8.1 - 9.8.8) ----------
  function besselI0(x) {
    const ax = Math.abs(x);
    if (ax < 3.75) {
      const y = (x / 3.75) ** 2;
      return 1.0 + y * (3.5156229 + y * (3.0899424 + y * (1.2067492 + y * (0.2659732 + y * (0.360768e-1 + y * 0.45813e-2)))));
    }
    const y = 3.75 / ax;
    return (Math.exp(ax) / Math.sqrt(ax)) * (0.39894228 + y * (0.1328592e-1 + y * (0.225319e-2 + y * (-0.157565e-2 + y * (0.916281e-2 +
      y * (-0.2057706e-1 + y * (0.2635537e-1 + y * (-0.1647633e-1 + y * 0.392377e-2))))))));
  }

  function besselI1(x) {
    const ax = Math.abs(x);
    let ans;
    if (ax < 3.75) {
      const y = (x / 3.75) ** 2;
      ans = ax * (0.5 + y * (0.87890594 + y * (0.51498869 + y * (0.15084934 + y * (0.2658733e-1 + y * (0.301532e-2 + y * 0.32411e-3))))));
    } else {
      const y = 3.75 / ax;
      ans = 0.2282967e-1 + y * (-0.2895312e-1 + y * (0.1787654e-1 - y * 0.420059e-2));
      ans = 0.39894228 + y * (-0.3988024e-1 + y * (-0.362018e-2 + y * (0.163801e-2 + y * (-0.1031555e-1 + y * ans))));
      ans *= Math.exp(ax) / Math.sqrt(ax);
    }
    return x < 0 ? -ans : ans;
  }

  /** e^x K0(x), x > 0 */
  function besselK0e(x) {
    if (x <= 2.0) {
      const y = x * x / 4.0;
      const k0 = (-Math.log(x / 2.0) * besselI0(x)) + (-0.57721566 + y * (0.42278420 + y * (0.23069756 + y * (0.3488590e-1 +
        y * (0.262698e-2 + y * (0.10750e-3 + y * 0.74e-5))))));
      return k0 * Math.exp(x);
    }
    const y = 2.0 / x;
    return (1.0 / Math.sqrt(x)) * (1.25331414 + y * (-0.7832358e-1 + y * (0.2189568e-1 + y * (-0.1062446e-1 + y * (0.587872e-2 +
      y * (-0.251540e-2 + y * 0.53208e-3))))));
  }

  /** e^x K1(x), x > 0 */
  function besselK1e(x) {
    if (x <= 2.0) {
      const y = x * x / 4.0;
      const k1 = (Math.log(x / 2.0) * besselI1(x)) + (1.0 / x) * (1.0 + y * (0.15443144 + y * (-0.67278579 + y * (-0.18156897 +
        y * (-0.1919402e-1 + y * (-0.110404e-2 + y * (-0.4686e-4)))))));
      return k1 * Math.exp(x);
    }
    const y = 2.0 / x;
    return (1.0 / Math.sqrt(x)) * (1.25331414 + y * (0.23498619 + y * (-0.3655620e-1 + y * (0.1504268e-1 + y * (-0.780353e-2 +
      y * (0.325614e-2 + y * (-0.68245e-3)))))));
  }

  const besselK0 = (x) => besselK0e(x) * Math.exp(-x);
  const besselK1 = (x) => besselK1e(x) * Math.exp(-x);

  /**
   * Log-space table of K_n(x) for n = 0..N.
   * Returns { lnK: Float64Array(N+1), dlog: Float64Array(N+1) } with
   *   lnK[n]  = ln K_n(x)
   *   dlog[n] = K_n'(x) / K_n(x)        (always negative)
   * Upward recurrence for K_n is numerically stable; ratios avoid overflow.
   */
  function lnKnTable(x, N) {
    const lnK = new Float64Array(N + 1);
    const dlog = new Float64Array(N + 1);
    const k0e = besselK0e(x), k1e = besselK1e(x);
    lnK[0] = Math.log(k0e) - x;
    let q = k1e / k0e; // K1/K0
    if (N >= 1) lnK[1] = lnK[0] + Math.log(q);
    dlog[0] = -q; // K0' = -K1
    for (let n = 1; n <= N; n++) {
      // q_n = K_{n+1}/K_n = K_{n-1}/K_n + 2n/x
      const qn = 1 / q + (2 * n) / x;
      dlog[n] = -qn + n / x; // K_n' = -K_{n+1} + (n/x) K_n
      if (n + 1 <= N) lnK[n + 1] = lnK[n] + Math.log(qn);
      q = qn;
    }
    return { lnK, dlog };
  }

  /** Composite Simpson rule on [a,b] with n (even) intervals. */
  function simpson(f, a, b, n) {
    if (n % 2) n++;
    const h = (b - a) / n;
    let s = f(a) + f(b);
    for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
    return (s * h) / 3;
  }

  const api = { EULER_GAMMA, E1, Ein, besselJ0, besselJ1, besselI0, besselI1, besselK0, besselK1, besselK0e, besselK1e, lnKnTable, simpson };
  root.BS = root.BS || {};
  root.BS.special = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

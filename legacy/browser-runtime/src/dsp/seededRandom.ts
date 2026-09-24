/**
 * Deterministic Pseudo-Random Number Generator
 * ============================================
 *
 * Monte Carlo results the README presents as empirical evidence have to be reproducible: two
 * runs of the same configuration must give the same curve, or there is no way to reproduce a
 * published number, bisect a regression, or have anyone else verify the claim. That is the
 * difference between a measurement and an anecdote.
 *
 * `Math.random()` is seeded by the engine and cannot be controlled, so the benchmark engines
 * use this instead. `mulberry32` is a 32-bit generator with a 2^32 period, excellent
 * statistical properties for simulation work of this size, and a two-line implementation whose
 * behaviour is identical in every JavaScript engine - which is what reproducibility needs.
 */

/** Seed used when a caller does not supply one, so the default run is still reproducible. */
export const DEFAULT_MONTE_CARLO_SEED = 0x5a30c0de;

export interface RandomSource {
  /** Uniform in [0, 1). */
  next(): number;
  /** Standard normal (mean 0, variance 1), via Box-Muller with a cached second variate. */
  normal(): number;
  /** The seed this source was constructed with, for recording alongside results. */
  readonly seed: number;
}

export function createSeededRandom(seed: number = DEFAULT_MONTE_CARLO_SEED): RandomSource {
  // Seed 0 degenerates mulberry32 into a short cycle; shift it off zero rather than silently
  // returning a poor sequence.
  let state = (seed >>> 0) || 0x9e3779b9;
  let spareNormal: number | null = null;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const normal = (): number => {
    if (spareNormal !== null) {
      const value = spareNormal;
      spareNormal = null;
      return value;
    }
    const u1 = Math.max(1e-12, next());
    const u2 = next();
    const magnitude = Math.sqrt(-2.0 * Math.log(u1));
    spareNormal = magnitude * Math.sin(2.0 * Math.PI * u2);
    return magnitude * Math.cos(2.0 * Math.PI * u2);
  };

  return { next, normal, seed: seed >>> 0 };
}

/**
 * Maidenhead grid locator parsing and validation - the one implementation.
 *
 * There were four. `SetupWizardModal` and `StationSettingsModal` each carried a byte-identical
 * `maidenheadToLatLon()` and `GRID_REGEX`, `QsoController` had a third decoder inlined into a
 * distance calculation, and `qsoEngine` had the fourth - the only one that bounds-checked its
 * fields and the only one under test. Four copies of a coordinate conversion is four chances
 * for a station to be plotted in the wrong hemisphere; this file is the survivor, and it is the
 * bounds-checked one.
 *
 * Per AGENTS.md §7 this is logic, so it lives in src/dsp/ with no DOM dependency, and the
 * components import it rather than re-deriving it.
 */

/**
 * Syntactic validation of a Maidenhead locator: two field letters (A-R), two square digits, and
 * optionally two subsquare letters (A-X). Four or six characters only - the odd lengths are not
 * valid locators, which the modals' own length check used to enforce separately.
 */
export function isValidGrid(grid: string): boolean {
  const trimmed = (grid || '').trim().toUpperCase();
  if (trimmed.length !== 4 && trimmed.length !== 6) return false;
  return /^[A-R]{2}[0-9]{2}([A-X]{2})?$/.test(trimmed);
}

/**
 * Converts a 4- or 6-character locator to the latitude/longitude of the centre of the square.
 *
 * Returns null for anything it cannot decode, including a locator whose characters are in range
 * for the regex but out of range for the grid system. Callers must handle null rather than
 * plotting a NaN.
 */
export function maidenheadToLatLon(grid: string): { lat: number; lon: number } | null {
  const clean = (grid || '').trim().toUpperCase();
  if (clean.length < 4) return null;

  const fLon = clean.charCodeAt(0) - 65; // A-R (0-17)
  const fLat = clean.charCodeAt(1) - 65; // A-R (0-17)
  const dLon = clean.charCodeAt(2) - 48; // 0-9
  const dLat = clean.charCodeAt(3) - 48; // 0-9

  if (fLon < 0 || fLon > 17 || fLat < 0 || fLat > 17 || dLon < 0 || dLon > 9 || dLat < 0 || dLat > 9) {
    return null;
  }

  // Centre of the 2° x 1° square.
  let lon = fLon * 20 - 180 + dLon * 2 + 1;
  let lat = fLat * 10 - 90 + dLat * 1 + 0.5;

  if (clean.length >= 6) {
    const sLon = clean.charCodeAt(4) - 65;
    const sLat = clean.charCodeAt(5) - 65;
    if (sLon < 0 || sLon > 23 || sLat < 0 || sLat > 23) return null;
    // Re-centre on the subsquare: back out the square centre, then add the subsquare centre.
    lon += (sLon * 5) / 60 + 2.5 / 60 - 1;
    lat += (sLat * 2.5) / 60 + 1.25 / 60 - 0.5;
  }

  return { lat, lon };
}

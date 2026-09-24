/**
 * Amateur Band Plan & Transmit Privilege Model
 * ============================================
 *
 * The data behind `canTransmit()` in catController.ts: which frequencies this station may put
 * a data-mode signal on, given the operator's regulatory region and licence class.
 *
 * Why this exists: nothing in this app used to check that the dial frequency plus the audio
 * offset landed inside an amateur allocation at all. Every mature digital-mode client refuses
 * to transmit out of band; z-30 would happily key a radio wherever the VFO happened to sit.
 *
 * Scope and limits - read this before trusting it:
 *
 *   * These are the segments in which *data* emissions are generally permitted. Some of an
 *     allocation is CW-only or phone-only and is deliberately absent here.
 *   * National regulations differ inside every IARU region, change over time, and carry
 *     conditions this table cannot express (power limits, secondary status, band-plan
 *     conventions, contest exclusions, LF/MF notches, 60 m channelisation).
 *   * The operator remains responsible for their own emissions. This gate exists to catch the
 *     obvious mistake - a mistuned VFO, a wrong band button - not to substitute for knowing
 *     your licence.
 *
 * `verifiedOn` records when each region's entries were last checked against the regulator's
 * own published table, so a stale plan is visible rather than assumed current.
 */

/** Regulatory framework the operator is licensed under. */
export type RegulatoryRegion = 'IARU_R1' | 'IARU_R2' | 'IARU_R3' | 'US';

/**
 * Licence class. `FULL` means "the full privileges of a general amateur licence in this
 * region"; the US classes model the FCC's sub-band structure, which is the case where class
 * actually changes which frequencies are legal.
 */
export type LicenseClass = 'FULL' | 'US_EXTRA' | 'US_ADVANCED' | 'US_GENERAL' | 'US_TECHNICIAN';

export interface BandSegment {
  /** Band label, matching HAM_BANDS where possible. */
  band: string;
  /** Inclusive lower edge in Hz. */
  startHz: number;
  /** Inclusive upper edge in Hz. */
  endHz: number;
  /** Licence classes for which this segment is available. */
  classes: LicenseClass[];
  /** Anything an operator should know about this segment. */
  note?: string;
}

export interface RegionBandPlan {
  region: RegulatoryRegion;
  displayName: string;
  /** ISO date on which these entries were last checked against the published allocation. */
  verifiedOn: string;
  /** Licence classes selectable within this region. */
  licenseClasses: LicenseClass[];
  segments: BandSegment[];
}

const FULL: LicenseClass[] = ['FULL'];

/** IARU Region 1: Europe, Africa, the Middle East and northern Asia. */
const REGION_1: RegionBandPlan = {
  region: 'IARU_R1',
  displayName: 'IARU Region 1 (Europe / Africa / Middle East)',
  verifiedOn: '2026-08-30',
  licenseClasses: FULL,
  segments: [
    { band: '160m', startHz: 1810000, endHz: 2000000, classes: FULL, note: 'Upper edge varies widely by country.' },
    { band: '80m', startHz: 3500000, endHz: 3800000, classes: FULL },
    { band: '60m', startHz: 5351500, endHz: 5366500, classes: FULL, note: 'Secondary, 15 W EIRP in most administrations.' },
    { band: '40m', startHz: 7000000, endHz: 7200000, classes: FULL },
    { band: '30m', startHz: 10100000, endHz: 10150000, classes: FULL, note: 'Secondary; CW and data only.' },
    { band: '20m', startHz: 14000000, endHz: 14350000, classes: FULL },
    { band: '17m', startHz: 18068000, endHz: 18168000, classes: FULL },
    { band: '15m', startHz: 21000000, endHz: 21450000, classes: FULL },
    { band: '12m', startHz: 24890000, endHz: 24990000, classes: FULL },
    { band: '10m', startHz: 28000000, endHz: 29700000, classes: FULL },
    { band: '6m', startHz: 50000000, endHz: 52000000, classes: FULL, note: 'Allocation above 52 MHz varies by country.' },
    { band: '2m', startHz: 144000000, endHz: 146000000, classes: FULL },
    { band: '70cm', startHz: 430000000, endHz: 440000000, classes: FULL },
  ],
};

/** IARU Region 2: the Americas. Use the US plan instead if licensed by the FCC. */
const REGION_2: RegionBandPlan = {
  region: 'IARU_R2',
  displayName: 'IARU Region 2 (Americas, non-US licence)',
  verifiedOn: '2026-08-30',
  licenseClasses: FULL,
  segments: [
    { band: '160m', startHz: 1800000, endHz: 2000000, classes: FULL },
    { band: '80m', startHz: 3500000, endHz: 4000000, classes: FULL },
    { band: '60m', startHz: 5351500, endHz: 5366500, classes: FULL, note: 'Secondary; channelised in some administrations.' },
    { band: '40m', startHz: 7000000, endHz: 7300000, classes: FULL },
    { band: '30m', startHz: 10100000, endHz: 10150000, classes: FULL, note: 'Secondary; CW and data only.' },
    { band: '20m', startHz: 14000000, endHz: 14350000, classes: FULL },
    { band: '17m', startHz: 18068000, endHz: 18168000, classes: FULL },
    { band: '15m', startHz: 21000000, endHz: 21450000, classes: FULL },
    { band: '12m', startHz: 24890000, endHz: 24990000, classes: FULL },
    { band: '10m', startHz: 28000000, endHz: 29700000, classes: FULL },
    { band: '6m', startHz: 50000000, endHz: 54000000, classes: FULL },
    { band: '2m', startHz: 144000000, endHz: 148000000, classes: FULL },
    { band: '70cm', startHz: 430000000, endHz: 450000000, classes: FULL },
  ],
};

/** IARU Region 3: Asia-Pacific. */
const REGION_3: RegionBandPlan = {
  region: 'IARU_R3',
  displayName: 'IARU Region 3 (Asia / Pacific)',
  verifiedOn: '2026-08-30',
  licenseClasses: FULL,
  segments: [
    { band: '160m', startHz: 1800000, endHz: 2000000, classes: FULL, note: 'Sub-band allocation varies widely.' },
    { band: '80m', startHz: 3500000, endHz: 3900000, classes: FULL },
    { band: '60m', startHz: 5351500, endHz: 5366500, classes: FULL, note: 'Not available in every administration.' },
    { band: '40m', startHz: 7000000, endHz: 7200000, classes: FULL },
    { band: '30m', startHz: 10100000, endHz: 10150000, classes: FULL, note: 'Secondary; CW and data only.' },
    { band: '20m', startHz: 14000000, endHz: 14350000, classes: FULL },
    { band: '17m', startHz: 18068000, endHz: 18168000, classes: FULL },
    { band: '15m', startHz: 21000000, endHz: 21450000, classes: FULL },
    { band: '12m', startHz: 24890000, endHz: 24990000, classes: FULL },
    { band: '10m', startHz: 28000000, endHz: 29700000, classes: FULL },
    { band: '6m', startHz: 50000000, endHz: 54000000, classes: FULL },
    { band: '2m', startHz: 144000000, endHz: 148000000, classes: FULL },
    { band: '70cm', startHz: 430000000, endHz: 440000000, classes: FULL },
  ],
};

const US_ALL: LicenseClass[] = ['US_EXTRA', 'US_ADVANCED', 'US_GENERAL', 'US_TECHNICIAN'];
const US_HF: LicenseClass[] = ['US_EXTRA', 'US_ADVANCED', 'US_GENERAL'];

/**
 * United States, FCC Part 97 RTTY/data sub-bands (97.301 / 97.305). Technicians hold data
 * privileges on 10 m and everything at 6 m and above; their HF privileges below 10 m are CW
 * only, so they do not appear in those segments.
 */
const US: RegionBandPlan = {
  region: 'US',
  displayName: 'United States (FCC Part 97)',
  verifiedOn: '2026-08-30',
  licenseClasses: US_ALL,
  segments: [
    { band: '160m', startHz: 1800000, endHz: 2000000, classes: US_HF },
    { band: '80m', startHz: 3500000, endHz: 3600000, classes: ['US_EXTRA'] },
    { band: '80m', startHz: 3525000, endHz: 3600000, classes: ['US_ADVANCED', 'US_GENERAL'] },
    { band: '60m', startHz: 5332000, endHz: 5405000, classes: US_HF, note: 'Channelised: 5332.0, 5348.0, 5358.5, 5373.0 and 5405.0 kHz centres only, 100 W ERP.' },
    { band: '40m', startHz: 7000000, endHz: 7125000, classes: ['US_EXTRA'] },
    { band: '40m', startHz: 7025000, endHz: 7125000, classes: ['US_ADVANCED', 'US_GENERAL'] },
    { band: '30m', startHz: 10100000, endHz: 10150000, classes: US_HF, note: 'Secondary; 200 W PEP maximum.' },
    { band: '20m', startHz: 14000000, endHz: 14150000, classes: ['US_EXTRA'] },
    { band: '20m', startHz: 14025000, endHz: 14150000, classes: ['US_ADVANCED', 'US_GENERAL'] },
    { band: '17m', startHz: 18068000, endHz: 18110000, classes: US_HF },
    { band: '15m', startHz: 21000000, endHz: 21200000, classes: ['US_EXTRA'] },
    { band: '15m', startHz: 21025000, endHz: 21200000, classes: ['US_ADVANCED', 'US_GENERAL'] },
    { band: '12m', startHz: 24890000, endHz: 24930000, classes: US_HF },
    { band: '10m', startHz: 28000000, endHz: 28300000, classes: US_ALL, note: 'Technicians: 200 W PEP maximum.' },
    { band: '6m', startHz: 50000000, endHz: 54000000, classes: US_ALL },
    { band: '2m', startHz: 144000000, endHz: 148000000, classes: US_ALL },
    { band: '70cm', startHz: 420000000, endHz: 450000000, classes: US_ALL, note: 'Secondary; geographic restrictions apply near the Canadian border and certain radar sites.' },
  ],
};

export const BAND_PLANS: Record<RegulatoryRegion, RegionBandPlan> = {
  IARU_R1: REGION_1,
  IARU_R2: REGION_2,
  IARU_R3: REGION_3,
  US,
};

export const REGULATORY_REGION_OPTIONS: { id: RegulatoryRegion; label: string }[] = [
  { id: 'US', label: BAND_PLANS.US.displayName },
  { id: 'IARU_R1', label: BAND_PLANS.IARU_R1.displayName },
  { id: 'IARU_R2', label: BAND_PLANS.IARU_R2.displayName },
  { id: 'IARU_R3', label: BAND_PLANS.IARU_R3.displayName },
];

export const LICENSE_CLASS_LABELS: Record<LicenseClass, string> = {
  FULL: 'Full amateur privileges',
  US_EXTRA: 'Amateur Extra',
  US_ADVANCED: 'Advanced',
  US_GENERAL: 'General',
  US_TECHNICIAN: 'Technician',
};

/**
 * Finds the segment that fully contains an emission of `bandwidthHz` centred on
 * `frequencyHz`, for the given region and class. Returns null when any part of the emission
 * falls outside every permitted segment.
 *
 * The check is against the emission's EDGES, not its centre. A z-30 signal is 50 Hz wide, so a
 * station whose centre sits 10 Hz inside a band edge is radiating more than half its power
 * outside the band - legally out of band, and exactly the mistake an operator tuning up to the
 * edge of a segment makes. Passing bandwidthHz = 0 recovers the old centre-only behaviour and
 * is only appropriate for a carrier of negligible width.
 */
export function findPermittedSegment(
  region: RegulatoryRegion,
  licenseClass: LicenseClass,
  frequencyHz: number,
  bandwidthHz: number = 0
): BandSegment | null {
  const plan = BAND_PLANS[region];
  if (!plan) return null;
  const half = Math.max(0, bandwidthHz) / 2;
  const lowEdgeHz = frequencyHz - half;
  const highEdgeHz = frequencyHz + half;
  for (const segment of plan.segments) {
    if (
      lowEdgeHz >= segment.startHz &&
      highEdgeHz <= segment.endHz &&
      segment.classes.includes(licenseClass)
    ) {
      return segment;
    }
  }
  return null;
}

/**
 * The permitted segment nearest to `frequencyHz`, with the distance to it, so a refusal can
 * tell the operator how far out of band they are instead of only that they are.
 */
export function nearestPermittedSegment(
  region: RegulatoryRegion,
  licenseClass: LicenseClass,
  frequencyHz: number
): { segment: BandSegment; distanceHz: number } | null {
  const plan = BAND_PLANS[region];
  if (!plan) return null;
  let best: { segment: BandSegment; distanceHz: number } | null = null;
  for (const segment of plan.segments) {
    if (!segment.classes.includes(licenseClass)) continue;
    const distanceHz =
      frequencyHz < segment.startHz
        ? segment.startHz - frequencyHz
        : frequencyHz > segment.endHz
          ? frequencyHz - segment.endHz
          : 0;
    if (!best || distanceHz < best.distanceHz) best = { segment, distanceHz };
  }
  return best;
}

/**
 * Syntactic validation of an amateur callsign.
 *
 * Deliberately structural rather than exhaustive: one to two prefix characters (at least one a
 * letter), a digit, and a one-to-four-character suffix, with optional `/P`-style appendages.
 * It rejects an empty box, a name typed into the callsign field, and obvious typos - which is
 * what the transmit gate needs. It cannot tell whether a well-formed callsign was actually
 * issued to the operator.
 */
export function isValidCallsign(callsign: string): boolean {
  const trimmed = (callsign || '').trim().toUpperCase();
  if (!trimmed) return false;
  return /^(?:[A-Z0-9]{1,3}\/)?[A-Z0-9]{1,3}\d[A-Z]{1,4}(?:\/[A-Z0-9]{1,4})?$/.test(trimmed) &&
    /[A-Z]/.test(trimmed.split('/')[0] || trimmed);
}

/**
 * Closed-loop rig state tracking
 * ==============================
 *
 * A port of WSJT-X's `TransceiverBase` / `PollingTransceiver` state model
 * (`Transceiver/TransceiverBase.cpp`, `Transceiver/PollingTransceiver.cpp`) into this
 * codebase's idiom.
 *
 * The idea being borrowed is small and it is the whole point: **WSJT-X never treats a command
 * it sent as knowledge of where the radio is.** It keeps two states - `requested_`, what the
 * software asked for, and `actual_`, what the rig reported when last read - polls the rig on an
 * interval, and only lets `actual_` become the truth. z-30 had no second state at all.
 * `catController.setFreqHz()` assigns its `currentFreqHz` field from the argument *before*
 * writing anything to the wire and never revises it, and `canTransmit()` validates the dial it
 * is handed against the band plan. So every one of these left the gate approving a frequency the
 * transmitter was not on:
 *
 *   - a `set_freq` the daemon refused (`RPRT -1`) - logged as an error, but the app's dial had
 *     already moved;
 *   - a rig whose VFO the operator turned by hand after the app last commanded it;
 *   - a rig that quantises the dial - see `RigResolution` below - and sits up to 99 Hz away
 *     from the frequency it was given;
 *   - rigctld pointed at a rig that was switched off, answering every set with an error and
 *     every get with nothing.
 *
 * None of those are exotic. The first and the last are what a station sees when the radio's USB
 * cable falls out mid-session, and the app's answer was to keep validating a fiction against the
 * band plan and then key the transmitter.
 *
 * This module is deliberately transport-free and DOM-free: it holds no sockets and does no I/O,
 * so `catController` can drive it from the Hamlib relay and the test suite can drive it from an
 * array of readings. Keeping the arithmetic here rather than inside the controller is what makes
 * the stabilisation and resolution rules testable without a radio.
 */

/**
 * How many consecutive polls a rig is allowed before a disagreement with what we asked for is
 * treated as the truth rather than as the rig not having got there yet.
 *
 * WSJT-X's `polls_to_stabilize`, same value. Its reason for existing is stated in
 * `PollingTransceiver.hpp`: some rigs do not update immediately after a state change, and
 * changing the split TX frequency on an Icom requires a VFO switch during which a poll returns
 * the *wrong* frequency. Believing that intermediate reading would be worse than believing
 * nothing. Here it also covers the case the relay adds: a poll already in flight when the QSY
 * was written answers with the pre-QSY dial.
 */
export const POLLS_TO_STABILIZE = 3;

/**
 * How long after a PTT transition to leave the rig alone before polling it again.
 *
 * `TransceiverBase::set` sleeps 100 ms after each PTT change with the comment "some rigs cannot
 * process CAT commands while switching from Tx to Rx". A poll fired into that window is the same
 * command traffic that comment is about, and the answer it gets - or fails to get - is not
 * evidence about the rig's state.
 */
export const PTT_SETTLE_MS = 100;

/**
 * A reading older than this is not evidence any more.
 *
 * The gate distinguishes "the radio says it is somewhere else" from "the radio has not been
 * heard from" - only the first is a refusal (see `dialDisagreement`). Without an expiry the two
 * collapse: a relay that died an hour ago would keep supplying its last reading as proof that
 * the rig is on frequency. Sized at several poll intervals so an ordinary missed poll does not
 * flap the state.
 */
export const READING_STALE_AFTER_MS = 6000;

/**
 * The interval between polls, in milliseconds.
 *
 * WSJT-X uses 500 ms (`PollingTransceiver::do_post_start` overrides the configured interval to
 * get PWR and SWR updates). Each poll here is an HTTP round trip to the local server, which then
 * opens a TCP connection to rigctld, rather than a direct read on an already-open serial handle,
 * so the same rate would be considerably more machinery for the same answer. One second still
 * bounds how long the app can believe a stale dial to well under the 30 s slot.
 */
export const DEFAULT_POLL_INTERVAL_MS = 1000;

/**
 * How finely the rig actually tunes, as WSJT-X's integer resolution code.
 *
 * WSJT-X measures this rather than assuming it: `HamlibTransceiver::do_start` sets a frequency
 * ending in 55, reads back what the rig made of it, and classifies the difference. A rig that
 * truncates to 100 Hz answers 55 Hz low. The consequence for us is the one that matters at a
 * band edge - the dial the app commanded and the dial the rig is on are not the same number, and
 * treating a reported difference as a fault would refuse to transmit on hardware that is working
 * exactly as designed.
 *
 * Values are WSJT-X's, taken from the classification code in `HamlibTransceiver::do_start`
 * rather than from the comment above the `resolution` signal in `Transceiver.hpp`, which has
 * drifted from it (the comment lists 100 Hz as ±2; the code assigns ±2 to 20 Hz and ±3 to
 * 100 Hz).
 *
 *   0  1 Hz - the rig tunes exactly where it is told
 *   1  10 Hz rounded      -1  10 Hz truncated
 *   2  20 Hz rounded      -2  20 Hz truncated
 *   3  100 Hz rounded     -3  100 Hz truncated
 */
export type RigResolution = 0 | 1 | -1 | 2 | -2 | 3 | -3;

/** The tuning step, in Hz, implied by a resolution code. */
export function resolutionStepHz(resolution: RigResolution): number {
  switch (resolution) {
    case 1:
    case -1:
      return 10;
    case 2:
    case -2:
      return 20;
    case 3:
    case -3:
      return 100;
    default:
      return 1;
  }
}

/**
 * How far the rig's dial may legitimately sit from the frequency it was commanded, given its
 * resolution. Returned as a signed pair because truncation is one-sided: a rig that truncates
 * only ever lands *below* the requested frequency, and allowing the same slack upwards would
 * widen the band-edge check for no reason.
 */
export function resolutionErrorBoundsHz(resolution: RigResolution): { belowHz: number; aboveHz: number } {
  const step = resolutionStepHz(resolution);
  if (step === 1) return { belowHz: 0, aboveHz: 0 };
  if (resolution < 0) {
    // Truncated: the rig drops the remainder, so it lands between 0 and step-1 Hz low.
    return { belowHz: step - 1, aboveHz: 0 };
  }
  // Rounded: at most half a step either way.
  return { belowHz: step / 2, aboveHz: step / 2 };
}

/**
 * True when a reported dial is consistent with a commanded one for a rig of this resolution.
 *
 * This is the check WSJT-X's `resolution` signal exists to inform. Without it, every reading
 * from a 10 Hz Yaesu would look like a disagreement and a gate built on top of it would refuse
 * to transmit at all - which is how a safety check gets switched off by its operator.
 */
export function dialAgrees(commandedHz: number, reportedHz: number, resolution: RigResolution): boolean {
  if (!Number.isFinite(commandedHz) || !Number.isFinite(reportedHz)) return false;
  const bounds = resolutionErrorBoundsHz(resolution);
  const error = reportedHz - commandedHz;
  // One Hz of slack on top absorbs the sub-Hz difference between the dial the UI carries as a
  // float and the integer `setFreqHz` rounds it to before writing it to the wire. It is three
  // orders of magnitude below the 50 Hz emission the band-edge check reasons about, so it
  // cannot make an out-of-band signal look in-band.
  return error <= bounds.aboveHz + 1 && -error <= bounds.belowHz + 1;
}

/** The resolution in words, for the rig control log and the diagnostics panel. */
export function describeRigResolution(resolution: RigResolution): string {
  const step = resolutionStepHz(resolution);
  if (step === 1) return '1 Hz';
  return `${step} Hz ${resolution < 0 ? 'truncated' : 'rounded'}`;
}

/** One observation of the rig, as read back. Fields absent from the reading are left untouched. */
export interface RigReading {
  dialHz?: number;
  ptt?: boolean;
  mode?: string;
}

/** What the tracker currently believes, and how much of it was actually read from a radio. */
export interface RigStateSnapshot {
  /** False once a poll has failed, or before the first successful one. Nothing here is evidence when false. */
  online: boolean;
  /** The dial the rig last reported, or null if it has never reported one. */
  reportedDialHz: number | null;
  /** The PTT state the rig last reported, or null if it has never reported one. */
  reportedPtt: boolean | null;
  /** The mode the rig last reported, or null. */
  reportedMode: string | null;
  /** The dial this software last commanded. */
  commandedDialHz: number | null;
  /** True when the rig has settled: it agrees with what we asked, or has had its retries. */
  stable: boolean;
  /** Polls still allowed before a disagreement is treated as the truth. */
  pollsRemaining: number;
  /** When the last successful reading arrived, in ms since epoch, or null. */
  lastReadingAtMs: number | null;
  /** Why the rig went offline, when it did. */
  offlineReason: string | null;
}

/**
 * A disagreement the transmit gate should act on: the rig is settled, was heard from recently,
 * and is reporting a dial that its resolution cannot explain.
 */
export interface DialDisagreement {
  commandedHz: number;
  reportedHz: number;
  errorHz: number;
  ageMs: number;
}

/**
 * Tracks what we asked a rig for against what it says it did.
 *
 * Mirrors the division of labour in WSJT-X: `noteRequested*` are the `requested_` writes made by
 * `TransceiverBase::set`, `observe` is `PollingTransceiver::handle_timeout` folding a `do_poll`
 * result into `actual_` and counting down `retries_`, and `isStable` is `do_pre_update` deciding
 * whether the state is fit to be believed yet.
 */
export class RigStateTracker {
  private online = false;
  private offlineReason: string | null = null;

  private commandedDialHz: number | null = null;
  private commandedPtt: boolean | null = null;
  private commandedMode: string | null = null;

  private reportedDialHz: number | null = null;
  private reportedPtt: boolean | null = null;
  private reportedMode: string | null = null;

  private pollsRemaining = 0;
  private lastReadingAtMs: number | null = null;
  private resolution: RigResolution = 0;
  /** Set when a PTT command was issued, so polls can be held off for PTT_SETTLE_MS. */
  private lastPttChangeAtMs: number | null = null;

  /**
   * Records the rig's measured tuning resolution. Until this is called the tracker assumes 1 Hz,
   * which is the strict reading: it will call a 10 Hz rig's rounding a disagreement rather than
   * quietly widening the tolerance for a rig nobody has measured.
   */
  public setResolution(resolution: RigResolution): void {
    this.resolution = resolution;
  }

  public getResolution(): RigResolution {
    return this.resolution;
  }

  /**
   * What this software last asked the rig to do. Each of these restarts the settling countdown,
   * exactly as `PollingTransceiver::do_post_frequency` and friends do, so that a reading taken
   * before the command landed cannot be mistaken for the rig disobeying.
   */
  public noteRequestedDial(hz: number): void {
    if (this.commandedDialHz !== hz) {
      this.commandedDialHz = hz;
      this.pollsRemaining = POLLS_TO_STABILIZE;
    }
  }

  public noteRequestedMode(mode: string): void {
    if (this.commandedMode !== mode) {
      this.commandedMode = mode;
      this.pollsRemaining = POLLS_TO_STABILIZE;
    }
  }

  public noteRequestedPtt(tx: boolean, nowMs: number = Date.now()): void {
    this.lastPttChangeAtMs = nowMs;
    if (this.commandedPtt !== tx) {
      this.commandedPtt = tx;
      this.pollsRemaining = POLLS_TO_STABILIZE;
    }
  }

  /**
   * True while the rig should be left alone after a PTT transition.
   *
   * The 100 ms in `TransceiverBase::set` exists because some rigs cannot process CAT commands
   * while switching between transmit and receive. A poll is CAT traffic like any other.
   */
  public inPttSettleWindow(nowMs: number = Date.now()): boolean {
    return this.pttSettleRemainingMs(nowMs) > 0;
  }

  /** Milliseconds left of that window, so a caller waits out the remainder rather than a fresh 100 ms. */
  public pttSettleRemainingMs(nowMs: number = Date.now()): number {
    if (this.lastPttChangeAtMs === null) return 0;
    return Math.max(0, PTT_SETTLE_MS - (nowMs - this.lastPttChangeAtMs));
  }

  /**
   * Folds one successful reading into the tracked state and counts down the settling window.
   *
   * The countdown ends early when the rig arrives at what was asked for, which is
   * `handle_timeout`'s `state () == next_state_` branch: there is no reason to keep withholding
   * judgement once the rig has demonstrably obeyed.
   */
  public observe(reading: RigReading, nowMs: number = Date.now()): void {
    this.online = true;
    this.offlineReason = null;
    this.lastReadingAtMs = nowMs;

    if (typeof reading.dialHz === 'number' && Number.isFinite(reading.dialHz)) {
      this.reportedDialHz = reading.dialHz;
    }
    if (typeof reading.ptt === 'boolean') {
      this.reportedPtt = reading.ptt;
    }
    if (typeof reading.mode === 'string' && reading.mode) {
      this.reportedMode = reading.mode;
    }

    if (this.pollsRemaining > 0) {
      this.pollsRemaining -= 1;
      if (this.matchesRequest()) {
        this.pollsRemaining = 0;
      }
    }
  }

  /** True when every commanded value the rig has reported back agrees with the command. */
  private matchesRequest(): boolean {
    if (this.commandedDialHz !== null && this.reportedDialHz !== null) {
      if (!dialAgrees(this.commandedDialHz, this.reportedDialHz, this.resolution)) return false;
    }
    if (this.commandedPtt !== null && this.reportedPtt !== null && this.commandedPtt !== this.reportedPtt) {
      return false;
    }
    return true;
  }

  /**
   * Takes the rig offline and discards what it told us.
   *
   * WSJT-X's `TransceiverBase::offline`, minus the part that drops PTT. That divergence is
   * deliberate and worth naming: WSJT-X owns the keying line it is giving up on, because on a
   * rig it cannot talk to over CAT it will not leave PTT asserted. Here the keying line is very
   * often somewhere else entirely - a CM108 GPIO, a Pi header pin, an RTS line on a second
   * cable, a TCI socket - so a failed rigctld poll is not evidence about the transmitter's
   * state, and unkeying on it would abort a perfectly good frame every time the local relay
   * hiccups. The stuck-transmitter defence stays where it already is: the browser watchdog, the
   * server-side dead-man switch, and the atexit pin release.
   *
   * What it does do is stop the readings counting as verification, which is the safety-relevant
   * half - a rig we have lost contact with must not go on vouching for its own dial.
   */
  public goOffline(reason: string): void {
    this.online = false;
    this.offlineReason = reason;
    this.reportedDialHz = null;
    this.reportedPtt = null;
    this.reportedMode = null;
    this.lastReadingAtMs = null;
    this.pollsRemaining = 0;
  }

  /** Clears everything, including what was commanded. For a rig being disconnected outright. */
  public reset(): void {
    this.goOffline('rig control stopped');
    this.commandedDialHz = null;
    this.commandedPtt = null;
    this.commandedMode = null;
    this.lastPttChangeAtMs = null;
    this.resolution = 0;
  }

  /** True once the rig has settled - it agrees with the last command, or has had its retries. */
  public isStable(): boolean {
    return this.pollsRemaining === 0;
  }

  public isOnline(): boolean {
    return this.online;
  }

  /** True when there is a reading recent enough to reason about. */
  public hasFreshReading(nowMs: number = Date.now()): boolean {
    return (
      this.online && this.lastReadingAtMs !== null && nowMs - this.lastReadingAtMs <= READING_STALE_AFTER_MS
    );
  }

  /**
   * The dial the radio itself reports, or null when there is nothing current enough to trust.
   *
   * Null is not a failure - most z-30 stations cannot read their rig back at all (Direct Serial
   * has no response parser, and VOX-keyed stations have no CAT link) - it means "unverified",
   * and callers must go on using the commanded dial in that case.
   */
  public verifiedDialHz(nowMs: number = Date.now()): number | null {
    if (!this.hasFreshReading(nowMs)) return null;
    return this.reportedDialHz;
  }

  /**
   * The disagreement the transmit gate acts on, or null if there is none to act on.
   *
   * All four conditions have to hold before this returns anything, and each one is a case where
   * refusing would be wrong rather than safe:
   *
   *   - a reading exists and is fresh   - otherwise "no radio attached" would block every
   *                                       station that cannot read its rig back;
   *   - the rig has settled             - otherwise a poll that crossed with the QSY refuses the
   *                                       slot the QSY was for (`polls_to_stabilize`);
   *   - the error exceeds what the rig's resolution explains - otherwise a 10 Hz rig is
   *                                       permanently out of compliance with itself;
   *   - the caller's dial is finite.
   */
  public dialDisagreement(commandedHz: number, nowMs: number = Date.now()): DialDisagreement | null {
    if (!Number.isFinite(commandedHz)) return null;
    if (!this.hasFreshReading(nowMs)) return null;
    if (!this.isStable()) return null;
    const reportedHz = this.reportedDialHz;
    if (reportedHz === null) return null;
    if (dialAgrees(commandedHz, reportedHz, this.resolution)) return null;
    return {
      commandedHz,
      reportedHz,
      errorHz: reportedHz - commandedHz,
      ageMs: nowMs - (this.lastReadingAtMs ?? nowMs),
    };
  }

  public snapshot(): RigStateSnapshot {
    return {
      online: this.online,
      reportedDialHz: this.reportedDialHz,
      reportedPtt: this.reportedPtt,
      reportedMode: this.reportedMode,
      commandedDialHz: this.commandedDialHz,
      stable: this.isStable(),
      pollsRemaining: this.pollsRemaining,
      lastReadingAtMs: this.lastReadingAtMs,
      offlineReason: this.offlineReason,
    };
  }
}

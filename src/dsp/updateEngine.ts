/**
 * Upstream Synchronisation Engine
 * Repository: https://github.com/themantas1994/z-30
 *
 * Answers "is this station running the current code, and if not, bring it there".
 *
 * Commits, not versions
 * ---------------------
 * z-30 is developed on `main` and is not released on a version cadence. This engine used to
 * compare a hardcoded `CURRENT_APP_VERSION = '1.0.0'` against the newest GitHub release tag,
 * the upstream package.json `version` field, and - on a separate "DEVELOPMENT" channel - a
 * hand-maintained `CURRENT_COMMIT_SHA` that had gone stale. All three had been 1.0.0/0d25629
 * for the life of the repository, so the check reported "up to date" no matter how far behind
 * the installation actually was. A version number nobody bumps is not a version number.
 *
 * There is now one question with one answer: how many commits behind `origin/main` is this
 * installation. `git` already knows, exactly, with no release to cut and no API rate limit.
 *
 * Two sources, in order of authority
 * ----------------------------------
 * 1. The native z-30 server (`/api/update/status`), when it is serving this page. It runs
 *    `git fetch` in the real checkout, so it knows the true local HEAD, the true upstream
 *    HEAD, whether the tree is dirty, and whether a fast-forward would succeed. It is also
 *    the only source that can *apply* the update.
 * 2. The GitHub commits API, when the app is served from static hosting or a PWA with no
 *    native server behind it. That can only compare the build-stamped commit against upstream
 *    and tell the operator what to run; it cannot update anything, and says so.
 *
 * The old engine's fourth job - printing five platforms' worth of shell commands into a set of
 * tabs - is now the fallback for case 2 rather than the primary interface, because in case 1
 * the button does the work instead of describing it.
 */

import { isLocalServerAvailable, getUpdateStatus, applyUpdate, getUpdateProgress } from './localServerApi';

/** Injected by vite.config.ts at build time; 'unknown' for a build made without git. */
declare const __Z30_BUILD_COMMIT__: string;
declare const __Z30_BUILD_DATE__: string;

export const GITHUB_REPO = {
  owner: 'themantas1994',
  repo: 'z-30',
  url: 'https://github.com/themantas1994/z-30',
  commitsUrl: 'https://github.com/themantas1994/z-30/commits/main',
  apiUrl: 'https://api.github.com/repos/themantas1994/z-30',
};

/** The branch every installation tracks. There are no release channels. */
export const UPSTREAM_BRANCH = 'main';

export const BUILD_COMMIT: string =
  typeof __Z30_BUILD_COMMIT__ === 'string' ? __Z30_BUILD_COMMIT__ : 'unknown';
export const BUILD_DATE: string =
  typeof __Z30_BUILD_DATE__ === 'string' ? __Z30_BUILD_DATE__ : 'unknown';

export function shortSha(sha: string): string {
  return sha && sha !== 'unknown' ? sha.slice(0, 7) : 'unknown';
}

export interface UpstreamCommit {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
  htmlUrl: string;
}

/**
 * Where this installation sits relative to `origin/main`.
 *
 * `behind` is the number the whole UI is built around. `canUpdate` is the server's own verdict
 * on whether pressing the button would do anything, so the UI never offers an action that is
 * going to be refused.
 */
export interface UpdateCheckResult {
  /** True when `behind > 0`. Kept as a named field because the header badge reads it. */
  hasUpdate: boolean;
  behind: number;
  ahead: number;
  localCommit: string;
  upstreamCommit: string;
  branch: string;
  pending: UpstreamCommit[];
  /** True when a native server is backing this page and can perform the update itself. */
  canApplyInApp: boolean;
  canUpdate: boolean;
  /** Why an update cannot be applied, when it cannot. */
  blockedReason: string | null;
  isGitCheckout: boolean;
  dirty: boolean;
  /** Where the numbers came from, so the UI can say so rather than implying git precision. */
  source: 'local-server' | 'github-api';
  checkedAt: string;
  error: string | null;
  isRateLimited: boolean;
}

export interface UpdateProgress {
  running: boolean;
  log: string[];
  finished: boolean;
  success: boolean;
  error: string | null;
  /** The served bundle changed, so the page must purge caches and reload to pick it up. */
  webAssetsChanged: boolean;
  /** The Python package changed, so the running server process is now stale. */
  restartRequired: boolean;
  fromCommit: string;
  toCommit: string;
}

const CACHE_KEY = 'z30_update_cache';

function emptyResult(): UpdateCheckResult {
  return {
    hasUpdate: false,
    behind: 0,
    ahead: 0,
    localCommit: BUILD_COMMIT,
    upstreamCommit: '',
    branch: UPSTREAM_BRANCH,
    pending: [],
    canApplyInApp: false,
    canUpdate: false,
    blockedReason: null,
    isGitCheckout: false,
    dirty: false,
    source: 'github-api',
    checkedAt: new Date().toISOString(),
    error: null,
    isRateLimited: false,
  };
}

class UpdateEngine {
  private cachedResult: UpdateCheckResult | null = null;
  private lastCheckTime = 0;
  private listeners: Set<(result: UpdateCheckResult) => void> = new Set();
  private isChecking = false;

  constructor() {
    // Load the last check result from localStorage, validating its shape rather than trusting
    // it. The parsed object is handed to subscribers and rendered directly; a truncated write
    // or a schema change between versions would otherwise produce an object whose fields are
    // the wrong type, and the update modal would throw on first paint.
    try {
      const saved = localStorage.getItem(CACHE_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (
          parsed &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed) &&
          typeof (parsed as UpdateCheckResult).behind === 'number' &&
          Array.isArray((parsed as UpdateCheckResult).pending)
        ) {
          this.cachedResult = parsed as UpdateCheckResult;
        } else {
          localStorage.removeItem(CACHE_KEY);
        }
      }
    } catch {
      // ignore
    }
  }

  public subscribe(fn: (result: UpdateCheckResult) => void): () => void {
    this.listeners.add(fn);
    if (this.cachedResult) {
      fn(this.cachedResult);
    }
    return () => this.listeners.delete(fn);
  }

  private notify(result: UpdateCheckResult) {
    this.cachedResult = result;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(result));
    } catch {
      // ignore
    }
    this.listeners.forEach((fn) => fn(result));
  }

  public getCachedResult(): UpdateCheckResult | null {
    return this.cachedResult;
  }

  /**
   * Counts the commits between this installation and `origin/main`.
   *
   * `force` fetches from the network; without it a check inside 60 s reuses the last answer,
   * and the native server is additionally asked not to fetch, so an idle badge refresh costs
   * nothing.
   */
  public async checkForUpdates(force = false): Promise<UpdateCheckResult> {
    const now = Date.now();
    if (!force && this.cachedResult && now - this.lastCheckTime < 60_000) {
      return this.cachedResult;
    }
    if (this.isChecking && this.cachedResult) {
      return this.cachedResult;
    }

    this.isChecking = true;
    this.lastCheckTime = now;
    try {
      const result = isLocalServerAvailable()
        ? await this.checkViaLocalServer(force)
        : await this.checkViaGitHub();
      this.notify(result);
      return result;
    } finally {
      this.isChecking = false;
    }
  }

  /** The authoritative path: the native server runs git in the real checkout. */
  private async checkViaLocalServer(fetchRemote: boolean): Promise<UpdateCheckResult> {
    const response = await getUpdateStatus(fetchRemote);
    const result = emptyResult();
    result.source = 'local-server';
    result.canApplyInApp = true;

    if (!response.success || !response.data) {
      result.error = response.error || 'The native server did not answer the update check.';
      return result;
    }

    const data = response.data;
    result.behind = data.behind ?? 0;
    result.ahead = data.ahead ?? 0;
    result.hasUpdate = result.behind > 0;
    result.localCommit = data.local_commit || BUILD_COMMIT;
    result.upstreamCommit = data.upstream_commit || '';
    result.branch = data.branch || UPSTREAM_BRANCH;
    result.isGitCheckout = Boolean(data.is_git_checkout);
    result.dirty = Boolean(data.dirty);
    result.canUpdate = Boolean(data.can_update);
    result.blockedReason = data.blocked_reason ?? null;
    result.error = data.error ?? null;
    result.checkedAt = data.checked_at || new Date().toISOString();
    result.pending = (data.pending || []).map((c) => ({
      sha: c.sha,
      shortSha: c.short_sha,
      subject: c.subject,
      author: c.author,
      date: c.date,
      htmlUrl: `${GITHUB_REPO.url}/commit/${c.sha}`,
    }));
    return result;
  }

  /**
   * The fallback: a bundle on static hosting, comparing its build stamp against upstream.
   *
   * This can tell the operator they are behind and by roughly how much, but it cannot apply
   * anything and does not pretend to. When the build stamp is 'unknown' - a build made without
   * git - it reports the newest commits without claiming a distance, rather than guessing.
   */
  private async checkViaGitHub(): Promise<UpdateCheckResult> {
    const result = emptyResult();
    result.source = 'github-api';
    result.blockedReason =
      'This page is not being served by the native z-30 server, so it cannot update the ' +
      'installation itself. Start z-30 with the "z30" command, or run the command below.';

    try {
      const response = await fetch(`${GITHUB_REPO.apiUrl}/commits?sha=${UPSTREAM_BRANCH}&per_page=25`, {
        headers: { Accept: 'application/vnd.github.v3+json' },
        cache: 'no-store',
      });
      if (response.status === 403 || response.status === 429) {
        result.isRateLimited = true;
        result.error = 'GitHub rate-limited the update check. Try again in a few minutes.';
        return result;
      }
      if (!response.ok) {
        result.error = `GitHub returned HTTP ${response.status}.`;
        return result;
      }

      const commits: unknown = await response.json();
      if (!Array.isArray(commits) || commits.length === 0) {
        result.error = 'GitHub returned no commits for the main branch.';
        return result;
      }

      const mapped: UpstreamCommit[] = commits.map((c: any) => ({
        sha: String(c.sha || ''),
        shortSha: shortSha(String(c.sha || '')),
        subject: String(c.commit?.message || '').split('\n')[0] || '(no subject)',
        author: String(c.commit?.author?.name || c.author?.login || GITHUB_REPO.owner),
        date: String(c.commit?.author?.date || ''),
        htmlUrl: String(c.html_url || `${GITHUB_REPO.url}/commit/${c.sha}`),
      }));

      result.upstreamCommit = mapped[0].sha;
      result.checkedAt = new Date().toISOString();

      if (BUILD_COMMIT === 'unknown') {
        // No stamp to compare against. Show what upstream has and say the distance is unknown
        // rather than inventing one - a wrong "you are up to date" is the failure this whole
        // rewrite exists to remove.
        result.pending = mapped.slice(0, 10);
        result.error = 'This bundle carries no build commit, so its distance from upstream is unknown.';
        return result;
      }

      const index = mapped.findIndex((c) => c.sha === BUILD_COMMIT);
      if (index === -1) {
        // Older than the page of commits fetched. "At least this many" is honest; a precise
        // count needs the local git repository.
        result.behind = mapped.length;
        result.hasUpdate = true;
        result.pending = mapped;
      } else {
        result.behind = index;
        result.hasUpdate = index > 0;
        result.pending = mapped.slice(0, index);
      }
    } catch (err: unknown) {
      result.error = err instanceof Error ? err.message : 'Could not reach GitHub.';
    }
    return result;
  }

  /**
   * Fast-forwards the installation onto `origin/main` through the native server.
   *
   * Resolves when the update has finished (or failed), having called `onLog` with each line as
   * the server produced it. The server runs the work in its own thread and this polls, so a
   * slow checkout on a Raspberry Pi does not sit inside one long-lived request that the
   * browser would abandon half-way with no way to find out what happened.
   */
  public async performUpdate(
    options: { reinstallPython?: boolean; rebuildWeb?: boolean } = {},
    onLog?: (line: string) => void
  ): Promise<UpdateProgress> {
    const idle: UpdateProgress = {
      running: false,
      log: [],
      finished: true,
      success: false,
      error: null,
      webAssetsChanged: false,
      restartRequired: false,
      fromCommit: '',
      toCommit: '',
    };

    if (!isLocalServerAvailable()) {
      return {
        ...idle,
        error:
          'The native z-30 server is not backing this page, so there is no installation for it ' +
          'to update. Start the app with the "z30" command.',
      };
    }

    const started = await applyUpdate({
      reinstall_python: Boolean(options.reinstallPython),
      rebuild_web: Boolean(options.rebuildWeb),
    });
    if (!started.success) {
      return { ...idle, error: started.error || 'The server refused to start the update.' };
    }

    let delivered = 0;
    // Bounded so a server that never clears `running` cannot spin here forever; 900 polls at
    // 1 s is comfortably longer than a checkout plus an optional npm build.
    for (let poll = 0; poll < 900; poll++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const snapshot = await getUpdateProgress();
      if (!snapshot.success || !snapshot.data) continue;

      const log = snapshot.data.log || [];
      for (; delivered < log.length; delivered++) {
        onLog?.(log[delivered]);
      }

      if (!snapshot.data.running) {
        const outcome = snapshot.data.result;
        const progress: UpdateProgress = {
          running: false,
          log,
          finished: true,
          success: Boolean(outcome?.success),
          error: outcome?.error ?? null,
          webAssetsChanged: Boolean(outcome?.web_assets_changed),
          restartRequired: Boolean(outcome?.restart_required),
          fromCommit: outcome?.from_commit || '',
          toCommit: outcome?.to_commit || '',
        };
        if (progress.success) {
          // The next check must not answer from a cache written before the fast-forward.
          this.lastCheckTime = 0;
          try {
            localStorage.removeItem(CACHE_KEY);
          } catch {
            // ignore
          }
        }
        return progress;
      }
    }

    return { ...idle, error: 'The update is taking longer than expected; check the server log.' };
  }

  /**
   * Purges the PWA caches and reloads, so the freshly fast-forwarded bundle is the one that
   * runs.
   *
   * Necessary because the service worker will otherwise keep serving the bundle it cached
   * before the update, which looks exactly like an update that silently did nothing.
   */
  public async reloadUpdatedAssets(): Promise<void> {
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.unregister()));
      }
      localStorage.removeItem(CACHE_KEY);
    } catch (err) {
      console.warn('Cache purge before reload failed:', err);
    } finally {
      window.location.reload();
    }
  }

  /**
   * The one command to run when the app cannot update itself.
   *
   * There used to be five platform variants of this behind a tab strip, differing only in
   * which installer script they invoked afterwards. The fast-forward is the update; re-running
   * an installer is a separate concern, and the installers are documented in wiki/09.
   */
  public getManualUpdateCommand(): string {
    return `cd z-30 && git pull --ff-only origin ${UPSTREAM_BRANCH}`;
  }
}

export const updateEngine = new UpdateEngine();

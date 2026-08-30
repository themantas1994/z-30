/**
 * GitHub Upstream Update & Version Synchronization Engine
 * Repository: https://github.com/themantas1994/z-30
 * 
 * Provides:
 * - Version check against GitHub Releases and Git Main Branch Commits
 * - Changelog & Release Notes parsing
 * - Platform-specific update scripts (Ubuntu, Arch, Windows, Android Termux, Pip)
 * - PWA / Web Audio ServiceWorker Cache Purge & Live Hot Update
 * - Automatic background update detection
 */

export interface GitHubReleaseAsset {
  name: string;
  size: number;
  download_count: number;
  browser_download_url: string;
  content_type: string;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  assets: GitHubReleaseAsset[];
}

export interface GitHubCommit {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string;
  authorDate: string;
  htmlUrl: string;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  channel: 'STABLE' | 'DEVELOPMENT';
  release?: GitHubRelease | null;
  latestCommit?: GitHubCommit | null;
  recentCommits: GitHubCommit[];
  checkedAt: string;
  error?: string | null;
  isRateLimited?: boolean;
}

export const GITHUB_REPO = {
  owner: 'themantas1994',
  repo: 'z-30',
  url: 'https://github.com/themantas1994/z-30',
  releasesUrl: 'https://github.com/themantas1994/z-30/releases',
  commitsUrl: 'https://github.com/themantas1994/z-30/commits/main',
  rawUrl: 'https://raw.githubusercontent.com/themantas1994/z-30/main',
  apiUrl: 'https://api.github.com/repos/themantas1994/z-30',
};

export const CURRENT_APP_VERSION = '1.0.0';
export const CURRENT_BUILD_DATE = '2026-08-28';
export const CURRENT_COMMIT_SHA = '0d25629';

// Compare two semver strings (e.g. "1.0.0" vs "1.1.0")
export function compareSemVer(v1: string, v2: string): number {
  const clean1 = v1.replace(/^v/, '').trim();
  const clean2 = v2.replace(/^v/, '').trim();
  const parts1 = clean1.split('.').map((p) => parseInt(p, 10) || 0);
  const parts2 = clean2.split('.').map((p) => parseInt(p, 10) || 0);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
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
      const saved = localStorage.getItem('z30_update_cache');
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (
          parsed &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed) &&
          typeof (parsed as UpdateCheckResult).currentVersion === 'string'
        ) {
          this.cachedResult = parsed as UpdateCheckResult;
        } else {
          localStorage.removeItem('z30_update_cache');
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
      localStorage.setItem('z30_update_cache', JSON.stringify(result));
    } catch {
      // ignore
    }
    this.listeners.forEach((fn) => fn(result));
  }

  public getCachedResult(): UpdateCheckResult | null {
    return this.cachedResult;
  }

  /**
   * Check for updates on GitHub (https://github.com/themantas1994/z-30)
   */
  public async checkForUpdates(
    channel: 'STABLE' | 'DEVELOPMENT' = 'STABLE',
    force = false
  ): Promise<UpdateCheckResult> {
    const now = Date.now();
    // Cache for 60 seconds unless forced
    if (!force && this.cachedResult && now - this.lastCheckTime < 60000 && this.cachedResult.channel === channel) {
      return this.cachedResult;
    }

    if (this.isChecking) {
      if (this.cachedResult) return this.cachedResult;
    }

    this.isChecking = true;
    this.lastCheckTime = now;

    let releaseData: GitHubRelease | null = null;
    let recentCommits: GitHubCommit[] = [];
    let latestCommit: GitHubCommit | null = null;
    let latestVersion = CURRENT_APP_VERSION;
    let hasUpdate = false;
    let isRateLimited = false;
    let errorMsg: string | null = null;

    try {
      // 1. Fetch latest release from GitHub API
      const releaseHeaders: HeadersInit = {
        Accept: 'application/vnd.github.v3+json',
      };

      const releasePromise = fetch(`${GITHUB_REPO.apiUrl}/releases/latest`, { headers: releaseHeaders })
        .then(async (res) => {
          if (res.status === 403 || res.status === 429) {
            isRateLimited = true;
            return null;
          }
          if (res.ok) {
            return await res.json();
          }
          return null;
        })
        .catch(() => null);

      // 2. Fetch recent commits on main branch
      const commitsPromise = fetch(`${GITHUB_REPO.apiUrl}/commits?per_page=6`, { headers: releaseHeaders })
        .then(async (res) => {
          if (res.status === 403 || res.status === 429) {
            isRateLimited = true;
            return null;
          }
          if (res.ok) {
            return await res.json();
          }
          return null;
        })
        .catch(() => null);

      // 3. Fetch raw package.json to compare version string
      const rawPkgPromise = fetch(`${GITHUB_REPO.rawUrl}/package.json`)
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            return data.version as string;
          }
          return null;
        })
        .catch(() => null);

      const [releaseRes, commitsRes, rawVersion] = await Promise.all([
        releasePromise,
        commitsPromise,
        rawPkgPromise,
      ]);

      if (releaseRes && releaseRes.tag_name) {
        releaseData = {
          id: releaseRes.id,
          tag_name: releaseRes.tag_name,
          name: releaseRes.name || releaseRes.tag_name,
          body: releaseRes.body || 'No release notes provided for this version.',
          published_at: releaseRes.published_at || new Date().toISOString(),
          html_url: releaseRes.html_url || `${GITHUB_REPO.url}/releases/tag/${releaseRes.tag_name}`,
          prerelease: Boolean(releaseRes.prerelease),
          draft: Boolean(releaseRes.draft),
          assets: Array.isArray(releaseRes.assets)
            ? releaseRes.assets.map((a: any) => ({
                name: a.name,
                size: a.size,
                download_count: a.download_count,
                browser_download_url: a.browser_download_url,
                content_type: a.content_type,
              }))
            : [],
        };
        latestVersion = releaseData.tag_name.replace(/^v/, '');
      } else if (rawVersion) {
        latestVersion = rawVersion;
      }

      if (Array.isArray(commitsRes)) {
        recentCommits = commitsRes.map((c: any) => ({
          sha: c.sha,
          shortSha: c.sha.substring(0, 7),
          message: c.commit?.message?.split('\n')[0] || 'Update z-30 DSP suite',
          authorName: c.commit?.author?.name || c.author?.login || 'themantas1994',
          authorDate: c.commit?.author?.date || new Date().toISOString(),
          htmlUrl: c.html_url || `${GITHUB_REPO.url}/commit/${c.sha}`,
        }));
        if (recentCommits.length > 0) {
          latestCommit = recentCommits[0];
        }
      }

      // Determine update availability
      if (channel === 'STABLE') {
        if (releaseData) {
          hasUpdate = compareSemVer(latestVersion, CURRENT_APP_VERSION) > 0;
        } else if (rawVersion) {
          hasUpdate = compareSemVer(rawVersion, CURRENT_APP_VERSION) > 0;
        }
      } else {
        // DEVELOPMENT channel: check if latest commit is different from CURRENT_COMMIT_SHA
        if (latestCommit && latestCommit.shortSha !== CURRENT_COMMIT_SHA) {
          hasUpdate = true;
        }
      }
    } catch (e: any) {
      errorMsg = e?.message || 'Failed to connect to GitHub API';
    } finally {
      this.isChecking = false;
    }

    const result: UpdateCheckResult = {
      hasUpdate,
      currentVersion: CURRENT_APP_VERSION,
      latestVersion: latestVersion || CURRENT_APP_VERSION,
      channel,
      release: releaseData,
      latestCommit,
      recentCommits,
      checkedAt: new Date().toISOString(),
      error: errorMsg,
      isRateLimited,
    };

    this.notify(result);
    return result;
  }

  /**
   * Triggers a Web / PWA cache purge and reload to fetch updated assets
   */
  public async performWebPwaUpdate(): Promise<boolean> {
    try {
      // 1. Clear CacheStorage
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }

      // 2. Unregister Service Workers
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.unregister()));
      }

      // 3. Clear LocalStorage update timestamp cache
      localStorage.removeItem('z30_update_cache');

      // 4. Force reload from network bypassing cache
      window.location.reload();
      return true;
    } catch (err) {
      console.warn('Web update purge failed:', err);
      window.location.reload();
      return false;
    }
  }

  /**
   * Generates platform-specific terminal commands to update the native suite
   */
  public getPlatformUpdateInstructions(platform: 'UBUNTU' | 'ARCH' | 'WINDOWS' | 'TERMUX' | 'PIP'): {
    title: string;
    description: string;
    commands: string[];
    scriptText: string;
  } {
    switch (platform) {
      case 'UBUNTU':
        return {
          title: 'Ubuntu / Debian / Raspberry Pi OS Update',
          description: 'Pulls the latest git commits from https://github.com/themantas1994/z-30, updates Python DSP libraries, and rebuilds the Web UI bundle.',
          commands: [
            'cd z-30',
            'git pull origin main',
            'chmod +x install_ubuntu.sh',
            './install_ubuntu.sh',
          ],
          scriptText: `cd z-30 && git pull origin main && ./install_ubuntu.sh`,
        };
      case 'ARCH':
        return {
          title: 'Arch Linux / Manjaro / EndeavourOS Update',
          description: 'Updates pacman dependencies, pulls latest upstream git master, and executes the Arch native automated installer.',
          commands: [
            'cd z-30',
            'git pull origin main',
            'chmod +x install_arch.sh',
            './install_arch.sh',
          ],
          scriptText: `cd z-30 && git pull origin main && ./install_arch.sh`,
        };
      case 'WINDOWS':
        return {
          title: 'Windows 10 / 11 Update',
          description: 'Pulls the latest git commits and executes the automated Windows batch launcher.',
          commands: [
            'cd z-30',
            'git pull origin main',
            'run_windows.bat',
          ],
          scriptText: `git pull origin main && run_windows.bat`,
        };
      case 'TERMUX':
        return {
          title: 'Android Termux Field Radio Update',
          description: 'Fetches latest commits and updates native sounddevice/DSP packages in Termux.',
          commands: [
            'cd z-30',
            'git pull origin main',
            'chmod +x install_android_termux.sh',
            './install_android_termux.sh',
          ],
          scriptText: `cd z-30 && git pull origin main && ./install_android_termux.sh`,
        };
      case 'PIP':
      default:
        return {
          title: 'Universal Python / Git Update',
          description: 'Direct universal git pull and PEP 517/621 package update.',
          commands: [
            'git pull origin main',
            'pip install --upgrade -e .',
            'npm install && npm run build',
          ],
          scriptText: `git pull origin main && pip install --upgrade -e . && npm install && npm run build`,
        };
    }
  }
}

export const updateEngine = new UpdateEngine();

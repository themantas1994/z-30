/**
 * Client for the local z-30 native server's /api endpoints.
 * ========================================================
 *
 * The Python process that serves this bundle (z30_dsp/web_server.py) is what actually reaches
 * the hardware and the filesystem: browser JavaScript can neither write a Linux GPIO pin nor
 * open a raw TCP socket to a rigctld daemon nor put a file in the operator's home directory.
 *
 * Every call here carries the per-run API token that the server injected into the index.html
 * it served. The endpoints drive a real transmitter and hold the operator's logbook; without a
 * credential, any page in any other tab could reach them with a plain `fetch()` to
 * http://127.0.0.1:3000, because loopback is not an authentication boundary. A page from a
 * different origin cannot read this one's globals, so the token never leaves the app.
 *
 * When the UI is opened from a plain `vite dev` server or a static host rather than through
 * the native server, no token is present - `isAvailable()` is false and every call fails
 * cleanly instead of pretending the hardware responded.
 */

export interface LocalApiResult<T = any> {
  /** True only if the server accepted the request and reported success. */
  success: boolean;
  /** Human-readable failure reason, suitable for the rig control log. */
  error?: string;
  /** Parsed response body. */
  data?: T;
  /** HTTP status, when a response was actually received. */
  status?: number;
}

const TOKEN_KEY = '__Z30_API_TOKEN__';

function readToken(): string {
  if (typeof window === 'undefined') return '';
  const token = (window as unknown as Record<string, unknown>)[TOKEN_KEY];
  return typeof token === 'string' ? token : '';
}

/** True when this page was served by the native z-30 server and carries an API token. */
export function isLocalServerAvailable(): boolean {
  return readToken().length > 0;
}

async function call<T = any>(
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number }
): Promise<LocalApiResult<T>> {
  const token = readToken();
  if (!token) {
    return {
      success: false,
      error:
        'The native z-30 server is not backing this page. Start the app with "z30-web" (or "z30") ' +
        'rather than opening the bundle directly, so hardware and file access are available.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 5000);
  try {
    const response = await fetch(path, {
      method: init?.method ?? 'GET',
      headers: {
        'X-Z30-Token': token,
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });

    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || (payload && payload.success === false)) {
      return {
        success: false,
        status: response.status,
        data: payload,
        error: (payload && payload.error) || `Local API request failed with HTTP ${response.status}.`,
      };
    }
    return { success: true, status: response.status, data: payload as T };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: (err as Error)?.name === 'AbortError' ? `Local API request to ${path} timed out.` : message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface ServerStatus {
  system: string;
  version: string;
  protocol: string;
  status: string;
  gpio_ptt_pin: number | null;
  gpio_keepalive_timeout_sec: number;
  gpio_max_keyed_sec: number;
  time_utc: string;
}

export function getServerStatus(): Promise<LocalApiResult<ServerStatus>> {
  return call<ServerStatus>('/api/status');
}

/** Keys or unkeys the server's single configured GPIO PTT pin. */
export function setGpioPin(pin: number, value: boolean): Promise<LocalApiResult> {
  return call('/api/gpio', { method: 'POST', body: { pin, value }, timeoutMs: 2000 });
}

/**
 * Refreshes the server-side dead-man countdown on a keyed GPIO PTT pin. The server drops the
 * line by itself if these stop arriving, so a crashed tab or a sleeping machine cannot leave a
 * transmitter keyed.
 */
export function keepAliveGpioPin(pin: number): Promise<LocalApiResult> {
  return call('/api/gpio/keepalive', { method: 'POST', body: { pin }, timeoutMs: 1500 });
}

export interface RigctlResponse {
  host: string;
  port: number;
  command: string;
  response: string;
}

/**
 * Relays one rigctl command to a local Hamlib rigctld daemon and returns the daemon's actual
 * reply. This is the only path by which the browser can speak to rigctld at all.
 */
export function sendRigctlCommand(
  command: string,
  host = '127.0.0.1',
  port = 4532,
  timeoutSec = 2.0
): Promise<LocalApiResult<RigctlResponse>> {
  return call<RigctlResponse>('/api/rigctl', {
    method: 'POST',
    body: { command, host, port, timeout_sec: timeoutSec },
    timeoutMs: Math.round(timeoutSec * 1000) + 2000,
  });
}

export function readServerLogbook(): Promise<LocalApiResult<{ entries: unknown[]; path: string }>> {
  return call('/api/logbook');
}

export function writeServerLogbook(
  entries: unknown[],
  adif?: string
): Promise<LocalApiResult<{ count: number; path: string; adif_path: string | null }>> {
  return call('/api/logbook', { method: 'POST', body: { entries, adif }, timeoutMs: 8000 });
}

export function readServerStationConfig(): Promise<LocalApiResult<{ config: Record<string, unknown>; path: string }>> {
  return call('/api/station-config');
}

export function writeServerStationConfig(
  config: Record<string, unknown>
): Promise<LocalApiResult<{ path: string }>> {
  return call('/api/station-config', { method: 'POST', body: { config }, timeoutMs: 5000 });
}

// -- upstream synchronisation ------------------------------------------------
//
// z-30 tracks upstream by commit, not by version. The native server is the only party that can
// answer "how many commits behind origin/main is this installation" truthfully - it is the one
// with the git checkout - and the only one that can do anything about it. See git_sync.py.

export interface UpdateStatusResponse {
  is_git_checkout: boolean;
  branch: string;
  local_commit: string;
  upstream_commit: string;
  local_short: string;
  upstream_short: string;
  behind: number;
  ahead: number;
  dirty: boolean;
  up_to_date: boolean;
  can_update: boolean;
  blocked_reason: string | null;
  error: string | null;
  checked_at: string;
  remote_url: string;
  update_running: boolean;
  pending: Array<{
    sha: string;
    short_sha: string;
    subject: string;
    author: string;
    date: string;
  }>;
}

/**
 * Asks the server how far behind upstream this installation is.
 *
 * `fetchRemote` false answers from the last fetch without touching the network - what a badge
 * refresh wants. True runs `git fetch`, which is why the timeout is generous: a fetch over a
 * slow link on a Raspberry Pi is not a hung server.
 */
export function getUpdateStatus(fetchRemote = true): Promise<LocalApiResult<UpdateStatusResponse>> {
  return call<UpdateStatusResponse>(`/api/update/status?fetch=${fetchRemote ? '1' : '0'}`, {
    timeoutMs: fetchRemote ? 60000 : 5000,
  });
}

export interface UpdateProgressResponse {
  running: boolean;
  log: string[];
  elapsed_sec: number;
  result: {
    success: boolean;
    error: string | null;
    from_commit: string;
    to_commit: string;
    web_assets_changed: boolean;
    restart_required: boolean;
    log: string[];
  } | null;
}

/**
 * Starts a fast-forward onto upstream. Returns as soon as the worker thread is running; the
 * caller polls getUpdateProgress() for the log and the outcome.
 *
 * Refused with HTTP 409 while a PTT line is asserted - the server will not swap the code out
 * from under a keyed transmitter.
 */
export function applyUpdate(options: {
  reinstall_python?: boolean;
  rebuild_web?: boolean;
}): Promise<LocalApiResult<{ running: boolean }>> {
  return call('/api/update/apply', { method: 'POST', body: options, timeoutMs: 15000 });
}

export function getUpdateProgress(): Promise<LocalApiResult<UpdateProgressResponse>> {
  return call<UpdateProgressResponse>('/api/update/progress', { timeoutMs: 8000 });
}

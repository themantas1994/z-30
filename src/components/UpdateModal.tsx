/**
 * Upstream Synchronisation Modal
 * Repository: https://github.com/themantas1994/z-30
 *
 * One question, one answer, one button.
 *
 * This modal used to carry four tabs (Overview / Commits / CLI / Settings), a STABLE vs
 * DEVELOPMENT channel selector, and a five-platform tab strip whose entire content was shell
 * commands for the operator to copy into a terminal. None of it updated anything: the primary
 * action, "Reload / Refresh PWA", purged the browser cache and reloaded the same bundle off
 * the same unchanged disk, which looks exactly like an update that did nothing - because it
 * was. The actual update was a paragraph of instructions in another tab.
 *
 * What the operator wants to know is whether this station is running the current code, and
 * what they want to do about it is update. So: how many commits behind `origin/main`, what
 * those commits are, and a button that fast-forwards the checkout and reloads. The shell
 * command survives only as the fallback for an installation the app genuinely cannot update
 * itself - a static-hosted bundle with no native server behind it.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  DownloadCloud,
  X,
  RefreshCw,
  ExternalLink,
  GitCommit,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Terminal,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import {
  updateEngine,
  UpdateCheckResult,
  UpstreamCommit,
  GITHUB_REPO,
  UPSTREAM_BRANCH,
  BUILD_COMMIT,
  BUILD_DATE,
  shortSha,
} from '../dsp/updateEngine';

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Phase = 'IDLE' | 'CHECKING' | 'UPDATING' | 'DONE' | 'FAILED';

export const UpdateModal: React.FC<UpdateModalProps> = ({ isOpen, onClose }) => {
  const [result, setResult] = useState<UpdateCheckResult | null>(() => updateEngine.getCachedResult());
  const [phase, setPhase] = useState<Phase>('IDLE');
  const [log, setLog] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const [copied, setCopied] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const unsub = updateEngine.subscribe(setResult);
    // A modal that opens showing a stale answer is the failure this rewrite is about, so the
    // first open always checks. Subsequent opens reuse the engine's 60 s cache.
    void runCheck(false);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [log]);

  if (!isOpen) return null;

  const runCheck = async (force = true) => {
    setPhase('CHECKING');
    try {
      setResult(await updateEngine.checkForUpdates(force));
    } finally {
      setPhase('IDLE');
    }
  };

  const runUpdate = async () => {
    setPhase('UPDATING');
    setLog([]);
    setFailure(null);
    const outcome = await updateEngine.performUpdate({}, (line) =>
      setLog((prev) => [...prev, line])
    );
    if (outcome.success) {
      setNeedsReload(outcome.webAssetsChanged);
      setRestartRequired(outcome.restartRequired);
      setPhase('DONE');
      void updateEngine.checkForUpdates(true);
    } else {
      setFailure(outcome.error || 'The update did not complete.');
      setPhase('FAILED');
    }
  };

  const copyCommand = () => {
    try {
      navigator.clipboard.writeText(updateEngine.getManualUpdateCommand());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  };

  const behind = result?.behind ?? 0;
  const isBusy = phase === 'CHECKING' || phase === 'UPDATING';
  const localLabel = result?.localCommit ? shortSha(result.localCommit) : shortSha(BUILD_COMMIT);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4 font-mono select-none">
      <div className="bg-[#141414] border border-[#333] w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#0F0F0F] border-b border-[#333]">
          <div className="flex items-center space-x-2.5">
            <div className="w-7 h-7 bg-[#050505] border border-[#00FF41]/40 flex items-center justify-center text-[#00FF41]">
              <DownloadCloud className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold text-[#D4D4D4] uppercase tracking-wider">
                Upstream Synchronisation
              </span>
              <div className="text-[9px] text-[#666] uppercase tracking-wide">
                tracking {GITHUB_REPO.owner}/{GITHUB_REPO.repo} &middot; {UPSTREAM_BRANCH}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={phase === 'UPDATING'}
            title={phase === 'UPDATING' ? 'An update is running.' : 'Close'}
            className="text-[#888] hover:text-[#D4D4D4] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* ---- Status ---- */}
          <div
            className={`border p-3 ${
              behind > 0
                ? 'border-amber-500/40 bg-amber-500/5'
                : 'border-[#00FF41]/30 bg-[#00FF41]/5'
            }`}
          >
            <div className="flex items-start space-x-2.5">
              {behind > 0 ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-[#00FF41] mt-0.5 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-[#D4D4D4]">
                  {behind > 0
                    ? `${behind} commit${behind === 1 ? '' : 's'} behind ${UPSTREAM_BRANCH}`
                    : 'Up to date with upstream'}
                </div>
                <div className="text-[10px] text-[#888] mt-1 flex items-center flex-wrap gap-x-1.5">
                  <span className="text-[#D4D4D4]">{localLabel}</span>
                  {behind > 0 && result?.upstreamCommit && (
                    <>
                      <ArrowRight className="w-3 h-3 inline" />
                      <span className="text-amber-400">{shortSha(result.upstreamCommit)}</span>
                    </>
                  )}
                  {result?.ahead ? <span>&middot; {result.ahead} local commit(s) ahead</span> : null}
                  {result?.dirty ? <span className="text-amber-400">&middot; working tree modified</span> : null}
                </div>
                {/* Say where the numbers came from. A GitHub-API answer compares a build stamp
                    against upstream and cannot see the real checkout, which is a weaker claim
                    than git's and should not look like the same one. */}
                <div className="text-[9px] text-[#5A5A5A] mt-1">
                  {result?.source === 'local-server'
                    ? `via git in the local checkout${result.branch ? ` (on ${result.branch})` : ''}`
                    : `via the GitHub API, against this bundle's build stamp (${shortSha(BUILD_COMMIT)}, built ${BUILD_DATE})`}
                </div>
              </div>
            </div>
          </div>

          {result?.error && (
            <div className="border border-red-500/40 bg-red-500/5 p-2.5 text-[10px] text-red-300">
              {result.error}
            </div>
          )}
          {result && !result.canUpdate && result.blockedReason && behind > 0 && (
            <div className="border border-[#333] bg-[#0A0A0A] p-2.5 text-[10px] text-[#AAA]">
              {result.blockedReason}
            </div>
          )}

          {/* ---- Actions ---- */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => runCheck(true)}
              disabled={isBusy}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#1A1A1A] border border-[#333] text-[10px] uppercase font-bold text-[#D4D4D4] hover:border-[#555] disabled:opacity-40"
            >
              <RefreshCw className={`w-3 h-3 ${phase === 'CHECKING' ? 'animate-spin' : ''}`} />
              <span>Check now</span>
            </button>

            {result?.canApplyInApp && (
              <button
                onClick={runUpdate}
                disabled={isBusy || !result.canUpdate}
                title={
                  result.canUpdate
                    ? `Fast-forward this installation onto ${UPSTREAM_BRANCH}`
                    : result.blockedReason || 'Nothing to update.'
                }
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#00FF41]/10 border border-[#00FF41]/40 text-[10px] uppercase font-bold text-[#00FF41] hover:bg-[#00FF41]/20 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {phase === 'UPDATING' ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <DownloadCloud className="w-3 h-3" />
                )}
                <span>{phase === 'UPDATING' ? 'Updating…' : 'Update now'}</span>
              </button>
            )}

            {phase === 'DONE' && needsReload && (
              <button
                onClick={() => void updateEngine.reloadUpdatedAssets()}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/40 text-[10px] uppercase font-bold text-amber-300 hover:bg-amber-500/20"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Reload the updated interface</span>
              </button>
            )}

            <a
              href={GITHUB_REPO.commitsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#1A1A1A] border border-[#333] text-[10px] uppercase font-bold text-[#888] hover:text-[#D4D4D4] hover:border-[#555]"
            >
              <ExternalLink className="w-3 h-3" />
              <span>History on GitHub</span>
            </a>
          </div>

          {/* ---- Update log ---- */}
          {(phase === 'UPDATING' || phase === 'DONE' || phase === 'FAILED') && (
            <div className="border border-[#333] bg-[#080808]">
              <div className="px-2.5 py-1.5 border-b border-[#333] text-[9px] uppercase text-[#888] font-bold">
                Update log
              </div>
              <div className="p-2.5 max-h-40 overflow-y-auto text-[10px] leading-relaxed text-[#AAA] space-y-0.5">
                {log.length === 0 && <div className="text-[#666]">Starting…</div>}
                {log.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
                <div ref={logEndRef} />
              </div>
              {failure && (
                <div className="px-2.5 py-2 border-t border-red-500/30 text-[10px] text-red-300">
                  {failure}
                </div>
              )}
              {phase === 'DONE' && (
                <div className="px-2.5 py-2 border-t border-[#00FF41]/30 text-[10px] text-[#00FF41] space-y-1">
                  <div>Update applied.</div>
                  {needsReload && <div className="text-amber-300">Reload to run the new interface.</div>}
                  {restartRequired && (
                    <div className="text-amber-300">
                      The Python package changed. Restart z-30 so the server runs the new code.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ---- Pending commits ---- */}
          {behind > 0 && result && result.pending.length > 0 && (
            <div>
              <div className="text-[9px] uppercase text-[#888] font-bold mb-1.5">
                What you are missing
              </div>
              <div className="border border-[#333] divide-y divide-[#222]">
                {result.pending.map((commit: UpstreamCommit) => (
                  <a
                    key={commit.sha}
                    href={commit.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start space-x-2 px-2.5 py-2 bg-[#0A0A0A] hover:bg-[#111] group"
                  >
                    <GitCommit className="w-3 h-3 text-[#00FF41]/60 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-[#D4D4D4] group-hover:text-white break-words">
                        {commit.subject}
                      </div>
                      <div className="text-[9px] text-[#666] mt-0.5">
                        {commit.shortSha} &middot; {commit.author}
                        {commit.date ? ` · ${commit.date.slice(0, 10)}` : ''}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* ---- Fallback for installations the app cannot update itself ---- */}
          {!result?.canApplyInApp && (
            <div>
              <div className="text-[9px] uppercase text-[#888] font-bold mb-1.5 flex items-center space-x-1.5">
                <Terminal className="w-3 h-3" />
                <span>Update from a terminal</span>
              </div>
              <div className="flex items-stretch border border-[#333]">
                <code className="flex-1 px-2.5 py-2 bg-[#080808] text-[10px] text-[#00FF41] overflow-x-auto whitespace-nowrap">
                  {updateEngine.getManualUpdateCommand()}
                </code>
                <button
                  onClick={copyCommand}
                  title="Copy"
                  className="px-2.5 bg-[#1A1A1A] border-l border-[#333] text-[#888] hover:text-[#D4D4D4]"
                >
                  {copied ? <Check className="w-3 h-3 text-[#00FF41]" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
              <p className="text-[9px] text-[#666] mt-1.5 leading-relaxed">
                Run it in the z-30 checkout, then restart the app. Installations made with pip
                or a distribution package update through that package manager instead; see
                wiki/09 for the per-platform installers.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

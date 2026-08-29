/**
 * GitHub Upstream Update & Version Synchronizer Modal
 * Repository: https://github.com/themantas1994/z-30
 */

import React, { useState, useEffect } from 'react';
import {
  DownloadCloud,
  X,
  RefreshCw,
  ExternalLink,
  GitBranch,
  GitCommit,
  CheckCircle2,
  AlertTriangle,
  Terminal,
  Copy,
  Check,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Clock,
  Layers,
  Code2,
  Package,
  HardDrive,
  RotateCcw,
} from 'lucide-react';
import {
  updateEngine,
  UpdateCheckResult,
  GITHUB_REPO,
  CURRENT_APP_VERSION,
  CURRENT_BUILD_DATE,
  CURRENT_COMMIT_SHA,
} from '../dsp/updateEngine';

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'COMMITS' | 'CLI' | 'SETTINGS'>('OVERVIEW');
  const [channel, setChannel] = useState<'STABLE' | 'DEVELOPMENT'>('STABLE');
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(() => updateEngine.getCachedResult());
  const [selectedPlatform, setSelectedPlatform] = useState<'UBUNTU' | 'ARCH' | 'WINDOWS' | 'TERMUX' | 'PIP'>('UBUNTU');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isUpdatingWeb, setIsUpdatingWeb] = useState<boolean>(false);
  const [autoCheckOnStartup, setAutoCheckOnStartup] = useState<boolean>(() => {
    try {
      return localStorage.getItem('z30_auto_check_updates') !== 'false';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (isOpen) {
      // Subscribe to updater updates
      const unsub = updateEngine.subscribe((res) => {
        setUpdateResult(res);
      });

      // If never checked before, perform a check automatically
      if (!updateResult) {
        handleCheck(false);
      }
      return unsub;
    }
  }, [isOpen, channel]);

  if (!isOpen) return null;

  const handleCheck = async (force = true) => {
    setIsChecking(true);
    try {
      const res = await updateEngine.checkForUpdates(channel, force);
      setUpdateResult(res);
    } catch (e) {
      console.warn('Update check failed:', e);
    } finally {
      setIsChecking(false);
    }
  };

  const handleApplyWebUpdate = async () => {
    setIsUpdatingWeb(true);
    await updateEngine.performWebPwaUpdate();
  };

  const copyToClipboard = (text: string, key: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  };

  const platformInstructions = updateEngine.getPlatformUpdateInstructions(selectedPlatform);

  const hasUpdate = updateResult?.hasUpdate;
  const isUpToDate = updateResult && !updateResult.hasUpdate && !updateResult.error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4 font-mono select-none">
      <div className="bg-[#141414] border border-[#333] w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden rounded-none">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#0F0F0F] border-b border-[#333]">
          <div className="flex items-center space-x-2.5">
            <div className="w-7 h-7 bg-[#050505] border border-[#00FF41]/40 flex items-center justify-center text-[#00FF41] shadow-[0_0_8px_rgba(0,255,65,0.2)]">
              <DownloadCloud className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-[#D4D4D4] uppercase tracking-wider">
                  Software Update & Upstream Sync
                </span>
                <span className="text-[9px] uppercase px-1.5 py-0.5 bg-[#00FF41]/10 text-[#00FF41] border border-[#00FF41]/30 font-bold">
                  v{CURRENT_APP_VERSION}
                </span>
              </div>
              <a
                href={GITHUB_REPO.url}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center space-x-1 mt-0.5 transition-colors"
              >
                <span>github.com/{GITHUB_REPO.owner}/{GITHUB_REPO.repo}</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleCheck(true)}
              disabled={isChecking}
              className="px-2.5 py-1 bg-[#1A1A1A] hover:bg-[#262626] text-[#00FF41] border border-[#00FF41]/40 text-[10px] font-bold uppercase flex items-center space-x-1.5 transition-colors disabled:opacity-50"
              title="Check GitHub for newer releases or commits"
            >
              <RefreshCw className={`w-3 h-3 ${isChecking ? 'animate-spin' : ''}`} />
              <span>{isChecking ? 'Checking...' : 'Check Now'}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 bg-[#1A1A1A] hover:bg-[#262626] text-[#888] hover:text-[#D4D4D4] border border-[#333] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#262626] bg-[#0A0A0A] px-3 pt-2 gap-1 text-[11px] font-bold overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('OVERVIEW')}
            className={`px-3 py-1.5 border-t border-x flex items-center space-x-1.5 uppercase whitespace-nowrap ${
              activeTab === 'OVERVIEW'
                ? 'bg-[#141414] border-[#00FF41] text-[#00FF41]'
                : 'bg-[#0D0D0D] border-transparent text-[#888] hover:text-[#CCC]'
            }`}
          >
            <DownloadCloud className="w-3.5 h-3.5" />
            <span>Version Status</span>
            {hasUpdate && (
              <span className="w-2 h-2 rounded-full bg-[#00FF41] animate-pulse" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('COMMITS')}
            className={`px-3 py-1.5 border-t border-x flex items-center space-x-1.5 uppercase whitespace-nowrap ${
              activeTab === 'COMMITS'
                ? 'bg-[#141414] border-[#00FF41] text-[#00FF41]'
                : 'bg-[#0D0D0D] border-transparent text-[#888] hover:text-[#CCC]'
            }`}
          >
            <GitCommit className="w-3.5 h-3.5" />
            <span>GitHub Commits</span>
            {updateResult?.recentCommits?.length ? (
              <span className="text-[9px] px-1 py-0.2 bg-[#222] text-zinc-300">
                {updateResult.recentCommits.length}
              </span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('CLI')}
            className={`px-3 py-1.5 border-t border-x flex items-center space-x-1.5 uppercase whitespace-nowrap ${
              activeTab === 'CLI'
                ? 'bg-[#141414] border-[#00FF41] text-[#00FF41]'
                : 'bg-[#0D0D0D] border-transparent text-[#888] hover:text-[#CCC]'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>CLI / Native Update</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('SETTINGS')}
            className={`px-3 py-1.5 border-t border-x flex items-center space-x-1.5 uppercase whitespace-nowrap ${
              activeTab === 'SETTINGS'
                ? 'bg-[#141414] border-[#00FF41] text-[#00FF41]'
                : 'bg-[#0D0D0D] border-transparent text-[#888] hover:text-[#CCC]'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Preferences</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 flex-1 overflow-y-auto text-xs bg-[#0F0F0F] space-y-4">
          {/* TAB 1: OVERVIEW & STATUS */}
          {activeTab === 'OVERVIEW' && (
            <div className="space-y-4">
              {/* Channel Selector */}
              <div className="flex items-center justify-between bg-[#050505] p-2.5 border border-[#333]">
                <div className="flex items-center space-x-2">
                  <GitBranch className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[10px] text-[#888] uppercase">Release Channel:</span>
                </div>
                <div className="flex space-x-1">
                  <button
                    type="button"
                    onClick={() => {
                      setChannel('STABLE');
                      updateEngine.checkForUpdates('STABLE', true);
                    }}
                    className={`px-2.5 py-1 text-[10px] font-bold uppercase transition-all ${
                      channel === 'STABLE'
                        ? 'bg-[#00FF41] text-black shadow-[0_0_8px_rgba(0,255,65,0.4)]'
                        : 'bg-[#141414] text-[#888] hover:text-[#D4D4D4] border border-[#333]'
                    }`}
                  >
                    Stable Releases
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setChannel('DEVELOPMENT');
                      updateEngine.checkForUpdates('DEVELOPMENT', true);
                    }}
                    className={`px-2.5 py-1 text-[10px] font-bold uppercase transition-all ${
                      channel === 'DEVELOPMENT'
                        ? 'bg-purple-600 text-white shadow-[0_0_8px_rgba(168,85,247,0.4)]'
                        : 'bg-[#141414] text-[#888] hover:text-[#D4D4D4] border border-[#333]'
                    }`}
                  >
                    Main Branch (Nightly)
                  </button>
                </div>
              </div>

              {/* Version Comparison Card */}
              <div
                className={`p-4 border ${
                  hasUpdate
                    ? 'bg-[#0a1a0e] border-[#00FF41]/60 shadow-[0_0_15px_rgba(0,255,65,0.15)]'
                    : isUpToDate
                    ? 'bg-[#080f0a] border-[#1b3d22]'
                    : 'bg-[#0A0A0A] border-[#333]'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      {hasUpdate ? (
                        <Sparkles className="w-5 h-5 text-[#00FF41] animate-bounce" />
                      ) : isUpToDate ? (
                        <CheckCircle2 className="w-5 h-5 text-[#00FF41]" />
                      ) : (
                        <Clock className="w-5 h-5 text-yellow-400" />
                      )}
                      <span className="text-sm font-bold uppercase tracking-wider text-white">
                        {hasUpdate
                          ? 'New Version Available!'
                          : isUpToDate
                          ? 'z-30 Suite is Up to Date'
                          : 'Checking Upstream Repository...'}
                      </span>
                    </div>

                    <div className="text-[11px] text-zinc-400 flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                      <span>
                        Installed: <strong className="text-white">v{CURRENT_APP_VERSION}</strong> (Build {CURRENT_BUILD_DATE})
                      </span>
                      <span>•</span>
                      <span>
                        Latest on GitHub:{' '}
                        <strong className={hasUpdate ? 'text-[#00FF41]' : 'text-cyan-400'}>
                          v{updateResult?.latestVersion || CURRENT_APP_VERSION}
                        </strong>
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={handleApplyWebUpdate}
                      disabled={isUpdatingWeb}
                      className="px-3 py-1.5 bg-[#00FF41] hover:bg-[#00FF41]/90 text-black font-bold uppercase text-[11px] flex items-center space-x-1.5 shadow-[0_0_10px_rgba(0,255,65,0.4)] transition-all disabled:opacity-50"
                      title="Clear Web App caches and reload with latest compiled bundle"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${isUpdatingWeb ? 'animate-spin' : ''}`} />
                      <span>{isUpdatingWeb ? 'Reloading...' : 'Reload / Refresh PWA'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Release Notes / Body */}
              {updateResult?.release && (
                <div className="bg-[#050505] p-3.5 border border-[#333] space-y-2">
                  <div className="flex items-center justify-between border-b border-[#222] pb-2">
                    <div className="flex items-center space-x-2">
                      <Package className="w-4 h-4 text-yellow-400" />
                      <span className="font-bold text-[#D4D4D4] uppercase text-[11px]">
                        Release: {updateResult.release.name}
                      </span>
                    </div>
                    <span className="text-[9px] text-[#777]">
                      {new Date(updateResult.release.published_at).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="text-[10px] text-zinc-300 bg-[#0A0A0A] p-2.5 border border-[#222] max-h-36 overflow-y-auto whitespace-pre-wrap font-sans leading-relaxed">
                    {updateResult.release.body}
                  </div>

                  {/* Release Assets if available */}
                  {updateResult.release.assets?.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[9px] uppercase text-[#777] block">Official Release Assets:</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {updateResult.release.assets.map((asset, i) => (
                          <a
                            key={i}
                            href={asset.browser_download_url}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 bg-[#141414] hover:bg-[#1f1f1f] border border-[#333] flex items-center justify-between text-[10px] text-cyan-400 transition-colors"
                          >
                            <span className="truncate pr-2 font-mono">{asset.name}</span>
                            <span className="text-[8px] text-[#777] flex-shrink-0">
                              {(asset.size / (1024 * 1024)).toFixed(1)} MB
                            </span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Error or Rate Limit notice */}
              {updateResult?.error && (
                <div className="p-2.5 bg-yellow-950/40 border border-yellow-700/60 text-yellow-300 text-[10px] flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong>GitHub Connection Note:</strong> {updateResult.error}. You can still pull the latest changes directly using Git or view releases in your browser.
                  </div>
                </div>
              )}

              {/* Direct Links */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center text-[10px]">
                <a
                  href={GITHUB_REPO.releasesUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 bg-[#141414] hover:bg-[#1f1f1f] text-cyan-400 border border-[#333] flex items-center justify-center space-x-1.5 transition-colors"
                >
                  <Package className="w-3.5 h-3.5" />
                  <span>GitHub Releases</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>

                <a
                  href={GITHUB_REPO.commitsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 bg-[#141414] hover:bg-[#1f1f1f] text-purple-400 border border-[#333] flex items-center justify-center space-x-1.5 transition-colors"
                >
                  <GitCommit className="w-3.5 h-3.5" />
                  <span>Commit Log</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>

                <a
                  href={GITHUB_REPO.url}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 bg-[#141414] hover:bg-[#1f1f1f] text-[#00FF41] border border-[#333] flex items-center justify-center space-x-1.5 transition-colors"
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>Source Code</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
          )}

          {/* TAB 2: RECENT COMMITS STREAM */}
          {activeTab === 'COMMITS' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-[#D4D4D4] uppercase flex items-center space-x-1.5">
                  <GitCommit className="w-3.5 h-3.5 text-purple-400" />
                  <span>Latest Commits on Main Branch ({GITHUB_REPO.owner}/{GITHUB_REPO.repo})</span>
                </span>
                <a
                  href={GITHUB_REPO.commitsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center space-x-1"
                >
                  <span>View All on GitHub</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>

              {updateResult?.recentCommits && updateResult.recentCommits.length > 0 ? (
                <div className="space-y-2">
                  {updateResult.recentCommits.map((commit, idx) => (
                    <div
                      key={commit.sha || idx}
                      className="bg-[#050505] p-2.5 border border-[#222] hover:border-[#444] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center space-x-2">
                          <span className="px-1.5 py-0.2 bg-[#141414] border border-[#333] text-purple-400 font-mono text-[9px] font-bold">
                            {commit.shortSha}
                          </span>
                          <span className="text-zinc-200 font-medium text-[11px] truncate">
                            {commit.message}
                          </span>
                        </div>
                        <div className="text-[9px] text-[#777] flex items-center space-x-2 pl-0.5">
                          <span>By: <strong className="text-zinc-300">{commit.authorName}</strong></span>
                          <span>•</span>
                          <span>{new Date(commit.authorDate).toLocaleDateString()}</span>
                        </div>
                      </div>

                      <a
                        href={commit.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2 py-1 bg-[#141414] hover:bg-[#222] text-cyan-400 text-[9px] border border-[#333] flex items-center space-x-1 flex-shrink-0 self-start sm:self-center"
                      >
                        <span>Inspect</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center bg-[#050505] border border-[#222] text-[#777]">
                  <GitCommit className="w-8 h-8 mx-auto mb-2 text-[#444]" />
                  <p>Click "Check Now" above to load recent commits from https://github.com/{GITHUB_REPO.owner}/{GITHUB_REPO.repo}</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: CLI / NATIVE UPDATE SCRIPT GENERATOR */}
          {activeTab === 'CLI' && (
            <div className="space-y-3.5">
              <div>
                <span className="text-[11px] font-bold text-[#D4D4D4] uppercase block mb-1">
                  Terminal & Native Update Commands
                </span>
                <p className="text-[10px] text-zinc-400 leading-relaxed">
                  Select your operating system to generate the exact terminal update script to synchronize your local station directly with <span className="text-cyan-400">https://github.com/{GITHUB_REPO.owner}/{GITHUB_REPO.repo}</span>.
                </p>
              </div>

              {/* Platform Selector Buttons */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                {[
                  { id: 'UBUNTU', label: 'Ubuntu / Debian' },
                  { id: 'ARCH', label: 'Arch / Manjaro' },
                  { id: 'WINDOWS', label: 'Windows 10/11' },
                  { id: 'TERMUX', label: 'Android Termux' },
                  { id: 'PIP', label: 'Python / Pip' },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPlatform(p.id as any)}
                    className={`py-1.5 px-2 text-[10px] font-bold uppercase transition-colors border text-center ${
                      selectedPlatform === p.id
                        ? 'bg-[#00FF41]/20 border-[#00FF41] text-[#00FF41]'
                        : 'bg-[#0A0A0A] border-[#333] text-[#888] hover:text-[#CCC]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Code Box */}
              <div className="bg-[#050505] p-3 border border-[#333] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-yellow-400 font-bold text-[10px] uppercase">
                    <Terminal className="w-3.5 h-3.5" />
                    <span>{platformInstructions.title}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => copyToClipboard(platformInstructions.scriptText, 'script')}
                    className="px-2 py-0.5 bg-[#141414] hover:bg-[#222] text-[#00FF41] border border-[#00FF41]/40 text-[9px] font-bold uppercase flex items-center space-x-1"
                  >
                    {copiedKey === 'script' ? (
                      <>
                        <Check className="w-3 h-3 text-[#00FF41]" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy One-Liner</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="text-[10px] text-zinc-400">
                  {platformInstructions.description}
                </div>

                <div className="bg-[#000] p-2.5 border border-[#222] text-[#00FF41] font-mono text-[10px] space-y-1 overflow-x-auto">
                  {platformInstructions.commands.map((cmd, i) => (
                    <div key={i} className="flex items-center space-x-2">
                      <span className="text-[#555] select-none">$</span>
                      <span className="text-[#D4D4D4] select-all">{cmd}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Native CLI Command Note */}
              <div className="p-2.5 bg-[#080808] border border-[#222] text-[10px] space-y-1">
                <div className="font-bold text-cyan-400 uppercase flex items-center space-x-1">
                  <Code2 className="w-3.5 h-3.5" />
                  <span>Built-in Native Python Updater Tool</span>
                </div>
                <p className="text-zinc-400">
                  You can also run the built-in updater at any time from your system shell:
                </p>
                <div className="bg-[#000] p-1.5 border border-[#333] text-[#00FF41] font-mono flex items-center justify-between">
                  <span>z30 --update</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard('z30 --update', 'cli-cmd')}
                    className="text-[9px] text-zinc-400 hover:text-white"
                  >
                    {copiedKey === 'cli-cmd' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: PREFERENCES & AUTO-CHECK */}
          {activeTab === 'SETTINGS' && (
            <div className="space-y-3">
              <div className="bg-[#050505] p-3 border border-[#333] space-y-3">
                <span className="font-bold text-[#D4D4D4] uppercase text-[11px] block">
                  Update Automation Preferences
                </span>

                <div className="space-y-2">
                  <label className="flex items-center space-x-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoCheckOnStartup}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setAutoCheckOnStartup(val);
                        try {
                          localStorage.setItem('z30_auto_check_updates', String(val));
                        } catch {
                          // ignore
                        }
                      }}
                      className="accent-[#00FF41] w-4 h-4"
                    />
                    <span className="text-[11px] text-zinc-200">
                      Check for updates automatically in the background on startup
                    </span>
                  </label>
                  <p className="text-[9px] text-[#777] pl-6">
                    Connects to GitHub API once on startup. If a newer release is published, a glowing notification badge will illuminate on the top navigation bar.
                  </p>
                </div>

                <div className="pt-2 border-t border-[#222] flex items-center justify-between text-[10px] text-[#888]">
                  <span>Current Build Commit: <strong className="text-purple-400">{CURRENT_COMMIT_SHA}</strong></span>
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.removeItem('z30_update_cache');
                      handleCheck(true);
                    }}
                    className="text-cyan-400 hover:underline"
                  >
                    Clear Update Cache & Re-check
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#0A0A0A] border-t border-[#333] text-[10px]">
          <span className="text-[#666]">
            z-30 Suite • Upstream: <span className="text-zinc-300">https://github.com/themantas1994/z-30</span>
          </span>

          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 bg-[#1A1A1A] hover:bg-[#282828] text-white border border-[#444] text-[10px] font-bold uppercase transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

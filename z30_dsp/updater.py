#!/usr/bin/env python3
"""
z-30 Transceiver & DSP Suite - GitHub Upstream Updater
======================================================
Repository: https://github.com/themantas1994/z-30

Checks for updates, pulls latest git commits, rebuilds Web UI assets,
and updates native Python DSP dependencies.
"""

import os
import sys
import json
import urllib.request
import urllib.error
import subprocess
import shutil
from typing import Dict, Any, Optional

GITHUB_REPO = "themantas1994/z-30"
API_URL = f"https://api.github.com/repos/{GITHUB_REPO}"
RAW_URL = f"https://raw.githubusercontent.com/{GITHUB_REPO}/main"
CURRENT_VERSION = "1.0.0"


def print_banner():
    print("==================================================================")
    print("      z-30 TRANSCEIVER - GITHUB UPSTREAM UPDATER ENGINE           ")
    print("      Repository: https://github.com/themantas1994/z-30           ")
    print("==================================================================")


def check_remote_version() -> Dict[str, Any]:
    """Fetches latest release and commits from GitHub."""
    headers = {"User-Agent": "z30-Updater/1.0", "Accept": "application/vnd.github.v3+json"}
    result: Dict[str, Any] = {
        "current_version": CURRENT_VERSION,
        "latest_version": CURRENT_VERSION,
        "has_update": False,
        "release_name": "",
        "release_body": "",
        "latest_commit": "",
        "commit_message": "",
        "html_url": f"https://github.com/{GITHUB_REPO}",
    }

    # 1. Query latest release
    try:
        req = urllib.request.Request(f"{API_URL}/releases/latest", headers=headers)
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode("utf-8"))
            tag = data.get("tag_name", "").lstrip("v")
            result["latest_version"] = tag
            result["release_name"] = data.get("name", tag)
            result["release_body"] = data.get("body", "")
            result["html_url"] = data.get("html_url", result["html_url"])
            if tag and tag != CURRENT_VERSION:
                result["has_update"] = True
    except Exception as e:
        # Fallback to checking raw package.json
        try:
            req = urllib.request.Request(f"{RAW_URL}/package.json", headers=headers)
            with urllib.request.urlopen(req, timeout=5) as response:
                data = json.loads(response.read().decode("utf-8"))
                remote_v = data.get("version", CURRENT_VERSION)
                result["latest_version"] = remote_v
                if remote_v != CURRENT_VERSION:
                    result["has_update"] = True
        except Exception:
            pass

    # 2. Query latest commit
    try:
        req = urllib.request.Request(f"{API_URL}/commits?per_page=1", headers=headers)
        with urllib.request.urlopen(req, timeout=5) as response:
            commits = json.loads(response.read().decode("utf-8"))
            if commits and isinstance(commits, list):
                c = commits[0]
                result["latest_commit"] = c.get("sha", "")[:7]
                result["commit_message"] = c.get("commit", {}).get("message", "").split("\n")[0]
    except Exception:
        pass

    return result


def is_git_repo(path: str = ".") -> bool:
    """Checks if directory is a git repository."""
    return os.path.exists(os.path.join(path, ".git"))


def perform_git_update(repo_dir: str = ".") -> bool:
    """Executes git pull and updates local dependencies."""
    print(f"\n[Updater] Fetching latest changes from git origin (https://github.com/{GITHUB_REPO})...")
    try:
        subprocess.run(["git", "fetch", "--all"], cwd=repo_dir, check=True)
        subprocess.run(["git", "pull", "origin", "main"], cwd=repo_dir, check=True)
        print("[Updater] ✓ Git repository successfully updated to latest commit.")
    except Exception as e:
        print(f"[Updater] ✗ Git pull failed: {e}")
        return False

    # Check for npm and rebuild web UI if available
    pkg_json = os.path.join(repo_dir, "package.json")
    if os.path.exists(pkg_json) and shutil.which("npm"):
        print("[Updater] Rebuilding Web DSP distribution bundle (npm run build)...")
        try:
            subprocess.run(["npm", "run", "build"], cwd=repo_dir, check=True)
            print("[Updater] ✓ Web UI distribution built successfully.")
        except Exception as e:
            print(f"[Updater] ⚠ Web build warning: {e}")

    # Update Python editable package
    if shutil.which("pip"):
        print("[Updater] Refreshing Python package installation (pip install -e .)...")
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", "-e", "."], cwd=repo_dir, check=True)
            print("[Updater] ✓ Python DSP suite refreshed.")
        except Exception as e:
            print(f"[Updater] ⚠ Pip install notice: {e}")

    print("\n[Updater] ✓ Update process complete! You can now run 'z30' to start the latest version.")
    return True


def run_updater(interactive: bool = True):
    print_banner()
    print(f"Current Installed Version: v{CURRENT_VERSION}")
    print(f"Checking https://github.com/{GITHUB_REPO} for updates...\n")

    info = check_remote_version()

    print(f"Latest Upstream Version:  v{info['latest_version']}")
    if info.get("latest_commit"):
        print(f"Latest GitHub Commit:     {info['latest_commit']} ({info.get('commit_message', '')})")

    if info["has_update"]:
        print(f"\n★ A NEW UPDATE IS AVAILABLE: v{info['latest_version']} (Current: v{CURRENT_VERSION})")
        if info.get("release_name"):
            print(f"Release: {info['release_name']}")
        if info.get("release_body"):
            print(f"\nRelease Notes:\n{info['release_body']}\n")
    else:
        print("\n✓ Your z-30 Transceiver is up to date!")

    # If in git repo, offer automatic pull
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    if is_git_repo(root_dir):
        if interactive and info["has_update"]:
            ans = input("\nWould you like to pull and apply the update now? [Y/n]: ").strip().lower()
            if ans in ("", "y", "yes"):
                perform_git_update(root_dir)
        elif not interactive:
            perform_git_update(root_dir)
    else:
        print("\nTo update manually from GitHub:")
        print(f"  git clone https://github.com/{GITHUB_REPO}.git")
        print("  cd z-30 && ./install_ubuntu.sh (or install_arch.sh / run_windows.bat)")


def main():
    interactive = "--yes" not in sys.argv and "-y" not in sys.argv
    run_updater(interactive=interactive)


if __name__ == "__main__":
    main()

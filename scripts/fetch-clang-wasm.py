#!/usr/bin/env python3
"""Download clang.js / clang.wasm built by the clang-wasm GitHub Actions release."""

from __future__ import annotations

import json
import os
import ssl
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "public" / "assets" / "clang"
DEFAULT_REPO = "PartyPlanner64/partyplanner64"
RELEASE_TAG = "clang-wasm"


def repo_slug() -> str:
    return os.environ.get("GITHUB_REPOSITORY") or DEFAULT_REPO


def download(url: str, dest: Path, token: str | None) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/octet-stream",
            "User-Agent": "partyplanner64-fetch-clang-wasm",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
    )
    context = ssl.create_default_context()
    with urllib.request.urlopen(request, context=context) as response:
        dest.write_bytes(response.read())
    print(f"Wrote {dest} ({dest.stat().st_size} bytes)")


def main() -> None:
    allow_missing = "--allow-missing" in sys.argv
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    api_url = (
        f"https://api.github.com/repos/{repo_slug()}/releases/tags/{RELEASE_TAG}"
    )
    request = urllib.request.Request(
        api_url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "partyplanner64-fetch-clang-wasm",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
    )
    try:
        with urllib.request.urlopen(request) as response:
            release = json.load(response)
    except Exception as exc:
        message = (
            f"Could not read GitHub release '{RELEASE_TAG}' from {repo_slug()}: {exc}"
        )
        if allow_missing:
            print(message)
            print("Skipping Clang WASM download.")
            return
        raise SystemExit(message) from exc

    wanted = {"clang.js", "clang.wasm"}
    assets = {
        asset["name"]: asset
        for asset in release.get("assets", [])
        if asset.get("name") in wanted
    }
    missing = wanted - set(assets)
    if missing:
        message = (
            f"Release '{RELEASE_TAG}' is missing {sorted(missing)}. "
            "Run the build-clang-wasm GitHub Actions workflow."
        )
        if allow_missing:
            print(message)
            print("Skipping Clang WASM download.")
            return
        raise SystemExit(message)

    for name, asset in assets.items():
        download(asset["url"], OUTPUT_DIR / name, token)
    print("Fetched N64Recomp Clang WASM assets.")


if __name__ == "__main__":
    sys.exit(main())

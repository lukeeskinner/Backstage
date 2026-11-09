"""Fetch the pinned site-builder agent and install its dependencies in a shared volume.

Extracts only services/agent-workers/ and contracts/pivot/ from the pinned archive, then
installs services/agent-workers/requirements.txt into /runtime/python. Modeled on
deploy/incident/bootstrap.py.
"""
import io
import os
import re
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path, PurePosixPath

KEEP = ("services/agent-workers/", "contracts/pivot/")


def extract_runtime(data, target):
    count = 0
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for member in archive.getmembers():
            parts = PurePosixPath(member.name).parts[1:]
            if not member.isfile() or not parts or ".." in parts:
                continue
            relative = PurePosixPath(*parts)
            if not str(relative).startswith(KEEP):
                continue
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.extractfile(member).read())
            count += 1
    if not (target / "services/agent-workers/agent_workers/__main__.py").is_file():
        raise RuntimeError("Pinned archive is missing services/agent-workers/agent_workers/__main__.py")
    return count


def main():
    sha = os.environ["CODE_SHA"]
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise RuntimeError("CODE_SHA must be a full commit SHA")
    repo = os.environ.get("CODE_REPO", "lukeeskinner/Backstage")
    target = Path("/runtime/repo")
    with urllib.request.urlopen(f"https://codeload.github.com/{repo}/tar.gz/{sha}", timeout=60) as response:
        count = extract_runtime(response.read(), target)
    subprocess.run([
        sys.executable, "-m", "pip", "install", "--no-cache-dir", "--disable-pip-version-check",
        "--target", "/runtime/python", "-r", str(target / "services/agent-workers/requirements.txt"),
    ], check=True)
    print(f"Prepared {count} agent runtime files at {repo}@{sha}")


if __name__ == "__main__":
    main()

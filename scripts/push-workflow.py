#!/usr/bin/env python3
"""Pousse .github/workflows/precompute.yml dans le dépôt VOLTRIX.
Lit le fichier local download/precompute.yml, l'encode en base64 et
crée le commit via l'API Contents. Idempotent : met à jour si présent."""
import base64
import json
import os
import sys
import urllib.request
import urllib.error

TOKEN = os.environ["GH_TOKEN"]
REPO = "alamkevine226ascii-png/VOLTRIX-bet-"
LOCAL = "/home/z/my-project/download/precompute.yml"
REMOTE = ".github/workflows/precompute.yml"


def api(method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/{path}",
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "voltrix-setup",
        },
        data=json.dumps(body).encode() if body else None,
    )
    with urllib.request.urlopen(req) as r:
        text = r.read().decode()
        return r.status, json.loads(text) if text else {}


with open(LOCAL, "rb") as f:
    content = base64.b64encode(f.read()).decode()

# SHA existant (pour mise à jour) — 404 = création
try:
    status, cur = api("GET", f"contents/{REMOTE}?ref=main")
    sha = cur.get("sha")
except urllib.error.HTTPError as e:
    if e.code == 404:
        sha = None
    else:
        raise

status, res = api(
    "PUT",
    f"contents/{REMOTE}",
    {
        "message": "Ajout workflow Pré-calcul VOLTRIX (4 passages/jour, football + MMA -> Neon)",
        "content": content,
        "branch": "main",
        **({"sha": sha} if sha else {}),
    },
)
commit = res.get("commit", {})
print(f"HTTP {status} — commit {commit.get('sha', '?')[:10]}")
print(f"Fichier : {res.get('content', {}).get('html_url', REMOTE)}")

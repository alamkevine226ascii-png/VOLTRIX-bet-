#!/usr/bin/env python3
"""Diagnostic du PAT GitHub — VOLTRIX. N'affiche jamais le jeton."""
import json
import os
import urllib.request
import urllib.error

TOKEN = os.environ["GH_TOKEN"]
REPO = "alamkevine226ascii-png/VOLTRIX-bet-"


def call(path: str):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "voltrix-diag",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, dict(r.headers), json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:500]
        return e.code, dict(e.headers), body


for path in ["/user", f"/repos/{REPO}", f"/repos/{REPO}/actions/permissions"]:
    status, headers, body = call(path)
    limit = headers.get("x-ratelimit-remaining", "?")
    if isinstance(body, dict):
        info = {k: body.get(k) for k in ("login", "message", "full_name", "private", "permissions") if k in body}
        info = json.dumps(info, ensure_ascii=False)[:300]
    else:
        info = body[:300]
    print(f"{path} -> HTTP {status} | rate-remaining={limit} | {info}")

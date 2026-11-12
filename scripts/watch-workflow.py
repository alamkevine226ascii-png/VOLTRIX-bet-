#!/usr/bin/env python3
"""Surveille le dernier run du workflow Pré-calcul VOLTRIX jusqu'à fin.
Affiche les étapes au fur et à mesure. Timeout 40 minutes."""
import json
import os
import sys
import time
import urllib.request
import urllib.error

TOKEN = os.environ["GH_TOKEN"]
REPO = "alamkevine226ascii-png/VOLTRIX-bet-"
TIMEOUT_S = int(os.environ.get("WATCH_TIMEOUT", "2400"))


def get(path):
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/{path}",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "voltrix-watch",
        },
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"{}")


t0 = time.time()
run = None
# Attente de l'apparition du run (dispatch → création : quelques secondes)
while time.time() - t0 < 60:
    runs = get("actions/workflows/precompute.yml/runs?per_page=1")
    if runs.get("workflow_runs"):
        run = runs["workflow_runs"][0]
        break
    time.sleep(5)
if not run:
    print("ERREUR : run introuvable après 60 s")
    sys.exit(1)

run_id = run["id"]
print(f"Run #{run_id} détecté — statut initial : {run['status']}")
print(f"URL : {run['html_url']}")
print("=" * 60)

seen_steps = set()
last_status = None
while time.time() - t0 < TIMEOUT_S:
    try:
        run = get(f"actions/runs/{run_id}")
    except Exception as e:
        time.sleep(10)
        continue
    status, conclusion = run["status"], run.get("conclusion")
    if status != last_status:
        print(f"[{int(time.time()-t0)}s] Statut : {status} {('/ ' + conclusion) if conclusion else ''}")
        last_status = status
    # Étapes du job
    try:
        jobs = get(f"actions/runs/{run_id}/jobs")
        for job in jobs.get("jobs", []):
            for step in job.get("steps", []):
                key = step["name"]
                if key not in seen_steps and step["status"] == "completed":
                    seen_steps.add(key)
                    icone = "OK " if step["conclusion"] == "success" else "!! "
                    print(f"  [{icone}] {key} ({step['conclusion']})")
    except Exception:
        pass
    if status == "completed":
        print("=" * 60)
        print(f"RUN TERMINÉ : {conclusion.upper()}")
        sys.exit(0 if conclusion == "success" else 2)
    time.sleep(20)
print("Timeout de surveillance atteint — le run continue sans moi.")
sys.exit(3)

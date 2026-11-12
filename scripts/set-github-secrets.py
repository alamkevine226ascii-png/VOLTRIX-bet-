#!/usr/bin/env python3
"""Configure les secrets GitHub Actions du dépôt VOLTRIX.

Chiffre les deux URL Neon (sealed box libsodium avec la clé publique
du dépôt) et les pousse via l'API GitHub. Le PAT n'apparaît jamais
dans les logs (il est lu depuis l'argument et masqué).
"""

import base64
import json
import sys
import urllib.request

from nacl import encoding, public

import os

REPO = "alamkevine226ascii-png/VOLTRIX-bet-"
TOKEN = os.environ["GH_TOKEN"]
SECRETS = {
    "DATABASE_URL": os.environ["NEON_POOLER_URL"],
    "DIRECT_DATABASE_URL": os.environ["NEON_DIRECT_URL"],
}


def api(method: str, path: str, body: dict | None = None) -> dict:
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
        return json.loads(text) if text else {}


# 1. Clé publique du dépôt
pk = api("GET", "actions/secrets/public-key")
print("Clé publique récupérée :", pk.get("key_id", "ERREUR"))

pk_obj = public.PublicKey(pk["key"].encode(), encoding.Base64Encoder())
sealed = public.SealedBox(pk_obj)

# 2. Chiffrement + PUT de chaque secret
for name, value in SECRETS.items():
    enc = sealed.encrypt(value.encode())
    api(
        "PUT",
        f"actions/secrets/{name}",
        {
            "encrypted_value": base64.b64encode(enc).decode(),
            "key_id": pk["key_id"],
        },
    )
    print(f"Secret {name} : configuré")

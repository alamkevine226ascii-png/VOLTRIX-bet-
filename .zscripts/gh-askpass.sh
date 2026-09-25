#!/bin/bash
# Askpass GitHub — le token ne vit QUE dans l'env (GH_TOKEN, source .zscripts/.env.neon)
# Aucun secret dans ce fichier.
case "$1" in
  *Username*) echo "voltrix-ci" ;;
  *) echo "${GH_TOKEN:-}" ;;
esac

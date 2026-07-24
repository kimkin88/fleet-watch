#!/bin/bash
# Fleet Watch — one-command push.
# This folder IS the git repo (origin = github.com/MPC-git-worx/fleet-watch, private).
# Commits and pushes whatever has changed here. No mirroring, no second folder.
#
#   Usage:  bash push-to-github.sh "your commit message"
#   (if no message is given, a timestamped one is used)

set -e

REPO="/Users/james/Desktop/landing page/fleet-watch-llm-bundle"
MSG="${1:-Update Fleet Watch ($(date '+%Y-%m-%d %H:%M'))}"

cd "$REPO"

if [ ! -d ".git" ]; then
  echo "No .git found in $REPO — this folder is supposed to be the repo. Something's wrong."
  exit 1
fi

git add -A

if git diff --cached --quiet; then
  echo "→ Nothing changed since the last push. Done."
  exit 0
fi

echo "→ Committing: $MSG"
git commit -q -m "$MSG"

echo "→ Pushing to GitHub…"
git push -q

echo "✓ Pushed to github.com/MPC-git-worx/fleet-watch"

#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_DIR_REL="civilarchi"
SITE_DIR="$REPO_DIR/$SITE_DIR_REL"
DEST_DIR="/var/www/sengvis-playground/civilarchi"

UTC_NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TAG="deploy-${STAMP}"

cd "$REPO_DIR"

if [ ! -d .git ]; then
  echo "ERROR: not a git repo: $REPO_DIR" >&2
  exit 1
fi
if [ ! -d "$SITE_DIR" ]; then
  echo "ERROR: missing site dir: $SITE_DIR" >&2
  exit 1
fi

# Ensure git identity exists (local)
if ! git config user.email >/dev/null; then git config user.email "moltbot@local"; fi
if ! git config user.name  >/dev/null; then git config user.name  "Moltbot"; fi

# Commit everything (requirement: deploys must be committed)
# If there are no commits yet, this will create the first one.
git add -A
if git diff --cached --quiet; then
  echo "Nothing to commit. Continuing to deploy existing commit." >&2
else
  git commit -m "deploy: ${UTC_NOW}" >/dev/null
fi

COMMIT="$(git rev-parse --short HEAD)"

# Tag this deploy (idempotent-ish)
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag already exists: $TAG" >&2
else
  git tag -a "$TAG" -m "Deploy ${UTC_NOW}" >/dev/null
fi

# Push commit + tag
# NOTE: requires deploy key write access for pushing.
git push origin HEAD:main
git push origin "$TAG"

# Snapshot (site dir only) — stored outside webroot + optionally under /var/www backups
SNAP_DIR="/root/clawd-dev/backups/civilarchi"
mkdir -p "$SNAP_DIR"
SNAP_PATH="$SNAP_DIR/${TAG}_${COMMIT}.tgz"

tar -czf "$SNAP_PATH" -C "$REPO_DIR" "$SITE_DIR_REL"

# Deploy to webroot
mkdir -p "$DEST_DIR"
rsync -av --delete --exclude '.DS_Store' "$SITE_DIR/" "$DEST_DIR/"

# Append deploy log
LOG="$REPO_DIR/DEPLOY_LOG.md"
echo "- ${UTC_NOW} | ${COMMIT} | ${TAG} | ${SNAP_PATH}" >> "$LOG"

git add "$LOG"
if ! git diff --cached --quiet; then
  git commit -m "chore: deploy log ${UTC_NOW}" >/dev/null
  git push origin HEAD:main
fi

# Quick origin check
if command -v curl >/dev/null 2>&1; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: www.bimarchi-pg.com' http://127.0.0.1/civilarchi/ || true)
  echo "origin_check_http_code=${code}"
fi

echo "Deployed CIVILARCHI"
echo "  commit=${COMMIT}"
echo "  tag=${TAG}"
echo "  dest=${DEST_DIR}"
echo "  snapshot=${SNAP_PATH}"

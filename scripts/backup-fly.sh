#!/usr/bin/env bash
#
# Pulls a complete backup of Thalath Space off Fly onto this machine.
# Fly's own snapshots live on the same platform and expire after five days;
# this is the copy that survives losing the account, volume or region.
#
#   ./scripts/backup-fly.sh [app] [outdir]

set -euo pipefail

APP="${1:-thalath-space}"
OUT="${2:-$HOME/thalath-backups}"
KEEP="${KEEP:-12}"

say() { printf '\n\033[1m> %s\033[0m\n' "$*"; }
die() { printf '\033[31m  x %s\033[0m\n' "$*" >&2; exit 1; }

command -v flyctl >/dev/null 2>&1 || die "flyctl not found on PATH."
flyctl auth whoami >/dev/null 2>&1 || die "Not logged in. Run: fly auth login"

mkdir -p "$OUT"
LOCAL="$OUT/thalath-$(date +%Y-%m-%d-%H%M).tgz"

say "Taking a consistent database snapshot on the server"
flyctl ssh console -a "$APP" -C "node /app/scripts/snapshot.js /data/_snapshot.db" \
  || die "Snapshot failed. Nothing downloaded; live data untouched."

say "Packing the snapshot and the uploads"
flyctl ssh console -a "$APP" -C "tar czf /data/_backup.tgz -C /data _snapshot.db uploads" \
  || die "Could not pack the backup on the server."

say "Downloading"
flyctl ssh sftp get /data/_backup.tgz "$LOCAL" -a "$APP" || true

say "Cleaning up the server"
flyctl ssh console -a "$APP" -C "rm -f /data/_snapshot.db /data/_backup.tgz" >/dev/null 2>&1 || true

[ -f "$LOCAL" ] || die "Download produced no file. Try again."
SIZE=$(wc -c < "$LOCAL")
[ "$SIZE" -gt 1024 ] || die "Downloaded file is only ${SIZE} bytes -- not a real backup."

printf '  saved %s\n  size  %s\n' "$LOCAL" "$(du -h "$LOCAL" | cut -f1)"

if [ "$KEEP" -gt 0 ]; then
  ls -1t "$OUT"/thalath-*.tgz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r f; do rm -f "$f"; done
fi

cat <<DONE

  Backup complete. Inside the archive:
    _snapshot.db   the whole database
    uploads/       every photo and song

  Keep at least one copy somewhere else again.
DONE

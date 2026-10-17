#!/usr/bin/env bash
#
# One-command deploy to Fly.io. Safe to re-run: every step checks whether it
# has already been done, so this doubles as the "push an update" command.
#
#   FLY_API_TOKEN=... ./scripts/deploy-fly.sh
#
# See docs/FLY.md for the three things a human has to do first.

set -euo pipefail

APP="${FLY_APP:-$(grep -m1 '^app = ' fly.toml | cut -d'"' -f2)}"
REGION="${FLY_REGION:-$(grep -m1 '^primary_region = ' fly.toml | cut -d'"' -f2)}"
VOLUME="${FLY_VOLUME:-$(grep -m1 'source = ' fly.toml | cut -d'"' -f2)}"
VOLUME_GB="${FLY_VOLUME_GB:-3}"

say()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- preflight
[ -f fly.toml ] || die "run this from the repository root (no fly.toml here)"

if [ -z "${FLY_API_TOKEN:-}" ]; then
  die "FLY_API_TOKEN is not set.
    Add it in the cloud environment's settings (title bar -> environment -> Edit)
    under Network secrets, named FLY_API_TOKEN, then start a new session.
    Generate the token with: fly tokens create deploy --name thalath"
fi

if ! command -v flyctl >/dev/null 2>&1; then
  say "Installing flyctl"
  curl -fsSL https://fly.io/install.sh | sh
  export FLYCTL_INSTALL="${FLYCTL_INSTALL:-$HOME/.fly}"
  export PATH="$FLYCTL_INSTALL/bin:$PATH"
fi
command -v flyctl >/dev/null 2>&1 || die "flyctl still not on PATH after install"

say "Checking the token works"
flyctl auth whoami >/dev/null 2>&1 || die "FLY_API_TOKEN was rejected by Fly. Generate a fresh one."
echo "  authenticated as $(flyctl auth whoami 2>/dev/null)"

# ---------------------------------------------------------------- the app
if flyctl apps list --json 2>/dev/null | grep -q "\"Name\": *\"$APP\""; then
  echo "  app '$APP' already exists"
else
  say "Creating app '$APP'"
  flyctl apps create "$APP" || die "could not create '$APP' — the name may be taken globally.
    Pick another: edit the 'app' line in fly.toml, or run with FLY_APP=some-other-name"
fi

# ---------------------------------------------------------------- the volume
# This is the only thing standing between a redeploy and total data loss, so
# it is created once and never destroyed by this script.
EXISTING_VOLS=$(flyctl volumes list -a "$APP" --json 2>/dev/null | grep -c "\"name\": *\"$VOLUME\"" || true)
if [ "$EXISTING_VOLS" -gt 0 ]; then
  echo "  volume '$VOLUME' already exists ($EXISTING_VOLS); leaving it alone"
else
  say "Creating ${VOLUME_GB}GB volume '$VOLUME' in $REGION"
  flyctl volumes create "$VOLUME" --region "$REGION" --size "$VOLUME_GB" --yes -a "$APP"
fi

# ---------------------------------------------------------------- deploy
say "Building and deploying"
flyctl deploy --remote-only -a "$APP" --ha=false

# Belt and braces: --ha=false should already prevent a second machine, but two
# machines sharing one SQLite file would corrupt it, so assert it explicitly.
say "Pinning to a single machine (SQLite cannot be shared)"
flyctl scale count 1 --yes -a "$APP"

RUNNING=$(flyctl machines list -a "$APP" --json 2>/dev/null | grep -c '"state": *"started"' || true)
[ "$RUNNING" -le 1 ] || warn "$RUNNING machines are running — run: flyctl scale count 1 -a $APP"

# ---------------------------------------------------------------- verify
URL="https://${APP}.fly.dev"
say "Waiting for the health check"
for i in $(seq 1 40); do
  if curl -fsS --max-time 5 "$URL/healthz" 2>/dev/null | grep -q ok; then
    echo "  $URL/healthz -> ok"
    HEALTHY=1
    break
  fi
  sleep 3
done

if [ "${HEALTHY:-0}" != "1" ]; then
  warn "health check never came up. Logs:"
  flyctl logs -a "$APP" --no-tail | tail -40
  die "deploy finished but the app is not answering"
fi

say "Checking it is actually locked down"
code=$(curl -s -o /dev/null -w '%{http_code}' "$URL/uploads/probe.png" || true)
[ "$code" = "404" ] && echo "  uploads require a session (404 when logged out)" \
                    || warn "/uploads returned $code, expected 404 — is PUBLIC_UPLOADS set?"
curl -sSI "$URL/" | grep -qi 'strict-transport-security' \
  && echo "  HSTS present" || warn "HSTS header missing"

cat <<DONE

  ────────────────────────────────────────────────
   Thalath Space is live:  $URL
  ────────────────────────────────────────────────

  Tom's first-run password printed once, on first boot only.
  If this was the first deploy, grab it now:

      flyctl logs -a $APP --no-tail | grep -A4 'First run'

  Then: log in, open /admin, generate invite codes.
  Add the site to your phone's home screen and enable
  notifications in Settings.

DONE

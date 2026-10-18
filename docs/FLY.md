# Putting Thalath Space online with Fly.io

The path with the least ongoing work. No server to patch, no domain to buy, no
Cloudflare, no SSH. Fly gives you an HTTPS hostname for free, which is the only
hard requirement for the phone app and notifications to work.

**Your part is three steps, once. Everything after that is a single command.**

---

## What you do (about 20 minutes)

### 1. Make a Fly account

Sign up at [fly.io](https://fly.io) and add a payment method. A card is required
even on the smallest setup — expect **$3–6/month** for one always-on machine with
3 GB of storage.

### 2. Create a deploy token

In the Fly dashboard: **Tokens → Create token → Deploy token**, scoped to the
whole account (the app doesn't exist yet, so an app-scoped token has nothing to
attach to). Name it `thalath`.

It starts with `FlyV1 ...` and is shown once. A deploy token can push code and
manage this app — it is not a password for your whole account, but treat it like
one anyway.

### 3. Hand it over

**Do not paste the token into a chat message.** Put it in the cloud environment's
settings instead: the environment menu in the session's title bar → **Edit** →
**Network secrets**, named exactly:

```
FLY_API_TOKEN
```

While you're there, under **Network access**, allow these hosts so the deploy can
reach Fly:

```
api.fly.io
registry.fly.io
fly.io
```

Secrets are picked up by a *new* session, so start one after saving.

---

## What happens then

**Windows (PowerShell):**

```powershell
iwr https://fly.io/install.ps1 -useb | iex   # then reopen PowerShell
fly auth login                                # opens a browser
git clone -b claude/myspace-2005-webapp-8979ed https://github.com/epi-stem-ological/Code-Thalath
cd Code-Thalath
.\scripts\deploy-fly.ps1
```

**macOS / Linux:**

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
git clone -b claude/myspace-2005-webapp-8979ed https://github.com/epi-stem-ological/Code-Thalath
cd Code-Thalath
./scripts/deploy-fly.sh
```

`fly auth login` authenticates through the browser, so no API token is needed
at all. If you are running this from CI or an agent instead, set `FLY_API_TOKEN`
and the scripts will use that.

It installs `flyctl` if missing, creates the app, creates the storage volume,
builds the container, deploys it, pins it to a single machine, waits for the
health check, and verifies that uploads are locked down and HTTPS is enforced.
It is safe to re-run — that's also how you ship an update.

Then grab Tom's password, which prints only on the very first boot:

```bash
flyctl logs -a thalath-space --no-tail | grep -A4 'First run'
```

Log in at `https://thalath-space.fly.dev`, open `/admin`, generate invite codes,
and send people the copy-link button.

---

## Things worth understanding

### Only one machine, ever

All the state lives in one SQLite file on one disk. Two machines sharing it would
corrupt the database; zero machines would drop live IM connections and stop push
notifications. So `fly.toml` sets `auto_stop_machines = false` and
`min_machines_running = 1`, the deploy uses `--ha=false`, and the script asserts
the count afterwards.

**Never run `fly scale count 2`.** If Fly ever suggests scaling out, the answer is
a bigger machine, not more of them.

### The volume is the whole thing

`thalath_data` holds the database *and* every uploaded photo and song. The app is
disposable; this is not. The deploy script creates it once and will never delete
it, but **Fly volumes are not backups** — they live on one physical host.

Take snapshots and keep them off-platform:

```bash
flyctl volumes snapshots list <volume-id> -a thalath-space      # Fly's own, kept 5 days
flyctl ssh console -a thalath-space -C "tar czf - /data" > thalath-backup-$(date +%F).tar.gz
```

The second command is the one that matters — it pulls a copy onto your own
machine. Worth doing monthly, and before any big change.

### Picking a region

`primary_region = "lhr"` in `fly.toml` is London. Change it to wherever your
people actually are before the first deploy — moving a volume afterwards means
copying data by hand. Common ones: `iad` US east, `lax` US west, `fra` Frankfurt,
`syd` Sydney, `nrt` Tokyo. Full list: `flyctl platform regions`.

### Adding your own domain later

Nothing about the app changes:

```bash
flyctl certs create space.yourdomain.com -a thalath-space
```

Fly prints the DNS records to add and issues the certificate automatically. The
`.fly.dev` address keeps working alongside it.

---

## When something is wrong

```bash
flyctl status  -a thalath-space      # is the machine up?
flyctl logs    -a thalath-space      # what is it saying?
flyctl machine restart <id> -a thalath-space
flyctl releases -a thalath-space     # what shipped, and when
flyctl deploy --image <previous> -a thalath-space   # roll back
```

If the health check at `/healthz` fails, Fly restarts the machine on its own.
That handles the common case — a crash — without anyone being awake for it.

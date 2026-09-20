# Putting Thalath Space on the internet with Cloudflare

Public HTTPS hostname, origin on a machine you control, **no inbound ports open**,
and the repository stays private — it is never involved in serving.

## Why Tunnel and not Pages or Workers

Cloudflare Pages serves static files, and Workers run on a V8 isolate runtime with
no filesystem and no native modules. This app is a stateful server: it writes to a
SQLite file via `better-sqlite3` (a native module), stores uploads on disk, and
holds long-lived SSE connections open for IM. None of that runs on Pages or Workers.

Porting it would mean SQLite → D1, disk → R2, SSE → Durable Objects, and swapping
the template engine — a rewrite that would make the app slower and more fragile,
in exchange for nothing you want here.

**Cloudflare Tunnel** gives you the part you actually asked for: a public
`https://space.yourdomain.com` on Cloudflare's edge, with the app running wherever
you like — a VPS, a home server, a Raspberry Pi, a spare laptop. The repo being
private is unrelated and automatic, because deployment does not go through GitHub.

```
    phone ──https──▶ Cloudflare edge ──encrypted tunnel──▶ cloudflared ──▶ app:3000
                                       (outbound only)      (your machine)
```

---

## What you need

- A domain on Cloudflare (any plan, including free). The nameservers must point at
  Cloudflare — that is what makes the hostname routable.
- Docker, or Node 20+ if you'd rather run it directly.

> No domain yet and you just want to see it working? `cloudflared tunnel --url
> http://localhost:3000` prints a throwaway `*.trycloudflare.com` URL. It changes
> every restart and has no uptime guarantee, so it is for testing only — don't
> hand it to people.

---

## Setup

### 1. Create the tunnel

In the Cloudflare dashboard: **Zero Trust → Networks → Tunnels → Create a tunnel →
Cloudflared**. Name it `thalath`. Copy the token it shows you — a long string
starting `eyJ…`.

### 2. Point a hostname at the app

Still in the tunnel setup, add a **Public hostname**:

| Field | Value |
|---|---|
| Subdomain | `space` |
| Domain | `yourdomain.com` |
| Type | `HTTP` |
| URL | `app:3000` *(Docker)* or `localhost:3000` *(host install)* |

`HTTP` is correct here — the hop from cloudflared to the app is on a private
network, and the public leg is HTTPS at Cloudflare's edge. The DNS record is
created for you.

### 3. Run it

```bash
cp .env.example .env
# put TUNNEL_TOKEN=eyJ... in .env
docker compose up -d --build
docker compose logs app        # your Tom password prints here, once
```

Open `https://space.yourdomain.com`, log in as Tom, go to `/admin`, generate invite
codes, and send people the copy-link button.

---

## Cloudflare settings that matter

Most defaults are fine. These four are worth checking:

**SSL/TLS → Overview → Full.** Not Flexible. Flexible makes Cloudflare talk plain
HTTP to the origin and, worse, makes the app think requests arrived over HTTP —
which breaks secure cookies.

**SSL/TLS → Edge Certificates → Always Use HTTPS: on.** The app sets HSTS itself
when `SECURE_COOKIES=1`.

**Speed → Optimization → Rocket Loader: off.** It rewrites and defers your
JavaScript, which breaks the music player and the IM stream.

**Caching.** No rules needed. Cloudflare does not cache HTML by default, and
uploads are served `Cache-Control: private` so they are never cached at the edge
either. If you set `PUBLIC_UPLOADS=1` they become `public` and the CDN will cache
them — faster, but then anyone with a URL can fetch a photo without logging in.

### The IM stream

Live chat uses Server-Sent Events, which Cloudflare proxies fine. The app already
sends `Cache-Control: no-transform` and `X-Accel-Buffering: no` so nothing buffers
the stream, and a keepalive every 25 seconds stays comfortably inside Cloudflare's
100-second idle timeout. If a connection does drop, the browser reconnects after
3 seconds and re-fetches anything it missed. Nothing to configure.

### Optional: a second lock on the door

The app is already invite-only, so a public hostname is safe. If you want the site
to be unreachable without passing Cloudflare first, put **Zero Trust → Access →
Applications** in front of the hostname with a policy allowing specific email
addresses.

Be aware this hurts the phone experience: everyone gets an extra login, and Access
session expiry can interrupt the installed app. For a group that is already behind
invite codes, it is usually more friction than protection. Skip **Bot Fight Mode**
too — it challenges legitimate `fetch` calls and will break IM.

---

## Running on the host instead of Docker

```bash
sudo cloudflared service install eyJ...      # the token from step 1
```

Then run the app under systemd (unit file in the main README), with:

```
Environment=SECURE_COOKIES=1
Environment=TRUST_PROXY=1
```

If you created the tunnel from the CLI rather than the dashboard, use
`docs/cloudflared-config.yml` as your `/etc/cloudflared/config.yml`.

---

## Checking it works

```bash
curl -sS https://space.yourdomain.com/healthz                  # -> ok
curl -sSI https://space.yourdomain.com/ | grep -i strict-trans # HSTS present
curl -sSI https://space.yourdomain.com/uploads/anything        # -> 404, not a file
```

The last one matters: uploads must not be readable without a session. If that
returns a file, `PUBLIC_UPLOADS` is set and you probably didn't mean to.

On a phone: open the hostname in Safari (iOS) or Chrome (Android), add it to the
home screen, open it from the icon, then **Settings → Turn on notifications here**.
Push only works over HTTPS from an installed app, which is exactly what this setup
gives you.

---

## Backups

The tunnel changes nothing about state. Two volumes hold everything:

```bash
docker compose exec app node -e "require('better-sqlite3')('/app/data/thalath.db').backup('/app/data/backup.db')"
docker compose cp app:/app/data/backup.db ./thalath-$(date +%F).db
docker run --rm -v thalath_uploads:/u -v "$PWD":/out alpine \
  tar czf /out/uploads-$(date +%F).tar.gz -C /u .
```

Use the `.backup` call rather than copying the file — the database runs in WAL
mode and a plain copy can catch it mid-write.

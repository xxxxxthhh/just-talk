# Deploying the public trial

The public trial runs Just Talk for anonymous visitors with a server-side
Azure AI Speech key. It has per-visitor data, persistent usage caps, and no
host ports: traffic arrives only through a Cloudflare Tunnel connector on an
internal Docker network.

Everything here uses placeholders (`justtalk.example.com`, `<TUNNEL_ID>`).
Replace them with your own values.

## What you need

- A Linux host with Docker Engine and the Compose plugin. The app container is
  limited to 1 CPU and 1 GiB of memory.
- An Azure AI Speech resource. A dedicated resource for the public trial is
  recommended, so you can rotate its key without affecting other use.
- A domain on Cloudflare and `cloudflared` on an admin machine that is logged
  in to the account (`cloudflared tunnel login`).

## 1. Configure the app

```bash
cp deploy/public/.env.example deploy/public/.env
chmod 600 deploy/public/.env
```

Fill in `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`, and set
`PUBLIC_ALLOWED_ORIGINS` and `CORS_ORIGINS` to the exact public origin (for
example `https://justtalk.example.com`). Any unsafe request (POST/PUT/PATCH/DELETE) without an allowed
`Origin` header is rejected. Keep `PUBLIC_CLIENT_IP_HEADER=CF-Connecting-IP`
only when the app is reachable **solely** through the tunnel.

Create the data directory for the container user:

```bash
mkdir -p deploy/public/data
sudo chown 10001:10001 deploy/public/data
```

## 2. Create a locally-managed tunnel

On the admin machine:

```bash
cloudflared tunnel create justtalk-public          # writes <TUNNEL_ID>.json
cloudflared tunnel route dns justtalk-public justtalk.example.com
```

On the host, place the files where the compose file mounts them read-only:

```bash
cp deploy/public/cloudflared/config.example.yml deploy/public/cloudflared/config.yml
# edit config.yml: tunnel: <TUNNEL_ID>, hostname: justtalk.example.com
install -m 400 -o 65532 -g 65532 <TUNNEL_ID>.json deploy/public/cloudflared/credentials.json
```

`config.yml` and `*.json` in that folder are git-ignored. To keep them
somewhere else, use a private `docker-compose.override.yml` that changes the
two volume sources. Don't edit the tracked compose file.

## 3. Start

```bash
docker compose -f deploy/public/docker-compose.yml up -d --build
docker compose -f deploy/public/docker-compose.yml ps
docker compose -f deploy/public/docker-compose.yml logs --tail=100 app
```

Check the app from inside the network, then through the public hostname:

```bash
docker compose -f deploy/public/docker-compose.yml exec app \
  python -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8000/api/health').read().decode())"
curl --fail-with-body https://justtalk.example.com/api/health
```

The health JSON must include `"public": {...}` and `"passage_check_configured": false`.

## Network isolation (recommended)

The compose network allows outbound traffic, which the app needs for Azure
and cloudflared needs for Cloudflare. It does not block the host, the LAN, or
cloud metadata endpoints. Add host firewall rules for that, for example in
the `DOCKER-USER` iptables chain: drop traffic from the compose subnet to
RFC 1918 ranges, link-local `169.254.0.0/16`, and the host's own addresses,
while allowing DNS and HTTPS egress.

## Operating

| Task | How |
| --- | --- |
| Pause all Azure calls | Set `PUBLIC_SCORING_ENABLED=0` in `.env`, then `up -d` |
| Rotate the Azure key | Regenerate the key in Azure, update `.env`, then `up -d` |
| Change limits | Edit the `PUBLIC_*` values in `.env`, then `up -d`. Usage already counted is kept |
| Back up | `stop app`, copy `deploy/public/data/`, then `start app` |
| Upgrade | Pull, then `up -d --build`. Back up first |

Keep the app at **one worker**. Per-visitor write locks and the Azure
concurrency limit are in-process. Usage caps live in SQLite.

## Usage caps and cost

The app counts decoded audio seconds and TTS characters in a persistent
ledger and rejects requests before calling Azure once a cap is reached:

| Cap (UTC windows) | Default |
| --- | --- |
| Site-wide per month | 4 h of scored audio, 100,000 TTS characters, 1,500 scores, 3,000 TTS requests |
| Site-wide per day | 30 min of audio, 5,000 characters, 120 scores, 200 TTS requests |
| Per visitor per day | 3 min of audio, 1,000 characters, 20 scores, 40 TTS requests |
| Per recording | 30 s (short), 90 s (long passage) |

Once a request reaches Azure, its usage counts even if the call fails or
times out. It is never refunded or retried automatically. Deleting data,
clearing cookies, or restarting does not reset site-wide usage.

**Estimate only.** These are Azure Retail Prices API list prices (eastus,
checked 2026-09-24):

- Speech to Text: $1.00/audio hour;
- "Speech to Text Enhanced Feature Audio": $0.30/h, assumed to be the prosody add-on, since prosody is billed on top of the baseline;
- Neural TTS: $15 per 1M characters.

At these prices the default monthly caps come to about 4 h × $1.30 + 0.1M × $15 ≈ **$6.70 per month**. This is not a bill ceiling:

- prices, billing granularity, and minimum charges are set by Microsoft;
- usage outside this app on the same key is not counted;
- the app's estimate of billable characters may differ from Azure's.

Set an Azure budget alert as well. Budgets notify you but do not stop
spending.

## Known limits

- Visitor identity is an anonymous cookie. Clearing it gives a new
  per-visitor allowance, so per-visitor caps only share the allowance fairly;
  the site-wide caps are what bound usage. A determined client can use up the
  shared daily allowance for everyone. Optional Turnstile
  (`TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`) makes automated abuse more
  expensive but does not prevent it.
- LLM features (passage check, drill generation) are disabled in public mode.
- Only English (en-US) scoring is supported.

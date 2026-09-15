# Deploying FightWars

A single box runs the whole game: Caddy for TLS, the game server, the API and
Postgres. The container image is built by GitHub Actions and pulled here — the
box never runs the build, because `build-prod` runs `tsc` and Vite
concurrently and will OOM anything small.

> **This stack has not yet been run end to end.** The compose file in the repo
> root was written and never executed (`docs/HANDOFF.md` §4). Expect the first
> `up` to surface something.

## 1. A box

Anything with 2 vCPU and 2–4 GB. With the GitHub Student Pack's DigitalOcean
credit, a 2 GB / 1 vCPU droplet ($12/mo) stretches the credit furthest and is
enough to start; 4 GB gives headroom for more workers.

Ubuntu 24.04, then:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER" && newgrp docker
```

## 2. DNS

The client resolves the API as `api.<DOMAIN>` (`src/client/ApiBase.ts`), so
**two** records are needed, both pointing at the box:

| Type | Name            | Value      |
| ---- | --------------- | ---------- |
| A    | `fightwars`     | droplet IP |
| A    | `api.fightwars` | droplet IP |

Let them resolve before step 4 — Caddy issues certificates on first boot and
fails if the names do not yet point here.

## 3. Configure

```bash
git clone https://github.com/MooMooDevelopments/fightwars.git
cd fightwars/deploy
cp .env.example .env
```

Fill in `.env`. Every secret has its generator command in the comments. Two
that matter:

- **`API_JWT_PRIVATE_KEY`** — generate once and keep it. Changing it logs
  every player out.
- **`CLUSTER_JSON`** — its `host` must equal `DOMAIN` exactly. The server
  finds its own entry by that string and refuses to boot without a match.

## 4. Up

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f
```

Watch for `All workers ready, starting game scheduling`. Then open
`https://<DOMAIN>` and start a solo game.

## 5. Updating

CI publishes `:latest` and a `:sha-<commit>` tag on every push to `main`.

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Pin `IMAGE` to a `sha-` tag in `.env` to roll back.

## Notes

- **redis is omitted.** The root compose file marks it "reserved … not yet
  wired" and nothing reads it.
- **Turnstile.** The default site key is Cloudflare's always-passes test key.
  Replace both Turnstile values before you advertise the server or you have no
  bot protection.
- **Singleplayer replay archiving does not work yet** — the client posts to
  `/archive_singleplayer_game` and the API defines no such route. The CORS
  preflight for it is fixed, but the endpoint itself is unimplemented.
- **Backups.** Game records live in the `pgdata` volume and replays in
  `replays`. Nothing backs them up; `docker compose exec db pg_dump -U
fightwars fightwars` on a cron is the minimum.

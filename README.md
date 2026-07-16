# MenuMate

MenuMate is a restaurant QR-menu system with an owner dashboard and a mobile-first public menu. Every public menu lives at its own `/r/{restaurant-slug}` URL. The AI waiter receives only that restaurant's item names, prices, and owner-written notes, and is instructed to ask staff when a fact is missing.

## Run locally

Use Python 3.12+.

```powershell
python -m pip install -r requirements.txt
$env:APP_SECRET = "use-a-long-random-value"
$env:OPENAI_API_KEY = "your-key" # optional until the AI waiter is enabled
python server.py
```

Open `http://localhost:8000/owner` to create the first restaurant owner account. The SQLite database (`menumate.db`) is created automatically and persists all restaurants, menu items, suggested questions, and guest chat logs.

For a local HTTPS-style production setting, also set:

```powershell
$env:PUBLIC_BASE_URL = "https://your-domain.example"
$env:COOKIE_SECURE = "true"
```

## AI configuration

The waiter uses an OpenAI-compatible Responses API. Set these environment variables in the deployment platform:

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Yes for AI chat | API key for the LLM provider |
| `LLM_BASE_URL` | No | Defaults to `https://api.openai.com/v1` |
| `LLM_MODEL` | No | Defaults to `gpt-4o-mini` |
| `APP_SECRET` | Yes | Long random value for signed owner sessions |
| `PUBLIC_BASE_URL` | Yes in production | Canonical `https://...` URL encoded in downloaded QR codes |
| `DATABASE_PATH` | No | SQLite file path, defaults to `./menumate.db` |
| `COOKIE_SECURE` | Yes in production | Set to `true` behind HTTPS |

The deployed app never exposes `OPENAI_API_KEY` to the browser.

## Deploy on Render

This repository includes `Dockerfile` and `render.yaml`. In Render, create a Blueprint from this repository, then set:

1. `OPENAI_API_KEY` to the LLM API key.
2. Optionally adjust `LLM_MODEL` and `LLM_BASE_URL` for another OpenAI-compatible provider.

The app automatically derives the Render URL used in QR codes. If you later add a custom domain, optionally set `PUBLIC_BASE_URL` to that canonical `https://` origin and redeploy.

The Blueprint provisions a persistent disk at `/data`, so the SQLite database survives redeployments. The health check is available at `/api/health`.

## Product boundaries

- There are no seeded suggested questions; each restaurant controls exactly what guests see.
- Menu notes are free text, not allergen tags. They stay server-side: the public menu payload never exposes them, while the AI is deliberately instructed not to infer missing ingredients or allergen information.
- `/api/owner/*` routes require the signed, HTTP-only owner session; `/api/public/{slug}` routes are intentionally public and tenant-scoped.

# Daily Fitted API and worker

Python 3.12, FastAPI, psycopg 3. Managed with [uv](https://docs.astral.sh/uv/).

| Command | What it does |
| --- | --- |
| `uv sync` | Install dependencies into `.venv` |
| `uv run dailyfitted-api` | Start the API on http://localhost:8000 (docs at `/docs`) |
| `uv run dailyfitted-worker` | Start the detection worker |
| `uv run pytest` | Run tests |
| `uv run ruff check . && uv run ruff format --check .` | Lint and format check |
| `uv run mypy src tests` | Type check |

Copy `.env.example` to `.env` and fill it in before starting the API or worker.

## Layout

```
src/dailyfitted_api/
  app.py       FastAPI setup: connection pool, token verifier
  auth.py      Verifies the Supabase sign-in token (JWT) on each request
  db.py        Runs each request's queries as the signed-in user, so Postgres RLS applies
  outfits.py   POST /outfits, GET /outfits/me
  worker/
    queue.py     Postgres job queue (SELECT ... FOR UPDATE SKIP LOCKED)
    retry.py     Exponential backoff rules
    detector.py  Detector interface + stub (real model chosen in Phase 2)
    run.py       Worker loop with graceful shutdown
```

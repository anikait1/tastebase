# tastebase

A small service that turns short-form cooking videos (YouTube Shorts) into structured, searchable recipes. It ingests a video, extracts a transcript, parses it with an LLM into a clean recipe, generates embeddings, and stores everything in Postgres with pgvector for hybrid search.

## Architecture

- HTTP server: `Elysia` in `server.ts`, exposes:
  - `POST /recipe` (streamed pipeline events) and `GET /recipe?q=...` (search)
- Pipeline: `recipe/job.ts`
  - Steps: Transcript → LLM parse → Persist recipe + embedding
- YouTube: `youtube/service.ts` via `youtubei.js` (no API key required)
- LLM: `ai` SDK with OpenAI (`gpt-4o` for parsing, `text-embedding-3-small` for embeddings) in `llm/service.ts`
- DB: `drizzle-orm` + Postgres + `pgvector` (`db/schema.ts`, migrations in `db/migrations/`)
- Logging: `pino` with scoped request logging

## Docker (local database)

- Compose file: `docker/docker-compose.local.yml`
  - Postgres 17 with `pgvector` extension initialized by `docker/pgvector-init.sql`
  - Defaults: user `recipellm`, password `recipellm`, db `recipes`, port `5432`
- Example `DATABASE_URL`: `postgres://recipellm:recipellm@localhost:5432/recipes`

## Run It

1. Install deps

```bash
bun install
```

2. Start Postgres (in another shell)

```bash
docker compose -f docker/docker-compose.local.yml up -d
```

3. Set environment

```bash
export DATABASE_URL=postgres://recipellm:recipellm@localhost:5432/recipes
export OPENAI_API_KEY=sk-... # required by ai/openai
```

4. Run migrations

```bash
bun run db:migrate
```

5. Start the server (watches files)

```bash
bun run dev
# listens on http://localhost:6969
```

## API at a Glance

- API docs: http://localhost:6969/openapi

- Ingest (streamed events): `POST /recipe`
  - Body: `{ "type": "youtube-shorts", "data": { "url": "https://www.youtube.com/shorts/<id>" } }`
- Search: `GET /recipe?q=<text>`
  - Hybrid ranking: 70% vector similarity + 30% keyword score

## Notes

- If the Shorts video lacks a transcript, ingestion may fail; the pipeline returns an error event.
- To change models/providers, update `llm/service.ts` (the `ai` SDK supports multiple providers).

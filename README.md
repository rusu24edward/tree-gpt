# Branching Chat App (Graph Conversations)

A full-stack starter for a ChatGPT-like UI where conversations are **trees** (not linear). 
Click any previous node to branch, keep the old path, and explore new lines of inquiry.

## Stack
- **Backend**: FastAPI + SQLAlchemy (Postgres), OpenAI for completions
- **Frontend**: Next.js + React, **React Flow** for the conversation graph
- **DB**: Postgres
- **Deploy**: Docker Compose (dev & prod friendly)

---

## Quick start

1) **Prereqs**: Docker + Docker Compose installed.

2) Create a `.env` file at the project root by copying `.env.example` and fill in your keys:
```bash
cp .env.example .env
```

3) Launch everything:
```bash
docker compose up --build
```
- API: http://localhost:8000/docs (FastAPI docs)
- Web: http://localhost:3000

> First run will auto-create the DB tables.

---

## How it works

- Each **message** is a node with a `parent_id`. The tree is grouped by `tree_id`.
- Clicking a node in the graph sets the **active branch**. When you send a message from that node:
  1. The server creates the user node.
  2. It walks the **ancestor path** to the root (not the whole tree).
  3. (Optional) Summarizes very old context.
  4. Calls the LLM with only that path.
  5. Saves the assistant node with `parent_id = user_node.id`.
- The UI refreshes the graph and shows the updated path.

---

## Environment variables

Copy `.env.example` to `.env` and set:

```
# Database
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=app
POSTGRES_HOST=db
POSTGRES_PORT=5432
DATABASE_URL=postgresql+psycopg2://postgres:postgres@db:5432/app

# Backend
OPENAI_API_KEY=sk-YOUR_KEY_HERE
OPENAI_MODEL=gpt-4o-mini  # set any chat-capable model you have access to
SYSTEM_PROMPT=You are a helpful assistant.

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Development tips

- Use http://localhost:8000/docs to try endpoints.
- If you change DB schema, rebuild or add a proper migration tool (Alembic). For the starter,
  we call `Base.metadata.create_all` on startup (simple but not for production migrations).
- To test without an OpenAI key, set `OPENAI_API_KEY` empty; the API will return a **mock** response.

---

## Production hints

- Add proper auth (e.g., NextAuth/Auth0) and a `user_id` on every message/tree.
- Replace `create_all` with **Alembic** migrations.
- Add a token counter and a **summary buffer** that condenses old context to stay within limits.
- Consider a vector store (e.g., pgvector) to recall relevant non-ancestor facts when helpful.
- Deploy to any container platform (Fly.io, Render, Railway, AWS ECS). Keep environment variables in secrets.


## Project layout

```
.
├── docker-compose.yml
├── .env.example
├── server/              # FastAPI
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py
│       ├── database.py
│       ├── models.py
│       ├── schemas.py
│       ├── crud.py
│       ├── services/
│       │   ├── llm.py
│       │   └── summarizer.py
│       └── routers/
│           ├── trees.py
│           └── messages.py
└── web/                 # Next.js
    ├── Dockerfile
    ├── package.json
    ├── next.config.mjs
    ├── tsconfig.json
    ├── src/
    │   ├── pages/
    │   │   └── index.tsx
    │   ├── components/
    │   │   ├── ChatGraph.tsx
    │   │   └── ChatPane.tsx
    │   └── lib/
    │       └── api.ts
    └── public/
```

---

## Common commands

- Rebuild after changes:
  ```bash
  docker compose up --build
  ```
- Stop:
  ```bash
  docker compose down
  ```
- Wipe volumes (removes DB data):
  ```bash
  docker compose down -v
  ```

Happy building! 🎋

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import Base, engine
from .routers import messages, trees, files

# Create tables (simple starter; prefer Alembic later)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Branching Chat API")

# CORS (dev-friendly)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trees.router, prefix="/api")
app.include_router(messages.router, prefix="/api")
app.include_router(files.router, prefix="/api")

@app.get("/healthz")
def health():
    return {"ok": True}

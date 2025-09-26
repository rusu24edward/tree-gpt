from typing import Dict, List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from .. import schemas, crud, models
from ..services.llm import build_messages, complete
from ..services.summarizer import maybe_summarize

router = APIRouter(prefix="/messages", tags=["messages"])

@router.get("/graph/{tree_id}", response_model=schemas.GraphResponse)
def get_graph(tree_id: UUID, db: Session = Depends(get_db)):
    msgs = crud.get_tree_messages(db, tree_id)
    nodes = []
    edges = []
    for m in msgs:
        nodes.append({
            "id": str(m.id),
            "label": (m.content[:48] + "…") if len(m.content) > 48 else m.content,
            "role": m.role,
            "parent_id": str(m.parent_id) if m.parent_id else None
        })
        if m.parent_id:
            edges.append({
                "id": f"{m.parent_id}->{m.id}",
                "source": str(m.parent_id),
                "target": str(m.id)
            })
    return {"nodes": nodes, "edges": edges}

@router.get("/path/{message_id}", response_model=schemas.PathResponse)
def get_path(message_id: UUID, db: Session = Depends(get_db)):
    rows = crud.get_path_to_root(db, message_id)
    path = [{"role": r["role"], "content": r["content"]} for r in rows]
    return {"path": path}

@router.post("", response_model=schemas.MessageOut)
def post_message(payload: schemas.MessageCreate, db: Session = Depends(get_db)):
    # If no parent was chosen, default to the seeded root (if present)
    parent_id = payload.parent_id
    if parent_id is None:
        root = crud.get_root_message(db, payload.tree_id)
        if root:
            parent_id = root.id

    # 1) create the user message (now guaranteed to branch from root when no parent selected)
    user_msg = crud.create_message(
        db,
        tree_id=payload.tree_id,
        role="user",
        content=payload.content,
        parent_id=parent_id,
    )

    # 2) build path (ancestor chain including this new user node)
    rows = crud.get_path_to_root(db, user_msg.id)
    path_msgs = [{"role": r["role"], "content": r["content"]} for r in rows]

    # 3) (optional) summarize
    path_msgs = maybe_summarize(path_msgs, max_keep=20)

    # 4) LLM
    messages = build_messages(path_msgs)
    answer = complete(messages)

    # 5) store assistant message
    asst = crud.create_message(
        db,
        tree_id=payload.tree_id,
        role="assistant",
        content=answer,
        parent_id=user_msg.id,
    )
    return asst

@router.delete("/{message_id}")
def delete_message(message_id: UUID, db: Session = Depends(get_db)):
    deleted = crud.delete_subtree(db, message_id)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"deleted": deleted}

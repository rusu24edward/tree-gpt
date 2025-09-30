from typing import Dict, List, Optional
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
    by_id: Dict[UUID, models.Message] = {m.id: m for m in msgs}

    def collapse_whitespace(text: str) -> str:
        return " ".join(text.strip().split())

    def make_excerpt(text: str, limit: int = 72) -> str:
        snapped = collapse_whitespace(text)
        if len(snapped) <= limit:
            return snapped
        return snapped[: limit - 1].rstrip() + "…"

    def compose_label(user_excerpt: Optional[str], assistant_excerpt: Optional[str]) -> str:
        parts: List[str] = []
        if user_excerpt:
            parts.append(f"You: {user_excerpt}")
        if assistant_excerpt:
            parts.append(f"LLM: {assistant_excerpt}")
        if not parts:
            return "(empty)"
        return "\n".join(parts)

    nodes: List[Dict[str, Optional[str]]] = []
    edges: List[Dict[str, str]] = []

    def add_edge(parent: Optional[str], child: str) -> None:
        if not parent:
            return
        edges.append({
            "id": f"{parent}->{child}",
            "source": parent,
            "target": child,
        })

    handled_user_ids = set()

    # First pass: system/root messages (keep as standalone nodes)
    for m in msgs:
        if m.role != "system":
            continue
        parent_id = str(m.parent_id) if m.parent_id else None
        label = make_excerpt(m.content)
        node = {
            "id": str(m.id),
            "role": "system",
            "label": label,
            "parent_id": parent_id,
            "user_label": None,
            "assistant_label": label,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        nodes.append(node)
        add_edge(parent_id, str(m.id))

    # Second pass: combine user prompt + assistant reply into a single node
    for m in msgs:
        if m.role != "assistant":
            continue

        parent_user = by_id.get(m.parent_id) if m.parent_id else None
        user_excerpt = None
        parent_id: Optional[str] = None

        if parent_user and parent_user.role == "user":
            user_excerpt = make_excerpt(parent_user.content)
            if parent_user.parent_id:
                parent_id = str(parent_user.parent_id)
            handled_user_ids.add(parent_user.id)
        else:
            parent_id = str(m.parent_id) if m.parent_id else None

        assistant_excerpt = make_excerpt(m.content)
        label = compose_label(user_excerpt, assistant_excerpt)

        node = {
            "id": str(m.id),
            "role": "turn",
            "label": label,
            "parent_id": parent_id,
            "user_label": user_excerpt,
            "assistant_label": assistant_excerpt,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        nodes.append(node)
        add_edge(parent_id, str(m.id))

    # Fallback: orphaned user messages (no assistant child yet)
    for m in msgs:
        if m.role != "user" or m.id in handled_user_ids:
            continue
        parent_id = str(m.parent_id) if m.parent_id else None
        user_excerpt = make_excerpt(m.content)
        label = compose_label(user_excerpt, None)
        node = {
            "id": str(m.id),
            "role": "user",
            "label": label,
            "parent_id": parent_id,
            "user_label": user_excerpt,
            "assistant_label": None,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        nodes.append(node)
        add_edge(parent_id, str(m.id))

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

@router.post("/branch/{message_id}/fork", response_model=schemas.BranchForkResponse)
def fork_branch(message_id: UUID, db: Session = Depends(get_db)):
    target = crud.get_message(db, message_id)
    if not target:
        raise HTTPException(status_code=404, detail="Message not found")

    lineage: List[models.Message] = []
    current = target
    while current:
        lineage.append(current)
        if current.parent_id is None:
            break
        current = crud.get_message(db, current.parent_id)
        if current is None:
            break

    lineage.reverse()

    source_tree = db.query(models.Tree).filter(models.Tree.id == target.tree_id).first()
    base_title = source_tree.title if source_tree else None
    branch_title = f"{base_title} (Branch)" if base_title else "Conversation branch"
    new_tree = models.Tree(title=branch_title)
    db.add(new_tree)
    db.flush()

    id_map: Dict[UUID, UUID] = {}
    last_clone: Optional[models.Message] = None

    try:
        for msg in lineage:
            parent_new_id = id_map.get(msg.parent_id) if msg.parent_id else None
            clone = models.Message(
                tree_id=new_tree.id,
                parent_id=parent_new_id,
                role=msg.role,
                content=msg.content,
                meta=msg.meta,
            )
            db.add(clone)
            db.flush()
            id_map[msg.id] = clone.id
            if msg.id == target.id:
                last_clone = clone

        if not last_clone:
            raise HTTPException(status_code=500, detail="Failed to copy branch")

        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(new_tree)
    return {"tree": new_tree, "active_node_id": str(last_clone.id)}

@router.delete("/{message_id}")
def delete_message(message_id: UUID, db: Session = Depends(get_db)):
    target = crud.get_message(db, message_id)
    if not target:
        raise HTTPException(status_code=404, detail="Message not found")

    delete_id = target.id
    if target.role == "assistant" and target.parent_id:
        parent = crud.get_message(db, target.parent_id)
        if parent and parent.role == "user":
            delete_id = parent.id

    deleted = crud.delete_subtree(db, delete_id)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"deleted": deleted}

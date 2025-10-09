import json
import time
from typing import Dict, List, Optional, Iterator
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from ..database import get_db
from .. import schemas, crud, models
from ..services.llm import build_messages, complete, stream_complete, client as llm_client
from ..services.summarizer import maybe_summarize
from ..services import files as file_service
from ..deps import get_current_user_id

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
def get_path(
    message_id: UUID,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    rows = crud.get_path_to_root(db, message_id)
    message_ids = [UUID(str(r["id"])) for r in rows if r.get("id")]
    attachments = crud.get_files_for_messages(db, message_ids)
    grouped = {}
    for attachment in attachments:
        if attachment.uploader_id != user_id:
            continue
        grouped.setdefault(attachment.message_id, []).append(attachment)

    path: List[schemas.PathMessage] = []
    for row in rows:
        msg_id = UUID(str(row["id"])) if row.get("id") else None
        att_models = [file_service.serialize_for_message(a) for a in grouped.get(msg_id, [])]
        path.append(
            schemas.PathMessage(
                role=row["role"],
                content=row["content"],
                attachments=att_models,
            )
        )
    return {"path": path}

@router.post("", response_model=schemas.MessageOut)
def post_message(
    payload: schemas.MessageCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    # If no parent was chosen, default to the seeded root (if present)
    parent_id = payload.parent_id
    if parent_id is None:
        root = crud.get_root_message(db, payload.tree_id)
        if root:
            parent_id = root.id

    attachment_ids = payload.attachments or []
    if len(attachment_ids) > file_service.MAX_ATTACHMENTS_PER_MESSAGE:
        raise HTTPException(status_code=400, detail="Too many attachments")

    try:
        attachment_records = file_service.require_files(db, user_id, attachment_ids)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))

    meta = None
    if attachment_records:
        meta = {"attachments": [str(record.id) for record in attachment_records]}

    # 1) create the user message (now guaranteed to branch from root when no parent selected)
    user_msg = crud.create_message(
        db,
        tree_id=payload.tree_id,
        role="user",
        content=payload.content,
        parent_id=parent_id,
        meta=meta,
    )

    if attachment_records:
        try:
            file_service.mark_files_attached(db, attachment_records, payload.tree_id, user_msg.id)
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))

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
    return schemas.MessageOut(
        id=asst.id,
        tree_id=asst.tree_id,
        parent_id=asst.parent_id,
        role=asst.role,
        content=asst.content,
        attachments=[],
    )


def _encode_event(payload: Dict) -> bytes:
    return (json.dumps(jsonable_encoder(payload)) + "\n").encode("utf-8")


@router.post("/stream")
def post_message_stream(
    payload: schemas.MessageCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    parent_id = payload.parent_id
    if parent_id is None:
        root = crud.get_root_message(db, payload.tree_id)
        if root:
            parent_id = root.id

    attachment_ids = payload.attachments or []
    if len(attachment_ids) > file_service.MAX_ATTACHMENTS_PER_MESSAGE:
        raise HTTPException(status_code=400, detail="Too many attachments")

    try:
        attachment_records = file_service.require_files(db, user_id, attachment_ids)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))

    meta = None
    if attachment_records:
        meta = {"attachments": [str(record.id) for record in attachment_records]}

    user_msg = crud.create_message(
        db,
        tree_id=payload.tree_id,
        role="user",
        content=payload.content,
        parent_id=parent_id,
        meta=meta,
    )

    if attachment_records:
        try:
            file_service.mark_files_attached(db, attachment_records, payload.tree_id, user_msg.id)
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))

    serialized_attachments = [file_service.serialize_for_message(rec) for rec in attachment_records]

    rows = crud.get_path_to_root(db, user_msg.id)
    path_msgs = [{"role": r["role"], "content": r["content"]} for r in rows]
    path_msgs = maybe_summarize(path_msgs, max_keep=20)
    messages = build_messages(path_msgs)

    def stream_tokens() -> Iterator[bytes]:
        buffer: List[str] = []
        finished = False

        yield _encode_event(
            {
                "type": "start",
                "tree_id": str(user_msg.tree_id),
                "user_id": str(user_msg.id),
                "parent_id": str(parent_id) if parent_id else None,
                "attachments": [a.model_dump() for a in serialized_attachments],
            }
        )

        try:
            for token in stream_complete(messages):
                if not token:
                    continue
                buffer.append(token)
                yield _encode_event({"type": "token", "delta": token})
                if llm_client is None:
                    time.sleep(0.02)

            final_content = "".join(buffer).strip()
            assistant = crud.create_message(
                db,
                tree_id=user_msg.tree_id,
                role="assistant",
                content=final_content,
                parent_id=user_msg.id,
            )
            finished = True
            yield _encode_event(
                {
                    "type": "end",
                    "assistant_id": str(assistant.id),
                    "tree_id": str(assistant.tree_id),
                    "content": assistant.content,
                    "parent_id": str(user_msg.id),
                }
            )
        except GeneratorExit:
            return
        except Exception as exc:  # pragma: no cover - defensive
            yield _encode_event({"type": "error", "message": str(exc)})
            raise
        finally:
            if not finished:
                db.rollback()

    return StreamingResponse(stream_tokens(), media_type="application/jsonl")

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
def delete_message(
    message_id: UUID,
    db: Session = Depends(get_db),
    _user_id: str = Depends(get_current_user_id),
):
    target = crud.get_message(db, message_id)
    if not target:
        raise HTTPException(status_code=404, detail="Message not found")

    delete_id = target.id
    if target.role == "assistant" and target.parent_id:
        parent = crud.get_message(db, target.parent_id)
        if parent and parent.role == "user":
            delete_id = parent.id

    subtree_ids = crud.get_subtree_message_ids(db, delete_id)
    files_to_delete = crud.delete_files_for_messages(db, subtree_ids)
    if files_to_delete:
        file_service.delete_files(db, None, [f.id for f in files_to_delete])

    deleted = crud.delete_subtree(db, delete_id)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"deleted": deleted}

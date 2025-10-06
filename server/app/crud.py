from typing import List, Optional, Dict, Any, Iterable
from uuid import UUID
from sqlalchemy import text
from sqlalchemy.orm import Session
from . import models

def create_tree(db: Session, title: Optional[str] = None) -> models.Tree:
    t = models.Tree(title=title)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t

def list_trees(db: Session) -> List[models.Tree]:
    return db.query(models.Tree).order_by(models.Tree.title.asc().nulls_last()).all()

def delete_tree(db: Session, tree_id: UUID) -> int:
    q = db.query(models.Tree).filter(models.Tree.id == tree_id)
    exists = q.first()
    if not exists: return 0
    q.delete()
    db.commit()
    return 1

def update_tree_title(db: Session, tree_id: UUID, title: Optional[str]) -> Optional[models.Tree]:
    tree = db.query(models.Tree).filter(models.Tree.id == tree_id).first()
    if not tree:
        return None
    tree.title = title
    db.commit()
    db.refresh(tree)
    return tree

def create_message(
    db: Session,
    tree_id: UUID,
    role: str,
    content: str,
    parent_id: Optional[UUID] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> models.Message:
    m = models.Message(tree_id=tree_id, role=role, content=content, parent_id=parent_id, meta=meta)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m

def get_tree_messages(db: Session, tree_id: UUID) -> List[models.Message]:
    return db.query(models.Message).filter(models.Message.tree_id == tree_id).order_by(models.Message.created_at.asc()).all()

def get_message(db: Session, message_id: UUID) -> Optional[models.Message]:
    return db.query(models.Message).filter(models.Message.id == message_id).first()

def get_path_to_root(db: Session, message_id: UUID) -> List[Dict[str, Any]]:
    sql = text("""
    WITH RECURSIVE path AS (
      SELECT id, parent_id, role, content, meta, created_at, 0 as depth
      FROM messages WHERE id = :mid
      UNION ALL
      SELECT m.id, m.parent_id, m.role, m.content, m.meta, m.created_at, p.depth + 1
      FROM messages m
      JOIN path p ON m.id = p.parent_id
    )
    SELECT id, parent_id, role, content, meta, created_at, depth
    FROM path
    ORDER BY depth DESC;
    """)
    rows = db.execute(sql, {"mid": str(message_id)}).mappings().all()
    return [dict(r) for r in rows]

from typing import Optional
from . import models
from sqlalchemy.orm import Session
from uuid import UUID

def get_root_message(db: Session, tree_id: UUID) -> Optional[models.Message]:
    q = db.query(models.Message).filter(
        models.Message.tree_id == tree_id,
        models.Message.parent_id.is_(None),
    )
    # Prefer a seeded system root, else any earliest root
    sys_root = q.filter(models.Message.role == "system").order_by(models.Message.created_at.asc()).first()
    if sys_root:
        return sys_root
    return q.order_by(models.Message.created_at.asc()).first()

def get_subtree_message_ids(db: Session, message_id: UUID) -> List[UUID]:
    sql = text("""
    WITH RECURSIVE subtree AS (
      SELECT id FROM messages WHERE id = :mid
      UNION ALL
      SELECT m.id FROM messages m
      JOIN subtree s ON m.parent_id = s.id
    )
    SELECT id FROM subtree;
    """)
    rows = db.execute(sql, {"mid": str(message_id)}).fetchall()
    return [UUID(str(row[0])) for row in rows]


def delete_subtree(db: Session, message_id: UUID) -> int:
    ids = get_subtree_message_ids(db, message_id)
    if not ids:
        return 0
    db.query(models.Message).filter(models.Message.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return len(ids)


def get_files_for_messages(db: Session, message_ids: Iterable[UUID]) -> List[models.FileAsset]:
    ids = list(message_ids)
    if not ids:
        return []
    return (
        db.query(models.FileAsset)
        .filter(models.FileAsset.message_id.in_(ids), models.FileAsset.deleted_at.is_(None))
        .all()
    )


def delete_files_for_messages(db: Session, message_ids: Iterable[UUID]) -> List[models.FileAsset]:
    ids = list(message_ids)
    if not ids:
        return []
    rows = (
        db.query(models.FileAsset)
        .filter(models.FileAsset.message_id.in_(ids), models.FileAsset.deleted_at.is_(None))
        .all()
    )
    return rows


def delete_files_for_tree(db: Session, tree_id: UUID) -> List[models.FileAsset]:
    rows = (
        db.query(models.FileAsset)
        .filter(models.FileAsset.tree_id == tree_id, models.FileAsset.deleted_at.is_(None))
        .all()
    )
    return rows


def update_message_meta(db: Session, message_id: UUID, meta: Optional[Dict[str, Any]]) -> Optional[models.Message]:
    msg = db.query(models.Message).filter(models.Message.id == message_id).first()
    if not msg:
        return None
    msg.meta = meta
    db.commit()
    db.refresh(msg)
    return msg

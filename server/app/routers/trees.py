from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from .. import schemas, crud

router = APIRouter(prefix="/trees", tags=["trees"])

@router.post("", response_model=schemas.TreeOut)
def create_tree(payload: schemas.TreeCreate, db: Session = Depends(get_db)):
    t = crud.create_tree(db, title=payload.title)
    # Optional: seed a visible root node so the graph isn't empty
    crud.create_message(
        db,
        tree_id=t.id,
        role="system",
        content="(root) – start a branch by selecting me or just send a message."
    )
    return t

@router.get("")
def list_trees(db: Session = Depends(get_db)):
    return [schemas.TreeOut.model_validate(t) for t in crud.list_trees(db)]

@router.delete("/{tree_id}")
def delete_tree(tree_id: UUID, db: Session = Depends(get_db)):
    deleted = crud.delete_tree(db, tree_id)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Tree not found")
    return {"deleted": deleted}

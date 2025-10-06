from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from .. import schemas, crud
from ..services import files as file_service
from ..deps import get_current_user_id

router = APIRouter(prefix="/trees", tags=["trees"])

@router.post("", response_model=schemas.TreeOut)
def create_tree(payload: schemas.TreeCreate, db: Session = Depends(get_db)):
    return crud.create_tree(db, title=payload.title)

@router.get("")
def list_trees(db: Session = Depends(get_db)):
    return [schemas.TreeOut.model_validate(t) for t in crud.list_trees(db)]

@router.delete("/{tree_id}")
def delete_tree(
    tree_id: UUID,
    db: Session = Depends(get_db),
    _user_id: str = Depends(get_current_user_id),
):
    file_records = crud.delete_files_for_tree(db, tree_id)
    if file_records:
        file_service.delete_files(db, None, [f.id for f in file_records])

    deleted = crud.delete_tree(db, tree_id)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Tree not found")
    return {"deleted": deleted}

@router.patch("/{tree_id}", response_model=schemas.TreeOut)
def rename_tree(tree_id: UUID, payload: schemas.TreeUpdate, db: Session = Depends(get_db)):
    updated = crud.update_tree_title(db, tree_id, payload.title)
    if not updated:
        raise HTTPException(status_code=404, detail="Tree not found")
    return schemas.TreeOut.model_validate(updated)

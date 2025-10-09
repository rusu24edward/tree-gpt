from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..deps import get_current_user_id
from ..schemas import (
    FileCompleteRequest,
    FileListResponse,
    FileMetadata,
    FileSignRequest,
    SignedUploadResponse,
)
from ..services import files as file_service
from ..services import storage

router = APIRouter(prefix="/files", tags=["files"])


@router.post("/sign", response_model=SignedUploadResponse)
def sign_upload(
    payload: FileSignRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        pending = file_service.create_pending_upload(db, user_id, payload)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=500, detail="Failed to initiate upload") from err

    return SignedUploadResponse(
        file_id=pending.record.id,
        upload_url=pending.upload_url,
        expires_at=pending.expires_at,
        required_headers={"Content-Type": pending.record.content_type},
        max_size=file_service.MAX_FILE_SIZE_BYTES,
    )


@router.post("/{file_id}/complete", response_model=FileMetadata)
def complete_upload(
    file_id: UUID,
    payload: FileCompleteRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        record = file_service.complete_upload(db, user_id, file_id, payload)
    except NoResultFound:
        raise HTTPException(status_code=404, detail="File not found")
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=500, detail="Failed to finalize upload") from err
    return file_service.serialize_metadata(record)


@router.get("/{file_id}", response_model=FileMetadata)
def get_file(
    file_id: UUID,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        record = file_service.get_file(db, user_id, file_id)
    except NoResultFound:
        raise HTTPException(status_code=404, detail="File not found")
    return file_service.serialize_metadata(record)


@router.get("", response_model=FileListResponse)
def list_files(
    tree_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    if not tree_id:
        files = (
            db.query(models.FileAsset)
            .filter(
                models.FileAsset.uploader_id == user_id,
                models.FileAsset.deleted_at.is_(None),
            )
            .order_by(models.FileAsset.created_at.desc())
            .all()
        )
    else:
        files = file_service.list_files_for_tree(db, user_id, tree_id)
    return FileListResponse(files=[file_service.serialize_metadata(f) for f in files])


@router.delete("/{file_id}")
def delete_file(
    file_id: UUID,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    deleted = file_service.delete_files(db, user_id, [file_id])
    if deleted == 0:
        raise HTTPException(status_code=404, detail="File not found")
    return {"deleted": deleted}


@router.get("/{file_id}/download")
def get_download_url(
    file_id: UUID,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        record = file_service.get_file(db, user_id, file_id)
    except NoResultFound:
        raise HTTPException(status_code=404, detail="File not found")
    if record.status not in {"ready", "attached"}:
        raise HTTPException(status_code=400, detail="File is not ready for download")
    url = storage.generate_presigned_download(record.object_key)
    expires = storage.expires_at(storage.download_expiration_seconds())
    return {"download_url": url, "expires_at": expires}


@router.get("/{file_id}/thumbnail")
def get_thumbnail_url(
    file_id: UUID,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    try:
        record = file_service.get_file(db, user_id, file_id)
    except NoResultFound:
        raise HTTPException(status_code=404, detail="File not found")
    if not record.thumbnail_key:
        raise HTTPException(status_code=404, detail="Thumbnail not available")
    url = storage.generate_presigned_download(record.thumbnail_key)
    expires = storage.expires_at(storage.download_expiration_seconds())
    return {"thumbnail_url": url, "expires_at": expires}

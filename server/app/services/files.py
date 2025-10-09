import logging
import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from typing import Iterable, List, Optional, Sequence, Tuple

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import Session

from .. import models
from ..schemas import FileSignRequest, FileCompleteRequest, FileMetadata, MessageAttachment
from . import storage

DISALLOWED_EXTENSIONS = {".exe", ".js", ".bat", ".cmd", ".sh", ".dll", ".com"}
ALLOWED_CONTENT_PREFIXES: Tuple[str, ...] = (
    "image/",
    "application/pdf",
    "application/msword",
    "application/vnd",
    "application/zip",
    "application/x-zip",
    "application/x-zip-compressed",
    "application/x-tar",
    "application/json",
    "text/plain",
    "text/csv",
)

MAX_FILE_SIZE_BYTES = int(os.getenv("UPLOAD_MAX_BYTES", str(25 * 1024 * 1024)))
MAX_FILES_PER_USER = int(os.getenv("UPLOAD_MAX_FILES_PER_USER", "200"))
MAX_TOTAL_BYTES_PER_USER = int(os.getenv("UPLOAD_MAX_TOTAL_BYTES_PER_USER", str(1024 * 1024 * 1024)))
MAX_ATTACHMENTS_PER_MESSAGE = int(os.getenv("UPLOAD_MAX_ATTACHMENTS_PER_MESSAGE", "5"))
THUMBNAIL_MAX_DIMENSION = int(os.getenv("STORAGE_THUMBNAIL_MAX_SIZE", "512"))
THUMBNAIL_CONTENT_TYPE = "image/jpeg"

_FILENAME_SAFE_PATTERN = re.compile(r"[^A-Za-z0-9_.-]+")


logger = logging.getLogger(__name__)


@dataclass
class PendingUpload:
    record: models.FileAsset
    upload_url: str
    expires_at: datetime


def sanitize_filename(filename: str) -> str:
    base = filename.strip() or "file"
    sanitized = _FILENAME_SAFE_PATTERN.sub("_", base)
    if not sanitized:
        sanitized = "file"
    return sanitized[:200]


def _extension_of(filename: str) -> str:
    idx = filename.rfind(".")
    if idx == -1:
        return ""
    return filename[idx:].lower()


def _validate_quota(db: Session, user_id: str, new_size: int) -> None:
    total_files = db.scalar(
        select(func.count(models.FileAsset.id)).where(
            models.FileAsset.uploader_id == user_id,
            models.FileAsset.deleted_at.is_(None),
        )
    ) or 0
    if total_files >= MAX_FILES_PER_USER:
        raise ValueError("Upload limit reached for this user")

    total_bytes = db.scalar(
        select(func.coalesce(func.sum(models.FileAsset.size), 0)).where(
            models.FileAsset.uploader_id == user_id,
            models.FileAsset.deleted_at.is_(None),
        )
    ) or 0
    if total_bytes + new_size > MAX_TOTAL_BYTES_PER_USER:
        raise ValueError("Total storage quota exceeded")


def _validate_file_type(filename: str, content_type: str) -> None:
    ext = _extension_of(filename)
    if ext in DISALLOWED_EXTENSIONS:
        raise ValueError("This file type is not allowed")
    prefix_allowed = any(content_type.startswith(prefix) for prefix in ALLOWED_CONTENT_PREFIXES)
    if not prefix_allowed:
        raise ValueError("Unsupported content type")


def _validate_size(size: int) -> None:
    if size <= 0:
        raise ValueError("File size must be greater than zero")
    if size > MAX_FILE_SIZE_BYTES:
        raise ValueError("File exceeds the maximum allowed size")


def create_pending_upload(db: Session, user_id: str, payload: FileSignRequest) -> PendingUpload:
    _validate_size(payload.size)
    safe_filename = sanitize_filename(payload.filename)
    _validate_file_type(safe_filename, payload.content_type)
    _validate_quota(db, user_id, payload.size)

    file_id = uuid.uuid4()
    object_key = storage.generate_object_key(user_id, str(file_id), safe_filename)
    upload_url = storage.generate_presigned_upload(object_key, payload.content_type)
    expires_at = storage.expires_at(storage.upload_expiration_seconds())

    record = models.FileAsset(
        id=file_id,
        uploader_id=user_id,
        filename=safe_filename,
        content_type=payload.content_type,
        size=payload.size,
        bucket=storage.bucket_name(),
        object_key=object_key,
        status="pending",
        upload_expires_at=expires_at,
        tree_id=payload.tree_id,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return PendingUpload(record=record, upload_url=upload_url, expires_at=expires_at)


def _generate_thumbnail(data: bytes) -> Optional[bytes]:
    try:
        with Image.open(BytesIO(data)) as image:
            image = ImageOps.exif_transpose(image)
            image.thumbnail((THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION))
            if image.mode not in ("RGB",):
                image = image.convert("RGB")
            output = BytesIO()
            image.save(output, format="JPEG", optimize=True, quality=80)
            return output.getvalue()
    except UnidentifiedImageError:
        return None
    except Exception as exc:
        logger.warning("Failed to generate thumbnail: %s", exc)
        return None


def complete_upload(db: Session, user_id: str, file_id: uuid.UUID, payload: FileCompleteRequest) -> models.FileAsset:
    record = (
        db.query(models.FileAsset)
        .filter(
            models.FileAsset.id == file_id,
            models.FileAsset.uploader_id == user_id,
            models.FileAsset.deleted_at.is_(None),
        )
        .one_or_none()
    )
    if not record:
        raise NoResultFound

    if record.status not in {"pending", "uploading"}:
        raise ValueError("File is already finalized")

    head = storage.safe_head_object(record.object_key)
    if not head:
        raise ValueError("Uploaded object not found in storage")

    content_length = head.get("ContentLength")
    if int(content_length or 0) != record.size:
        raise ValueError("Uploaded object size mismatch")

    if payload.tree_id and record.tree_id is None:
        record.tree_id = payload.tree_id

    record.status = "ready"
    record.checksum = payload.checksum or record.checksum
    record.upload_expires_at = None
    record.updated_at = datetime.now(timezone.utc)

    if record.content_type.startswith("image/"):
        blob = storage.fetch_object_bytes(record.object_key)
        thumb = _generate_thumbnail(blob)
        if thumb:
            thumb_key = f"{record.object_key}.thumbnail.jpg"
            try:
                storage.upload_bytes(thumb_key, thumb, THUMBNAIL_CONTENT_TYPE)
            except Exception as exc:
                logger.warning("Failed to upload thumbnail %s: %s", thumb_key, exc)
            else:
                record.thumbnail_key = thumb_key
                meta = dict(record.meta or {})
                meta["thumbnail_content_type"] = THUMBNAIL_CONTENT_TYPE
                record.meta = meta

    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_file(db: Session, user_id: str, file_id: uuid.UUID) -> models.FileAsset:
    record = (
        db.query(models.FileAsset)
        .filter(
            models.FileAsset.id == file_id,
            models.FileAsset.uploader_id == user_id,
            models.FileAsset.deleted_at.is_(None),
        )
        .one_or_none()
    )
    if not record:
        raise NoResultFound
    return record


def require_files(db: Session, user_id: str, file_ids: Sequence[uuid.UUID]) -> List[models.FileAsset]:
    if not file_ids:
        return []
    rows = (
        db.query(models.FileAsset)
        .filter(
            models.FileAsset.id.in_(file_ids),
            models.FileAsset.uploader_id == user_id,
            models.FileAsset.deleted_at.is_(None),
        )
        .all()
    )
    found = {row.id for row in rows}
    missing = [str(fid) for fid in file_ids if fid not in found]
    if missing:
        raise ValueError(f"Unknown attachments: {', '.join(missing)}")
    row_map = {row.id: row for row in rows}
    return [row_map[fid] for fid in file_ids]


def mark_files_attached(db: Session, files: Iterable[models.FileAsset], tree_id, message_id) -> None:
    now = datetime.now(timezone.utc)
    for record in files:
        if record.status != "ready":
            raise ValueError(f"File {record.id} is not ready for attachment")
        if record.message_id and record.message_id != message_id:
            raise ValueError(f"File {record.id} is already attached")
        record.message_id = message_id
        if tree_id:
            record.tree_id = tree_id
        record.status = "attached"
        record.attached_at = now
    db.commit()


def serialize_for_message(record: models.FileAsset) -> MessageAttachment:
    download_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    if record.status in {"ready", "attached"}:
        download_url = storage.generate_presigned_download(record.object_key)
        if record.thumbnail_key:
            thumbnail_url = storage.generate_presigned_download(record.thumbnail_key)
    return MessageAttachment(
        id=record.id,
        filename=record.filename,
        content_type=record.content_type,
        size=record.size,
        status=record.status,
        download_url=download_url,
        thumbnail_url=thumbnail_url,
    )


def serialize_metadata(record: models.FileAsset) -> FileMetadata:
    download_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    if record.status in {"ready", "attached"}:
        download_url = storage.generate_presigned_download(record.object_key)
        if record.thumbnail_key:
            thumbnail_url = storage.generate_presigned_download(record.thumbnail_key)
    return FileMetadata(
        id=record.id,
        filename=record.filename,
        content_type=record.content_type,
        size=record.size,
        status=record.status,
        tree_id=record.tree_id,
        message_id=record.message_id,
        download_url=download_url,
        thumbnail_url=thumbnail_url,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def list_files_for_tree(db: Session, user_id: str, tree_id) -> List[models.FileAsset]:
    return (
        db.query(models.FileAsset)
        .filter(
            models.FileAsset.uploader_id == user_id,
            models.FileAsset.tree_id == tree_id,
            models.FileAsset.deleted_at.is_(None),
        )
        .order_by(models.FileAsset.created_at.desc())
        .all()
    )


def delete_files(db: Session, user_id: Optional[str], file_ids: Iterable[uuid.UUID]) -> int:
    ids = list(file_ids)
    if not ids:
        return 0
    query = db.query(models.FileAsset).filter(models.FileAsset.id.in_(ids), models.FileAsset.deleted_at.is_(None))
    if user_id:
        query = query.filter(models.FileAsset.uploader_id == user_id)
    rows = query.all()
    keys_to_delete = []
    for record in rows:
        if record.object_key:
            keys_to_delete.append(record.object_key)
        if record.thumbnail_key:
            keys_to_delete.append(record.thumbnail_key)
        record.deleted_at = datetime.now(timezone.utc)
        record.status = "deleted"
    storage.delete_objects(keys_to_delete)
    db.commit()
    return len(rows)

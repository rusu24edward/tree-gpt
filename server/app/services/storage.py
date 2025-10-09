import os
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

import boto3
from botocore.client import BaseClient
from botocore.config import Config
from botocore.exceptions import ClientError


_STORAGE_CLIENT: Optional[BaseClient] = None


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


def _get_client() -> BaseClient:
    global _STORAGE_CLIENT
    if _STORAGE_CLIENT:
        return _STORAGE_CLIENT

    access_key = os.getenv("STORAGE_ACCESS_KEY_ID")
    secret_key = os.getenv("STORAGE_SECRET_ACCESS_KEY")
    region = os.getenv("STORAGE_REGION", "us-east-1")
    endpoint = os.getenv("STORAGE_ENDPOINT")
    addressing_style = "path" if _bool_env("STORAGE_FORCE_PATH_STYLE", True) else "auto"

    session = boto3.session.Session(
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region,
    )
    config = Config(signature_version="s3v4", s3={"addressing_style": addressing_style})
    _STORAGE_CLIENT = session.client("s3", endpoint_url=endpoint, config=config)
    return _STORAGE_CLIENT


def bucket_name() -> str:
    bucket = os.getenv("STORAGE_BUCKET")
    if not bucket:
        raise RuntimeError("Missing STORAGE_BUCKET configuration")
    return bucket


def upload_expiration_seconds() -> int:
    return int(os.getenv("STORAGE_UPLOAD_URL_EXPIRES_SECONDS", "300"))


def download_expiration_seconds() -> int:
    return int(os.getenv("STORAGE_DOWNLOAD_URL_EXPIRES_SECONDS", "300"))


def generate_object_key(user_id: str, file_id: str, filename: str) -> str:
    return f"uploads/{user_id}/{file_id}/{filename}"


def generate_presigned_upload(key: str, content_type: str, expires_in: Optional[int] = None) -> str:
    expires = expires_in or upload_expiration_seconds()
    client = _get_client()
    return client.generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket_name(), "Key": key, "ContentType": content_type},
        ExpiresIn=expires,
        HttpMethod="PUT",
    )


def generate_presigned_download(key: str, expires_in: Optional[int] = None) -> str:
    expires = expires_in or download_expiration_seconds()
    client = _get_client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket_name(), "Key": key},
        ExpiresIn=expires,
        HttpMethod="GET",
    )


def head_object(key: str) -> dict:
    client = _get_client()
    return client.head_object(Bucket=bucket_name(), Key=key)


def fetch_object_bytes(key: str) -> bytes:
    client = _get_client()
    response = client.get_object(Bucket=bucket_name(), Key=key)
    body = response.get("Body")
    if body is None:
        raise RuntimeError("Object body missing")
    return body.read()


def upload_bytes(key: str, data: bytes, content_type: str) -> None:
    client = _get_client()
    client.put_object(Bucket=bucket_name(), Key=key, Body=data, ContentType=content_type)


def delete_objects(keys: Iterable[str]) -> None:
    items = [k for k in keys if k]
    if not items:
        return
    client = _get_client()
    entries = [{"Key": key} for key in items]
    client.delete_objects(Bucket=bucket_name(), Delete={"Objects": entries, "Quiet": True})


def expires_at(seconds: int) -> datetime:
    return datetime.now(timezone.utc) + timedelta(seconds=seconds)


class StorageError(Exception):
    pass


def safe_head_object(key: str) -> Optional[dict]:
    try:
        return head_object(key)
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code")
        if error_code in {"404", "NoSuchKey", "NotFound"}:
            return None
        raise StorageError(str(exc)) from exc

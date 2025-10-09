import re
from typing import Optional

from fastapi import Header, HTTPException, status

_USER_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{3,128}$")


def sanitize_user_id(raw: str) -> Optional[str]:
    candidate = raw.strip()
    if not candidate:
        return None
    if _USER_ID_PATTERN.match(candidate):
        return candidate
    return None


def get_current_user_id(x_user_id: Optional[str] = Header(None)) -> str:
    user_id = sanitize_user_id(x_user_id or "")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid user id")
    return user_id

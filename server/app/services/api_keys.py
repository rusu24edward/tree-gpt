"""Helpers for extracting API keys from incoming requests."""
from __future__ import annotations

from typing import Optional

from fastapi import Request

_HEADER_CANDIDATES = (
    "x-openai-key",
    "x-openai-api-key",
    "authorization",
)


def resolve_api_key(request: Request) -> Optional[str]:
    for header in _HEADER_CANDIDATES:
        value = request.headers.get(header)
        if not value:
            continue
        token = value.strip()
        if header == "authorization" and token.lower().startswith("bearer "):
            token = token[7:].strip()
        if token:
            return token
    return None

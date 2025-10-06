from datetime import datetime
from typing import Optional, List, Dict
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl

class TreeCreate(BaseModel):
    title: Optional[str] = None

class TreeUpdate(BaseModel):
    title: Optional[str] = None

class TreeOut(BaseModel):
    id: UUID
    title: Optional[str] = None
    class Config:
        from_attributes = True

class MessageCreate(BaseModel):
    tree_id: UUID
    parent_id: Optional[UUID] = None
    content: str
    attachments: List[UUID] = Field(default_factory=list)

class FileSignRequest(BaseModel):
    filename: str
    content_type: str
    size: int
    tree_id: Optional[UUID] = None


class SignedUploadResponse(BaseModel):
    file_id: UUID
    upload_url: HttpUrl
    expires_at: datetime
    required_headers: Dict[str, str]
    max_size: int


class FileCompleteRequest(BaseModel):
    tree_id: Optional[UUID] = None
    checksum: Optional[str] = None


class FileMetadata(BaseModel):
    id: UUID
    filename: str
    content_type: str
    size: int
    status: str
    tree_id: Optional[UUID] = None
    message_id: Optional[UUID] = None
    download_url: Optional[HttpUrl] = None
    thumbnail_url: Optional[HttpUrl] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class FileListResponse(BaseModel):
    files: List[FileMetadata]


class MessageAttachment(BaseModel):
    id: UUID
    filename: str
    content_type: str
    size: int
    status: str
    download_url: Optional[HttpUrl] = None
    thumbnail_url: Optional[HttpUrl] = None


class MessageOut(BaseModel):
    id: UUID
    tree_id: UUID
    parent_id: Optional[UUID] = None
    role: str
    content: str
    attachments: List[MessageAttachment] = Field(default_factory=list)
    class Config:
        from_attributes = True

class GraphNode(BaseModel):
    id: str
    role: str
    label: str
    parent_id: Optional[str] = None
    user_label: Optional[str] = None
    assistant_label: Optional[str] = None
    created_at: Optional[str] = None

class GraphEdge(BaseModel):
    id: str
    source: str
    target: str

class GraphResponse(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]

class PathMessage(BaseModel):
    role: str
    content: str
    attachments: List[MessageAttachment] = Field(default_factory=list)

class PathResponse(BaseModel):
    path: List[PathMessage]

class BranchForkResponse(BaseModel):
    tree: TreeOut
    active_node_id: UUID

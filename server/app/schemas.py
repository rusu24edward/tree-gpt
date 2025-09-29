from typing import Optional, List
from pydantic import BaseModel
from uuid import UUID

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

class MessageOut(BaseModel):
    id: UUID
    tree_id: UUID
    parent_id: Optional[UUID] = None
    role: str
    content: str
    class Config:
        from_attributes = True

class GraphNode(BaseModel):
    id: str
    role: str
    label: str
    parent_id: Optional[str] = None
    user_label: Optional[str] = None
    assistant_label: Optional[str] = None

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

class PathResponse(BaseModel):
    path: List[PathMessage]

class BranchForkResponse(BaseModel):
    tree: TreeOut
    active_node_id: UUID

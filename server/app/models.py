import uuid
from sqlalchemy import Column, DateTime, ForeignKey, String, Text, func, BigInteger
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from .database import Base

class Tree(Base):
    __tablename__ = "trees"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String(255), nullable=True)

class Message(Base):
    __tablename__ = "messages"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tree_id = Column(UUID(as_uuid=True), ForeignKey("trees.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True, index=True)
    role = Column(String(16), nullable=False)  # 'system' | 'user' | 'assistant'
    content = Column(Text, nullable=False)
    meta = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # optional relation for ORM navigations (unused in queries)
    parent = relationship("Message", remote_side=[id], uselist=False)


class FileAsset(Base):
    __tablename__ = "files"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tree_id = Column(UUID(as_uuid=True), ForeignKey("trees.id", ondelete="SET NULL"), nullable=True, index=True)
    message_id = Column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True, index=True)
    uploader_id = Column(String(128), nullable=False, index=True)
    filename = Column(String(512), nullable=False)
    content_type = Column(String(255), nullable=False)
    size = Column(BigInteger, nullable=False)
    bucket = Column(String(255), nullable=False)
    object_key = Column(String(1024), nullable=False, unique=True)
    thumbnail_key = Column(String(1024), nullable=True)
    status = Column(String(32), nullable=False, default="pending", index=True)
    checksum = Column(String(128), nullable=True)
    meta = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    upload_expires_at = Column(DateTime(timezone=True), nullable=True)
    attached_at = Column(DateTime(timezone=True), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

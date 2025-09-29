import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { fetchJSON, API_BASE } from '../lib/api';
import type { GraphResponse, TreeOut, BranchForkResponse } from '../lib/api';

const ChatGraph = dynamic(() => import('../components/ChatGraph'), { ssr: false });
import ChatPane from '../components/ChatPane';

export default function Home() {
  const [trees, setTrees] = useState<TreeOut[]>([]);
  const [activeTreeId, setActiveTreeId] = useState<string | null>(null);
  const [graph, setGraph] = useState<GraphResponse>({ nodes: [], edges: [] });
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [isLoadingTrees, setIsLoadingTrees] = useState(false);
  const [isSyncingGraph, setIsSyncingGraph] = useState(false);
  const [editingTreeId, setEditingTreeId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [pendingTreeId, setPendingTreeId] = useState<string | null>(null);
  const [blankTreeId, setBlankTreeId] = useState<string | null>(null);
  const pendingFocusNodeIdRef = useRef<string | null>(null);

  const hasMessages = graph.nodes.length > 0;
  const rootId = useMemo(() => graph.nodes.find((n) => !n.parent_id)?.id ?? null, [graph]);
  const activeNode = useMemo(() => graph.nodes.find((n) => n.id === activeNodeId) ?? null, [graph, activeNodeId]);
  const isEmptyConversation = Boolean(activeTreeId) && !hasMessages;
  const deleteLabel = activeNode && !activeNode.parent_id ? 'Delete conversation' : 'Delete branch';

  const ensureInitialTree = useCallback(async () => {
    setIsLoadingTrees(true);
    try {
      const list = await fetchJSON<TreeOut[]>('/api/trees');
      setTrees(list);
      setActiveTreeId((prev) => {
        if (prev && list.some((t) => t.id === prev)) {
          return prev;
        }
        return list[0]?.id ?? null;
      });
    } finally {
      setIsLoadingTrees(false);
    }
  }, []);

  useEffect(() => {
    ensureInitialTree();
  }, [ensureInitialTree]);

  const refreshGraph = useCallback(
    async (treeId: string, opts?: { selectRoot?: boolean; focusNodeId?: string | null }) => {
      setIsSyncingGraph(true);
      try {
        const data = await fetchJSON<GraphResponse>(`/api/messages/graph/${treeId}`);
        setGraph(data);
        const root = data.nodes.find((n) => !n.parent_id)?.id ?? null;
        const focusId = opts?.focusNodeId ?? null;
        const shouldSelectRoot = Boolean(opts?.selectRoot);

        setActiveNodeId((prev) => {
          if (focusId && data.nodes.some((n) => n.id === focusId)) {
            return focusId;
          }
          if (shouldSelectRoot) {
            return root;
          }
          if (!prev) return root;
          return data.nodes.some((n) => n.id === prev) ? prev : root;
        });

        if (data.nodes.length === 0) {
          setBlankTreeId(treeId);
        } else if (blankTreeId === treeId) {
          setBlankTreeId(null);
        }

        return data;
      } finally {
        setIsSyncingGraph(false);
      }
    },
    [blankTreeId]
  );

  useEffect(() => {
    if (!activeTreeId) {
      setGraph({ nodes: [], edges: [] });
      setActiveNodeId(null);
      return;
    }
    const focusId = pendingFocusNodeIdRef.current;
    const opts = focusId ? { focusNodeId: focusId } : { selectRoot: true };
    pendingFocusNodeIdRef.current = null;
    void refreshGraph(activeTreeId, opts);
  }, [activeTreeId, refreshGraph]);

  const handleCreateTree = useCallback(async () => {
    if (isEmptyConversation || blankTreeId) return;
    setIsLoadingTrees(true);
    try {
      const newTree = await fetchJSON<TreeOut>('/api/trees', {
        method: 'POST',
        body: JSON.stringify({ title: 'New Conversation' }),
      });
      setTrees((prev) => [newTree, ...prev]);
      setActiveNodeId(null);
      setActiveTreeId(newTree.id);
      setBlankTreeId(newTree.id);
    } finally {
      setIsLoadingTrees(false);
    }
  }, [blankTreeId, isEmptyConversation]);

  const handleSelectTree = useCallback(
    async (treeId: string) => {
      if (treeId === activeTreeId) return;

      if (blankTreeId && blankTreeId === activeTreeId && isEmptyConversation) {
        try {
          await fetchJSON(`/api/trees/${blankTreeId}`, { method: 'DELETE' });
        } catch (err) {
          console.error('Failed to discard empty conversation', err);
        }
        setTrees((prev) => prev.filter((t) => t.id !== blankTreeId));
        setBlankTreeId(null);
        setGraph({ nodes: [], edges: [] });
        setActiveNodeId(null);
        setActiveTreeId(null);
      }

      if (editingTreeId && editingTreeId !== treeId) {
        setEditingTreeId(null);
        setEditingTitle('');
      }
      setActiveNodeId(null);
      setActiveTreeId(treeId);
    },
    [activeTreeId, blankTreeId, editingTreeId, isEmptyConversation]
  );

  const handleStartRename = useCallback((tree: TreeOut) => {
    setEditingTreeId(tree.id);
    setEditingTitle(tree.title ?? '');
  }, []);

  const handleCancelRename = useCallback(() => {
    setEditingTreeId(null);
    setEditingTitle('');
  }, []);

  const handleRenameSubmit = useCallback(
    async (evt?: React.FormEvent<HTMLFormElement>) => {
      if (evt) evt.preventDefault();
      if (!editingTreeId) return;
      const trimmed = editingTitle.trim();
      const currentTitle = trees.find((t) => t.id === editingTreeId)?.title ?? '';
      const normalizedCurrent = (currentTitle ?? '').trim();
      if (trimmed === normalizedCurrent) {
        setEditingTreeId(null);
        setEditingTitle('');
        return;
      }

      setPendingTreeId(editingTreeId);
      try {
        const payload = { title: trimmed.length ? trimmed : null };
        const updated = await fetchJSON<TreeOut>(`/api/trees/${editingTreeId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setTrees((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setEditingTreeId(null);
        setEditingTitle('');
      } finally {
        setPendingTreeId(null);
      }
    },
    [editingTreeId, editingTitle, trees]
  );

  const handleDeleteTree = useCallback(
    async (treeId: string) => {
      const confirmed = window.confirm('Delete this conversation and all its messages?');
      if (!confirmed) return;
      setPendingTreeId(treeId);
      try {
        await fetchJSON(`/api/trees/${treeId}`, { method: 'DELETE' });
        const wasActive = treeId === activeTreeId;
        const wasEditing = treeId === editingTreeId;
        if (blankTreeId === treeId) {
          setBlankTreeId(null);
        }
        setTrees((prev) => {
          const next = prev.filter((t) => t.id !== treeId);
          if (wasActive) {
            const nextActive = next[0]?.id ?? null;
            setActiveTreeId(nextActive);
            setActiveNodeId(null);
            if (!nextActive) {
              setGraph({ nodes: [], edges: [] });
            }
          }
          return next;
        });
        if (wasEditing) {
          setEditingTreeId(null);
          setEditingTitle('');
        }
      } finally {
        setPendingTreeId(null);
      }
    },
    [activeTreeId, blankTreeId, editingTreeId]
  );

  const handleDeleteActive = useCallback(async () => {
    if (!activeTreeId || !activeNodeId || !activeNode) return;

    if (!activeNode.parent_id) {
      await handleDeleteTree(activeTreeId);
      return;
    }

    await fetchJSON(`/api/messages/${activeNodeId}`, { method: 'DELETE' });
    setActiveNodeId(activeNode.parent_id);
    await refreshGraph(activeTreeId);
  }, [activeTreeId, activeNodeId, activeNode, handleDeleteTree, refreshGraph]);

  const handleAfterSend = useCallback(
    (newAssistantId: string) => {
      setActiveNodeId(newAssistantId);
      if (blankTreeId === activeTreeId) {
        setBlankTreeId(null);
      }
      if (activeTreeId) {
        refreshGraph(activeTreeId);
      }
    },
    [activeTreeId, blankTreeId, refreshGraph]
  );

  const handleForkActive = useCallback(async () => {
    if (!activeNodeId) return;
    try {
      const result = await fetchJSON<BranchForkResponse>(`/api/messages/branch/${activeNodeId}/fork`, {
        method: 'POST',
      });
      setTrees((prev) => {
        const filtered = prev.filter((t) => t.id !== result.tree.id);
        return [result.tree, ...filtered];
      });
      pendingFocusNodeIdRef.current = result.active_node_id;
      setActiveTreeId(result.tree.id);
      setActiveNodeId(result.active_node_id);
      setBlankTreeId((prev) => (prev === result.tree.id ? null : prev));
    } catch (err) {
      console.error('Failed to create conversation from branch', err);
    }
  }, [activeNodeId]);

  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const ensureActiveTree = useCallback(async () => {
    if (activeTreeId) {
      return activeTreeId;
    }
    if (blankTreeId) {
      return blankTreeId;
    }

    setIsLoadingTrees(true);
    try {
      const newTree = await fetchJSON<TreeOut>('/api/trees', {
        method: 'POST',
        body: JSON.stringify({ title: 'New Conversation' }),
      });
      setTrees((prev) => [newTree, ...prev]);
      setActiveTreeId(newTree.id);
      setActiveNodeId(null);
      setGraph({ nodes: [], edges: [] });
      setBlankTreeId(newTree.id);
      return newTree.id;
    } finally {
      setIsLoadingTrees(false);
    }
  }, [activeTreeId, blankTreeId]);

  const handleMenuRename = useCallback(
    (tree: TreeOut) => {
      handleStartRename(tree);
    },
    [handleStartRename]
  );

  const handleMenuDelete = useCallback(
    (treeId: string) => {
      handleDeleteTree(treeId);
    },
    [handleDeleteTree]
  );

  useEffect(() => {
    if (editingTreeId && renameInputRef.current) {
      const input = renameInputRef.current;
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    }
  }, [editingTreeId]);

  return (
    <div className="app">
      <header>
        <div className="title">
          <span>Branching Chat</span>
          <small>API: {API_BASE}</small>
        </div>
        <div className="header-actions">
          <button onClick={handleCreateTree} disabled={isLoadingTrees || blankTreeId !== null}>
            New conversation
          </button>
        </div>
      </header>

      <main>
        <aside className="trees">
          <div className="trees-header">
            <span>Conversations</span>
            <button onClick={handleCreateTree} disabled={isLoadingTrees || blankTreeId !== null}>
              + New
            </button>
          </div>
          <div className="tree-list">
            {isLoadingTrees && trees.length === 0 && <div className="hint">Loading…</div>}
            {!isLoadingTrees && trees.length === 0 && <div className="hint">No conversations yet.</div>}
            {trees.map((tree) => {
              const isActive = tree.id === activeTreeId;
              const isEditing = editingTreeId === tree.id;
              const isPending = pendingTreeId === tree.id;
              const hasMutation = pendingTreeId !== null;
              const displayTitle = tree.title && tree.title.trim().length > 0 ? tree.title : 'Untitled conversation';
              return (
                <div
                  key={tree.id}
                  className={`tree-item ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    if (isEditing || isPending) return;
                    void handleSelectTree(tree.id);
                  }}
                >
                  {isEditing ? (
                    <form
                      className="tree-item-edit"
                      onSubmit={handleRenameSubmit}
                      onClick={(evt) => evt.stopPropagation()}
                    >
                      <input
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        placeholder="Conversation title"
                        ref={(node) => {
                          renameInputRef.current = node;
                        }}
                        onKeyDown={(evt) => {
                          if (evt.key === 'Escape') {
                            evt.preventDefault();
                            handleCancelRename();
                          }
                        }}
                        disabled={isPending}
                      />
                      <div className="tree-item-edit-actions">
                        <button type="submit" disabled={isPending}>Save</button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={handleCancelRename}
                          disabled={isPending}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="tree-item-top">
                        <button
                          type="button"
                          className="tree-item-main"
                          onClick={(evt) => {
                            evt.stopPropagation();
                            if (isPending) return;
                            void handleSelectTree(tree.id);
                          }}
                          disabled={isPending}
                        >
                          <span className="tree-title">{displayTitle}</span>
                        </button>
                        <div className="tree-item-icons">
                          <button
                            type="button"
                            className="icon-button"
                            onClick={(evt) => {
                              evt.stopPropagation();
                              if (hasMutation || isLoadingTrees) return;
                              handleMenuRename(tree);
                            }}
                            disabled={hasMutation || isLoadingTrees}
                            aria-label="Rename conversation"
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            className="icon-button danger"
                            onClick={(evt) => {
                              evt.stopPropagation();
                              if (hasMutation) return;
                              handleMenuDelete(tree.id);
                            }}
                            disabled={hasMutation}
                            aria-label="Delete conversation"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <div className="graph">
          {activeTreeId ? (
            <ChatGraph
              data={graph}
              onSelectNode={setActiveNodeId}
              activeNodeId={activeNodeId}
              onDeleteActive={handleDeleteActive}
              onForkActive={handleForkActive}
              deleteLabel={deleteLabel}
            />
          ) : (
            <div className="empty">Create or select a conversation to see the graph.</div>
          )}
        </div>

        <div className="chat">
          <ChatPane
            activeNodeId={activeNodeId}
            treeId={activeTreeId}
            defaultParentId={rootId}
            onAfterSend={handleAfterSend}
            onDeleteNode={handleDeleteActive}
            isDeleteDisabled={!activeNode}
            showEmptyOverlay={isEmptyConversation}
            onEnsureTree={ensureActiveTree}
            deleteLabel={deleteLabel}
          />
        </div>
      </main>

      <footer>
        <span>Branching Chat — manage multiple conversation trees.</span>
      </footer>

      <style jsx>{`
        .app {
          display: grid;
          grid-template-rows: 72px 1fr 52px;
          height: 100vh;
          background: radial-gradient(circle at top left, #f8f9ff 0%, #eef2ff 55%, #e4ecff 100%);
          color: #0f172a;
        }
        header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 32px;
          background: rgba(255, 255, 255, 0.88);
          backdrop-filter: blur(16px);
          border-bottom: 1px solid #dbe3f5;
        }
        .title {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .title span {
          font-size: 18px;
          font-weight: 700;
        }
        .title small {
          font-size: 12px;
          color: #6b7280;
        }
        .header-actions {
          display: flex;
          gap: 12px;
        }
        button {
          border-radius: 999px;
          border: 1px solid #c7cff9;
          background: linear-gradient(135deg, #f1f3ff, #dfe3ff);
          color: #1f2937;
          padding: 8px 20px;
          font-weight: 600;
          font-size: 13px;
          box-shadow: 0 12px 24px rgba(79, 97, 185, 0.18);
          transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
        }
        button:hover:enabled {
          transform: translateY(-1px);
          box-shadow: 0 18px 36px rgba(79, 97, 185, 0.24);
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          box-shadow: none;
          transform: none;
        }
        main {
          display: grid;
          grid-template-columns: 300px minmax(0, 1fr) 520px;
          gap: 24px;
          padding: 28px 36px;
          min-height: 0;
        }
        aside.trees,
        .graph,
        .chat {
          border-radius: 28px;
          background: rgba(255, 255, 255, 0.82);
          border: 1px solid #dbe3f5;
          box-shadow: 0 28px 56px rgba(30, 64, 175, 0.12);
          min-height: 0;
          overflow: hidden;
        }
        aside.trees {
          display: flex;
          flex-direction: column;
        }
        .trees-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 22px 12px;
          font-weight: 600;
          color: #1e293b;
        }
        .trees-header button {
          padding: 6px 16px;
          font-size: 12px;
          box-shadow: none;
        }
        .tree-list {
          flex: 1;
          overflow: auto;
          padding: 0 18px 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .tree-item {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 12px;
          text-align: left;
          border: 1px solid #d9e1ff;
          padding: 16px;
          border-radius: 18px;
          background: #ffffff;
          color: inherit;
          box-shadow: 0 14px 28px rgba(30, 64, 175, 0.12);
          transition: border 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
        }
        .tree-item:hover:not(.active) {
          transform: translateY(-1px);
          box-shadow: 0 20px 36px rgba(30, 64, 175, 0.18);
        }
        .tree-item.active {
          border-color: #6366f1;
          background: linear-gradient(135deg, rgba(129, 140, 248, 0.2), rgba(59, 130, 246, 0.18));
          box-shadow: 0 24px 48px rgba(79, 97, 185, 0.24);
        }
        .tree-item-top {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          width: 100%;
        }
        .tree-item-main {
          display: flex;
          align-items: flex-start;
          justify-content: flex-start;
          gap: 12px;
          flex: 1;
          width: 100%;
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0;
          font: inherit;
          color: inherit;
          text-align: left;
          cursor: pointer;
        }
        .tree-item-main:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .tree-item-icons {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .icon-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 10px;
          border: 1px solid rgba(99, 102, 241, 0.35);
          background: rgba(99, 102, 241, 0.12);
          color: #1e293b;
          font-size: 16px;
          box-shadow: none;
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }
        .icon-button:hover:enabled {
          transform: translateY(-1px);
          box-shadow: 0 12px 20px rgba(79, 97, 185, 0.18);
        }
        .icon-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          box-shadow: none;
          transform: none;
        }
        .icon-button.danger {
          border-color: #fecaca;
          background: #fee2e2;
          color: #b91c1c;
        }
        .tree-title {
          display: block;
          text-align: left;
          font-size: 14px;
          font-weight: 600;
          flex: 1;
          word-break: break-word;
        }
        .tree-item-edit-actions button {
          border-radius: 999px;
          border: 1px solid #c7cff9;
          background: rgba(99, 102, 241, 0.12);
          color: #1e293b;
          padding: 6px 14px;
          font-size: 12px;
          box-shadow: none;
          transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
        }
        .tree-item-edit-actions button:hover:enabled {
          transform: translateY(-1px);
          box-shadow: 0 10px 18px rgba(79, 97, 185, 0.18);
        }
        .tree-item-edit-actions .danger {
          background: #fee2e2;
          border-color: #fecaca;
          color: #b91c1c;
        }
        .tree-item-edit-actions .secondary {
          background: rgba(148, 163, 184, 0.2);
          border-color: rgba(148, 163, 184, 0.5);
          color: #475569;
        }
        .tree-item-edit {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .tree-item-edit-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
        }
        .tree-item-edit input {
          border-radius: 12px;
          border: 1px solid #cbd5e1;
          padding: 12px;
          font-size: 13px;
          background: #f8fafc;
          color: inherit;
          box-shadow: inset 0 2px 4px rgba(15, 23, 42, 0.06);
        }
        .tree-item-edit input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .hint {
          padding: 14px;
          border-radius: 16px;
          background: rgba(241, 245, 249, 0.72);
          color: #64748b;
          font-size: 13px;
        }
        .graph {
          position: relative;
          display: flex;
          background: linear-gradient(180deg, rgba(248, 249, 255, 0.9), rgba(231, 235, 255, 0.9));
        }
        .graph > div {
          flex: 1;
        }
        .graph .empty {
          display: flex;
          align-items: center;
          justify-content: center;
          color: #64748b;
          font-size: 14px;
        }
        .chat {
          display: flex;
          flex-direction: column;
        }
        footer {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 32px;
          background: rgba(255, 255, 255, 0.88);
          border-top: 1px solid #dbe3f5;
          color: #475569;
          font-size: 12px;
          backdrop-filter: blur(16px);
        }
      `}</style>
    </div>
  );
}

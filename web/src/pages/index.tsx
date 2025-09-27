import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { fetchJSON, API_BASE } from '../lib/api';
import type { GraphResponse, TreeOut } from '../lib/api';

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
  const [menuTreeId, setMenuTreeId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  const rootId = useMemo(() => graph.nodes.find((n) => !n.parent_id)?.id ?? null, [graph]);
  const activeNode = useMemo(() => graph.nodes.find((n) => n.id === activeNodeId) ?? null, [graph, activeNodeId]);

  const ensureInitialTree = useCallback(async () => {
    setIsLoadingTrees(true);
    try {
      const list = await fetchJSON<TreeOut[]>('/api/trees');
      if (list.length === 0) {
        const created = await fetchJSON<TreeOut>('/api/trees', {
          method: 'POST',
          body: JSON.stringify({ title: 'My Conversation' }),
        });
        setTrees([created]);
        setActiveTreeId(created.id);
      } else {
        setTrees(list);
        setActiveTreeId((prev) => {
          if (prev && list.some((t) => t.id === prev)) {
            return prev;
          }
          return list[0].id;
        });
      }
    } finally {
      setIsLoadingTrees(false);
    }
  }, []);

  useEffect(() => {
    ensureInitialTree();
  }, [ensureInitialTree]);

  const refreshGraph = useCallback(
    async (treeId: string, opts?: { selectRoot?: boolean }) => {
      setIsSyncingGraph(true);
      try {
        const data = await fetchJSON<GraphResponse>(`/api/messages/graph/${treeId}`);
        setGraph(data);
        const root = data.nodes.find((n) => !n.parent_id)?.id ?? null;

        if (opts?.selectRoot) {
          setActiveNodeId(root);
        } else {
          setActiveNodeId((prev) => {
            if (!prev) return root;
            return data.nodes.some((n) => n.id === prev) ? prev : root;
          });
        }

        return data;
      } finally {
        setIsSyncingGraph(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!activeTreeId) {
      setGraph({ nodes: [], edges: [] });
      setActiveNodeId(null);
      return;
    }
    refreshGraph(activeTreeId, { selectRoot: true });
  }, [activeTreeId, refreshGraph]);

  const handleCreateTree = useCallback(async () => {
    setIsLoadingTrees(true);
    try {
      const newTree = await fetchJSON<TreeOut>('/api/trees', {
        method: 'POST',
        body: JSON.stringify({ title: 'New Conversation' }),
      });
      setTrees((prev) => [newTree, ...prev]);
      setActiveNodeId(null);
      setActiveTreeId(newTree.id);
    } finally {
      setIsLoadingTrees(false);
    }
  }, []);

  const handleSelectTree = useCallback(
    (treeId: string) => {
      if (treeId === activeTreeId) return;
      if (editingTreeId && editingTreeId !== treeId) {
        setEditingTreeId(null);
        setEditingTitle('');
      }
      setMenuTreeId(null);
      setMenuPosition(null);
      setActiveNodeId(null);
      setActiveTreeId(treeId);
    },
    [activeTreeId, editingTreeId]
  );

  const handleStartRename = useCallback((tree: TreeOut) => {
    setMenuTreeId(null);
    setMenuPosition(null);
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
      setMenuTreeId(null);
      setMenuPosition(null);
      setPendingTreeId(treeId);
      try {
        await fetchJSON(`/api/trees/${treeId}`, { method: 'DELETE' });
        const wasActive = treeId === activeTreeId;
        const wasEditing = treeId === editingTreeId;
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
    [activeTreeId, editingTreeId]
  );

  const handleDeleteActive = useCallback(async () => {
    if (!activeTreeId || !activeNodeId) return;
    if (!activeNode || !activeNode.parent_id) return;

    await fetchJSON(`/api/messages/${activeNodeId}`, { method: 'DELETE' });
    setActiveNodeId(activeNode.parent_id);
    await refreshGraph(activeTreeId);
  }, [activeTreeId, activeNodeId, activeNode, refreshGraph]);

  const handleAfterSend = useCallback(
    (newAssistantId: string) => {
      setActiveNodeId(newAssistantId);
      if (activeTreeId) {
        refreshGraph(activeTreeId);
      }
    },
    [activeTreeId, refreshGraph]
  );

  const treeRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const handleToggleMenu = useCallback(
    (treeId: string) => {
      if (menuTreeId === treeId) {
        setMenuTreeId(null);
        setMenuPosition(null);
        return;
      }

      const anchor = treeRefs.current.get(treeId);
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const menuWidth = 176;
      const menuHeight = 160;
      const padding = 16;
      const maxLeft = window.innerWidth - menuWidth - padding;
      const tentativeLeft = rect.right - menuWidth;
      const left = Math.min(Math.max(tentativeLeft, padding), maxLeft);
      const desiredTop = rect.bottom + 8;
      const maxTop = window.innerHeight - menuHeight - padding;
      const minTop = padding;
      const top = Math.min(Math.max(desiredTop, minTop), maxTop);

      setMenuPosition({ top, left });
      setMenuTreeId(treeId);
    },
    [menuTreeId]
  );

  const handleMenuRename = useCallback(
    (tree: TreeOut) => {
      setMenuTreeId(null);
      setMenuPosition(null);
      handleStartRename(tree);
    },
    [handleStartRename]
  );

  const handleMenuDelete = useCallback(
    (treeId: string) => {
      setMenuTreeId(null);
      setMenuPosition(null);
      handleDeleteTree(treeId);
    },
    [handleDeleteTree]
  );

  useEffect(() => {
    if (!menuTreeId) return;
    function handleDismiss() {
      setMenuTreeId(null);
      setMenuPosition(null);
    }
    function handleKey(evt: KeyboardEvent) {
      if (evt.key === 'Escape') {
        setMenuTreeId(null);
        setMenuPosition(null);
      }
    }
    window.addEventListener('click', handleDismiss);
    window.addEventListener('scroll', handleDismiss, true);
    window.addEventListener('resize', handleDismiss);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('click', handleDismiss);
      window.removeEventListener('scroll', handleDismiss, true);
      window.removeEventListener('resize', handleDismiss);
      window.removeEventListener('keydown', handleKey);
    };
  }, [menuTreeId]);

  return (
    <div className="app">
      <header>
        <div className="title">
          <span>Branching Chat</span>
          <small>API: {API_BASE}</small>
        </div>
        <div className="header-actions">
          <button onClick={handleCreateTree} disabled={isLoadingTrees}>
            New conversation
          </button>
          <button onClick={() => activeTreeId && refreshGraph(activeTreeId)} disabled={!activeTreeId || isSyncingGraph}>
            Refresh graph
          </button>
        </div>
      </header>

      <main>
        <aside className="trees">
          <div className="trees-header">
            <span>Conversations</span>
            <button onClick={handleCreateTree} disabled={isLoadingTrees}>
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
              const isMenuOpen = menuTreeId === tree.id;

              return (
                <div
                  key={tree.id}
                  className={`tree-item ${isActive ? 'active' : ''} ${isMenuOpen ? 'menu-open' : ''}`}
                  ref={(node) => {
                    if (node) {
                      treeRefs.current.set(tree.id, node);
                    } else {
                      treeRefs.current.delete(tree.id);
                    }
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
                        autoFocus
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
                          onClick={() => handleSelectTree(tree.id)}
                          disabled={isPending}
                        >
                          <span className="tree-title">{displayTitle}</span>
                        </button>
                        <button
                          type="button"
                          className="tree-item-menu-trigger"
                          onClick={(evt) => {
                            evt.stopPropagation();
                            evt.preventDefault();
                            if (!hasMutation) {
                              handleToggleMenu(tree.id);
                            }
                          }}
                          disabled={hasMutation}
                          aria-haspopup="menu"
                          aria-expanded={isMenuOpen}
                          aria-label="Conversation actions"
                        >
                          ...
                        </button>
                      </div>
                      {isMenuOpen && (
                        <div
                          className="tree-item-menu"
                          role="menu"
                          style={
                            menuPosition
                              ? {
                                  position: 'fixed',
                                  zIndex: 40,
                                  top: menuPosition.top,
                                  left: menuPosition.left,
                                }
                              : undefined
                          }
                          onClick={(evt) => evt.stopPropagation()}
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(evt) => {
                              evt.stopPropagation();
                              handleMenuRename(tree);
                            }}
                            disabled={hasMutation || isLoadingTrees}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="danger"
                            role="menuitem"
                            onClick={(evt) => {
                              evt.stopPropagation();
                              handleMenuDelete(tree.id);
                            }}
                            disabled={hasMutation}
                          >
                            Delete
                          </button>
                        </div>
                      )}
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
            isDeleteDisabled={!activeNode || !activeNode.parent_id}
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
        }
        .tree-item-main {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 12px;
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0;
          padding-right: 36px;
          font: inherit;
          color: inherit;
          cursor: pointer;
        }
        .tree-item-main:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .tree-item-menu-trigger {
          position: absolute;
          top: 50%;
          right: 0;
          transform: translateY(-50%);
          border-radius: 999px;
          border: 1px solid #c7cff9;
          background: rgba(148, 163, 184, 0.2);
          color: #1e293b;
          padding: 6px 12px;
          font-size: 14px;
          font-weight: 600;
          line-height: 1;
          box-shadow: none;
          transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
          opacity: 0;
          pointer-events: none;
        }
        .tree-item-menu-trigger:hover:enabled {
          transform: translateY(calc(-50% - 2px));
          box-shadow: 0 10px 18px rgba(79, 97, 185, 0.18);
        }
        .tree-item-menu-trigger:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: translateY(-50%);
          box-shadow: none;
        }
        .tree-item:hover .tree-item-menu-trigger,
        .tree-item.menu-open .tree-item-menu-trigger,
        .tree-item-menu-trigger:focus,
        .tree-item-menu-trigger:focus-visible,
        .tree-item-menu-trigger:active {
          opacity: 1;
          pointer-events: auto;
        }
        .tree-title {
          font-size: 14px;
          font-weight: 600;
          flex: 1;
        }
        .tree-item-menu {
          position: fixed;
          z-index: 40;
          display: flex;
          flex-direction: column;
          gap: 6px;
          background: rgba(255, 255, 255, 0.95);
          border: 1px solid #dbe3f5;
          border-radius: 14px;
          padding: 8px;
          box-shadow: 0 20px 36px rgba(30, 64, 175, 0.18);
          min-width: 176px;
          pointer-events: auto;
        }
        .tree-item-menu button {
          border-radius: 10px;
          border: none;
          background: transparent;
          color: #1e293b;
          padding: 8px 12px;
          font-size: 13px;
          font-weight: 600;
          text-align: left;
          box-shadow: none;
          transition: background 0.18s ease, transform 0.18s ease;
        }
        .tree-item-menu button:hover:enabled {
          background: rgba(99, 102, 241, 0.12);
          transform: translateX(2px);
        }
        .tree-item-menu button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }
        .tree-item-menu .danger {
          color: #b91c1c;
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

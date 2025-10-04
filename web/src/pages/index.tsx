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
  const [composerFocusToken, setComposerFocusToken] = useState(0);
  const [isGraphExpanded, setIsGraphExpanded] = useState(false);
  const pendingFocusNodeIdRef = useRef<string | null>(null);
  const overlayCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingGraphNodeIdsRef = useRef<Map<string, { treeId: string; parentId: string | null }>>(new Map());
  const lastSelectedNodeRef = useRef<Map<string, string>>(new Map());
  const scrollPositionsRef = useRef<Map<string, number>>(new Map());
  const [unreadMap, setUnreadMap] = useState<Map<string, Set<string>>>(() => new Map());
  const activeTreeIdRef = useRef<string | null>(null);
  const blankTreeIdRef = useRef<string | null>(null);

  const hasMessages = graph.nodes.length > 0;
  const rootId = useMemo(() => graph.nodes.find((n) => !n.parent_id)?.id ?? null, [graph]);
  const activeNode = useMemo(() => graph.nodes.find((n) => n.id === activeNodeId) ?? null, [graph, activeNodeId]);
  const isEmptyConversation = Boolean(activeTreeId) && !hasMessages;
  const deleteLabel = activeNode && !activeNode.parent_id ? 'Delete conversation' : 'Delete branch';
  const forkLabel = 'Create conversation from branch';

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

  useEffect(() => {
    activeTreeIdRef.current = activeTreeId;
  }, [activeTreeId]);

  useEffect(() => {
    blankTreeIdRef.current = blankTreeId;
  }, [blankTreeId]);

  const markNodeUnread = useCallback((treeId: string, nodeId: string) => {
    if (!treeId || !nodeId) return;
    setUnreadMap((prev) => {
      const existing = prev.get(treeId);
      if (existing?.has(nodeId)) {
        return prev;
      }
      const next = new Map(prev);
      const nextSet = new Set(existing ?? []);
      nextSet.add(nodeId);
      next.set(treeId, nextSet);
      return next;
    });
  }, []);

  const markNodeRead = useCallback((treeId: string, nodeId: string) => {
    if (!treeId || !nodeId) return;
    setUnreadMap((prev) => {
      const existing = prev.get(treeId);
      if (!existing || !existing.has(nodeId)) {
        return prev;
      }
      const next = new Map(prev);
      const nextSet = new Set(existing);
      nextSet.delete(nodeId);
      if (nextSet.size === 0) {
        next.delete(treeId);
      } else {
        next.set(treeId, nextSet);
      }
      return next;
    });
  }, []);

  const pruneUnreadForTree = useCallback((treeId: string, validIds: Set<string>) => {
    setUnreadMap((prev) => {
      const existing = prev.get(treeId);
      if (!existing) {
        return prev;
      }
      let changed = false;
      const nextSet = new Set<string>();
      existing.forEach((id) => {
        if (validIds.has(id)) {
          nextSet.add(id);
        } else {
          changed = true;
        }
      });
      if (!changed) {
        return prev;
      }
      const next = new Map(prev);
      if (nextSet.size === 0) {
        next.delete(treeId);
      } else {
        next.set(treeId, nextSet);
      }
      return next;
    });
  }, []);

  type RefreshOptions = {
    selectRoot?: boolean;
    focusNodeId?: string | null;
    focusComposer?: boolean;
  };

  const refreshGraph = useCallback(
    async (treeId: string, opts?: RefreshOptions) => {
      setIsSyncingGraph(true);
      try {
        const data = await fetchJSON<GraphResponse>(`/api/messages/graph/${treeId}`);
        setGraph(data);
        pruneUnreadForTree(treeId, new Set(data.nodes.map((n) => n.id)));
        pendingGraphNodeIdsRef.current.clear();
        const root = data.nodes.find((n) => !n.parent_id)?.id ?? null;
        const remembered = lastSelectedNodeRef.current.get(treeId) ?? null;
        const latestNodeId = (() => {
          let selected: string | null = null;
          let latestTs = -Infinity;
          data.nodes.forEach((node) => {
            if (!node.created_at) return;
            const ts = Date.parse(node.created_at);
            if (Number.isNaN(ts)) return;
            if (ts >= latestTs) {
              latestTs = ts;
              selected = node.id;
            }
          });
          return selected;
        })();
        const focusId = opts?.focusNodeId ?? null;
        const shouldSelectRoot = Boolean(opts?.selectRoot);
        const shouldFocusComposer = opts?.focusComposer ?? false;

        setActiveNodeId((prev) => {
          if (focusId && data.nodes.some((n) => n.id === focusId)) {
            return focusId;
          }
          const defaultNodeId = remembered && data.nodes.some((n) => n.id === remembered) ? remembered : latestNodeId ?? root;
          if (shouldSelectRoot) {
            return defaultNodeId;
          }
          if (!prev) return defaultNodeId;
          return data.nodes.some((n) => n.id === prev) ? prev : defaultNodeId;
        });

        if (data.nodes.length === 0) {
          setBlankTreeId(treeId);
        } else if (blankTreeId === treeId) {
          setBlankTreeId(null);
        }

        if (shouldFocusComposer) {
          setComposerFocusToken((prev) => prev + 1);
        }

        return data;
      } finally {
        setIsSyncingGraph(false);
      }
    },
    [blankTreeId, pruneUnreadForTree]
  );

  useEffect(() => {
    if (!activeTreeId) {
      setGraph({ nodes: [], edges: [] });
      setActiveNodeId(null);
      return;
    }
    const focusId = pendingFocusNodeIdRef.current;
    const remembered = lastSelectedNodeRef.current.get(activeTreeId) ?? null;
    const opts = focusId
      ? { focusNodeId: focusId }
      : remembered
      ? { focusNodeId: remembered }
      : { selectRoot: true, focusComposer: true };
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
      setComposerFocusToken((prev) => prev + 1);
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
      setComposerFocusToken((prev) => prev + 1);
      setIsGraphExpanded(false);
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
        scrollPositionsRef.current.forEach((_, key) => {
          if (key.startsWith(`${treeId}:`)) {
            scrollPositionsRef.current.delete(key);
          }
        });
        lastSelectedNodeRef.current.delete(treeId);
        setUnreadMap((prev) => {
          if (!prev.has(treeId)) {
            return prev;
          }
          const next = new Map(prev);
          next.delete(treeId);
          return next;
        });
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

  type PendingUserMessage = { id: string; parentId: string | null; content: string; treeId: string };
  type AfterSendPayload = {
    assistantId: string;
    treeId: string;
    parentId: string | null;
    pendingUserId: string;
    userId: string | null;
  };

  const handlePendingUserMessage = useCallback(({ id, parentId, content, treeId }: PendingUserMessage) => {
      pendingGraphNodeIdsRef.current.set(id, { treeId, parentId });
      setGraph((prev) => {
        const nodeExists = prev.nodes.some((node) => node.id === id);
        if (nodeExists) return prev;

        const newNode: GraphResponse['nodes'][number] = {
          id,
          role: 'user',
          label: content,
          parent_id: parentId,
          user_label: content,
          assistant_label: null,
        };

        const nextNodes = [...prev.nodes, newNode];

        const nextEdges = parentId
          ? prev.edges.some((edge) => edge.target === id)
            ? prev.edges
            : [
                ...prev.edges,
                {
                  id: `pending-edge-${parentId}-${id}`,
                  source: parentId,
                  target: id,
                } as GraphResponse['edges'][number],
              ]
          : prev.edges;

        return { nodes: nextNodes, edges: nextEdges };
      });

      if (treeId === activeTreeId) {
        setActiveNodeId(id);
      }
    }, [activeTreeId]);

  const handlePendingUserMessageFailed = useCallback(({ id, parentId }: { id: string; parentId: string | null }) => {
    pendingGraphNodeIdsRef.current.delete(id);
    setGraph((prev) => {
      const nextNodes = prev.nodes.filter((node) => node.id !== id);
      const nextEdges = prev.edges.filter((edge) => edge.source !== id && edge.target !== id);
      return { nodes: nextNodes, edges: nextEdges };
    });
    setActiveNodeId((current) => {
      if (current !== id) return current;
      return parentId ?? null;
    });
  }, []);

  useEffect(() => {
    if (activeTreeId && activeNodeId) {
      lastSelectedNodeRef.current.set(activeTreeId, activeNodeId);
    }
  }, [activeTreeId, activeNodeId]);

  const effectiveScrollNodeId = useMemo(() => activeNodeId ?? rootId ?? null, [activeNodeId, rootId]);
  const currentScrollKey = useMemo(() => {
    if (!activeTreeId) return null;
    return `${activeTreeId}:${effectiveScrollNodeId ?? '__root__'}`;
  }, [activeTreeId, effectiveScrollNodeId]);
  const savedScrollTop = currentScrollKey ? scrollPositionsRef.current.get(currentScrollKey) ?? null : null;
  const handleScrollPositionChange = useCallback(
    (scrollTop: number | null) => {
      if (!currentScrollKey) return;
      if (scrollTop === null) {
        scrollPositionsRef.current.delete(currentScrollKey);
        if (activeTreeId && activeNodeId && unreadMap.get(activeTreeId)?.has(activeNodeId)) {
          markNodeRead(activeTreeId, activeNodeId);
        }
      } else {
        scrollPositionsRef.current.set(currentScrollKey, scrollTop);
      }
    },
    [currentScrollKey, activeTreeId, activeNodeId, unreadMap, markNodeRead]
  );

  const handleAfterSend = useCallback(
    ({ assistantId, treeId, pendingUserId }: AfterSendPayload) => {
      pendingGraphNodeIdsRef.current.delete(pendingUserId);

      markNodeUnread(treeId, assistantId);

      if (blankTreeIdRef.current === treeId) {
        setBlankTreeId(null);
      }

      if (treeId !== activeTreeIdRef.current) {
        return;
      }

      setActiveNodeId(assistantId);

      setGraph((prev) => {
        const hasPending = prev.nodes.some((node) => node.id === pendingUserId);
        if (!hasPending) {
          return prev;
        }
        const nextNodes = prev.nodes.filter((node) => node.id !== pendingUserId);
        const nextEdges = prev.edges.filter(
          (edge) => edge.source !== pendingUserId && edge.target !== pendingUserId
        );
        return { nodes: nextNodes, edges: nextEdges };
      });

      void refreshGraph(treeId);
    },
    [markNodeUnread, refreshGraph]
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

  useEffect(() => {
    if (isGraphExpanded && overlayCloseButtonRef.current) {
      requestAnimationFrame(() => {
        overlayCloseButtonRef.current?.focus();
      });
    }
  }, [isGraphExpanded]);

  useEffect(() => {
    if (!activeTreeId) {
      setIsGraphExpanded(false);
    }
  }, [activeTreeId]);

  useEffect(() => {
    if (!isGraphExpanded) return;
    const handleKey = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') {
        setIsGraphExpanded(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isGraphExpanded]);

  const toggleGraphExpanded = useCallback(() => {
    setIsGraphExpanded((prev) => !prev);
  }, []);

  const canOverlayFork = Boolean(activeNode && handleForkActive);
  const canOverlayDelete = Boolean(activeNode && handleDeleteActive);
  const unreadForActiveTree = activeTreeId ? unreadMap.get(activeTreeId) : undefined;

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
              const unreadCount = unreadMap.get(tree.id)?.size ?? 0;
              const hasUnread = unreadCount > 0;
              const displayTitle = tree.title && tree.title.trim().length > 0 ? tree.title : 'Untitled conversation';
              return (
                <div
                  key={tree.id}
                  className={`tree-item ${isActive ? 'active' : ''}${hasUnread ? ' unread' : ''}`}
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
                          aria-label={hasUnread ? `${displayTitle} (new responses)` : displayTitle}
                          disabled={isPending}
                        >
                          <span className="tree-title">{displayTitle}</span>
                          {hasUnread && (
                            <span
                              className="tree-indicator"
                              aria-hidden
                              title="New responses"
                            />
                          )}
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
            focusComposerToken={composerFocusToken}
            onPendingUserMessage={handlePendingUserMessage}
            onPendingUserMessageFailed={handlePendingUserMessageFailed}
            savedScrollTop={savedScrollTop}
            onScrollPositionChange={handleScrollPositionChange}
          />
        </div>

        <div className="graph">
          <button
            type="button"
            className="graph-toggle"
            onClick={toggleGraphExpanded}
            aria-expanded={isGraphExpanded}
          >
            {isGraphExpanded ? 'Close graph' : 'Expand graph'}
          </button>
          {activeTreeId ? (
            <ChatGraph
              data={graph}
              onSelectNode={setActiveNodeId}
              activeNodeId={activeNodeId}
              onDeleteActive={handleDeleteActive}
              onForkActive={handleForkActive}
              deleteLabel={deleteLabel}
              showInlineActions={!isGraphExpanded}
              unreadNodeIds={unreadForActiveTree}
            />
          ) : (
            <div className="empty">Create or select a conversation to see the graph.</div>
          )}
        </div>
      </main>

      {isGraphExpanded && (
        <div className="graph-overlay" role="dialog" aria-modal="true" aria-label="Expanded conversation graph">
          <div className="graph-overlay-inner">
            <div className="graph-overlay-header">
              <span className="graph-overlay-title">Conversation graph</span>
              {(canOverlayFork || canOverlayDelete) && (
                <div className="graph-overlay-actions">
                  {canOverlayFork && (
                    <button type="button" className="overlay-action" onClick={handleForkActive}>
                      {forkLabel}
                    </button>
                  )}
                  {canOverlayDelete && (
                    <button type="button" className="overlay-action danger" onClick={handleDeleteActive}>
                      {deleteLabel}
                    </button>
                  )}
                </div>
              )}
              <button
                type="button"
                className="overlay-close"
                onClick={toggleGraphExpanded}
                ref={overlayCloseButtonRef}
              >
                Collapse graph
              </button>
            </div>
            <div className="graph-overlay-content">
              <ChatGraph
                data={graph}
                onSelectNode={setActiveNodeId}
                activeNodeId={activeNodeId}
                onDeleteActive={handleDeleteActive}
                onForkActive={handleForkActive}
                deleteLabel={deleteLabel}
                showInlineActions={false}
                unreadNodeIds={unreadForActiveTree}
              />
            </div>
          </div>
        </div>
      )}

      <footer>
        <span>Branching Chat — manage multiple conversation trees.</span>
      </footer>

      <style jsx>{`
        .app {
          display: grid;
          grid-template-rows: 72px 1fr 52px;
          height: 100dvh;
          background: #343541;
          color: #ececf1;
          overflow: hidden;
        }
        header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 32px;
          background: #343541;
          border-bottom: 1px solid #565869;
        }
        .title {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .title span {
          font-size: 18px;
          font-weight: 700;
          color: #ececf1;
        }
        .title small {
          font-size: 12px;
          color: #8e8ea0;
        }
        .header-actions {
          display: flex;
          gap: 12px;
        }
        button {
          border-radius: 999px;
          border: 1px solid #10a37f;
          background: #10a37f;
          color: #ffffff;
          padding: 8px 20px;
          font-weight: 600;
          font-size: 13px;
          box-shadow: none;
          transition: background 0.18s ease, border 0.18s ease, opacity 0.18s ease;
        }
        button:hover:enabled {
          background: #14b381;
          border-color: #14b381;
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        main {
          display: grid;
          grid-template-columns: 300px minmax(0, 1fr) 460px;
          gap: 24px;
          padding: 28px 36px;
          min-height: 0;
          position: relative;
          overflow: hidden;
        }
        aside.trees,
        .graph,
        .chat {
          border-radius: 28px;
          background: #202123;
          border: 1px solid #3f3f4b;
          box-shadow: none;
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
          color: #ececf1;
        }
        .trees-header button {
          padding: 6px 16px;
          font-size: 12px;
          border: 1px solid #565869;
          background: #40414f;
          color: #ececf1;
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
          border: 1px solid #565869;
          padding: 16px;
          border-radius: 18px;
          background: #2f3038;
          color: #ececf1;
          transition: border 0.18s ease, background 0.18s ease;
        }
        .tree-item.unread:not(.active) {
          border-color: #f7c948;
        }
        .tree-item:hover:not(.active) {
          background: #343541;
        }
        .tree-item.active {
          border-color: #10a37f;
          background: #343541;
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
          border: 1px solid #565869;
          background: #202123;
          color: #ececf1;
          font-size: 16px;
          transition: background 0.18s ease, border 0.18s ease, opacity 0.18s ease;
        }
        .icon-button:hover:enabled {
          background: #343541;
          border-color: #565869;
        }
        .icon-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .icon-button.danger {
          border-color: #ef4146;
          color: #ef4146;
          background: transparent;
        }
        .tree-title {
          display: block;
          text-align: left;
          font-size: 14px;
          font-weight: 600;
          flex: 1;
          word-break: break-word;
        }
        .tree-indicator {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #f7c948;
          box-shadow: 0 0 0 2px rgba(32, 33, 35, 0.9);
        }
        .tree-item.active .tree-indicator {
          box-shadow: 0 0 0 2px rgba(52, 53, 65, 0.9);
        }
        .tree-item-edit-actions button {
          border-radius: 999px;
          border: 1px solid #565869;
          background: #40414f;
          color: #ececf1;
          padding: 6px 14px;
          font-size: 12px;
          box-shadow: none;
        }
        .tree-item-edit-actions button:hover:enabled {
          background: #4f5160;
          border-color: #4f5160;
        }
        .tree-item-edit-actions .danger {
          background: #ef4146;
          border-color: #ef4146;
          color: #ffffff;
        }
        .tree-item-edit-actions .secondary {
          background: #40414f;
          border-color: #565869;
          color: #ececf1;
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
          border: 1px solid #565869;
          padding: 12px;
          font-size: 13px;
          background: #40414f;
          color: #ececf1;
        }
        .tree-item-edit input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .hint {
          padding: 14px;
          border-radius: 16px;
          background: #202123;
          color: #c5c5d2;
          font-size: 13px;
          border: 1px solid #3f3f4b;
        }
        .graph {
          position: relative;
          display: flex;
          background: #202123;
          overflow: hidden;
        }
        .graph > div {
          flex: 1;
        }
        .graph-toggle {
          position: absolute;
          top: 16px;
          right: 16px;
          z-index: 2;
          padding: 6px 14px;
          font-size: 12px;
          border-radius: 999px;
          border: 1px solid #565869;
          background: #40414f;
          color: #ececf1;
          box-shadow: none;
        }
        .graph-toggle:hover:enabled {
          background: #4f5160;
          border-color: #4f5160;
        }
        .graph-toggle:focus-visible {
          outline: 2px solid #10a37f;
          outline-offset: 2px;
        }
        .graph .empty {
          display: flex;
          align-items: center;
          justify-content: center;
          color: #8e8ea0;
          font-size: 14px;
        }
        .graph-overlay {
          position: absolute;
          top: 28px;
          bottom: 28px;
          left: calc(36px + 300px + 24px);
          right: 36px;
          z-index: 40;
          display: flex;
          align-items: stretch;
          justify-content: stretch;
        }
        .graph-overlay-inner {
          display: flex;
          flex-direction: column;
          width: 100%;
          border-radius: 28px;
          border: 1px solid #565869;
          background: rgba(32, 33, 35, 0.96);
          box-shadow: 0 24px 48px rgba(0, 0, 0, 0.45);
          overflow: hidden;
        }
        .graph-overlay-header {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 18px 22px;
          border-bottom: 1px solid #565869;
          color: #ececf1;
          font-size: 14px;
          background: #202123;
        }
        .graph-overlay-title {
          font-weight: 600;
        }
        .graph-overlay-actions {
          display: flex;
          gap: 12px;
          margin-left: auto;
        }
        .overlay-action {
          padding: 6px 16px;
          border-radius: 999px;
          border: 1px solid #10a37f;
          background: #10a37f;
          color: #ffffff;
          font-size: 12px;
          font-weight: 600;
          box-shadow: none;
        }
        .overlay-action.danger {
          border-color: #ef4146;
          background: #ef4146;
          color: #ffffff;
        }
        .overlay-action:hover:enabled {
          background: #14b381;
          border-color: #14b381;
        }
        .overlay-action:focus-visible {
          outline: 2px solid #10a37f;
          outline-offset: 2px;
        }
        .graph-overlay-content {
          flex: 1;
          min-height: 0;
        }
        .overlay-close {
          padding: 6px 14px;
          font-size: 12px;
          border-radius: 999px;
          border: 1px solid #565869;
          background: #40414f;
          color: #ececf1;
          box-shadow: none;
          margin-left: auto;
        }
        .graph-overlay-actions + .overlay-close {
          margin-left: 12px;
        }
        .overlay-close:hover:enabled {
          background: #4f5160;
          border-color: #4f5160;
        }
        .overlay-close:focus-visible {
          outline: 2px solid #10a37f;
          outline-offset: 2px;
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
          background: #202123;
          border-top: 1px solid #565869;
          color: #8e8ea0;
          font-size: 12px;
        }
      `}</style>
      <style jsx global>{`
        html,
        body,
        #__next {
          height: 100%;
          margin: 0;
          background: #343541;
          overflow: hidden;
        }
        body {
          font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
      `}</style>
    </div>
  );
}

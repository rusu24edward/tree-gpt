import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
      setActiveNodeId(null);
      setActiveTreeId(treeId);
    },
    [activeTreeId]
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
            {trees.map((tree) => (
              <button
                key={tree.id}
                className={`tree-item ${tree.id === activeTreeId ? 'active' : ''}`}
                onClick={() => handleSelectTree(tree.id)}
              >
                <span className="tree-title">{tree.title || 'Untitled conversation'}</span>
              </button>
            ))}
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
          text-align: left;
          border: 1px solid #d9e1ff;
          padding: 14px 16px;
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
        .tree-title {
          font-size: 14px;
          font-weight: 600;
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

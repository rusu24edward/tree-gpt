import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { fetchJSON, API_BASE } from '../lib/api';
import type { GraphResponse, TreeOut } from '../lib/api';

const ChatGraph = dynamic(() => import('../components/ChatGraph'), { ssr: false });
import ChatPane from '../components/ChatPane';

export default function Home() {
  const [tree, setTree] = useState<TreeOut | null>(null);
  const [graph, setGraph] = useState<GraphResponse>({ nodes: [], edges: [] });
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  // Create a tree on first mount
  useEffect(() => {
    async function boot() {
      const t = await fetchJSON<TreeOut>('/api/trees', {
        method: 'POST',
        body: JSON.stringify({ title: 'My Conversation' }),
      });
      setTree(t);
    }
    boot();
  }, []);

  async function refreshGraph() {
    if (!tree) return;
    const g = await fetchJSON<GraphResponse>(`/api/messages/graph/${tree.id}`);
    setGraph(g);
  }

  // Load graph when a tree exists
  useEffect(() => {
    if (tree?.id) {
      refreshGraph();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree?.id]);

  // Find the root node (node without a parent)
  const rootId = useMemo(() => {
    return graph.nodes.find((n) => !n.parent_id)?.id ?? null;
  }, [graph]);

  // If nothing is selected yet, auto-select the root so the composer uses it
  useEffect(() => {
    if (!activeNodeId && rootId) {
      setActiveNodeId(rootId);
    }
  }, [rootId, activeNodeId]);

  function handleAfterSend(newAssistantId: string) {
    // After a reply, focus the branch tip we just created
    setActiveNodeId(newAssistantId);
    refreshGraph();
  }

  return (
    <div className="wrap">
      <header>
        <h1>Branching Chat</h1>
        <div className="spacer" />
        <div className="env">API: {API_BASE}</div>
      </header>

      <main>
        <div className="graph">
          <ChatGraph
            data={graph}
            onSelectNode={setActiveNodeId}
            activeNodeId={activeNodeId}
          />
        </div>
        <div className="chat">
          <ChatPane
            activeNodeId={activeNodeId}
            treeId={tree?.id ?? null}
            defaultParentId={rootId}
            onAfterSend={handleAfterSend}
          />
        </div>
      </main>

      <footer>
        <button onClick={() => window.location.reload()}>New conversation</button>
        <button onClick={refreshGraph}>Refresh graph</button>
      </footer>

      <style jsx>{`
        .wrap {
          display: grid;
          grid-template-rows: 56px 1fr 48px;
          height: 100vh;
        }
        header, footer {
          display: flex;
          align-items: center;
          padding: 0 12px;
          background: #0b1020;
          color: #e6e6e6;
          border-bottom: 1px solid #1f2937;
        }
        footer {
          border-top: 1px solid #1f2937;
          border-bottom: none;
          gap: 8px;
        }
        main {
          display: grid;
          grid-template-columns: 1fr 420px;
          gap: 0;
          height: calc(100vh - 56px - 48px);
        }
        .graph { height: 100%; background: #0b1020; }
        .chat { height: 100%; border-left: 1px solid #1f2937; }
        .spacer { flex: 1; }
        .env { opacity: 0.6; font-size: 12px; }
        h1 { font-size: 16px; margin: 0; }
        button {
          border: 1px solid #1f2937;
          border-radius: 8px;
          background: #1f2937;
          color: white;
          font-weight: 600;
          height: 32px;
          padding: 0 12px;
        }
      `}</style>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import type { PathResponse } from '../lib/api';
import { fetchJSON } from '../lib/api';

type Props = {
  activeNodeId: string | null;
  treeId: string | null;
  defaultParentId?: string | null;       // NEW: root as fallback
  onAfterSend: (assistantId: string) => void;
};

export default function ChatPane({ activeNodeId, treeId, defaultParentId, onAfterSend }: Props) {
  const [path, setPath] = useState<PathResponse['path']>([]);
  const [input, setInput] = useState('');

  // Prefer active node; else default (root); else null
  const effectiveNodeId = useMemo(
    () => activeNodeId ?? defaultParentId ?? null,
    [activeNodeId, defaultParentId]
  );

  // Load the ancestor path for the effective node
  useEffect(() => {
    async function load() {
      if (effectiveNodeId) {
        const p = await fetchJSON<PathResponse>(`/api/messages/path/${effectiveNodeId}`);
        setPath(p.path);
      } else {
        setPath([]);
      }
    }
    load();
  }, [effectiveNodeId]);

  async function send() {
    if (!treeId || input.trim().length === 0) return;

    // Use the selected node if present; else fall back to root
    const parent = activeNodeId ?? defaultParentId ?? null;

    const res = await fetchJSON<any>(`/api/messages`, {
      method: 'POST',
      body: JSON.stringify({
        tree_id: treeId,
        parent_id: parent,
        content: input,
      }),
    });
    setInput('');
    onAfterSend(res.id);
  }

  return (
    <div className="pane">
      <div className="scroll">
        {path.length === 0 && (
          <div className="placeholder">
            Select a node in the graph, or just start typing — your first message will attach to the <b>root</b>.
          </div>
        )}
        {path.map((m, idx) => (
          <div key={idx} className={`bubble ${m.role}`}>
            <div className="role">{m.role}</div>
            <div>{m.content}</div>
          </div>
        ))}
      </div>

      <div className="composer">
        <textarea
          placeholder="Type your message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
        />
        <button onClick={send} disabled={!treeId || input.trim().length === 0}>Send</button>
      </div>

      <style jsx>{`
        .pane { display: flex; flex-direction: column; height: 100%; }
        .scroll {
          flex: 1;
          overflow: auto;
          padding: 12px;
          background: #0b1020;
          color: #e6e6e6;
        }
        .placeholder { opacity: 0.7; font-style: italic; }
        .bubble {
          border-radius: 12px;
          padding: 10px 12px;
          margin-bottom: 8px;
          background: #111827;
          border: 1px solid #1f2937;
          white-space: pre-wrap;
        }
        .bubble.user { background: #0f172a; }
        .bubble.assistant { background: #111827; }
        .role {
          font-size: 12px;
          opacity: 0.6;
          margin-bottom: 6px;
          text-transform: uppercase;
        }
        .composer {
          display: grid;
          grid-template-columns: 1fr 120px;
          gap: 8px;
          border-top: 1px solid #1f2937;
          padding: 8px;
          background: #0b1020;
        }
        textarea {
          width: 100%;
          background: #0f172a;
          color: #f9fafb;
          border: 1px solid #1f2937;
          border-radius: 8px;
          padding: 8px;
          resize: vertical;
        }
        button {
          border: 1px solid #1f2937;
          border-radius: 8px;
          background: #1f2937;
          color: white;
          font-weight: 600;
        }
        button:disabled { opacity: .6; }
      `}</style>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import type { PathResponse } from '../lib/api';
import { fetchJSON } from '../lib/api';

type Props = {
  activeNodeId: string | null;
  treeId: string | null;
  defaultParentId?: string | null;
  onAfterSend: (assistantId: string) => void;
  onDeleteNode?: () => void;
  isDeleteDisabled?: boolean;
  showEmptyOverlay?: boolean;
  onEnsureTree?: () => Promise<string | null>;
  deleteLabel?: string;
};

export default function ChatPane({
  activeNodeId,
  treeId,
  defaultParentId,
  onAfterSend,
  onDeleteNode,
  isDeleteDisabled,
  showEmptyOverlay,
  onEnsureTree,
  deleteLabel = 'Delete branch',
}: Props) {
  const [path, setPath] = useState<PathResponse['path']>([]);
  const [input, setInput] = useState('');

  const effectiveNodeId = useMemo(
    () => activeNodeId ?? defaultParentId ?? null,
    [activeNodeId, defaultParentId]
  );

  const showStartPrompt = Boolean(showEmptyOverlay && path.length === 0);

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
    if (input.trim().length === 0) return;

    let targetTreeId = treeId;
    if (!targetTreeId && onEnsureTree) {
      targetTreeId = await onEnsureTree();
    }
    if (!targetTreeId) return;

    const parent = activeNodeId ?? defaultParentId ?? null;

    const res = await fetchJSON<any>(`/api/messages`, {
      method: 'POST',
      body: JSON.stringify({
        tree_id: targetTreeId,
        parent_id: parent,
        content: input,
      }),
    });
    setInput('');
    onAfterSend(res.id);
  }

  const handleKeyDown = (evt: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (evt.key === 'Enter' && !evt.shiftKey) {
      evt.preventDefault();
      send();
    }
  };

  return (
    <div className="pane">
      <div className="toolbar">
        <div className="toolbar-copy">
          <span className="title">Current branch</span>
          <span className="subtitle">
            {effectiveNodeId ? 'Viewing the path to the selected node.' : 'Select a node to inspect its branch.'}
          </span>
        </div>
        {onDeleteNode && (
          <button className="danger" onClick={onDeleteNode} disabled={Boolean(isDeleteDisabled)}>
            {deleteLabel}
          </button>
        )}
      </div>

      <div className="scroll">
        {showStartPrompt && (
          <div className="start-banner">Start chatting to get started</div>
        )}
        {path.length === 0 && !showStartPrompt && (
          <div className="placeholder">
            Select a node in the graph, or start typing to begin a new branch from here.
          </div>
        )}
        {path.map((m, idx) => (
          <div key={idx} className={`bubble ${m.role}`}>
            <div className="meta">
              <span className="role">{m.role}</span>
            </div>
            <div className="content">{m.content}</div>
          </div>
        ))}
      </div>

      <div className="composer">
        <textarea
          placeholder="Send a message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
        />
        <div className="composer-actions">
          <button onClick={send} disabled={input.trim().length === 0}>
            Send
          </button>
        </div>
      </div>

      <style jsx>{`
        .pane {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: #f7f8ff;
          color: #0f172a;
        }
        .toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px 16px;
          border-bottom: 1px solid #e2e8f0;
          background: #ffffff;
        }
        .toolbar-copy {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .title {
          font-size: 15px;
          font-weight: 600;
        }
        .subtitle {
          font-size: 13px;
          color: #64748b;
        }
        .scroll {
          flex: 1;
          overflow: auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .start-banner {
          text-align: center;
          font-size: 18px;
          font-weight: 600;
          color: rgba(15, 23, 42, 0.55);
          margin: 40px auto 12px;
        }
        .placeholder {
          font-size: 14px;
          color: #64748b;
          background: #ffffff;
          border: 1px dashed #cbd5e1;
          border-radius: 16px;
          padding: 16px;
        }
        .bubble {
          border-radius: 18px;
          padding: 16px 18px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .bubble.user {
          background: #f1f5ff;
          border-color: #dbeafe;
        }
        .meta {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #94a3b8;
        }
        .content {
          white-space: pre-wrap;
          line-height: 1.6;
        }
        .composer {
          border-top: 1px solid #e2e8f0;
          background: #ffffff;
          padding: 20px 24px 24px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        textarea {
          width: 100%;
          background: #f8fafc;
          color: inherit;
          border: 1px solid #cbd5e1;
          border-radius: 16px;
          padding: 16px;
          resize: vertical;
          font-size: 14px;
          line-height: 1.5;
          box-shadow: inset 0 2px 4px rgba(15, 23, 42, 0.04);
        }
        textarea::placeholder {
          color: #94a3b8;
        }
        .composer-actions {
          display: flex;
          justify-content: flex-end;
        }
        button {
          border-radius: 999px;
          border: 1px solid #1f2937;
          background: linear-gradient(135deg, #141a29, #2a3b7d);
          color: #f8fafc;
          padding: 10px 24px;
          font-weight: 600;
          font-size: 14px;
          box-shadow: 0 6px 16px rgba(37, 56, 110, 0.25);
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          box-shadow: none;
        }
        .danger {
          background: #fee2e2;
          border-color: #fecaca;
          color: #b91c1c;
          box-shadow: none;
          padding: 8px 16px;
        }
        .danger:disabled {
          background: #fef2f2;
          color: #fca5a5;
        }
      `}</style>
    </div>
  );
}

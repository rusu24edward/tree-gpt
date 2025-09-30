import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  focusComposerToken?: number;
};

type DisplayMessage = PathResponse['path'][number] & { id?: string; pending?: boolean };

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
  focusComposerToken,
}: Props) {
  const [path, setPath] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const effectiveNodeId = useMemo(
    () => activeNodeId ?? defaultParentId ?? null,
    [activeNodeId, defaultParentId]
  );

  const showStartPrompt = Boolean(showEmptyOverlay && path.length === 0);

  useEffect(() => {
    async function load() {
      if (effectiveNodeId) {
        const p = await fetchJSON<PathResponse>(`/api/messages/path/${effectiveNodeId}`);
        const shaped = p.path.map((msg, idx) => ({
          ...msg,
          pending: false,
          id: `${msg.role}-${idx}`,
        }));
        setPath(shaped);
        setIsSending(false);
      } else {
        setPath([]);
        setIsSending(false);
      }
    }
    load();
  }, [effectiveNodeId]);

  useEffect(() => {
    if (!focusComposerToken) return;
    const node = composerRef.current;
    if (!node) return;
    requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
  }, [focusComposerToken]);

  async function send() {
    if (isSending) return;
    const trimmed = input.trim();
    if (trimmed.length === 0) return;

    let targetTreeId = treeId;
    if (!targetTreeId && onEnsureTree) {
      targetTreeId = await onEnsureTree();
    }
    if (!targetTreeId) return;

    const parent = activeNodeId ?? defaultParentId ?? null;

    const stamp = Date.now().toString(36);
    const userPendingId = `pending-user-${stamp}`;
    const assistantPendingId = `pending-assistant-${stamp}`;

    setIsSending(true);
    setPath((prev) => [
      ...prev,
      { role: 'user', content: trimmed, pending: true, id: userPendingId },
      { role: 'assistant', content: '', pending: true, id: assistantPendingId },
    ]);
    setInput('');

    try {
      const res = await fetchJSON<any>(`/api/messages`, {
        method: 'POST',
        body: JSON.stringify({
          tree_id: targetTreeId,
          parent_id: parent,
          content: trimmed,
        }),
      });
      onAfterSend(res.id);
    } catch (err) {
      console.error('Failed to send message', err);
      setPath((prev) => prev.filter((msg) => msg.id !== userPendingId && msg.id !== assistantPendingId));
      setInput(trimmed);
      setIsSending(false);
    }
  }

  const handleKeyDown = (evt: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (evt.key === 'Enter' && !evt.shiftKey) {
      evt.preventDefault();
      if (!isSending) {
        void send();
      }
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
          <div key={m.id ?? idx} className={`bubble ${m.role}${m.pending ? ' pending' : ''}`}>
            <div className="meta">
              <span className="role">{m.role}</span>
            </div>
            <div className="content">
              {m.pending && m.role === 'assistant' ? (
                <div className="loading">
                  <span className="spinner" aria-label="Waiting for response" />
                  <span className="loading-text">Awaiting response…</span>
                </div>
              ) : (
                m.content
              )}
            </div>
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
          ref={composerRef}
        />
        <div className="composer-actions">
          <button onClick={() => void send()} disabled={isSending || input.trim().length === 0}>
            Send
          </button>
        </div>
      </div>

      <style jsx>{`
        .pane {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: #343541;
          color: #ececf1;
        }
        .toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px 16px;
          border-bottom: 1px solid #565869;
          background: #343541;
        }
        .toolbar-copy {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .title {
          font-size: 15px;
          font-weight: 600;
          color: #ececf1;
        }
        .subtitle {
          font-size: 13px;
          color: #c5c5d2;
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
          color: #acacb3;
          margin: 40px auto 12px;
        }
        .placeholder {
          font-size: 14px;
          color: #c5c5d2;
          background: #444654;
          border: 1px dashed #565869;
          border-radius: 16px;
          padding: 16px;
        }
        .bubble {
          border-radius: 18px;
          padding: 16px 18px;
          background: #444654;
          border: 1px solid #565869;
          box-shadow: none;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .bubble.pending {
          opacity: 0.85;
        }
        .bubble.user {
          background: #343541;
          border-color: #565869;
        }
        .meta {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #8e8ea0;
        }
        .content {
          white-space: pre-wrap;
          line-height: 1.6;
        }
        .loading {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .spinner {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          border: 2px solid rgba(236, 236, 241, 0.2);
          border-top-color: #ececf1;
          animation: spin 0.9s linear infinite;
        }
        .loading-text {
          color: #8e8ea0;
          font-size: 13px;
        }
        .composer {
          border-top: 1px solid #565869;
          background: #343541;
          padding: 20px 24px 24px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        textarea {
          width: 100%;
          background: #40414f;
          color: #ececf1;
          border: 1px solid #565869;
          border-radius: 16px;
          padding: 16px;
          box-sizing: border-box;
          resize: vertical;
          font-size: 14px;
          line-height: 1.5;
          box-shadow: none;
        }
        textarea::placeholder {
          color: #8e8ea0;
        }
        .composer-actions {
          display: flex;
          justify-content: flex-end;
        }
        button {
          border-radius: 999px;
          border: 1px solid #10a37f;
          background: #10a37f;
          color: #ffffff;
          padding: 10px 24px;
          font-weight: 600;
          font-size: 14px;
          box-shadow: none;
        }
        button:hover:enabled {
          background: #14b381;
          border-color: #14b381;
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          box-shadow: none;
        }
        .danger {
          background: #ef4146;
          border-color: #ef4146;
          color: #ffffff;
          box-shadow: none;
          padding: 8px 16px;
        }
        .danger:disabled {
          background: #5f1f22;
          color: #f9d0d2;
          border-color: #803135;
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PathResponse } from '../lib/api';
import { fetchJSON, API_BASE } from '../lib/api';

type MarkdownCodeProps = {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode[];
  [key: string]: unknown;
};

type AfterSendPayload = {
  assistantId: string;
  treeId: string;
  parentId: string | null;
  pendingUserId: string;
  userId: string | null;
};

type Props = {
  activeNodeId: string | null;
  treeId: string | null;
  defaultParentId?: string | null;
  onAfterSend: (payload: AfterSendPayload) => void;
  onDeleteNode?: () => void;
  isDeleteDisabled?: boolean;
  showEmptyOverlay?: boolean;
  onEnsureTree?: () => Promise<string | null>;
  deleteLabel?: string;
  focusComposerToken?: number;
  onPendingUserMessage?: (payload: {
    id: string;
    parentId: string | null;
    content: string;
    treeId: string;
  }) => void;
  onPendingUserMessageFailed?: (payload: { id: string; parentId: string | null }) => void;
  savedScrollTop?: number | null;
  onScrollPositionChange?: (scrollTop: number | null) => void;
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
  onPendingUserMessage,
  onPendingUserMessageFailed,
  savedScrollTop,
  onScrollPositionChange,
}: Props) {
  const [input, setInput] = useState('');
  const [justCopiedId, setJustCopiedId] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastScrollTargetRef = useRef<string | null>(null);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseAutoScrollNodeRef = useRef<'__initial__' | '__none__'>('__initial__');
  const pathStoreRef = useRef<Map<string, DisplayMessage[]>>(new Map());
  const [pathSnapshot, setPathSnapshot] = useState<DisplayMessage[]>([]);
  const activeKeyRef = useRef<string>('');
  const sendingKeysRef = useRef<Set<string>>(new Set());
  const [sendingVersion, setSendingVersion] = useState(0);
  const streamSessionsRef = useRef<
    Map<
      string,
      {
        controller: AbortController;
        pendingAssistantId: string;
        assistantId: string | null;
        content: string;
        userId: string | null;
        active: boolean;
      }
    >
  >(new Map());
  const [streamVersion, setStreamVersion] = useState(0);

  const effectiveNodeId = useMemo(
    () => activeNodeId ?? defaultParentId ?? null,
    [activeNodeId, defaultParentId]
  );

  const computeKey = useCallback((maybeTreeId: string | null, nodeId: string | null) => {
    return `${maybeTreeId ?? '__no_tree__'}:${nodeId ?? '__root__'}`;
  }, []);

  const currentKey = computeKey(treeId, effectiveNodeId);

  useEffect(() => {
    activeKeyRef.current = currentKey;
    const cached = pathStoreRef.current.get(currentKey) ?? [];
    setPathSnapshot(cached);
    setSendingVersion((prev) => prev + 1);
  }, [currentKey]);

  const showStartPrompt = Boolean(showEmptyOverlay && pathSnapshot.length === 0);

  const isSending = useMemo(() => sendingKeysRef.current.has(currentKey), [currentKey, sendingVersion]);

  const updatePathForKey = useCallback(
    (key: string, updater: (current: DisplayMessage[]) => DisplayMessage[]) => {
      const current = pathStoreRef.current.get(key) ?? [];
      const next = updater(current);
      pathStoreRef.current.set(key, next);
      if (key === activeKeyRef.current) {
        setPathSnapshot(next);
      }
      return next;
    },
    []
  );

  const loadPath = useCallback(
    async (targetKey: string, nodeId: string | null) => {
      if (!nodeId) {
        pathStoreRef.current.set(targetKey, []);
        if (targetKey === activeKeyRef.current) {
          setPathSnapshot([]);
        }
        sendingKeysRef.current.delete(targetKey);
        setSendingVersion((prev) => prev + 1);
        return;
      }
      const existing = pathStoreRef.current.get(targetKey);
      if (existing) {
        if (targetKey === activeKeyRef.current) {
          setPathSnapshot(existing);
        }
        return;
      }
      const response = await fetchJSON<PathResponse>(`/api/messages/path/${nodeId}`);
      const shaped = response.path.map((msg, idx) => ({
        ...msg,
        pending: false,
        id: `${msg.role}-${idx}`,
      }));
      pathStoreRef.current.set(targetKey, shaped);
      if (targetKey === activeKeyRef.current) {
        setPathSnapshot(shaped);
      }
      sendingKeysRef.current.delete(targetKey);
      setSendingVersion((prev) => prev + 1);
    },
    []
  );

  useEffect(() => {
    void loadPath(currentKey, effectiveNodeId);
  }, [currentKey, effectiveNodeId, loadPath]);

  const activeStream = useMemo(() => streamSessionsRef.current.get(currentKey) ?? null, [currentKey, streamVersion]);
  const isStreaming = Boolean(activeStream?.active);

  useEffect(() => {
    if (!focusComposerToken) return;
    const node = composerRef.current;
    if (!node) return;
    requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
  }, [focusComposerToken]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const scrollTarget = `${treeId ?? '__no_tree__'}:${effectiveNodeId ?? '__root__'}`;
    const previousTarget = lastScrollTargetRef.current;
    if (scrollTarget === previousTarget) return;
    lastScrollTargetRef.current = scrollTarget;

    requestAnimationFrame(() => {
      const node = scrollContainerRef.current;
      if (!node) return;
      if (typeof savedScrollTop === 'number') {
        node.scrollTop = savedScrollTop;
      } else if (baseAutoScrollNodeRef.current === '__initial__') {
        node.scrollTop = node.scrollHeight;
        baseAutoScrollNodeRef.current = '__none__';
      }
    });
  }, [treeId, effectiveNodeId, savedScrollTop, onScrollPositionChange]);

  useEffect(() => {
    return () => {
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current);
        copyResetRef.current = null;
      }
    };
  }, []);

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
    const baseNodeId = effectiveNodeId;

    const stamp = Date.now().toString(36);
    const userPendingId = `pending-user-${stamp}`;
    const assistantPendingId = `pending-assistant-${stamp}`;

    const baseKey = computeKey(targetTreeId, baseNodeId);
    const basePath = pathStoreRef.current.get(baseKey) ?? (baseKey === currentKey ? pathSnapshot : []);
    const initialPath: DisplayMessage[] = [
      ...basePath.map((msg) => ({ ...msg })),
      { role: 'user', content: trimmed, pending: true, id: userPendingId },
      { role: 'assistant', content: '', pending: true, id: assistantPendingId },
    ];

    const pendingKey = computeKey(targetTreeId, userPendingId);
    pathStoreRef.current.set(pendingKey, initialPath);
    sendingKeysRef.current.add(pendingKey);
    setSendingVersion((prev) => prev + 1);
    setInput('');

    if (onPendingUserMessage) {
      onPendingUserMessage({ id: userPendingId, parentId: parent, content: trimmed, treeId: targetTreeId });
    }

    const controller = new AbortController();
    streamSessionsRef.current.set(pendingKey, {
      controller,
      pendingAssistantId: assistantPendingId,
      assistantId: null,
      content: '',
      userId: null,
      active: true,
    });
    setStreamVersion((prev) => prev + 1);

    let streamKey = pendingKey;

    const migrateStreamKey = (nextKey: string) => {
      if (nextKey === streamKey) return;
      const currentPath = pathStoreRef.current.get(streamKey) ?? [];
      pathStoreRef.current.set(nextKey, currentPath);
      pathStoreRef.current.delete(streamKey);
      if (sendingKeysRef.current.delete(streamKey)) {
        sendingKeysRef.current.add(nextKey);
      }
      const session = streamSessionsRef.current.get(streamKey);
      if (session) {
        streamSessionsRef.current.delete(streamKey);
        streamSessionsRef.current.set(nextKey, session);
      }
      if (activeKeyRef.current === streamKey) {
        activeKeyRef.current = nextKey;
        setPathSnapshot(currentPath);
      }
      streamKey = nextKey;
    };

    const updateStreamPath = (updater: (current: DisplayMessage[]) => DisplayMessage[]) => {
      updatePathForKey(streamKey, updater);
    };

    try {
      const response = await fetch(`${API_BASE}/api/messages/stream`, {
        method: 'POST',
        body: JSON.stringify({
          tree_id: targetTreeId,
          parent_id: parent,
          content: trimmed,
        }),
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Stream request failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalAssistantId: string | null = null;
      let finalContent = '';
      let serverUserId: string | null = null;

      const processLine = (line: string) => {
        if (!line) return;
        try {
          const payload = JSON.parse(line);
          if (payload.type === 'start') {
            serverUserId = payload.user_id ?? null;
            updateStreamPath((prev) =>
              prev.map((msg) => {
                if (msg.id === userPendingId) {
                  return {
                    ...msg,
                    id: serverUserId ?? msg.id,
                    pending: false,
                  };
                }
                return msg;
              })
            );
            const current = streamSessionsRef.current.get(streamKey);
            if (current) {
              current.userId = serverUserId;
            }
            setStreamVersion((prev) => prev + 1);
          } else if (payload.type === 'token') {
            const delta = typeof payload.delta === 'string' ? payload.delta : '';
            const session = streamSessionsRef.current.get(streamKey);
            if (session) {
              session.content += delta;
            }
            updateStreamPath((prev) =>
              prev.map((msg) => {
                if (msg.id === assistantPendingId) {
                  return {
                    ...msg,
                    content: session?.content ?? delta,
                    pending: true,
                  };
                }
                return msg;
              })
            );
          } else if (payload.type === 'end') {
            finalAssistantId = payload.assistant_id ?? null;
            finalContent = typeof payload.content === 'string' ? payload.content : '';
            const session = streamSessionsRef.current.get(streamKey);
            if (session) {
              session.assistantId = finalAssistantId;
              session.content = finalContent;
              session.active = false;
            }
            updateStreamPath((prev) =>
              prev.map((msg) => {
                if (msg.id === assistantPendingId) {
                  return {
                    ...msg,
                    id: finalAssistantId ?? msg.id,
                    content: finalContent,
                    pending: false,
                  };
                }
                if (msg.id === userPendingId && serverUserId) {
                  return { ...msg, id: serverUserId, pending: false };
                }
                return msg;
              })
            );
            if (finalAssistantId) {
              migrateStreamKey(computeKey(targetTreeId, finalAssistantId));
            }
          } else if (payload.type === 'error') {
            const message = typeof payload.message === 'string' ? payload.message : 'Streaming error';
            throw new Error(message);
          }
        } catch (err) {
          console.error('Failed to process stream line', err, line);
          throw err;
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const raw = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          processLine(raw);
          newlineIndex = buffer.indexOf('\n');
        }
      }

      buffer += decoder.decode(new Uint8Array(), { stream: false });
      const remainder = buffer.trim();
      if (remainder.length > 0) {
        processLine(remainder);
      }

      if (!finalAssistantId) {
        throw new Error('Streaming ended without assistant response');
      }

      streamSessionsRef.current.delete(streamKey);
      setStreamVersion((prev) => prev + 1);

      sendingKeysRef.current.delete(streamKey);
      setSendingVersion((prev) => prev + 1);

      onAfterSend({
        assistantId: finalAssistantId,
        treeId: targetTreeId,
        parentId: parent,
        pendingUserId: userPendingId,
        userId: serverUserId,
      });
    } catch (err) {
      console.error('Failed to send message', err);
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Cancelled by user
        updateStreamPath((prev) => prev.filter((msg) => msg.id !== assistantPendingId));
        if (onPendingUserMessageFailed) {
          onPendingUserMessageFailed({ id: userPendingId, parentId: parent });
        }
      } else {
        updateStreamPath((prev) => prev.filter((msg) => msg.id !== userPendingId && msg.id !== assistantPendingId));
        setInput(trimmed);
        if (onPendingUserMessageFailed) {
          onPendingUserMessageFailed({ id: userPendingId, parentId: parent });
        }
      }
      pathStoreRef.current.delete(streamKey);
      streamSessionsRef.current.delete(streamKey);
      setStreamVersion((prev) => prev + 1);
      sendingKeysRef.current.delete(streamKey);
      setSendingVersion((prev) => prev + 1);
    }
  }

  const handleStopStream = () => {
    const session = streamSessionsRef.current.get(currentKey);
    if (!session) return;
    session.controller.abort();
  };

  const handleKeyDown = (evt: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (evt.key === 'Enter' && !evt.shiftKey) {
      evt.preventDefault();
      if (!isSending) {
        void send();
      }
    }
  };

  const handleScroll = () => {
    if (!onScrollPositionChange) return;
    const node = scrollContainerRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.clientHeight - node.scrollTop;
    if (Math.abs(distanceFromBottom) <= 2) {
      onScrollPositionChange(null);
    } else {
      onScrollPositionChange(node.scrollTop);
    }
  };

  const handleCopy = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setJustCopiedId(id);
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current);
      }
      copyResetRef.current = setTimeout(() => {
        setJustCopiedId((current) => (current === id ? null : current));
        copyResetRef.current = null;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy message', err);
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

      <div className="scroll" ref={scrollContainerRef} onScroll={handleScroll}>
        {showStartPrompt && (
          <div className="start-banner">Start chatting to get started</div>
        )}
        {pathSnapshot.length === 0 && !showStartPrompt && (
          <div className="placeholder">
            Select a node in the graph, or start typing to begin a new branch from here.
          </div>
        )}
        {pathSnapshot.map((m, idx) => {
          const messageId = m.id ?? `message-${idx}`;
          const isAssistantPending = m.pending && m.role === 'assistant' && (!m.content || m.content.trim().length === 0);
          const isStreamingMessage = Boolean(
            isStreaming && activeStream?.pendingAssistantId === messageId && activeStream?.active
          );

          let blockIndex = 0;

          return (
            <div key={messageId} className={`bubble ${m.role}${m.pending ? ' pending' : ''}`}>
              <div className="meta">
                <span className="role">{m.role}</span>
              </div>
              <div className="content">
                {isAssistantPending ? (
                  <div className="loading">
                    <span className="spinner" aria-label="Waiting for response" />
                    <span className="loading-text">Awaiting response…</span>
                  </div>
                ) : (
                  <div className="markdown-wrapper">
                    <ReactMarkdown
                      className="markdown"
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code(componentProps) {
                          const { inline, className, children, ...props } = componentProps as MarkdownCodeProps;
                          const restProps = props as Record<string, unknown>;
                          if (inline) {
                            return (
                              <code className={className} {...restProps}>
                                {children}
                              </code>
                            );
                          }
                          blockIndex += 1;
                          const codeId = `${messageId}-code-${blockIndex}`;
                          const rawCode = String(children).replace(/\n$/, '');
                          return (
                            <div className="code-block">
                              <pre className={className} {...restProps}>
                                <code>{children}</code>
                              </pre>
                              <div className="copy-row">
                                <button
                                  type="button"
                                  className="copy-button"
                                  onClick={() => handleCopy(codeId, rawCode)}
                                  aria-label="Copy code block"
                                  title="Copy code block"
                                >
                                  <span aria-hidden>{justCopiedId === codeId ? '✅' : '📋'}</span>
                                </button>
                              </div>
                            </div>
                          );
                        },
                      }}
                    >
                      {m.content}
                    </ReactMarkdown>
                    {isStreamingMessage && <span className="stream-caret" aria-hidden />}
                  </div>
                )}
              </div>
              <div className="copy-row">
                <button
                  type="button"
                  className="copy-button"
                  onClick={() => handleCopy(messageId, m.content ?? '')}
                  disabled={isAssistantPending}
                  aria-label="Copy message"
                  title="Copy message"
                >
                  <span aria-hidden>{justCopiedId === messageId ? '✅' : '📋'}</span>
                </button>
              </div>
            </div>
          );
        })}
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
          {isStreaming && (
            <button type="button" className="secondary" onClick={handleStopStream}>
              Stop
            </button>
          )}
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
          line-height: 1.6;
          overflow: hidden;
          word-break: break-word;
        }
        .markdown-wrapper {
          display: flex;
          align-items: flex-start;
          gap: 6px;
        }
        .markdown {
          display: flex;
          flex-direction: column;
          gap: 12px;
          overflow: hidden;
          flex: 1;
        }
        .markdown :global(p) {
          margin: 0;
          overflow-wrap: break-word;
        }
        .markdown :global(p + p) {
          margin-top: 12px;
        }
        .markdown :global(h1),
        .markdown :global(h2),
        .markdown :global(h3),
        .markdown :global(h4),
        .markdown :global(h5),
        .markdown :global(h6) {
          margin: 0;
          font-weight: 700;
          color: #ececf1;
        }
        .markdown :global(h1) {
          font-size: 20px;
        }
        .markdown :global(h2) {
          font-size: 18px;
        }
        .markdown :global(h3) {
          font-size: 16px;
        }
        .markdown :global(ul),
        .markdown :global(ol) {
          margin: 0;
          padding-left: 20px;
        }
        .markdown :global(li) {
          margin: 6px 0;
        }
        .markdown :global(code) {
          font-family: 'Source Code Pro', Menlo, Consolas, monospace;
          font-size: 13px;
          background: rgba(64, 65, 79, 0.8);
          padding: 2px 6px;
          border-radius: 6px;
        }
        .markdown :global(pre) {
          background: transparent;
          padding: 0;
          margin: 0;
          border: none;
          overflow: auto;
        }
        .markdown :global(pre code) {
          display: block;
          padding: 0;
          background: transparent;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .markdown :global(blockquote) {
          margin: 0;
          padding-left: 12px;
          border-left: 3px solid #565869;
          color: #c5c5d2;
        }
        .code-block {
          display: flex;
          flex-direction: column;
          gap: 0;
          border: 1px solid #3f3f4b;
          border-radius: 12px;
          background: rgba(64, 65, 79, 0.85);
          overflow: hidden;
        }
        .code-block pre {
          padding: 14px;
          white-space: pre-wrap;
          word-break: break-word;
          overflow-wrap: anywhere;
        }
        .code-block code {
          white-space: inherit;
          word-break: inherit;
          overflow-wrap: inherit;
        }
        .copy-row {
          display: flex;
          justify-content: flex-end;
          margin-top: 6px;
        }
        .code-block .copy-row {
          margin-top: 0;
          padding: 6px 10px;
          background: rgba(40, 41, 54, 0.6);
          border-top: 1px solid #3f3f4b;
        }
        .copy-button {
          border: none;
          background: rgba(64, 65, 79, 0.35);
          color: #c5c5d2;
          border-radius: 8px;
          font-size: 16px;
          padding: 4px 8px;
          line-height: 1;
          cursor: pointer;
          transition: background 0.18s ease, transform 0.18s ease, color 0.18s ease;
        }
        .copy-button:hover:enabled {
          background: rgba(64, 65, 79, 0.55);
          color: #ececf1;
          transform: translateY(-1px);
        }
        .copy-button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .stream-caret {
          display: inline-block;
          align-self: stretch;
          width: 2px;
          background: #f7c948;
          border-radius: 1px;
          animation: blink 1s steps(1) infinite;
          margin-top: 4px;
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
          gap: 8px;
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
        .composer-actions .secondary {
          background: transparent;
          border-color: #ececf1;
          color: #ececf1;
        }
        .composer-actions .secondary:hover:enabled {
          background: rgba(236, 236, 241, 0.12);
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
        @keyframes blink {
          0%,
          50% {
            opacity: 1;
          }
          50.0001%,
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

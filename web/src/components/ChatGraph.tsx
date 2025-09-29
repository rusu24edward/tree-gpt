import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { GraphResponse } from '../lib/api';

type Props = {
  data: GraphResponse;
  onSelectNode: (id: string) => void;
  activeNodeId?: string | null;
  focusNodeId?: string | null;
  focusAncestors?: string[];
  onDeleteActive?: () => void;
  deleteLabel?: string;
  onForkActive?: () => void;
};

const NODE_HORIZONTAL_GAP = 260;
const NODE_VERTICAL_GAP = 160;
const VIEW_PADDING_X = 120;
const VIEW_PADDING_Y = 200;
const NODE_FALLBACK_WIDTH = 220;
const NODE_FALLBACK_HEIGHT = 80;

function layoutNodes(data: GraphResponse): Record<string, { x: number; y: number }> {
  const childrenMap = new Map<string, string[]>();
  const hasParent = new Set<string>();
  data.nodes.forEach((n) => childrenMap.set(n.id, []));
  data.edges.forEach((e) => {
    childrenMap.get(e.source)?.push(e.target);
    hasParent.add(e.target);
  });
  const roots = data.nodes.filter((n) => !hasParent.has(n.id)).map((n) => n.id);

  const pos: Record<string, { x: number; y: number }> = {};
  let queue: Array<{ id: string; depth: number }> = roots.map((id) => ({ id, depth: 0 }));
  const layerIndex = new Map<number, number>();

  while (queue.length) {
    const { id, depth } = queue.shift()!;
    const idx = layerIndex.get(depth) ?? 0;
    pos[id] = { x: idx * NODE_HORIZONTAL_GAP, y: depth * NODE_VERTICAL_GAP };
    layerIndex.set(depth, idx + 1);

    const kids = childrenMap.get(id) ?? [];
    kids.forEach((kid) => queue.push({ id: kid, depth: depth + 1 }));
  }

  if (Object.keys(pos).length === 0) {
    data.nodes.forEach((n, i) => {
      pos[n.id] = { x: (i % 4) * NODE_HORIZONTAL_GAP, y: Math.floor(i / 4) * NODE_VERTICAL_GAP };
    });
  }

  const entries = Object.values(pos);
  if (entries.length > 0) {
    const minX = Math.min(...entries.map((p) => p.x));
    const maxX = Math.max(...entries.map((p) => p.x));
    const minY = Math.min(...entries.map((p) => p.y));
    const maxY = Math.max(...entries.map((p) => p.y));
    const offsetX = (minX + maxX) / 2;
    const offsetY = (minY + maxY) / 2;

    Object.keys(pos).forEach((id) => {
      pos[id] = {
        x: pos[id].x - offsetX,
        y: pos[id].y - offsetY,
      };
    });
  }

  return pos;
}

function getNodeWorldPosition(node: Node): { x: number; y: number } {
  return node.positionAbsolute ?? node.position ?? { x: 0, y: 0 };
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    const mid = (min + max) / 2;
    return mid;
  }
  return Math.min(Math.max(value, min), max);
}

function ChatGraphInner({
  data,
  onSelectNode,
  activeNodeId,
  onDeleteActive,
  deleteLabel,
  onForkActive,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const initialViewDone = useRef(false);
  const lastAddedId = useRef<string | null>(null);
  const prevNodeIds = useRef<Set<string>>(new Set());
  const reactFlow = useReactFlow();
  const [isInteractive, setIsInteractive] = useState(true);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node[]>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge[]>([]);

  const parentById = useMemo(() => {
    const map = new Map<string, string | null>();
    data.nodes.forEach((n) => map.set(n.id, n.parent_id ?? null));
    return map;
  }, [data.nodes]);

  useEffect(() => {
    const positions = layoutNodes(data);
    const nextNodes: Node[] = data.nodes.map((n) => {
      const lines: string[] = [];
      if (n.user_label) {
        lines.push(`🧑 ${n.user_label}`);
      }
      if (n.assistant_label) {
        lines.push(`🤖 ${n.assistant_label}`);
      }
      const label = lines.length > 0 ? lines.join('\n') : n.label;

      const isSystem = n.role === 'system';
      const isUser = n.role === 'user';
      const background = isSystem ? '#2f2413' : isUser ? '#1d2540' : '#16213b';
      const borderColor = n.id === activeNodeId ? '#6366f1' : isSystem ? '#f59e0b' : isUser ? '#2f3b5d' : '#23304a';
      const textColor = isSystem ? '#fef6d8' : '#e2e8f0';
      const shadow = n.id === activeNodeId ? '0 24px 48px rgba(76, 102, 245, 0.35)' : '0 20px 40px rgba(3, 7, 18, 0.6)';

      return {
        id: n.id,
        data: { label },
        position: positions[n.id] ?? { x: 0, y: 0 },
        draggable: false,
        style: {
          border: n.id === activeNodeId ? '2px solid #6366f1' : `1px solid ${borderColor}`,
          borderRadius: 16,
          padding: 14,
          background,
          color: textColor,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: 1.45,
          boxShadow: shadow,
          maxWidth: 280,
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          textOverflow: 'ellipsis',
        },
      } as Node;
    });

    const nextEdges: Edge[] = data.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: false,
      style: { stroke: '#cbd5f0', strokeWidth: 1.4 },
    }));

    setNodes(nextNodes);
    setEdges(nextEdges);

    const prevIds = prevNodeIds.current;
    const nextIds = new Set(nextNodes.map((n) => n.id));
    const isInitial = prevIds.size === 0;
    let addedId: string | null = null;
    nextNodes.forEach((n) => {
      if (!prevIds.has(n.id)) {
        addedId = n.id;
      }
    });
    prevNodeIds.current = nextIds;

    if (isInitial && nextNodes.length > 0) {
      initialViewDone.current = false;
      lastAddedId.current = null;
    }
    if (!isInitial && addedId) {
      lastAddedId.current = addedId;
    }
  }, [data, activeNodeId, setNodes, setEdges]);

  useEffect(() => {
    if (initialViewDone.current) return;
    if (nodes.length === 0) return;

    const raf = requestAnimationFrame(() => {
      if (initialViewDone.current || nodes.length === 0) return;

      const wrapper = wrapperRef.current;
      if (!wrapper) return;

      const { width: viewWidth, height: viewHeight } = wrapper.getBoundingClientRect();
      if (viewWidth === 0 || viewHeight === 0) return;

      const metrics = nodes.map((node) => {
        const pos = getNodeWorldPosition(node);
        const width = node.width ?? NODE_FALLBACK_WIDTH;
        const height = node.height ?? NODE_FALLBACK_HEIGHT;
        return {
          minX: pos.x,
          maxX: pos.x + width,
          minY: pos.y,
          maxY: pos.y + height,
        };
      });

      const minX = Math.min(...metrics.map((m) => m.minX));
      const maxX = Math.max(...metrics.map((m) => m.maxX));
      const minY = Math.min(...metrics.map((m) => m.minY));
      const maxY = Math.max(...metrics.map((m) => m.maxY));

      const contentWidth = Math.max(maxX - minX, NODE_FALLBACK_WIDTH);
      const contentHeight = Math.max(maxY - minY, NODE_FALLBACK_HEIGHT);

      const padding = 160;
      const zoomForWidth = viewWidth / (contentWidth + padding);
      const zoomForHeight = viewHeight / (contentHeight + padding);
      const computedZoom = Math.min(zoomForWidth, zoomForHeight);
      const clampedZoom = clamp(computedZoom, 0.25, 1.5);

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const targetX = viewWidth / 2 - centerX * clampedZoom;
      const targetY = viewHeight / 2 - centerY * clampedZoom;

      reactFlow.setViewport({ x: targetX, y: targetY, zoom: clampedZoom });
      initialViewDone.current = true;
    });

    return () => cancelAnimationFrame(raf);
  }, [nodes, reactFlow]);

  useEffect(() => {
    const nodeId = lastAddedId.current;
    if (!nodeId) return;

    const raf = requestAnimationFrame(() => {
      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!bounds) {
        lastAddedId.current = null;
        return;
      }

      const node = reactFlow.getNode(nodeId);
      if (!node) {
        lastAddedId.current = null;
        return;
      }

      const viewport = reactFlow.getViewport();
      const zoom = viewport.zoom ?? 1;
      const viewLeft = -viewport.x / zoom;
      const viewTop = -viewport.y / zoom;
      const viewWidthWorld = bounds.width / zoom;
      const viewHeightWorld = bounds.height / zoom;
      const viewRight = viewLeft + viewWidthWorld;
      const viewBottom = viewTop + viewHeightWorld;

      const nodePos = getNodeWorldPosition(node);
      const nodeWidth = node.width ?? NODE_FALLBACK_WIDTH;
      const nodeHeight = node.height ?? NODE_FALLBACK_HEIGHT;
      const nodeLeft = nodePos.x;
      const nodeRight = nodePos.x + nodeWidth;
      const nodeTopWorld = nodePos.y;
      const nodeBottom = nodePos.y + nodeHeight;

      const fullyVisible =
        nodeLeft >= viewLeft &&
        nodeRight <= viewRight &&
        nodeTopWorld >= viewTop &&
        nodeBottom <= viewBottom;

      if (fullyVisible) {
        lastAddedId.current = null;
        return;
      }

      const focusIds: string[] = [];
      let current: string | null = nodeId;
      for (let i = 0; i < 3 && current; i += 1) {
        focusIds.push(current);
        current = parentById.get(current) ?? null;
      }

      const focusNodes = focusIds
        .map((id) => reactFlow.getNode(id))
        .filter((n): n is Node => Boolean(n));

      if (focusNodes.length === 0) {
        lastAddedId.current = null;
        return;
      }

      const minX = Math.min(...focusNodes.map((n) => getNodeWorldPosition(n).x)) - VIEW_PADDING_X;
      const maxX = Math.max(
        ...focusNodes.map((n) => {
          const pos = getNodeWorldPosition(n);
          const width = n.width ?? NODE_FALLBACK_WIDTH;
          return pos.x + width;
        })
      ) + VIEW_PADDING_X;
      const minY = Math.min(...focusNodes.map((n) => getNodeWorldPosition(n).y)) - VIEW_PADDING_Y;
      const maxY = Math.max(
        ...focusNodes.map((n) => {
          const pos = getNodeWorldPosition(n);
          const height = n.height ?? NODE_FALLBACK_HEIGHT;
          return pos.y + height;
        })
      ) + VIEW_PADDING_Y;

      const bboxWidth = Math.max(maxX - minX, 1);
      const bboxHeight = Math.max(maxY - minY, 1);
      const desiredZoom = Math.min(bounds.width / bboxWidth, bounds.height / bboxHeight);
      const targetZoom = Math.min(zoom, desiredZoom);

      const nextViewWidth = bounds.width / targetZoom;
      const nextViewHeight = bounds.height / targetZoom;

      const minLeft = maxX - nextViewWidth;
      const maxLeft = minX;
      const nodeCenterX = nodeLeft + nodeWidth / 2;
      const desiredLeft = nodeCenterX - nextViewWidth / 2;
      const viewLeftNext = clamp(desiredLeft, minLeft, maxLeft);

      const minTopAllowed = maxY - nextViewHeight;
      const maxTopAllowed = minY;
      const nodeCenterY = nodeTopWorld + nodeHeight / 2;
      const desiredTop = nodeCenterY - (nextViewHeight * 2) / 3;
      const viewTopNext = clamp(desiredTop, minTopAllowed, maxTopAllowed);

      reactFlow.setViewport({
        x: -viewLeftNext * targetZoom,
        y: -viewTopNext * targetZoom,
        zoom: targetZoom,
      });

      lastAddedId.current = null;
    });

    return () => cancelAnimationFrame(raf);
  }, [parentById, nodes, reactFlow]);

  const activeNode = useMemo(() => data.nodes.find((n) => n.id === activeNodeId) ?? null, [data.nodes, activeNodeId]);

  const canDelete = useMemo(() => Boolean(onDeleteActive && activeNode), [onDeleteActive, activeNode]);
  const canFork = useMemo(() => Boolean(onForkActive && activeNode), [onForkActive, activeNode]);
  const showActions = canDelete || canFork;

  const deleteLabelResolved = useMemo(() => {
    if (deleteLabel) return deleteLabel;
    if (activeNode && !activeNode.parent_id) return 'Delete conversation';
    return 'Delete branch';
  }, [activeNode, deleteLabel]);

  const forkLabel = 'Create conversation from branch';

  return (
    <div ref={wrapperRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesUpdatable={false}
        selectNodesOnDrag={false}
        panOnDrag={isInteractive}
        panOnScroll={false}
        zoomOnScroll={isInteractive}
        zoomOnPinch={isInteractive}
        zoomOnDoubleClick={isInteractive}
        fitView={false}
        minZoom={0.25}
        maxZoom={1.5}
      >
        <MiniMap
          style={{ background: '#0f172a', borderRadius: 12, border: '1px solid #1f2937', padding: 6 }}
          nodeColor={(n) => {
            const bg = n.style && typeof n.style === 'object' ? (n.style as any).background : null;
            return typeof bg === 'string' ? bg : '#1f2a44';
          }}
          nodeStrokeColor={() => '#6366f1'}
          nodeBorderRadius={12}
        />
        <Controls
          style={{ background: 'rgba(15, 23, 42, 0.92)', borderRadius: 12, border: '1px solid #1f2937', color: '#e2e8f0' }}
          onInteractiveChange={(next) => setIsInteractive(next)}
          showInteractive
        />
        <Background color="#27364d" gap={24} />
      </ReactFlow>

      {showActions && (
        <div
          style={{
            position: 'absolute',
            right: 16,
            top: 16,
            background: 'rgba(15, 23, 42, 0.9)',
            boxShadow: '0 20px 40px rgba(3, 7, 18, 0.55)',
            borderRadius: 12,
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 10,
            border: '1px solid #1f2937',
          }}
        >
          <span style={{ fontSize: 13, color: '#f8fafc', fontWeight: 600 }}>Branch actions</span>
          {canFork && onForkActive && (
            <button
              onClick={onForkActive}
              style={{
                background: 'linear-gradient(135deg, #1e3a8a, #2563eb)',
                border: '1px solid #3b82f6',
                color: '#e0f2ff',
                borderRadius: 999,
                padding: '6px 12px',
                fontWeight: 600,
              }}
            >
              {forkLabel}
            </button>
          )}
          {canDelete && onDeleteActive && (
            <button
              onClick={onDeleteActive}
              style={{
                background: 'linear-gradient(135deg, #7f1d1d, #b91c1c)',
                border: '1px solid #dc2626',
                color: '#fee2e2',
                borderRadius: 999,
                padding: '6px 12px',
                fontWeight: 600,
              }}
            >
              {deleteLabelResolved}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatGraph(props: Props) {
  return (
    <ReactFlowProvider>
      <ChatGraphInner {...props} />
    </ReactFlowProvider>
  );
}

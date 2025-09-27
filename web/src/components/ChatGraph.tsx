import React, { useEffect, useMemo, useRef } from 'react';
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

function ChatGraphInner({ data, onSelectNode, activeNodeId, onDeleteActive }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const initialViewDone = useRef(false);
  const lastAddedId = useRef<string | null>(null);
  const prevNodeIds = useRef<Set<string>>(new Set());
  const reactFlow = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node[]>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge[]>([]);

  const parentById = useMemo(() => {
    const map = new Map<string, string | null>();
    data.nodes.forEach((n) => map.set(n.id, n.parent_id ?? null));
    return map;
  }, [data.nodes]);

  useEffect(() => {
    const positions = layoutNodes(data);
    const nextNodes: Node[] = data.nodes.map((n) => ({
      id: n.id,
      data: {
        label: `${n.role === 'assistant' ? '🤖 ' : n.role === 'user' ? '🧑 ' : ''}${n.label}`,
      },
      position: positions[n.id] ?? { x: 0, y: 0 },
      draggable: false,
      style: {
        border: n.id === activeNodeId ? '2px solid #8a9aff' : '1px solid #d0d7e2',
        borderRadius: 16,
        padding: 10,
        background: n.role === 'assistant' ? '#ffffff' : '#f7f8ff',
        color: '#0f172a',
        fontSize: 13,
        fontWeight: 500,
        boxShadow: '0 12px 24px rgba(15, 23, 42, 0.08)',
        maxWidth: 260,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
    }));

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
      reactFlow.fitView({ padding: 0.18 });
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

  const canDelete = useMemo(() => {
    if (!activeNodeId || !onDeleteActive) return false;
    const target = data.nodes.find((n) => n.id === activeNodeId);
    return Boolean(target && target.parent_id);
  }, [activeNodeId, onDeleteActive, data.nodes]);

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
        panOnDrag
        panOnScroll
        zoomOnScroll
        zoomOnPinch
        fitView={false}
        minZoom={0.25}
        maxZoom={1.5}
      >
        <MiniMap
          style={{ background: '#f1f3f9', borderRadius: 12, border: '1px solid #d8e1f2', padding: 6 }}
          nodeColor={(n) => (n.style && typeof n.style === 'object' ? (n.style as any).background : '#e5e7eb')}
          nodeStrokeColor={() => '#94a3b8'}
          nodeBorderRadius={12}
        />
        <Controls style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #d0d7e2' }} />
        <Background color="#dbe4ff" gap={24} />
      </ReactFlow>

      {canDelete && (
        <div
          style={{
            position: 'absolute',
            right: 16,
            top: 16,
            background: 'rgba(255, 255, 255, 0.9)',
            boxShadow: '0 12px 24px rgba(15, 23, 42, 0.12)',
            borderRadius: 999,
            padding: '6px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            border: '1px solid #d0d7e2',
          }}
        >
          <span style={{ fontSize: 13, color: '#0f172a', fontWeight: 500 }}>Branch actions</span>
          <button
            onClick={onDeleteActive}
            style={{
              background: '#fee2e2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              borderRadius: 999,
              padding: '4px 10px',
              fontWeight: 600,
            }}
          >
            Delete branch
          </button>
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

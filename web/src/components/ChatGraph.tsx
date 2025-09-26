import React, { useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
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

// simple layered layout: roots at depth 0, children below
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
  const layerGapY = 140;
  const nodeGapX = 260;

  let queue: Array<{ id: string; depth: number }> = roots.map((id) => ({ id, depth: 0 }));
  const layerIndex = new Map<number, number>(); // depth -> next x-index

  while (queue.length) {
    const { id, depth } = queue.shift()!;
    const idx = layerIndex.get(depth) ?? 0;
    pos[id] = { x: idx * nodeGapX, y: depth * layerGapY };
    layerIndex.set(depth, idx + 1);

    const kids = childrenMap.get(id) ?? [];
    kids.forEach((kid) => queue.push({ id: kid, depth: depth + 1 }));
  }

  // if no edges (single node or empty), still place nodes
  if (Object.keys(pos).length === 0) {
    data.nodes.forEach((n, i) => {
      pos[n.id] = { x: (i % 4) * nodeGapX, y: Math.floor(i / 4) * layerGapY };
    });
  }
  return pos;
}

export default function ChatGraph({ data, onSelectNode, activeNodeId }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node[]>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge[]>([]);

  useEffect(() => {
    const positions = layoutNodes(data);
    const nextNodes: Node[] = data.nodes.map((n) => ({
      id: n.id,
      data: {
        label: `${n.role === 'assistant' ? '🤖 ' : n.role === 'user' ? '🧑 ' : ''}${n.label}`,
      },
      position: positions[n.id] ?? { x: 0, y: 0 },
      style: {
        border: n.id === activeNodeId ? '2px solid #2563eb' : '1px solid #3b3b3b',
        borderRadius: 12,
        padding: 8,
        background: n.role === 'assistant' ? '#0f172a' : '#111827',
        color: '#e5e7eb',
        fontSize: 12,
        maxWidth: 240,
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
      style: { stroke: '#475569' },
    }));

    setNodes(nextNodes);
    setEdges(nextEdges);
  }, [data, activeNodeId, setNodes, setEdges]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        fitView
      >
        <MiniMap
          style={{ background: '#0b1020' }}
          nodeColor={(n) => (n.style && typeof n.style === 'object' ? (n.style as any).background : '#1f2937')}
          nodeStrokeColor={() => '#6b7280'}
          nodeBorderRadius={8}
        />
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
}

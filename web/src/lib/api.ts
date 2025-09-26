export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function fetchJSON<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed: ${res.status} ${text}`);
  }
  return res.json();
}

export type GraphNode = { id: string; label: string; role: string; parent_id?: string | null };
export type GraphEdge = { id: string; source: string; target: string };
export type GraphResponse = { nodes: GraphNode[]; edges: GraphEdge[] };
export type TreeOut = { id: string; title?: string | null };
export type PathMessage = { role: string; content: string };
export type PathResponse = { path: PathMessage[] };

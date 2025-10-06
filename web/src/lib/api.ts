import { ensureUserId } from './user';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

function buildHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init || {});
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-User-Id', ensureUserId());
  return headers;
}

export function authHeaders(init?: HeadersInit): Headers {
  return buildHeaders(init);
}

export async function fetchJSON<T>(path: string, opts?: RequestInit): Promise<T> {
  const headers = buildHeaders(opts?.headers);
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed: ${res.status} ${text}`);
  }
  return res.json();
}

export type GraphNode = {
  id: string;
  role: string;
  label: string;
  parent_id?: string | null;
  user_label?: string | null;
  assistant_label?: string | null;
  created_at?: string | null;
};
export type GraphEdge = { id: string; source: string; target: string };
export type GraphResponse = { nodes: GraphNode[]; edges: GraphEdge[] };
export type TreeOut = { id: string; title?: string | null };
export type MessageAttachment = {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  status: string;
  download_url?: string | null;
  thumbnail_url?: string | null;
};
export type PathMessage = { role: string; content: string; attachments: MessageAttachment[] };
export type PathResponse = { path: PathMessage[] };
export type BranchForkResponse = { tree: TreeOut; active_node_id: string };

export type SignedUploadResponse = {
  file_id: string;
  upload_url: string;
  expires_at: string;
  required_headers: Record<string, string>;
  max_size: number;
};

export type FileMetadata = {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  status: string;
  tree_id?: string | null;
  message_id?: string | null;
  download_url?: string | null;
  thumbnail_url?: string | null;
  created_at: string;
  updated_at?: string | null;
};

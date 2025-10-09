import { FileMetadata, SignedUploadResponse, fetchJSON } from './api';

export const MAX_CLIENT_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const DISALLOWED_EXTENSIONS = new Set(['.exe', '.js', '.bat', '.cmd', '.sh', '.dll', '.com']);

function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx === -1) return '';
  return name.slice(idx).toLowerCase();
}

export function validateFile(file: File): string | null {
  if (file.size === 0) {
    return 'File is empty';
  }
  if (file.size > MAX_CLIENT_FILE_SIZE) {
    return 'File is too large (max 25 MB)';
  }
  const ext = extensionOf(file.name);
  if (DISALLOWED_EXTENSIONS.has(ext)) {
    return 'This file type is not allowed';
  }
  return null;
}

export async function requestSignedUpload(file: File, treeId: string | null): Promise<SignedUploadResponse> {
  return fetchJSON<SignedUploadResponse>('/api/files/sign', {
    method: 'POST',
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
      size: file.size,
      tree_id: treeId,
    }),
  });
}

export async function completeUpload(fileId: string, treeId: string | null): Promise<FileMetadata> {
  return fetchJSON<FileMetadata>(`/api/files/${fileId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ tree_id: treeId }),
  });
}

export async function deleteFile(fileId: string): Promise<void> {
  await fetchJSON(`/api/files/${fileId}`, { method: 'DELETE' });
}

export type UploadProgressHandler = (percent: number) => void;

export function uploadToSignedUrl(
  file: File,
  signed: SignedUploadResponse,
  onProgress?: UploadProgressHandler
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signed.upload_url, true);
    Object.entries(signed.required_headers || {}).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });
    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      onProgress(percent);
    };
    xhr.onerror = () => {
      reject(new Error('Upload failed'));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };
    xhr.send(file);
  });
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function isImage(contentType: string): boolean {
  return contentType.startsWith('image/');
}

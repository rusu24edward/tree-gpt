const STORAGE_KEY = 'branching-chat-user-id';

function generateFallbackId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `user-${Math.random().toString(36).slice(2, 10)}`;
}

export function ensureUserId(): string {
  if (typeof window === 'undefined') {
    if (typeof globalThis === 'object' && (globalThis as any).__BRANCHING_CHAT_USER_ID) {
      return (globalThis as any).__BRANCHING_CHAT_USER_ID as string;
    }
    const generated = generateFallbackId();
    if (typeof globalThis === 'object') {
      (globalThis as any).__BRANCHING_CHAT_USER_ID = generated;
    }
    return generated;
  }

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) {
      return existing;
    }
    const generated = generateFallbackId();
    window.localStorage.setItem(STORAGE_KEY, generated);
    return generated;
  } catch (err) {
    console.warn('Failed to access localStorage for user id; using fallback', err);
    return generateFallbackId();
  }
}

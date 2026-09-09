import type { DebateMessage, DebateMode, ParticipantConfig } from '@/lib/types';

const STORAGE_KEY = 'ai-debate-arena:session:v1';

export interface StoredSession {
  topic: string;
  mode: DebateMode;
  maxTurns: number;
  participants: ParticipantConfig[];
  synthesizerId?: string;
  produceSynthesis: boolean;
  history: DebateMessage[];
  synthesis?: DebateMessage;
  updatedAt: number;
}

export function saveSession(session: StoredSession) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // localStorage plein ou indisponible (mode privé) : on dégrade
    // silencieusement, l'appli reste utilisable sans persistance.
  }
}

export function loadSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

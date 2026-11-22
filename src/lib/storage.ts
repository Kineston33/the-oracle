/**
 * Local persistence for saved research drafts.
 *
 * Drafts are questions a visitor chose to keep while working through the
 * resolution criteria. They never leave the browser. No account, no analytics,
 * no transmission. If storage is unavailable (private mode, disabled), the app
 * degrades to in-memory state and says so on the Explore surface.
 */

import type { IsoDateTime, LocalDraft, PredictionCategory } from '@/data/types';

const STORAGE_KEY = 'the-oracle:drafts:v1';
const MAX_DRAFTS = 24;

export interface StorageAvailability {
  available: boolean;
  reason?: string;
}

export function checkStorage(): StorageAvailability {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { available: false, reason: 'This browser does not expose local storage.' };
  }
  try {
    const probe = '__oracle_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return { available: true };
  } catch {
    return {
      available: false,
      reason: 'Local storage is blocked, so drafts will not persist after this session.',
    };
  }
}

function isDraft(value: unknown): value is LocalDraft {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.question === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.saved === 'boolean'
  );
}

export function loadDrafts(): LocalDraft[] {
  if (!checkStorage().available) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDraft).slice(0, MAX_DRAFTS);
  } catch {
    return [];
  }
}

function persist(drafts: LocalDraft[]): boolean {
  if (!checkStorage().available) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts.slice(0, MAX_DRAFTS)));
    return true;
  } catch {
    return false;
  }
}

export function createDraft(
  question: string,
  category: PredictionCategory | null,
  now: Date = new Date(),
): LocalDraft {
  const createdAt: IsoDateTime = now.toISOString();
  return {
    id: `draft-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    question,
    category,
    createdAt,
    saved: true,
  };
}

/** Add or replace by identical question text, newest first. */
export function saveDraft(draft: LocalDraft): LocalDraft[] {
  const existing = loadDrafts().filter(
    (item) => item.question.trim().toLowerCase() !== draft.question.trim().toLowerCase(),
  );
  const next = [draft, ...existing].slice(0, MAX_DRAFTS);
  persist(next);
  return next;
}

export function removeDraft(id: string): LocalDraft[] {
  const next = loadDrafts().filter((draft) => draft.id !== id);
  persist(next);
  return next;
}

export function clearDrafts(): LocalDraft[] {
  if (checkStorage().available) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable — nothing to clear */
    }
  }
  return [];
}

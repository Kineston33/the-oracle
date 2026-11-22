import { describe, expect, it, beforeEach } from 'vitest';
import { checkStorage, clearDrafts, createDraft, loadDrafts, removeDraft, saveDraft } from './storage';

describe('local drafts', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reports storage as available in a normal browser context', () => {
    expect(checkStorage().available).toBe(true);
  });

  it('creates a draft with a unique id and saved flag', () => {
    const draft = createDraft('Will fusion reach the grid by 2035?', 'climate');
    expect(draft.saved).toBe(true);
    expect(draft.category).toBe('climate');
    expect(draft.id).toMatch(/^draft-/);
    expect(draft.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('round-trips drafts through localStorage', () => {
    const draft = createDraft('Will fusion reach the grid by 2035?', null);
    saveDraft(draft);
    const loaded = loadDrafts();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].question).toBe(draft.question);
  });

  it('puts the newest draft first', () => {
    const first = createDraft('First question about storage?', 'climate', new Date('2026-01-01'));
    const second = createDraft('Second question about compute?', 'technology', new Date('2026-02-01'));
    saveDraft(first);
    saveDraft(second);
    expect(loadDrafts()[0].id).toBe(second.id);
  });

  it('de-duplicates identical questions instead of stacking them', () => {
    const draft = createDraft('Will fusion reach the grid by 2035?', null);
    saveDraft(draft);
    saveDraft(createDraft('  Will fusion reach the grid by 2035? ', null));
    expect(loadDrafts()).toHaveLength(1);
  });

  it('removes a draft by id and leaves the rest intact', () => {
    const a = createDraft('Question A about storage', null);
    const b = createDraft('Question B about compute', null);
    saveDraft(a);
    saveDraft(b);
    const remaining = removeDraft(a.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(b.id);
  });

  it('clears everything on request', () => {
    saveDraft(createDraft('Question about storage', null));
    expect(clearDrafts()).toEqual([]);
    expect(loadDrafts()).toEqual([]);
  });

  it('ignores malformed data rather than throwing', () => {
    window.localStorage.setItem('the-oracle:drafts:v1', '{"not":"an array"}');
    expect(loadDrafts()).toEqual([]);
  });

  it('filters out entries that do not match the draft shape', () => {
    window.localStorage.setItem(
      'the-oracle:drafts:v1',
      JSON.stringify([{ id: 'ok', question: 'Q', createdAt: '2026-01-01T00:00:00Z', saved: true }, { nope: true }]),
    );
    expect(loadDrafts()).toHaveLength(1);
  });
});

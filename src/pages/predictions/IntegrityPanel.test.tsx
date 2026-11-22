import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { IntegrityPanel } from './IntegrityPanel';
import { predictionRecords } from '@/data/records';
import type { PredictionRecord } from '@/data/types';

/**
 * The panel is the public face of verification, so it must fail visibly.
 *
 * Each case tampered with one layer and asserts that the panel reports that
 * layer as failed and never shows the "everything verifies" verdict. A panel
 * that silently degraded to a green badge would make the whole model decorative.
 */

const open = predictionRecords.find((record) => record.id === 'ORC-2025-0001')!;
const resolved = predictionRecords.find((record) => record.id === 'ORC-2025-0007')!;

function panelText(container: HTMLElement): string {
  return container.textContent ?? '';
}

async function renderPanel(record: PredictionRecord) {
  const view = render(<IntegrityPanel record={record} />);
  await waitFor(
    () => expect(panelText(view.container)).not.toMatch(/Recomputing/i),
    { timeout: 4000 },
  );
  return view;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the panel never overstates integrity', () => {
  it('reports all four checks for an intact record', async () => {
    const { container } = await renderPanel(open);
    const text = panelText(container);

    expect(text).toMatch(/Sealed payload verified/);
    expect(text).toMatch(/Publication event verified/);
    expect(text).toMatch(/Event chain verified/);
    expect(text).toMatch(/External anchoring not verified/);
    expect(text).toMatch(/all verify against the shipped bytes/i);
  });

  it('8. does not show full integrity when the event chain fails', async () => {
    // Tamper with the chain only: the payload still reproduces its digest.
    const broken: PredictionRecord = {
      ...open,
      events: [{ ...open.events[0], occurredAt: '2020-01-01T00:00:00.000Z' }],
    };
    const { container } = await renderPanel(broken);
    const text = panelText(container);

    expect(text).toMatch(/Event chain failed/);
    expect(text).not.toMatch(/all verify against the shipped bytes/i);
    expect(text).toMatch(/Verification failed/i);
  });

  it('8b. does not show full integrity when the payload fails', async () => {
    const tampered: PredictionRecord = { ...open, probability: open.probability + 0.1 };
    const { container } = await renderPanel(tampered);
    const text = panelText(container);

    expect(text).toMatch(/Sealed payload failed/);
    expect(text).not.toMatch(/all verify against the shipped bytes/i);
    expect(text).toMatch(/Verification failed/i);
  });

  it('8c. does not show full integrity when the publication link fails', async () => {
    const unlinked: PredictionRecord = {
      ...open,
      events: [
        {
          ...open.events[0],
          body: { ...open.events[0].body, payloadDigest: 'a'.repeat(64) },
        },
      ],
    };
    const { container } = await renderPanel(unlinked);
    const text = panelText(container);

    expect(text).toMatch(/Publication event failed/);
    expect(text).not.toMatch(/all verify against the shipped bytes/i);
  });

  it('8d. reports verification unavailable rather than a pass', async () => {
    // Simulate a browser without Web Crypto: the panel must not claim anything.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { subtle: undefined },
    });

    try {
      const { container } = await renderPanel(open);
      const text = panelText(container);

      expect(text).toMatch(/not verified/i);
      expect(text).not.toMatch(/Sealed payload verified/);
      expect(text).not.toMatch(/all verify against the shipped bytes/i);
      expect(text).toMatch(/Nothing has been verified|not internally consistent/i);
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
  });

  it('keeps the migration caveat visible with a closed record', async () => {
    const { container } = await renderPanel(resolved);
    const text = panelText(container);

    expect(text).toMatch(/Event chain migration/i);
    expect(text).toMatch(/not a witness that anything happened/i);
    expect(text).toMatch(/covered by each event's digest/i);
    expect(text).toMatch(/Migrated, not witnessed/i);
  });
});

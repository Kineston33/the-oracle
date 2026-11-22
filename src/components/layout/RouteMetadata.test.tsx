import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '@/App';

/**
 * Every route must carry its own title, description and canonical URL. Without
 * this the whole app shares one static title, which breaks tab readability and
 * link previews.
 */

function launch(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

function metaContent(selector: string): string | null {
  return document.head.querySelector(selector)?.getAttribute('content') ?? null;
}

describe('route metadata', () => {
  it('gives the homepage its own title and description', () => {
    launch('/');
    expect(document.title).toBe("THE ORACLE — See what's coming.");
    expect(metaContent('meta[name="description"]')).toMatch(/public archive/i);
  });

  it('gives Explore its own title', async () => {
    launch('/explore');
    await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
    expect(document.title).toMatch(/^Explore a question — THE ORACLE$/);
  });

  it('gives the archive its own title', async () => {
    launch('/predictions');
    await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
    expect(document.title).toMatch(/^The prediction archive — THE ORACLE$/);
  });

  it('gives the trends index its own title', async () => {
    launch('/trends');
    await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
    expect(document.title).toMatch(/^Emerging signals — THE ORACLE$/);
  });

  it('gives About its own title', async () => {
    launch('/about');
    await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
    expect(document.title).toMatch(/^Method and limitations — THE ORACLE$/);
  });

  it('puts the record title in the document title', async () => {
    launch('/predictions/ORC-2025-0007');
    await screen.findByRole('heading', { level: 1, name: /mauna loa/i }, { timeout: 3000 });
    expect(document.title).toMatch(/^ORC-2025-0007 — Mauna Loa CO₂ above 430 ppm · THE ORACLE$/);
    expect(metaContent('meta[name="description"]')).toMatch(/71%/);
  });

  it('labels an unknown record as not found', async () => {
    launch('/predictions/ORC-9999-9999');
    await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
    expect(document.title).toMatch(/Page not found — THE ORACLE/);
  });

  it('labels an unknown path as not found', async () => {
    launch('/no-such-page');
    await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
    expect(document.title).toMatch(/Page not found — THE ORACLE/);
  });

  it('keeps the canonical link in step with the route', async () => {
    launch('/trends');
    await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
    const canonical = document.head.querySelector('link[rel="canonical"]');
    expect(canonical?.getAttribute('href')).toMatch(/\/trends$/);
  });

  it('updates the Open Graph title alongside the document title', async () => {
    launch('/about');
    await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
    expect(metaContent('meta[property="og:title"]')).toMatch(/^Method and limitations/);
  });
});

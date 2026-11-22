import { describe, it } from 'vitest';
import { render } from '@testing-library/react';
import { writeFileSync, mkdirSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';

const OUT = '/home/user/the-oracle/.arena-audit';

/**
 * Development-only structural audit. Renders every route and writes the
 * resulting markup so layout and content can be inspected outside a browser.
 * Not part of the shipped test suite (see `include` in vitest.config.ts, and
 * this file is excluded from normal runs by its `.audit.` suffix).
 */
describe('route audit', () => {
  const routes: Array<[string, string]> = [
    ['home', '/'],
    ['explore', '/explore'],
    ['predictions', '/predictions'],
    ['record', '/predictions/ORC-2025-0007'],
    ['trends', '/trends'],
    ['about', '/about'],
    ['notfound', '/missing'],
  ];

  it('dumps markup for each route', async () => {
    mkdirSync(OUT, { recursive: true });
    for (const [name, path] of routes) {
      const { container, unmount } = render(
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 900));
      writeFileSync(`${OUT}/${name}.html`, container.innerHTML, 'utf8');

      const headings = Array.from(container.querySelectorAll('h1,h2,h3')).map(
        (node) => `${node.tagName}: ${node.textContent?.trim().slice(0, 90)}`,
      );
      const buttons = container.querySelectorAll('button').length;
      const links = container.querySelectorAll('a').length;
      const inputs = container.querySelectorAll('input,textarea,select').length;
      console.log(
        `\n[${name}] ${path} — ${container.innerHTML.length}B, ${buttons} buttons, ${links} links, ${inputs} inputs`,
      );
      for (const heading of headings) console.log('   ', heading);
      unmount();
    }
  }, 30_000);
});

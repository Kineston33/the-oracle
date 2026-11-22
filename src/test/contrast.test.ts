import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the accessibility claim in the README: every text token must clear
 * WCAG AA (4.5:1) against every surface token it can appear on. A palette tweak
 * that breaks legibility now fails the suite instead of shipping quietly.
 */

// Resolved from the project root so it works under any test environment.
const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

function token(name: string): string {
  const match = tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`Token --${name} not found as a hex colour`);
  return match[1];
}

function toRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function relativeLuminance(hex: string): number {
  const channel = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = toRgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}

const TEXT_TOKENS = ['text-primary', 'text-secondary', 'text-tertiary', 'text-quaternary'];
const SURFACE_TOKENS = ['obsidian', 'obsidian-2', 'midnight', 'midnight-2', 'navy-raised'];

describe('text contrast', () => {
  for (const textToken of TEXT_TOKENS) {
    for (const surfaceToken of SURFACE_TOKENS) {
      it(`--${textToken} clears AA on --${surfaceToken}`, () => {
        const ratio = contrast(token(textToken), token(surfaceToken));
        expect(ratio, `${textToken} on ${surfaceToken} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('keeps the hierarchy monotonic: primary is lighter than secondary, and so on', () => {
    const luminances = TEXT_TOKENS.map((name) => relativeLuminance(token(name)));
    for (let index = 1; index < luminances.length; index += 1) {
      expect(luminances[index]).toBeLessThan(luminances[index - 1]);
    }
  });

  it('keeps accent text legible on the page base', () => {
    for (const accent of ['violet-bright', 'cosmic-soft', 'gold', 'positive', 'caution', 'danger']) {
      const ratio = contrast(token(accent), token('obsidian'));
      expect(ratio, `${accent} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

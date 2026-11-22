import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Testing Library keeps its default async-utility timeout here.
 *
 * This file deliberately does NOT raise `asyncUtilTimeout` globally. A global
 * ceiling would slow down every failing assertion in the suite to mask a problem
 * that belongs to one test, and it cannot actually solve it — see limitation 36.
 *
 * The single test that needs more room (`App.test.tsx > navigation > navigates
 * from the homepage to the archive`) passes `timeout: 5000` on its own
 * `findByRole`, where the reason is local and visible.
 */

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

// jsdom has no matchMedia; components query it for responsive behaviour.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom has no IntersectionObserver; the sphere and About nav use it.
if (!('IntersectionObserver' in window)) {
  class MockIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly scrollMargin = '';
    readonly thresholds: readonly number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    configurable: true,
    value: MockIntersectionObserver,
  });
}

// jsdom does not implement scrolling; the router calls it on navigation.
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
Element.prototype.scrollIntoView = vi.fn();

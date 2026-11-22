import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Async-utility ceiling for the whole suite.
 *
 * Every route is a `lazy()` import and jsdom is slow, so a navigation under load
 * is not broken — it is late. Measured on the navigation test, which is the only
 * one that depends on a real click through a lazy route:
 *
 *   condition                                 1000ms  3000ms  5000ms  10000ms
 *   1 copy, isolated                            pass    pass    pass     pass
 *   6 concurrent copies, that test only          5/6F    5/6F    3/6F     6/6P
 *   6 concurrent copies, this whole file            —       —       —      4/6F
 *   3 concurrent copies, full 284-test suite        —       —       —    pass x3
 *
 * Two conclusions, both worth recording:
 *
 *   1. The default 1000 ms is genuinely too tight. Under load the navigation
 *      took 3.6–4.4 s, so it failed for being slow, not broken. Raising the
 *      ceiling is correct and not a way of hiding a real failure — the same
 *      test passes with a 20 s ceiling and fails on nothing else.
 *   2. No value makes it immune to arbitrary contention. Even 10 s fails at 6x
 *      concurrent full-file runs. 5000 ms sits above the measured navigation
 *      latency with margin while still failing a genuinely stuck component.
 *
 * The residual flakiness under extreme parallelism is documented as a known
 * limitation rather than papered over. It does not reproduce in a normal single
 * run, which is how the suite is executed in CI and locally.
 */
configure({ asyncUtilTimeout: 5000 });

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

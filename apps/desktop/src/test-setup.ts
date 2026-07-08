import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount React trees between tests so repeated render() calls don't stack.
afterEach(() => cleanup());

// jsdom lacks a few browser APIs that HeroUI / React-Aria components touch
// (media queries for theming, ResizeObserver for popovers/overlays). Provide
// inert stubs so those components mount in tests.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

if (!("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

// jsdom on newer Node versions (26+) fails to wire window.localStorage at all.
// The app treats storage as best-effort, so provide a spec-shaped in-memory
// stub — fresh per test file — when the environment doesn't supply one.
if (!window.localStorage) {
  const store = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(String(key)) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => {
      store.delete(String(key));
    },
    setItem: (key, value) => {
      store.set(String(key), String(value));
    },
  };
  Object.defineProperty(window, "localStorage", { value: stub, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true });
}

// Radix popovers (Select, etc.) call these pointer-capture / scroll APIs that
// jsdom does not implement.
const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
proto.hasPointerCapture ??= () => false;
proto.setPointerCapture ??= () => {};
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};

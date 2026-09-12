/**
 * Browser-global shims for running client code (src/client/view, theme,
 * WebGLFrameBuilder) under Node. Import this FIRST — ESM executes imports in
 * order, so it must precede any module that touches these globals.
 *
 * UserSettings reads localStorage lazily; an in-memory store means every
 * setting resolves to its default, which is also the deterministic choice.
 */
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

/**
 * Only the event surface, deliberately. src/client/Api.ts registers a
 * `session-cleared` listener at module scope, and WebGLFrameBuilder reaches
 * it through Cosmetics, so the harness cannot import the code it measures
 * without one. A real EventTarget means the listener actually registers
 * rather than being silently skipped; leaving createElement and friends off
 * means any genuine DOM work still throws instead of being measured under a
 * shim that does nothing.
 */
if (typeof globalThis.document === "undefined") {
  const target = new EventTarget();
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    },
  });
}

export {};

// jsdom polyfills for the browser APIs Radix primitives call. Import this file from
// DOM tests that open Select, Slider, Menubar, Popover and similar components.
// It is deliberately not in vitest.setup.ts, which also runs in the node environment.

if (typeof window !== "undefined") {
  const proto = window.HTMLElement.prototype;

  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
  if (!proto.setPointerCapture) proto.setPointerCapture = () => undefined;
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => undefined;
  if (!proto.scrollIntoView) proto.scrollIntoView = () => undefined;

  if (!("ResizeObserver" in window)) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    Object.assign(window, { ResizeObserver: ResizeObserverStub });
    Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
  }

  if (!("DOMRect" in window)) {
    class DOMRectStub {
      constructor(
        public x = 0,
        public y = 0,
        public width = 0,
        public height = 0,
      ) {}
      get top() {
        return this.y;
      }
      get left() {
        return this.x;
      }
      get right() {
        return this.x + this.width;
      }
      get bottom() {
        return this.y + this.height;
      }
      toJSON() {
        return { ...this };
      }
    }
    Object.assign(window, { DOMRect: DOMRectStub });
    Object.assign(globalThis, { DOMRect: DOMRectStub });
  }
}

export {};

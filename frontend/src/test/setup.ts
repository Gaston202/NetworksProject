import '@testing-library/jest-dom/vitest'

// jsdom lacks the browser APIs Radix components rely on.
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
if (typeof Element !== 'undefined' && Element.prototype.scrollIntoView === undefined) {
  Element.prototype.scrollIntoView = () => {}
}
// jsdom 29 has no pointer-capture API; @radix-ui/react-select's onPointerDown
// calls hasPointerCapture() before opening, and throwing there keeps the
// dropdown closed (its click fallback assumes pointerdown already did it).
if (typeof Element !== 'undefined' && typeof Element.prototype.hasPointerCapture !== 'function') {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.setPointerCapture = () => {}
}
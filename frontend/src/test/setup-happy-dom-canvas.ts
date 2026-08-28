/**
 * Vitest setup for headless Phaser tests.
 *
 * Phaser's module-init (device/CanvasFeatures) needs a 2D canvas context that
 * happy-dom does not provide, so we shim `HTMLCanvasElement.getContext` to
 * return a minimal no-op 2D context. This lets the real `DungeonPhaserScene`
 * import and boot under the HEADLESS renderer without a GPU/canvas backend.
 */
const ctx2d = {
  canvas: null as unknown as HTMLCanvasElement,
  fillStyle: "",
  strokeStyle: "",
  globalAlpha: 1,
  font: "",
  textAlign: "",
  textBaseline: "",
  fillRect() {},
  strokeRect() {},
  clearRect() {},
  beginPath() {},
  closePath() {},
  moveTo() {},
  lineTo() {},
  arc() {},
  fill() {},
  stroke() {},
  save() {},
  restore() {},
  translate() {},
  rotate() {},
  scale() {},
  createLinearGradient() {
    return { addColorStop() {} };
  },
  createRadialGradient() {
    return { addColorStop() {} };
  },
  drawImage() {},
  putImageData() {},
  getImageData() {
    return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
  },
  measureText() {
    return { width: 0 };
  },
  fillText() {},
  setTransform() {},
  rect() {},
  clip() {},
  arcTo() {},
  quadraticCurveTo() {},
  bezierCurveTo() {},
  setLineDash() {},
  getLineDash() {
    return [];
  },
  createPattern() {
    return null;
  },
  ellipse() {},
};

if (typeof HTMLCanvasElement !== "undefined") {
  // @ts-expect-error override for headless test environment
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return ctx2d;
  };
  HTMLCanvasElement.prototype.toDataURL = function toDataURL() {
    return "data:image/png;base64,";
  };
}

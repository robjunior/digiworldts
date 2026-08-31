import { useEffect, type RefObject } from 'react';

/**
 * Mirrors the observed element's content-box `width`/`height` into a CSS custom
 * property on both the element and the nearest `.c3d-stage` ancestor, so CSS
 * can size overlays against the command panel's live height.
 */
export function useResizeObserverCSSVar(
  elemRef: RefObject<HTMLElement | null>,
  cssVarName: string,
  propertyName: 'width' | 'height',
): void {
  useEffect(() => {
    const node = elemRef.current;
    if (node === null) return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const value = propertyName === 'width' ? entry.contentRect.width : entry.contentRect.height;
      const px = `${Math.round(value)}px`;
      node.style.setProperty(cssVarName, px);

      const stage = node.closest('.c3d-stage') as HTMLElement | null;
      if (stage !== null) stage.style.setProperty(cssVarName, px);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [elemRef, cssVarName, propertyName]);
}

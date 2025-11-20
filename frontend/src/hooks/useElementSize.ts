import { useLayoutEffect, useRef, useState } from 'react';

interface ElementSize {
  width: number;
  height: number;
}

/**
 * Measure an element's rendered size using ResizeObserver.
 * Returns a ref to attach to the element and the latest width/height.
 */
export function useElementSize<T extends HTMLElement = HTMLDivElement>() {
  const elementRef = useRef<T | null>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const node = elementRef.current;
    if (!node) {
      return;
    }

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setSize({
        width: rect.width,
        height: rect.height,
      });
    };

    updateSize();

    const observer = new ResizeObserver(() => {
      updateSize();
    });

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  return { ref: elementRef, size };
}

import { useEffect, useState } from "react";

export type ImageDimensions = {
  width: number;
  height: number;
};

export function useImageDimensions(source?: string) {
  const [dimensions, setDimensions] = useState<ImageDimensions>();

  useEffect(() => {
    setDimensions(undefined);
    if (!source) return;
    let cancelled = false;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (!cancelled && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setDimensions({ width: image.naturalWidth, height: image.naturalHeight });
      }
    };
    image.onerror = () => {
      if (!cancelled) setDimensions(undefined);
    };
    image.src = source;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [source]);

  return dimensions;
}

export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CropHandle = "center" | "topLeft" | "top" | "topRight" | "right" | "bottomRight" | "bottom" | "bottomLeft" | "left";

export function createCenteredCrop(imageWidth: number, imageHeight: number, ratio: number | null): CropRect {
  if (ratio == null) return { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
  const normalizedRatio = ratio / (imageWidth / imageHeight);
  const width = normalizedRatio >= 1 ? 0.8 : 0.8 * normalizedRatio;
  const height = normalizedRatio >= 1 ? 0.8 / normalizedRatio : 0.8;
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}

export function resizeCrop(
  start: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  ratio: number | null,
  imageAspect: number,
  bounds: { width: number; height: number },
): CropRect {
  if (handle === "center") {
    return {
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.width),
      y: clamp(start.y + dy, 0, 1 - start.height),
    };
  }

  const minWidth = Math.min(0.25, 48 / bounds.width);
  const minHeight = Math.min(0.25, 48 / bounds.height);
  if (ratio != null && isCorner(handle)) {
    const normalizedRatio = ratio / imageAspect;
    const left = handle === "topLeft" || handle === "bottomLeft";
    const top = handle === "topLeft" || handle === "topRight";
    const anchorX = left ? start.x + start.width : start.x;
    const anchorY = top ? start.y + start.height : start.y;
    const proposedWidth = start.width + (left ? -dx : dx);
    const proposedHeight = start.height + (top ? -dy : dy);
    const maxWidth = left ? anchorX : 1 - anchorX;
    const maxHeight = top ? anchorY : 1 - anchorY;
    const minimum = Math.max(minWidth, minHeight * normalizedRatio);
    const maximum = Math.max(minimum, Math.min(maxWidth, maxHeight * normalizedRatio));
    const horizontalMovement = Math.abs(dx * bounds.width);
    const verticalMovement = Math.abs(dy * bounds.height);
    const width = clamp(horizontalMovement >= verticalMovement ? proposedWidth : proposedHeight * normalizedRatio, minimum, maximum);
    const height = width / normalizedRatio;
    return {
      x: left ? anchorX - width : anchorX,
      y: top ? anchorY - height : anchorY,
      width,
      height,
    };
  }

  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes("Left") || handle === "left") left = clamp(left + dx, 0, right - minWidth);
  if (handle.includes("Right") || handle === "right") right = clamp(right + dx, left + minWidth, 1);
  if (handle.includes("top") || handle === "top") top = clamp(top + dy, 0, bottom - minHeight);
  if (handle.includes("bottom") || handle === "bottom") bottom = clamp(bottom + dy, top + minHeight, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export async function cropImage(source: string, crop: CropRect) {
  const image = await loadImage(source);
  const sourceX = Math.round(crop.x * image.naturalWidth);
  const sourceY = Math.round(crop.y * image.naturalHeight);
  const sourceWidth = Math.max(1, Math.min(image.naturalWidth - sourceX, Math.round(crop.width * image.naturalWidth)));
  const sourceHeight = Math.max(1, Math.min(image.naturalHeight - sourceY, Math.round(crop.height * image.naturalHeight)));
  const canvas = document.createElement("canvas");
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  const sourceMime = /^data:(image\/[^;,]+)/i.exec(source)?.[1]?.toLowerCase();
  const outputMime = sourceMime === "image/png" || sourceMime === "image/webp" ? sourceMime : "image/jpeg";
  return canvas.toDataURL(outputMime, 0.92);
}

function isCorner(handle: CropHandle) {
  return ["topLeft", "topRight", "bottomRight", "bottomLeft"].includes(handle);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to read the cover image"));
    image.src = source;
  });
}

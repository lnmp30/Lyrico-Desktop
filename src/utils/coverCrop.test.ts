import { describe, expect, it } from "vitest";
import { createCenteredCrop, resizeCrop } from "./coverCrop";

describe("cover crop geometry", () => {
  it("creates a centered square in pixel space for a landscape image", () => {
    const crop = createCenteredCrop(1600, 900, 1);
    expect(crop.x).toBeCloseTo(0.275);
    expect(crop.y).toBeCloseTo(0.1);
    expect(crop.width * 1600).toBeCloseTo(crop.height * 900);
  });

  it("moves the crop without leaving image bounds", () => {
    const crop = resizeCrop({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, "center", 0.8, -0.4, null, 1, { width: 500, height: 500 });
    expect(crop).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.5 });
  });

  it("keeps a fixed aspect ratio while resizing a corner", () => {
    const crop = resizeCrop({ x: 0.1, y: 0.1, width: 0.4, height: 0.4 }, "bottomRight", 0.2, 0.1, 16 / 9, 1, { width: 600, height: 600 });
    expect(crop.width / crop.height).toBeCloseTo(16 / 9);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1);
    expect(crop.y + crop.height).toBeLessThanOrEqual(1);
  });

  it("supports independent edge resizing in free mode", () => {
    const crop = resizeCrop({ x: 0.2, y: 0.2, width: 0.6, height: 0.6 }, "left", 0.15, 0, null, 1, { width: 500, height: 500 });
    expect(crop.x).toBeCloseTo(0.35);
    expect(crop.width).toBeCloseTo(0.45);
    expect(crop.height).toBeCloseTo(0.6);
  });
});

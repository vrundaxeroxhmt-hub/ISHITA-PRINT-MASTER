export type EditState = {
  brightness: number; // 0..200 (100 = neutral)
  contrast: number; // 0..200
  saturation: number; // 0..200
  highlights: number; // -100..100
  invert: boolean;
  deskew: number; // -15..15 deg (fine rotation)
  rotate: number; // 0/90/180/270
  flipH: boolean;
  flipV: boolean;
  crop: { top: number; right: number; bottom: number; left: number }; // percent 0..100 (max 45 per side)
  cropFit: boolean;
  cropMarginMm: number;
  perspective: { enabled: boolean; points: import("./perspective").PerspectiveQuad };
};

export const DEFAULT_EDIT: EditState = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  highlights: 0,
  invert: false,
  deskew: 0,
  rotate: 0,
  flipH: false,
  flipV: false,
  crop: { top: 0, right: 0, bottom: 0, left: 0 },
  cropFit: false,
  cropMarginMm: 10,
  perspective: { enabled: false, points: [{ x: 2, y: 2 }, { x: 98, y: 2 }, { x: 98, y: 98 }, { x: 2, y: 98 }] },
};

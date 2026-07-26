export interface IdCardLayoutConfig {
  cardWidthMm: number; // 85.60 mm
  cardHeightMm: number; // 53.98 mm
  targetDpi: number; // 300 DPI
  spacingMm: number; // 5 mm
  borderWidthPx: number; // 1 px
  borderColor: string; // #d1d5db
  copies: number; // 1, 2, 4, etc.
  orientation: 'portrait' | 'landscape';
}

export const DEFAULT_ID_CARD_CONFIG: Readonly<IdCardLayoutConfig> = {
  cardWidthMm: 85.6,
  cardHeightMm: 53.98,
  targetDpi: 300,
  spacingMm: 5,
  borderWidthPx: 1,
  borderColor: '#d1d5db',
  copies: 1,
  orientation: 'portrait',
};

export class IdCardLayoutEngine {
  /**
   * Dedicated ID Card Layout Engine.
   * Generates CR-80 physical size (85.60 mm × 53.98 mm) Front + Back print layouts
   * at full 300 DPI using print masters.
   */
  public static calculateCardPx(dpi: number = 300): { widthPx: number; heightPx: number } {
    const widthPx = Math.round((85.6 / 25.4) * dpi); // 1011 px at 300 DPI
    const heightPx = Math.round((53.98 / 25.4) * dpi); // 638 px at 300 DPI
    return { widthPx, heightPx };
  }

  public static async generateCardLayoutDataUrl(
    frontImageSrc: string,
    backImageSrc?: string,
    config: Partial<IdCardLayoutConfig> = {}
  ): Promise<{ layoutDataUrl: string; pixelWidth: number; pixelHeight: number; effectiveDpi: number }> {
    const cfg = { ...DEFAULT_ID_CARD_CONFIG, ...config };
    const { widthPx, heightPx } = this.calculateCardPx(cfg.targetDpi);
    const spacingPx = Math.round((cfg.spacingMm / 25.4) * cfg.targetDpi);

    // Canvas size for Front + Back side by side or stacked
    const totalWidthPx = backImageSrc ? widthPx * 2 + spacingPx + 40 : widthPx + 40;
    const totalHeightPx = heightPx + 40;

    let layoutDataUrl = frontImageSrc;

    if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof Image !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = totalWidthPx;
      canvas.height = totalHeightPx;
      const ctx = canvas.getContext('2d')!;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, totalWidthPx, totalHeightPx);

      const frontImg = await this.loadImage(frontImageSrc);
      ctx.drawImage(frontImg, 20, 20, widthPx, heightPx);

      // Draw border
      if (cfg.borderWidthPx > 0) {
        ctx.strokeStyle = cfg.borderColor;
        ctx.lineWidth = cfg.borderWidthPx;
        ctx.strokeRect(20, 20, widthPx, heightPx);
      }

      if (backImageSrc) {
        const backImg = await this.loadImage(backImageSrc);
        const backX = 20 + widthPx + spacingPx;
        ctx.drawImage(backImg, backX, 20, widthPx, heightPx);

        if (cfg.borderWidthPx > 0) {
          ctx.strokeRect(backX, 20, widthPx, heightPx);
        }
      }

      layoutDataUrl = canvas.toDataURL('image/jpeg', 0.98);
    }

    return {
      layoutDataUrl,
      pixelWidth: totalWidthPx,
      pixelHeight: totalHeightPx,
      effectiveDpi: cfg.targetDpi,
    };
  }

  private static loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load card image for layout'));
      img.src = src;
    });
  }
}

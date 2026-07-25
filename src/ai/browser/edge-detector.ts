export interface SobelResult {
  magnitudes: Float32Array;
  maxMagnitude: number;
  averageMagnitude: number;
}

export function computeSobelEdges(
  grayscale: Uint8ClampedArray,
  width: number,
  height: number
): SobelResult {
  const magnitudes = new Float32Array(width * height);
  let maxMagnitude = 0;
  let totalMagnitude = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;

      // Sobel Gx
      const gx =
        -grayscale[idx - width - 1] + grayscale[idx - width + 1] +
        -2 * grayscale[idx - 1] + 2 * grayscale[idx + 1] +
        -grayscale[idx + width - 1] + grayscale[idx + width + 1];

      // Sobel Gy
      const gy =
        -grayscale[idx - width - 1] - 2 * grayscale[idx - width] - grayscale[idx - width + 1] +
        grayscale[idx + width - 1] + 2 * grayscale[idx + width] + grayscale[idx + width + 1];

      const mag = Math.hypot(gx, gy);
      magnitudes[idx] = mag;
      totalMagnitude += mag;

      if (mag > maxMagnitude) {
        maxMagnitude = mag;
      }
    }
  }

  const count = width * height;
  const averageMagnitude = count > 0 ? totalMagnitude / count : 0;

  return {
    magnitudes,
    maxMagnitude,
    averageMagnitude,
  };
}

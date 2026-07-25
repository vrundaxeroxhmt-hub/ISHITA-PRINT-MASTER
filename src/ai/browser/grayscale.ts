export function toGrayscale(imageData: ImageData): Uint8ClampedArray {
  const { data, width, height } = imageData;
  const grayscale = new Uint8ClampedArray(width * height);

  for (let i = 0; i < grayscale.length; i++) {
    const rIdx = i * 4;
    const r = data[rIdx];
    const g = data[rIdx + 1];
    const b = data[rIdx + 2];
    // Luminance standard: 0.299 * R + 0.587 * G + 0.114 * B
    grayscale[i] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
  }

  return grayscale;
}

export function gaussianBlur3x3(
  grayscale: Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(width * height);

  // Kernel: [1 2 1; 2 4 2; 1 2 1] / 16
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;

      const sum =
        grayscale[idx - width - 1] + 2 * grayscale[idx - width] + grayscale[idx - width + 1] +
        2 * grayscale[idx - 1] + 4 * grayscale[idx] + 2 * grayscale[idx + 1] +
        grayscale[idx + width - 1] + 2 * grayscale[idx + width] + grayscale[idx + width + 1];

      output[idx] = (sum >> 4); // divide by 16
    }
  }

  // Copy borders
  for (let x = 0; x < width; x++) {
    output[x] = grayscale[x];
    output[(height - 1) * width + x] = grayscale[(height - 1) * width + x];
  }
  for (let y = 0; y < height; y++) {
    output[y * width] = grayscale[y * width];
    output[y * width + (width - 1)] = grayscale[y * width + (width - 1)];
  }

  return output;
}

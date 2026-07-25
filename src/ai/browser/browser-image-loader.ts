import type { AIProviderError, ImageInput, ImageInputSource } from '../types.ts';

export interface LoadedBrowserImage {
  imageData: ImageData;
  analysisWidth: number;
  analysisHeight: number;
  originalWidth: number;
  originalHeight: number;
}

function isImageInputSource(input: unknown): input is ImageInputSource {
  return (
    typeof input === 'object' &&
    input !== null &&
    !('stream' in input) &&
    'type' in input &&
    typeof (input as Record<string, unknown>).type === 'string' &&
    ['data-url', 'blob', 'local-file-path', 'remote-url', 'raw-bytes'].includes(
      (input as Record<string, unknown>).type as string
    )
  );
}

export async function loadBrowserImageData(
  input: ImageInput,
  maxDimension = 512,
  timeoutMs = 5000
): Promise<LoadedBrowserImage | { error: AIProviderError }> {
  // 1. SSR Guard
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Browser DOM and Canvas APIs are unavailable in this environment (SSR context).',
        providerId: 'browser-local-vision',
        mode: 'browser',
      },
    };
  }

  let imageSrc: string | null = null;
  let objectUrlToRevoke: string | null = null;

  // 2. Handle Inputs safely
  if (typeof input === 'string') {
    if (
      input.startsWith('data:') ||
      input.startsWith('blob:') ||
      input.startsWith('http://') ||
      input.startsWith('https://')
    ) {
      imageSrc = input;
    } else {
      return {
        error: {
          code: 'UNSUPPORTED_INPUT',
          message: 'Local file system paths are not directly accessible in browser vision provider.',
          providerId: 'browser-local-vision',
          mode: 'browser',
        },
      };
    }
  } else if (typeof Blob !== 'undefined' && input instanceof Blob) {
    objectUrlToRevoke = URL.createObjectURL(input);
    imageSrc = objectUrlToRevoke;
  } else if (isImageInputSource(input)) {
    if (input.type === 'data-url') {
      imageSrc = input.dataUrl;
    } else if (input.type === 'blob') {
      objectUrlToRevoke = URL.createObjectURL(input.blob);
      imageSrc = objectUrlToRevoke;
    } else if (input.type === 'raw-bytes') {
      const blob = new Blob([input.bytes as unknown as BlobPart], { type: input.mimeType || 'image/png' });
      objectUrlToRevoke = URL.createObjectURL(blob);
      imageSrc = objectUrlToRevoke;
    } else if (input.type === 'local-file-path') {
      return {
        error: {
          code: 'UNSUPPORTED_INPUT',
          message: 'Local file path references cannot be read directly by the browser vision provider.',
          providerId: 'browser-local-vision',
          mode: 'browser',
        },
      };
    } else if (input.type === 'remote-url') {
      return {
        error: {
          code: 'UNSUPPORTED_INPUT',
          message: 'Remote URL object references must be loaded as browser-accessible URLs or Blobs.',
          providerId: 'browser-local-vision',
          mode: 'browser',
        },
      };
    }
  }

  if (!imageSrc) {
    if (objectUrlToRevoke) URL.revokeObjectURL(objectUrlToRevoke);
    return {
      error: {
        code: 'UNSUPPORTED_INPUT',
        message: 'Invalid or empty image source provided.',
        providerId: 'browser-local-vision',
        mode: 'browser',
      },
    };
  }

  try {
    // 3. Load HTMLImageElement with timeout safety
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      let timer: number | null = null;

      const cleanup = () => {
        if (timer !== null) clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
      };

      timer = window.setTimeout(() => {
        cleanup();
        reject(new Error(`Image loading timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      image.onload = () => {
        cleanup();
        resolve(image);
      };

      image.onerror = () => {
        cleanup();
        reject(new Error('Failed to load image or canvas CORS security error'));
      };

      image.src = imageSrc;
    });

    const origWidth = img.naturalWidth || img.width;
    const origHeight = img.naturalHeight || img.height;

    if (!origWidth || !origHeight) {
      return {
        error: {
          code: 'EXECUTION_FAILED',
          message: 'Image has zero width or height dimensions.',
          providerId: 'browser-local-vision',
          mode: 'browser',
        },
      };
    }

    // 4. Downscale for fast analysis while keeping aspect ratio
    let analysisWidth = origWidth;
    let analysisHeight = origHeight;

    if (Math.max(origWidth, origHeight) > maxDimension) {
      const scale = maxDimension / Math.max(origWidth, origHeight);
      analysisWidth = Math.max(1, Math.round(origWidth * scale));
      analysisHeight = Math.max(1, Math.round(origHeight * scale));
    }

    // 5. Draw to offscreen canvas and extract pixel data
    const canvas = document.createElement('canvas');
    canvas.width = analysisWidth;
    canvas.height = analysisHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return {
        error: {
          code: 'EXECUTION_FAILED',
          message: 'Failed to acquire 2D canvas context.',
          providerId: 'browser-local-vision',
          mode: 'browser',
        },
      };
    }

    ctx.drawImage(img, 0, 0, analysisWidth, analysisHeight);

    let imageData: ImageData;
    try {
      imageData = ctx.getImageData(0, 0, analysisWidth, analysisHeight);
    } catch (corsErr) {
      return {
        error: {
          code: 'EXECUTION_FAILED',
          message: corsErr instanceof Error ? corsErr.message : 'Canvas security CORS error when reading image pixels.',
          providerId: 'browser-local-vision',
          mode: 'browser',
        },
      };
    }

    return {
      imageData,
      analysisWidth,
      analysisHeight,
      originalWidth: origWidth,
      originalHeight: origHeight,
    };
  } catch (err) {
    return {
      error: {
        code: 'EXECUTION_FAILED',
        message: err instanceof Error ? err.message : 'Image load failure',
        providerId: 'browser-local-vision',
        mode: 'browser',
      },
    };
  } finally {
    if (objectUrlToRevoke) {
      URL.revokeObjectURL(objectUrlToRevoke);
    }
  }
}

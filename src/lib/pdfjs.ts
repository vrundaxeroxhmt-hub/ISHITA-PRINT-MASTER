import type * as pdfjsLibType from 'pdfjs-dist';

export type PDFDocumentProxy = pdfjsLibType.PDFDocumentProxy;
export type PDFPageProxy = pdfjsLibType.PDFPageProxy;

let pdfjsPromise: Promise<typeof pdfjsLibType> | null = null;

/**
 * Client-only dynamic loader for pdfjs-dist.
 * Prevents SSR crashes ("DOMMatrix is not defined") while preserving
 * browser PDF rendering and PDF worker configuration.
 */
export async function getPdfjsLib(): Promise<typeof pdfjsLibType> {
  if (typeof window === 'undefined') {
    throw new Error('pdfjs-dist is client-only and cannot be executed on the server.');
  }
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl as string;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

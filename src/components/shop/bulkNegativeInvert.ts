import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PrintFile } from "@/lib/mock-data";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc as string;

function invertPixels(context: CanvasRenderingContext2D, width: number, height: number) {
  const pixels = context.getImageData(0, 0, width, height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    pixels.data[index] = 255 - pixels.data[index];
    pixels.data[index + 1] = 255 - pixels.data[index + 1];
    pixels.data[index + 2] = 255 - pixels.data[index + 2];
  }
  context.putImageData(pixels, 0, 0);
}

async function invertImage(source: string) {
  const image = new Image(); image.crossOrigin = "anonymous"; image.src = source; await image.decode();
  const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d"); if (!context) throw new Error("Image processing is unavailable.");
  context.drawImage(image, 0, 0); invertPixels(context, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.98);
}

async function invertPdf(source: string) {
  const bytes = new Uint8Array(await (await fetch(source)).arrayBuffer());
  const input = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const output = await PDFDocument.create();
  for (let pageNumber = 1; pageNumber <= input.numPages; pageNumber++) {
    const page = await input.getPage(pageNumber), base = page.getViewport({ scale: 1 });
    const scale = Math.min(300 / 72, 4000 / Math.max(base.width, base.height)), viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(viewport.width)); canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext("2d"); if (!context) throw new Error("PDF processing is unavailable.");
    await page.render({ canvas, canvasContext: context, viewport }).promise; invertPixels(context, canvas.width, canvas.height);
    const png = await output.embedPng(await (await fetch(canvas.toDataURL("image/png"))).arrayBuffer());
    output.addPage([base.width, base.height]).drawImage(png, { x: 0, y: 0, width: base.width, height: base.height });
  }
  const outputBytes = await output.save(); let binary = "";
  for (let index = 0; index < outputBytes.length; index += 0x8000) binary += String.fromCharCode(...outputBytes.subarray(index, index + 0x8000));
  return `data:application/pdf;base64,${btoa(binary)}`;
}

export async function invertSelectedFiles(contactId: string, files: PrintFile[], onProgress?: (done: number, total: number) => void) {
  let latestJobs: unknown = null;
  for (let index = 0; index < files.length; index++) {
    const file = files[index], source = file.livePreview || file.workingSrc || file.src;
    if (!source) throw new Error(`${file.name} has no source file.`);
    const dataUrl = file.kind === "pdf" ? await invertPdf(source) : await invertImage(source);
    const extension = file.kind === "pdf" ? "pdf" : "jpg", base = (file.originalFile?.name || file.name).replace(/\.[^.]+$/, "");
    const response = await fetch("http://127.0.0.1:3001/api/jobs/processed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contactId, fileName: `${base}_inverted.${extension}`, mimeType: file.kind === "pdf" ? "application/pdf" : "image/jpeg", dataUrl, originalFileId: file.originalFileId || file.id }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || `Could not invert ${file.name}`);
    latestJobs = result.jobs; onProgress?.(index + 1, files.length);
  }
  return latestJobs;
}

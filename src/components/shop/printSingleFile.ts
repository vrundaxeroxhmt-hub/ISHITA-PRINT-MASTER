import { PDFDocument, rgb } from "pdf-lib";
import { getFileSource, type PrintFile } from "@/lib/mock-data";

export type PhotoPrintLayout = "full" | "13x18-2" | "9x13-4";

const mm = (value: number) => value * 72 / 25.4;

/** The shared high-quality A4 pipeline used by Batch/Selected and the header single-file Print. */
export type BatchPrintSource = "latest" | "original";

function getBatchPrintSource(
  file: PrintFile,
  sourceMode: BatchPrintSource,
): string {
  if (sourceMode === "original") {
    return (
      file.originalFile?.originalSrc ||
      file.originalFile?.src ||
      file.originalSrc ||
      ""
    );
  }

  if (file.isEdited) {
    return (
      file.workingSrc ||
      file.processedSrc ||
      file.src ||
      file.activeSrc ||
      file.selectedSrc ||
      file.originalSrc ||
      ""
    );
  }

  return (
    file.workingSrc ||
    file.processedSrc ||
    file.activeSrc ||
    file.selectedSrc ||
    file.src ||
    file.originalSrc ||
    ""
  );
}
export async function createBatchQualityPrintPdf(
  files: PrintFile[],
  sourceMode: BatchPrintSource = "latest",
) {
  const output = await PDFDocument.create();
  for (const file of files) {
    // The live preview is a small UI thumbnail and must never be preferred for print.
    const sourceUrl = getBatchPrintSource(file, sourceMode);
    if (!sourceUrl) continue;
    if (file.kind === "pdf") {
      const source = await PDFDocument.load(await (await fetch(sourceUrl)).arrayBuffer());
      const copied = await output.copyPages(source, source.getPageIndices());
      copied.forEach((page) => output.addPage(page));
      continue;
    }
    const response = await fetch(sourceUrl);
    const bytes = await response.arrayBuffer();
    const mime = response.headers.get("content-type") || (sourceUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg");
    let embedded;
    if (mime.includes("png")) embedded = await output.embedPng(bytes);
    else if (mime.includes("jpeg") || mime.includes("jpg")) embedded = await output.embedJpg(bytes);
    else {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => { const item = new Image(); item.crossOrigin = "anonymous"; item.onload = () => resolve(item); item.onerror = () => reject(new Error(`Could not load ${file.name}`)); item.src = sourceUrl; });
      const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.getContext("2d")?.drawImage(image, 0, 0);
      embedded = await output.embedPng(await (await fetch(canvas.toDataURL("image/png"))).arrayBuffer());
    }
    const page = output.addPage(embedded.width > embedded.height ? [842, 595] : [595, 842]);
    const margin = 18, scale = Math.min((page.getWidth() - margin * 2) / embedded.width, (page.getHeight() - margin * 2) / embedded.height);
    const width = embedded.width * scale, height = embedded.height * scale;
    page.drawImage(embedded, { x: (page.getWidth() - width) / 2, y: (page.getHeight() - height) / 2, width, height });
  }
  if (!output.getPageCount()) throw new Error("No printable file is available.");
  return output.save();
}

async function imageAsJpeg(source: string) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.crossOrigin = "anonymous";
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Image could not be loaded for printing."));
    element.src = source;
  });
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Print canvas is unavailable.");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { bytes: await (await fetch(canvas.toDataURL("image/jpeg", 1))).arrayBuffer(), width: canvas.width, height: canvas.height };
}

export async function createPhotoPrintPdf(file: PrintFile, layout: PhotoPrintLayout, repeat = true) {
  const source = getFileSource(file);
  if (!source) throw new Error("No printable image is available.");
  const passport4x6 = file.layoutType === "passport" && file.passportLayout?.preset === "4x6-8" && layout === "full";
  if (layout === "full" && !passport4x6) return createBatchQualityPrintPdf([file]);
  const photo = await imageAsJpeg(source);
  const pdf = await PDFDocument.create();
  const embedded = await pdf.embedJpg(photo.bytes);
  const isFullLandscape = layout === "full" && photo.width > photo.height;
  const pageWidth = mm(passport4x6 ? 152.4 : isFullLandscape || layout === "13x18-2" ? 297 : 210);
  const pageHeight = mm(passport4x6 ? 101.6 : isFullLandscape || layout === "13x18-2" ? 210 : 297);
  const page = pdf.addPage([pageWidth, pageHeight]);
  page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: rgb(1, 1, 1) });

  let boxes: Array<{ x: number; y: number; width: number; height: number }>;
  if (layout === "13x18-2") {
    const width = mm(130), height = mm(180), gap = mm(5);
    const startX = (pageWidth - width * 2 - gap) / 2;
    boxes = [0, 1].map((column) => ({ x: startX + column * (width + gap), y: (pageHeight - height) / 2, width, height }));
  } else if (layout === "9x13-4") {
    const width = mm(90), height = mm(130), gapX = mm(5), gapY = mm(5);
    const startX = (pageWidth - width * 2 - gapX) / 2;
    const startY = (pageHeight - height * 2 - gapY) / 2;
    boxes = [0, 1, 2, 3].map((index) => ({
      x: startX + (index % 2) * (width + gapX),
      y: startY + (1 - Math.floor(index / 2)) * (height + gapY),
      width,
      height,
    }));
  } else {
    const margin = passport4x6 ? 0 : mm(5);
    boxes = [{ x: margin, y: margin, width: pageWidth - margin * 2, height: pageHeight - margin * 2 }];
  }

  for (const box of repeat ? boxes : boxes.slice(0, 1)) {
    const scale = Math.min(box.width / embedded.width, box.height / embedded.height);
    const width = embedded.width * scale, height = embedded.height * scale;
    page.drawImage(embedded, { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height });
  }
  return pdf.save();
}

export function openPrintWindow() {
  if (window.printDeskDesktop?.printPdf) return null;
  const printWindow = window.open("", "_blank");
  if (!printWindow) throw new Error("Print window was blocked. Allow pop-ups for this site and try again.");
  printWindow.document.title = "Preparing print...";
  printWindow.document.body.innerHTML = '<p style="font:14px system-ui;padding:24px">Preparing print preview...</p>';
  return printWindow;
}

export function printPdfBytes(bytes: Uint8Array, printWindow: Window | null = openPrintWindow()) {
  if (window.printDeskDesktop?.printPdf) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    void window.printDeskDesktop.printPdf(btoa(binary));
    return;
  }
  if (!printWindow) throw new Error("Print window is unavailable.");
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  let printed = false;
  const triggerPrint = () => {
    if (printed || printWindow.closed) return;
    printed = true;
    printWindow.focus();
    printWindow.print();
  };
  printWindow.addEventListener("load", () => window.setTimeout(triggerPrint, 900), { once: true });
  printWindow.location.replace(url);
  // Chromium's built-in PDF viewer may not forward its load event to the page.
  window.setTimeout(triggerPrint, 1800);
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

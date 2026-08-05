import { useCallback, useEffect, useRef, useState } from "react";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { getPdfjsLib, type PDFDocumentProxy } from "@/lib/pdfjs";
import {
  Trash2,
  RotateCw,
  RotateCcw,
  Plus,
  Download,
  Printer,
  GripVertical,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  MessageSquare,
  FolderOpen,
  X,
} from "lucide-react";
import type { PrintFile } from "@/lib/mock-data";
import { gatewayUrl } from "@/lib/gateway-url";
import { PerspectiveCropDialog } from "./PerspectiveCropDialog";

import { DEFAULT_PDF_ENHANCE, PdfPageEnhanceDialog, type PdfEnhanceSettings } from "./PdfPageEnhanceDialog";
import { openPrintWindow, printPdfBytes } from "../printSingleFile";

type PageState = {
  id: string;
  /** Index into srcDocs array */
  srcDocIdx: number;
  /** Page index in that source doc */
  srcPageIdx: number;
  rotate: 0 | 90 | 180 | 270;
  thumb?: string;
  perspectiveOriginal?: {
    srcDocIdx: number;
    srcPageIdx: number;
    rotate: 0 | 90 | 180 | 270;
  };
  enhance?: PdfEnhanceSettings;
};

async function makeDemoPdf(name: string, pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595, 842]);
    p.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(0.98, 0.97, 0.95) });
    p.drawRectangle({ x: 30, y: 30, width: 535, height: 782, borderColor: rgb(0.6, 0.3, 0.2), borderWidth: 2 });
    p.drawText(name, { x: 60, y: 760, size: 22, font, color: rgb(0.15, 0.15, 0.2) });
    p.drawText(`Page ${i + 1} of ${pages}`, { x: 60, y: 720, size: 14, font, color: rgb(0.4, 0.4, 0.5) });
    p.drawText("Demo PDF — PrintDesk", { x: 60, y: 80, size: 11, font, color: rgb(0.5, 0.5, 0.6) });
  }
  return await doc.save();
}

async function renderThumb(pdfDoc: PDFDocumentProxy, pageIdx: number, rotate: number): Promise<string> {
  const page = await pdfDoc.getPage(pageIdx + 1);
  const viewport = page.getViewport({ scale: 0.35, rotation: rotate });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.7);
}

async function renderPageForPerspective(
  pdfDoc: PDFDocumentProxy,
  pageIdx: number,
  rotate: number,
): Promise<string> {
  const page = await pdfDoc.getPage(pageIdx + 1);
  const base = page.getViewport({ scale: 1, rotation: rotate });
  const scale = Math.min(300 / 72, 4000 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale, rotation: rotate });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/png");
}

async function processScanPage(pdfDoc: PDFDocumentProxy, pageIdx: number, rotate: number, settings: PdfEnhanceSettings) {
  const source = await renderPageForPerspective(pdfDoc, pageIdx, rotate);
  const img = new Image(); img.src = source; await img.decode();
  const left = Math.round(img.naturalWidth * settings.crop.left / 100);
  const top = Math.round(img.naturalHeight * settings.crop.top / 100);
  const width = Math.max(1, Math.round(img.naturalWidth * (100 - settings.crop.left - settings.crop.right) / 100));
  const height = Math.max(1, Math.round(img.naturalHeight * (100 - settings.crop.top - settings.crop.bottom) / 100));
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!; ctx.fillStyle = "white"; ctx.fillRect(0, 0, width, height);
  ctx.save(); ctx.translate(width / 2, height / 2); ctx.rotate(settings.deskew * Math.PI / 180);
  ctx.filter = `brightness(${settings.brightness}%) contrast(${settings.contrast + settings.darkness}%)`;
  ctx.drawImage(img, left, top, width, height, -width / 2, -height / 2, width, height); ctx.restore();
  const pixels = ctx.getImageData(0, 0, width, height);
  const white = settings.whiteBackground / 100, cleanup = settings.cleanup / 100;
  for (let i = 0; i < pixels.data.length; i += 4) {
    let r=pixels.data[i],g=pixels.data[i+1],b=pixels.data[i+2];
    if (settings.invert) { r=255-r; g=255-g; b=255-b; }
    const gray=0.299*r+0.587*g+0.114*b;
    if (settings.treatment === "grayscale") r=g=b=gray;
    if (settings.treatment === "bw") r=g=b=gray > 170 - settings.darkness * .5 ? 255 : 0;
    const threshold = 190 - cleanup * 45;
    if (gray > threshold) { const amount=Math.min(1, white + cleanup * (gray-threshold)/(255-threshold)); r+= (255-r)*amount; g+=(255-g)*amount; b+=(255-b)*amount; }
    pixels.data[i]=r; pixels.data[i+1]=g; pixels.data[i+2]=b;
  }
  ctx.putImageData(pixels,0,0);
  return { bytes: new Uint8Array(await (await fetch(canvas.toDataURL("image/png"))).arrayBuffer()), width, height, preview: canvas.toDataURL("image/jpeg", .82) };
}

export function PdfEditor({
  file,
  chatFiles,
  contactId,
  onLivePreview,
  onSaveHandler,
}: {
  file: PrintFile;
  chatFiles: PrintFile[];
  contactId: string;
  onLivePreview?: (dataUrl: string) => void;
  onSaveHandler?: (handler: (() => Promise<void>) | null) => void;
}) {
  const [srcDocs, setSrcDocs] = useState<Uint8Array[]>([]);
  const [srcRenderDocs, setSrcRenderDocs] = useState<PDFDocumentProxy[]>([]);
  const srcDocsRef = useRef<Uint8Array[]>([]);
  const srcRenderDocsRef = useRef<PDFDocumentProxy[]>([]);
  const [pages, setPages] = useState<PageState[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [perspectivePageId, setPerspectivePageId] = useState<string | null>(null);
  const [perspectiveSource, setPerspectiveSource] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showChatPicker, setShowChatPicker] = useState(false);
  const [startDocumentsOnFront, setStartDocumentsOnFront] = useState(false);
  const [enhancePageId, setEnhancePageId] = useState<string | null>(null);
  const [enhanceSource, setEnhanceSource] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);
  const uid = useRef(0);
  const nextId = () => `p_${++uid.current}`;

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setPages([]);
      setSrcDocs([]);
      setSrcRenderDocs([]);
      srcDocsRef.current = [];
      srcRenderDocsRef.current = [];
      setSelected(null);
      const bytes = file.src
        ? new Uint8Array(await (await fetch(file.src)).arrayBuffer())
        : await makeDemoPdf(file.name, file.pages ?? 1);
      // Clone: pdfjs will detach the buffer, keep pdf-lib copy separate
      const forRender = bytes.slice();
      const pdfjsLib = await getPdfjsLib();
      const rdoc = await pdfjsLib.getDocument({ data: forRender }).promise;
      if (cancelled) return;
      const initPages: PageState[] = [];
      for (let i = 0; i < rdoc.numPages; i++) {
        const pdfPage = await rdoc.getPage(i + 1);
        const text = await pdfPage.getTextContent();
        initPages.push({ id: nextId(), srcDocIdx: 0, srcPageIdx: i, rotate:
  file.pdfEditorState?.pageRotations?.[`0:${i}`] ??
  0, enhance: text.items.length >= 5 ? undefined : { ...DEFAULT_PDF_ENHANCE, mode: "scan" } });
      }
      setSrcDocs([bytes]);
      setSrcRenderDocs([rdoc]);
      srcDocsRef.current = [bytes];
      srcRenderDocsRef.current = [rdoc];
      setPages(initPages);
      setLoading(false);
      // Render thumbs
      for (const p of initPages) {
        const t = await renderThumb(rdoc, p.srcPageIdx, p.rotate);
        if (cancelled) return;
        setPages((prev) => prev.map((x) => (x.id === p.id ? { ...x, thumb: t } : x)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file.id, file.name, file.pages]);

  const refreshThumb = useCallback(
    async (id: string) => {
      const p = pages.find((x) => x.id === id);
      if (!p) return;
      const rdoc = srcRenderDocs[p.srcDocIdx];
      if (!rdoc) return;
      const t = await renderThumb(rdoc, p.srcPageIdx, p.rotate);
      setPages((prev) => prev.map((x) => (x.id === id ? { ...x, thumb: t } : x)));
    },
    [pages, srcRenderDocs],
  );

  const rotate = (id: string, delta: number) => {
  const nextPages = pages.map((page) => {
    if (page.id !== id) return page;

    const nextRotation =
      (((page.rotate + delta) % 360) + 360) % 360;

    return {
      ...page,
      rotate: nextRotation as 0 | 90 | 180 | 270,
      thumb: undefined,
    };
  });

  setPages(nextPages);

  const changedPage = nextPages.find((page) => page.id === id);
  if (changedPage) {
    const renderDoc = srcRenderDocsRef.current[changedPage.srcDocIdx];

    if (renderDoc) {
      void renderThumb(
        renderDoc,
        changedPage.srcPageIdx,
        changedPage.rotate,
      ).then((thumb) => {
        setPages((current) =>
          current.map((page) =>
            page.id === id ? { ...page, thumb } : page,
          ),
        );
      });
    }
  }

  const pageRotations = Object.fromEntries(
    nextPages.map((page) => [
      `${page.srcDocIdx}:${page.srcPageIdx}`,
      page.rotate,
    ]),
  );

  void fetch(
    gatewayUrl(
      `/api/jobs/files/${encodeURIComponent(file.id)}/pdf-editor-state`,
    ),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pageRotations }),
    },
  ).catch((error) => {
    console.error("PDF rotation save failed:", error);
  });
};

  const remove = (id: string) => {
    setPages((prev) => prev.filter((p) => p.id !== id));
    if (selected === id) setSelected(null);
  };

  const move = (id: string, dir: -1 | 1) => {
    setPages((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx < 0) return prev;
      const tgt = idx + dir;
      if (tgt < 0 || tgt >= prev.length) return prev;
      const cp = [...prev];
      [cp[idx], cp[tgt]] = [cp[tgt], cp[idx]];
      return cp;
    });
  };

  const onDragStart = (id: string) => {
    dragId.current = id;
  };
  const onDragOver = (e: React.DragEvent, overId: string) => {
    e.preventDefault();
    const from = dragId.current;
    if (!from || from === overId) return;
    setPages((prev) => {
      const fromIdx = prev.findIndex((p) => p.id === from);
      const toIdx = prev.findIndex((p) => p.id === overId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const cp = [...prev];
      const [it] = cp.splice(fromIdx, 1);
      cp.splice(toIdx, 0, it);
      return cp;
    });
  };

  const addFromFile = async (f: File) => {
    setBusy("Adding pages...");
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
        const forRender = buf.slice();
        const rdoc = await (await getPdfjsLib()).getDocument({ data: forRender }).promise;
        const docIdx = srcDocsRef.current.length;
        srcDocsRef.current = [...srcDocsRef.current, buf];
        srcRenderDocsRef.current = [...srcRenderDocsRef.current, rdoc];
        setSrcDocs(srcDocsRef.current);
        setSrcRenderDocs(srcRenderDocsRef.current);
        const newPages: PageState[] = [];
        for (let i = 0; i < rdoc.numPages; i++) {
          const pdfPage = await rdoc.getPage(i + 1);
          const text = await pdfPage.getTextContent();
          newPages.push({ id: nextId(), srcDocIdx: docIdx, srcPageIdx: i, rotate: 0, enhance: text.items.length >= 5 ? undefined : { ...DEFAULT_PDF_ENHANCE, mode: "scan" } });
        }
        setPages((prev) => [...prev, ...newPages]);
        for (const p of newPages) {
          const t = await renderThumb(rdoc, p.srcPageIdx, p.rotate);
          setPages((prev) => prev.map((x) => (x.id === p.id ? { ...x, thumb: t } : x)));
        }
      } else if (f.type.startsWith("image/")) {
        // Wrap image in a fresh PDF page
        const newDoc = await PDFDocument.create();
        const bytes = new Uint8Array(await f.arrayBuffer());
        const img = f.type === "image/png" ? await newDoc.embedPng(bytes) : await newDoc.embedJpg(bytes);
        const page = newDoc.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
        const outBytes = await newDoc.save();
        const forRender = outBytes.slice();
        const rdoc = await (await getPdfjsLib()).getDocument({ data: forRender }).promise;
        const docIdx = srcDocsRef.current.length;
        srcDocsRef.current = [...srcDocsRef.current, outBytes];
        srcRenderDocsRef.current = [...srcRenderDocsRef.current, rdoc];
        setSrcDocs(srcDocsRef.current);
        setSrcRenderDocs(srcRenderDocsRef.current);
        const np: PageState = { id: nextId(), srcDocIdx: docIdx, srcPageIdx: 0, rotate: 0, enhance: { ...DEFAULT_PDF_ENHANCE, mode: "scan" } };
        setPages((prev) => [...prev, np]);
        const t = await renderThumb(rdoc, 0, 0);
        setPages((prev) => prev.map((x) => (x.id === np.id ? { ...x, thumb: t } : x)));
      }
    } finally {
      setBusy(null);
    }
  };

  const addFromChat = async (chatFile: PrintFile) => {
    const source = chatFile.workingSrc || chatFile.src;
    if (!source) return;
    setBusy("Adding from this chat...");
    try {
      const response = await fetch(source);
      if (!response.ok) throw new Error("Unable to read chat file");
      const blob = await response.blob();
      const mime = chatFile.kind === "pdf" ? "application/pdf" : blob.type || "image/jpeg";
      await addFromFile(new File([blob], chatFile.name, { type: mime }));
      setShowChatPicker(false);
    } finally {
      setBusy(null);
    }
  };

  const openPerspective = async (p: PageState) => {
    const rdoc = srcRenderDocs[p.srcDocIdx];
    if (!rdoc) return;
    setBusy("Preparing perspective crop...");
    try {
      setPerspectiveSource(await renderPageForPerspective(rdoc, p.srcPageIdx, p.rotate));
      setPerspectivePageId(p.id);
    } finally {
      setBusy(null);
    }
  };

  const applyPerspective = async (dataUrl: string) => {
    const target = pages.find((p) => p.id === perspectivePageId);
    if (!target) return;
    setBusy("Applying perspective crop...");
    try {
      const imageBytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
      const newDoc = await PDFDocument.create();
      const image = await newDoc.embedPng(imageBytes);
      const page = newDoc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      const outBytes = await newDoc.save();
      const rdoc = await (await getPdfjsLib()).getDocument({ data: outBytes.slice() }).promise;
      const docIdx = srcDocsRef.current.length;
      const original = target.perspectiveOriginal ?? {
        srcDocIdx: target.srcDocIdx,
        srcPageIdx: target.srcPageIdx,
        rotate: target.rotate,
      };
      srcDocsRef.current = [...srcDocsRef.current, outBytes];
      srcRenderDocsRef.current = [...srcRenderDocsRef.current, rdoc];
      setSrcDocs(srcDocsRef.current);
      setSrcRenderDocs(srcRenderDocsRef.current);
      setPages((prev) =>
        prev.map((p) =>
          p.id === target.id
            ? {
                ...p,
                srcDocIdx: docIdx,
                srcPageIdx: 0,
                rotate: 0,
                thumb: dataUrl,
                perspectiveOriginal: original,
              }
            : p,
        ),
      );
      setPerspectivePageId(null);
      setPerspectiveSource(null);
    } finally {
      setBusy(null);
    }
  };

  const restorePerspective = async (p: PageState) => {
    const original = p.perspectiveOriginal;
    if (!original) return;
    const rdoc = srcRenderDocs[original.srcDocIdx];
    if (!rdoc) return;
    setBusy("Restoring original page...");
    try {
      const thumb = await renderThumb(rdoc, original.srcPageIdx, original.rotate);
      setPages((prev) =>
        prev.map((item) =>
          item.id === p.id
            ? {
                ...item,
                ...original,
                thumb,
                perspectiveOriginal: undefined,
              }
            : item,
        ),
      );
    } finally {
      setBusy(null);
    }
  };

  const openEnhance = async (p: PageState) => {
    const rdoc = srcRenderDocs[p.srcDocIdx]; if (!rdoc) return;
    setBusy("Opening page editor...");
    try { setEnhanceSource(await renderPageForPerspective(rdoc,p.srcPageIdx,p.rotate)); setEnhancePageId(p.id); }
    finally { setBusy(null); }
  };

  const applyEnhance = async (settings: PdfEnhanceSettings, all: boolean) => {
    const ids = all ? new Set(pages.map((p) => p.id)) : new Set([enhancePageId]);
    setPages((prev) => prev.map((p) => ids.has(p.id) ? {...p,enhance:settings} : p));
    setEnhancePageId(null); setEnhanceSource(null);
    setBusy("Updating previews...");
    try {
      for (const p of pages.filter((item) => ids.has(item.id))) {
        if (settings.mode === "preserve") { await refreshThumb(p.id); continue; }
        const result = await processScanPage(srcRenderDocs[p.srcDocIdx],p.srcPageIdx,p.rotate,settings);
        setPages((prev) => prev.map((item) => item.id === p.id ? {...item,thumb:result.preview} : item));
      }
    } finally { setBusy(null); }
  };

  const buildOutput = useCallback(async (): Promise<Uint8Array> => {
    const out = await PDFDocument.create();
    // Load pdf-lib docs from srcDocs (clone so buffers stay usable)
    const srcLoaded: PDFDocument[] = [];
    for (const bytes of srcDocs) {
      srcLoaded.push(await PDFDocument.load(bytes.slice()));
    }
    let previousDoc: number | null = null;
    for (const p of pages) {
      const logicalDoc = p.perspectiveOriginal?.srcDocIdx ?? p.srcDocIdx;
      if (
        startDocumentsOnFront &&
        previousDoc !== null &&
        previousDoc !== logicalDoc &&
        out.getPageCount() % 2 === 1
      ) {
        out.addPage([595, 842]);
      }
      if (p.enhance?.mode === "scan") {
        const processed = await processScanPage(srcRenderDocs[p.srcDocIdx],p.srcPageIdx,p.rotate,p.enhance);
        const image = await out.embedPng(processed.bytes);
        const page = out.addPage([processed.width * 72 / 300, processed.height * 72 / 300]);
        page.drawImage(image,{x:0,y:0,width:page.getWidth(),height:page.getHeight()});
      } else {
        const [copied] = await out.copyPages(srcLoaded[p.srcDocIdx], [p.srcPageIdx]);
        if (p.rotate) copied.setRotation(degrees(p.rotate));
        out.addPage(copied);
      }
      previousDoc = logicalDoc;
    }
    return await out.save();
  }, [pages, srcDocs, srcRenderDocs, startDocumentsOnFront]);

  useEffect(() => {
    const first = pages[0]?.thumb;
    if (first && onLivePreview) onLivePreview(first);
  }, [onLivePreview, pages]);

  useEffect(() => {
    if (!onSaveHandler) return;
    onSaveHandler(async () => {
      const bytes = await buildOutput();
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      const dataUrl = `data:application/pdf;base64,${btoa(binary)}`;
      const base = (file.originalFile?.name || file.name).replace(/\.pdf$/i, "");
      const response = await fetch(gatewayUrl("/api/jobs/processed"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId, fileName: `${base}_edited.pdf`, mimeType: "application/pdf", dataUrl, originalFileId: file.originalFileId || file.id }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Save failed");
    });
    return () => onSaveHandler(null);
  }, [buildOutput, contactId, file.name, onSaveHandler]);

  const download = async () => {
    setBusy("Building PDF...");
    try {
      const bytes = await buildOutput();
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name.replace(/\.pdf$/i, "") + "_edited.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } finally {
      setBusy(null);
    }
  };

  const openInDefaultApp = async () => {
    setBusy("Opening in default PDF app...");
    try {
      const response = await fetch(gatewayUrl(`/api/jobs/files/${encodeURIComponent(file.id)}/open-default`), { method: "POST" });
      if (!response.ok) throw new Error((await response.json()).error || "Could not open PDF app.");
    } finally {
      setBusy(null);
    }
  };

  const print = async () => {
    let printWindow: Window | null;
    try { printWindow = openPrintWindow(); }
    catch { return; }
    setBusy("Preparing print...");
    try {
      const bytes = await buildOutput();
      printPdfBytes(bytes, printWindow);
    } catch (error) {
      printWindow?.close();
      throw error;
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border bg-card/40 px-3 py-1.5">
        <div className="relative">
          <button onClick={() => setShowAddMenu((value) => !value)} className="inline-flex items-center gap-1 rounded-md border border-border bg-accent/40 px-2 py-1 text-[11px] hover:bg-accent">
            <Plus className="h-3 w-3" /> Add Pages
          </button>
          {showAddMenu && <div className="absolute left-0 top-full z-30 mt-1 w-44 rounded-md border border-border bg-card p-1 shadow-xl">
            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-[11px] hover:bg-accent"><FolderOpen className="h-3.5 w-3.5" /> From Local Computer
              <input
            type="file"
            accept="application/pdf,image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              (async () => {
                for (const f of files) await addFromFile(f);
                setShowAddMenu(false);
              })();
            }}
              />
            </label>
            <button onClick={() => { setShowChatPicker(true); setShowAddMenu(false); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-[11px] hover:bg-accent"><MessageSquare className="h-3.5 w-3.5" /> From This Chat</button>
          </div>}
        </div>
        <label className="ml-1 inline-flex items-center gap-1.5 text-[10px] text-muted-foreground" title="Insert a blank page when needed so each newly added document starts on a front/odd-numbered page">
          <input type="checkbox" checked={startDocumentsOnFront} onChange={(e) => setStartDocumentsOnFront(e.target.checked)} /> New PDF on front
        </label>
        <button
          onClick={openInDefaultApp}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-accent/40 px-2 py-1 text-[11px] hover:bg-accent"
        >
          <FolderOpen className="h-3 w-3" /> Open in PDF App
        </button>
        <button
          onClick={download}
          disabled={!pages.length}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-accent/40 px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-40"
        >
          <Download className="h-3 w-3" /> Save PDF
        </button>
        <button
          onClick={print}
          disabled={!pages.length}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          <Printer className="h-3 w-3" /> Print
        </button>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {pages.length} pages{busy ? ` · ${busy}` : ""}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_260px]">
        {/* Page grid */}
        <div className="overflow-auto p-4">
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading PDF...
            </div>
          ) : pages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              No pages. Add pages from PDF or images.
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
              {pages.map((p, i) => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={() => onDragStart(p.id)}
                  onDragOver={(e) => onDragOver(e, p.id)}
                  onClick={() => setSelected(p.id)}
                  className={`group relative flex flex-col overflow-hidden rounded-md border bg-card/40 shadow transition-colors ${
                    selected === p.id ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/60"
                  }`}
                >
                  <div className="flex aspect-[3/4] items-center justify-center bg-black/40">
                    {p.thumb ? (
                      <img src={p.thumb} alt={`Page ${i + 1}`} className="max-h-full max-w-full object-contain" />
                    ) : (
                      <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex items-center justify-between border-t border-border/60 px-2 py-1 text-[10px]">
                    <span className="text-muted-foreground">Page {i + 1}</span>
                    <GripVertical className="h-3 w-3 cursor-grab text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Side actions */}
        <aside className="flex flex-col overflow-y-auto border-l border-border bg-card/30 p-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Page Tools
          </h3>
          {!selected ? (
            <p className="text-[11px] text-muted-foreground">Select a page to see actions.</p>
          ) : (
            (() => {
              const p = pages.find((x) => x.id === selected);
              const idx = pages.findIndex((x) => x.id === selected);
              if (!p) return null;
              return (
                <div className="space-y-2">
                  <div className="text-[11px] font-medium">Page {idx + 1}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => rotate(p.id, -90)}
                      className="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-accent/40 py-1.5 text-[11px] hover:bg-accent"
                    >
                      <RotateCcw className="h-3 w-3" /> -90°
                    </button>
                    <button
                      onClick={() => rotate(p.id, 90)}
                      className="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-accent/40 py-1.5 text-[11px] hover:bg-accent"
                    >
                      <RotateCw className="h-3 w-3" /> +90°
                    </button>
                    <button
                      onClick={() => move(p.id, -1)}
                      className="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-accent/40 py-1.5 text-[11px] hover:bg-accent"
                    >
                      <ArrowUp className="h-3 w-3" /> Up
                    </button>
                    <button
                      onClick={() => move(p.id, 1)}
                      className="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-accent/40 py-1.5 text-[11px] hover:bg-accent"
                    >
                      <ArrowDown className="h-3 w-3" /> Down
                    </button>
                  </div>
                  <button
                    onClick={() => openPerspective(p)}
                    className="inline-flex w-full items-center justify-center rounded-md border border-primary/50 bg-primary/10 py-1.5 text-[11px] text-primary hover:bg-primary/20"
                  >
                    Perspective Crop
                  </button>
                  <button onClick={() => openEnhance(p)} className="inline-flex w-full items-center justify-center rounded-md border border-primary/50 bg-primary/10 py-1.5 text-[11px] text-primary hover:bg-primary/20">Open Crop / Deskew / Enhance</button>
                  {p.enhance && <button onClick={async () => { const thumb = await renderThumb(srcRenderDocs[p.srcDocIdx],p.srcPageIdx,p.rotate); setPages((prev) => prev.map((item) => item.id === p.id ? {...item,enhance:undefined,thumb} : item)); }} className="w-full rounded border border-border py-1.5 text-[10px]">Reset Page Enhancement</button>}
                  {p.perspectiveOriginal && (
                    <button
                      onClick={() => restorePerspective(p)}
                      className="inline-flex w-full items-center justify-center rounded-md border border-border bg-accent/40 py-1.5 text-[11px] hover:bg-accent"
                    >
                      Restore Before Perspective
                    </button>
                  )}
                  <button
                    onClick={() => remove(p.id)}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 py-1.5 text-[11px] text-destructive hover:bg-destructive/20"
                  >
                    <Trash2 className="h-3 w-3" /> Delete Page
                  </button>
                  <div className="rounded-md border border-border bg-accent/20 p-2 text-[10px] text-muted-foreground">
                    Mode: {p.enhance?.mode === "scan" ? "Scan Enhancement · 300 DPI" : "Preserve Original Quality"}<br />Rotation: {p.rotate}° · Source doc #{p.srcDocIdx + 1}, page {p.srcPageIdx + 1}
                  </div>
                </div>
              );
            })()
          )}

          <div className="mt-4 rounded-md border border-border bg-accent/10 p-2 text-[10px] text-muted-foreground">
            <p className="mb-1 font-semibold text-foreground">Tips</p>
            <ul className="list-disc space-y-0.5 pl-3">
              <li>Drag any page to reorder.</li>
              <li>Add pages from another PDF or image.</li>
              <li>Save PDF downloads a merged file.</li>
            </ul>
          </div>
        </aside>
      </div>
      {perspectivePageId && perspectiveSource && (
        <PerspectiveCropDialog
          source={perspectiveSource}
          onClose={() => {
            setPerspectivePageId(null);
            setPerspectiveSource(null);
          }}
          onApply={(dataUrl) => void applyPerspective(dataUrl)}
        />
      )}
      {enhancePageId && enhanceSource && <PdfPageEnhanceDialog source={enhanceSource} initial={pages.find((p) => p.id === enhancePageId)?.enhance} onClose={() => {setEnhancePageId(null);setEnhanceSource(null);}} onApply={(settings,all) => void applyEnhance(settings,all)} />}
      {showChatPicker && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="flex max-h-[80%] w-full max-w-3xl flex-col rounded-lg border border-border bg-card shadow-2xl">
            <div className="flex items-center border-b border-border px-4 py-3"><div><h3 className="text-sm font-semibold">Add Pages From This Chat</h3><p className="text-[10px] text-muted-foreground">Select a PDF or image received from this customer.</p></div><button onClick={() => setShowChatPicker(false)} className="ml-auto rounded p-1 hover:bg-accent"><X className="h-4 w-4" /></button></div>
            <div className="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3 overflow-auto p-4">
              {chatFiles.filter((item) => item.id !== file.id && (item.src || item.workingSrc)).map((item) => <button key={item.id} onClick={() => void addFromChat(item)} className="overflow-hidden rounded-md border border-border bg-background text-left hover:border-primary"><div className="flex aspect-[4/3] items-center justify-center bg-black/30">{item.kind === "image" ? <img src={item.workingSrc || item.src} className="h-full w-full object-contain" alt="" /> : <div className="text-xs font-semibold text-red-400">PDF · {item.pages || 1} page</div>}</div><div className="truncate p-2 text-[10px]">{item.name}</div></button>)}
              {!chatFiles.some((item) => item.id !== file.id && (item.src || item.workingSrc)) && <p className="col-span-full py-8 text-center text-xs text-muted-foreground">No other files found in this customer chat.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

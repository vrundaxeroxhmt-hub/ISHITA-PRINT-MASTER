import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlipHorizontal2,
  FlipVertical2,
  RotateCcw,
  RotateCw,
  Undo2,
  Redo2,
  RefreshCw,
  Crop as CropIcon,
  Sun,
  Contrast,
  Droplet,
  Sparkles,
  Wand2,
  RectangleHorizontal,
  RectangleVertical,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { gatewayUrl } from "@/lib/gateway-url";
import { getFileSource, type PrintFile } from "@/lib/mock-data";
import { DEFAULT_EDIT, type EditState } from "./types";
import { Slider } from "./Slider";
import { PerspectiveCropDialog } from "./PerspectiveCropDialog";
import { warpPerspective } from "./perspective";

function clampCrop(v: number) {
  return Math.max(0, Math.min(45, v));
}

/** Build CSS filter string. Highlights approximated via brightness*contrast trim. */
function buildFilter(e: EditState) {
  // Highlights: positive lifts highlights (extra brightness), negative compresses via contrast
  const hi = e.highlights;
  const brightAdj = hi > 0 ? 1 + hi * 0.004 : 1;
  const contrastAdj = hi < 0 ? 1 + Math.abs(hi) * 0.003 : 1;
  return [
    `brightness(${(e.brightness / 100) * brightAdj})`,
    `contrast(${(e.contrast / 100) * contrastAdj})`,
    `saturate(${e.saturation / 100})`,
    e.invert ? "invert(1)" : "",
  ].join(" ");
}

function buildTransform(e: EditState) {
  const scaleX = e.flipH ? -1 : 1;
  const scaleY = e.flipV ? -1 : 1;
  return `rotate(${e.rotate + e.deskew}deg) scale(${scaleX}, ${scaleY})`;
}

type DragState =
  | { kind: "none" }
  | { kind: "new"; startX: number; startY: number; curX: number; curY: number };

export function ImageEditor({
  file,
  contactId,
  onLivePreview,
  onSaveHandler,
  onSelectSource,
}: {
  file: PrintFile;
  contactId: string;
  onLivePreview?: (dataUrl: string, appliedCrop?: boolean) => void;
  onSaveHandler?: (handler: (() => Promise<void>) | null) => void;
  onSelectSource?: (fileId: string, source: "original" | "processed") => Promise<void>;
}) {
  // Per-file edit state + history
  const [edit, setEdit] = useState<EditState>(DEFAULT_EDIT);
  const [history, setHistory] = useState<EditState[]>([DEFAULT_EDIT]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const [activeTab, setActiveTab] = useState<"adjust" | "crop" | "transform">("crop");
  const [cropMode, setCropMode] = useState(false);
  const [drag, setDrag] = useState<DragState>({ kind: "none" });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [perspectiveOpen, setPerspectiveOpen] = useState(false);
  const [perspectiveSrc, setPerspectiveSrc] = useState<string | null>(null);
  const [appliedSource, setAppliedSource] = useState<string | null>(null);
  const [guidedMode, setGuidedMode] = useState(true);
  const [reviewStep, setReviewStep] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const commitTimer = useRef<number | null>(null);
  const skipCommit = useRef(false);
  const skipPersist = useRef(false);

  // Reset state when file changes
  useEffect(() => {
    const restored = file.workingEdit || DEFAULT_EDIT;
    skipCommit.current = true;
    setEdit(restored);
    setHistory([restored]);
    setHistoryIdx(0);
    setCropMode(false);
    setDrag({ kind: "none" });
    setNaturalSize({ width: 0, height: 0 });
    setPerspectiveSrc(null);
    setAppliedSource(file.appliedCropSrc || null);
    setReviewStep(false);
    setActiveTab(guidedMode ? "transform" : "adjust");
  }, [file.id, file.src, file.selectedSrc]);

  const selectedBaseSource =
  file.selectedSrc ||
  file.originalFile?.src ||
  file.src ||
  file.originalSrc ||
  "";

const baseSource = appliedSource || selectedBaseSource;

  const selectSource = async (source: "original" | "processed") => {
    try {
      if (onSelectSource) {
        await onSelectSource(file.id, source);
      } else {
        await fetch(gatewayUrl(`/api/jobs/files/${file.id}/select-source`), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source }),
        });
      }
      skipCommit.current = true;
      skipPersist.current = true;
      setAppliedSource(null);
      setPerspectiveSrc(null);
      setEdit(DEFAULT_EDIT);
      setHistory([DEFAULT_EDIT]);
      setHistoryIdx(0);
    } catch (err) {
      console.error("Failed to select source:", err);
    }
  };
  useEffect(() => {
    let cancelled = false;
    if (!edit.perspective?.enabled || !baseSource) { setPerspectiveSrc(null); return; }
    warpPerspective(baseSource, edit.perspective.points).then((value) => { if (!cancelled) setPerspectiveSrc(value); }).catch(() => {});
    return () => { cancelled = true; };
  }, [baseSource, edit.perspective?.enabled, edit.perspective?.points]);

  // Push to history (debounced) whenever edit changes
  useEffect(() => {
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      setHistory((h) => {
        const trimmed = h.slice(0, historyIdx + 1);
        // Skip if identical to last
        const last = trimmed[trimmed.length - 1];
        if (JSON.stringify(last) === JSON.stringify(edit)) return trimmed;
        const next = [...trimmed, edit];
        setHistoryIdx(next.length - 1);
        return next;
      });
    }, 220);
    return () => {
      if (commitTimer.current) window.clearTimeout(commitTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit]);

  const update = useCallback((patch: Partial<EditState>) => {
    setEdit((e) => ({ ...e, ...patch }));
  }, []);

  const updateCrop = useCallback((patch: Partial<EditState["crop"]>) => {
    setEdit((e) => ({
      ...e,
      crop: {
        top: clampCrop(patch.top ?? e.crop.top),
        right: clampCrop(patch.right ?? e.crop.right),
        bottom: clampCrop(patch.bottom ?? e.crop.bottom),
        left: clampCrop(patch.left ?? e.crop.left),
      },
    }));
  }, []);

  const undo = () => {
    if (historyIdx > 0) {
      const idx = historyIdx - 1;
      skipCommit.current = true;
      setEdit(history[idx]);
      setHistoryIdx(idx);
    }
  };
  const redo = () => {
    if (historyIdx < history.length - 1) {
      const idx = historyIdx + 1;
      skipCommit.current = true;
      setEdit(history[idx]);
      setHistoryIdx(idx);
    }
  };
  const resetAll = () => {
    skipCommit.current = true;
    skipPersist.current = true;
    setAppliedSource(null);
    setPerspectiveSrc(null);
    setEdit(DEFAULT_EDIT);
    setHistory([DEFAULT_EDIT]);
    setHistoryIdx(0);
    if (file.id) {
      void fetch(gatewayUrl(`/api/jobs/files/${encodeURIComponent(file.id)}/reset`), { method: "POST" });
    }
  };

  const applyCrop = () => {
    const image = imgRef.current;
    if (!image?.naturalWidth || !image.naturalHeight) return;
    const angle = (edit.rotate + edit.deskew) * Math.PI / 180;
    // Crop controls are measured against the fixed visible image box, not the
    // larger diagonal bounding box produced by a fine rotation.
    const sideways = edit.rotate % 180 !== 0;
    const rotatedWidth = sideways ? image.naturalHeight : image.naturalWidth;
    const rotatedHeight = sideways ? image.naturalWidth : image.naturalHeight;
    const transformed = document.createElement("canvas");
    transformed.width = rotatedWidth;
    transformed.height = rotatedHeight;
    const transformedCtx = transformed.getContext("2d");
    if (!transformedCtx) return;
    transformedCtx.translate(rotatedWidth / 2, rotatedHeight / 2);
    transformedCtx.rotate(angle);
    transformedCtx.scale(edit.flipH ? -1 : 1, edit.flipV ? -1 : 1);
    transformedCtx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);

    const sx = Math.round(rotatedWidth * edit.crop.left / 100);
    const sy = Math.round(rotatedHeight * edit.crop.top / 100);
    const sw = Math.max(1, Math.round(rotatedWidth * (100 - edit.crop.left - edit.crop.right) / 100));
    const sh = Math.max(1, Math.round(rotatedHeight * (100 - edit.crop.top - edit.crop.bottom) / 100));
    const cropped = document.createElement("canvas");
    cropped.width = sw;
    cropped.height = sh;
    cropped.getContext("2d")?.drawImage(transformed, sx, sy, sw, sh, 0, 0, sw, sh);
    const dataUrl = cropped.toDataURL("image/jpeg", 0.96);
    setAppliedSource(dataUrl);
    setPerspectiveSrc(null);
    const next = { ...edit, rotate: 0, deskew: 0, flipH: false, flipV: false, crop: { top: 0, right: 0, bottom: 0, left: 0 }, perspective: { ...edit.perspective, enabled: false } };
    skipCommit.current = true;
    setEdit(next);
    setHistory([next]);
    setHistoryIdx(0);
    setCropMode(false);
    onLivePreview?.(dataUrl, true);
    if (contactId) {
      void fetch(gatewayUrl("/api/jobs/working-preview"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId, fileId: file.id, dataUrl, appliedCropDataUrl: dataUrl, edit: next }),
      });
    }
  };

  // Mouse-drag crop on the stage
  const stageRect = () => stageRef.current?.getBoundingClientRect();
  const onMouseDown = (e: React.MouseEvent) => {
    if (!cropMode) return;
    const r = stageRect();
    if (!r) return;
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    setDrag({ kind: "new", startX: x, startY: y, curX: x, curY: y });
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (drag.kind !== "new") return;
    const r = stageRect();
    if (!r) return;
    const x = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100));
    setDrag({ ...drag, curX: x, curY: y });
  };
  const onMouseUp = () => {
    if (drag.kind !== "new") return;
    const left = clampCrop(Math.min(drag.startX, drag.curX));
    const right = clampCrop(100 - Math.max(drag.startX, drag.curX));
    const top = clampCrop(Math.min(drag.startY, drag.curY));
    const bottom = clampCrop(100 - Math.max(drag.startY, drag.curY));
    // Only apply if drag has meaningful size
    if (Math.abs(drag.curX - drag.startX) > 2 && Math.abs(drag.curY - drag.startY) > 2) {
      updateCrop({ top, right, bottom, left });
    }
    setDrag({ kind: "none" });
  };

  const filter = useMemo(() => buildFilter(edit), [edit]);
  const transform = useMemo(() => buildTransform(edit), [edit]);
  const quarterTurn = edit.rotate % 180 !== 0;
  const normalizedRotation = ((edit.rotate % 360) + 360) % 360;
  // Crop controls describe the sides visible on screen. Map them back to the
  // unrotated source before canvas/CSS clipping so each slider stays independent.
  const sourceCrop = useMemo(() => normalizedRotation === 90
    ? { top: edit.crop.right, right: edit.crop.bottom, bottom: edit.crop.left, left: edit.crop.top }
    : normalizedRotation === 180
      ? { top: edit.crop.bottom, right: edit.crop.left, bottom: edit.crop.top, left: edit.crop.right }
      : normalizedRotation === 270
        ? { top: edit.crop.left, right: edit.crop.top, bottom: edit.crop.right, left: edit.crop.bottom }
        : edit.crop, [edit.crop, normalizedRotation]);
  const effectiveWidth = quarterTurn ? naturalSize.height : naturalSize.width;
  const effectiveHeight = quarterTurn ? naturalSize.width : naturalSize.height;
  const isLandscape = effectiveWidth > effectiveHeight;
  const isPassportSheet = file.layoutType === "passport";
  const isPassport4x6 = isPassportSheet && file.passportLayout?.preset === "4x6-8";
  const orientation = isLandscape ? "Landscape" : "Portrait";
  const pageRatio = isPassport4x6 ? "3 / 2" : isLandscape ? "297 / 210" : "210 / 297";
  const pageAspect = isPassport4x6 ? 3 / 2 : isLandscape ? 297 / 210 : 210 / 297;
  const sourceAspect = naturalSize.width && naturalSize.height ? naturalSize.width / naturalSize.height : pageAspect;
  const displayAspect = quarterTurn ? 1 / sourceAspect : sourceAspect;
  const imageBounds = displayAspect > pageAspect
    ? { left: "0%", top: `${(1 - pageAspect / displayAspect) * 50}%`, width: "100%", height: `${(pageAspect / displayAspect) * 100}%` }
    : { left: `${(1 - displayAspect / pageAspect) * 50}%`, top: "0%", width: `${(displayAspect / pageAspect) * 100}%`, height: "100%" };
  const cropWidthRatio = (100 - edit.crop.left - edit.crop.right) / 100;
  const cropHeightRatio = (100 - edit.crop.top - edit.crop.bottom) / 100;
  const croppedAspect = displayAspect * cropWidthRatio / cropHeightRatio;
  const marginX = edit.cropMarginMm / (isLandscape ? 297 : 210) * 100;
  const marginY = edit.cropMarginMm / (isLandscape ? 210 : 297) * 100;
  const availableW = 100 - marginX * 2, availableH = 100 - marginY * 2;
  const availableAspect = pageAspect * availableW / availableH;
  const fitCropBounds = croppedAspect > availableAspect
    ? { left: `${marginX}%`, top: `${marginY + (availableH - availableW * pageAspect / croppedAspect) / 2}%`, width: `${availableW}%`, height: `${availableW * pageAspect / croppedAspect}%` }
    : { left: `${marginX + (availableW - availableH * croppedAspect / pageAspect) / 2}%`, top: `${marginY}%`, width: `${availableH * croppedAspect / pageAspect}%`, height: `${availableH}%` };

  const renderA4 = useCallback((longEdge: number, quality = 0.9) => {
    const image = imgRef.current;
    if (!image?.naturalWidth || !image.naturalHeight) return null;
    const pageWidth = isPassport4x6 ? longEdge : isLandscape ? longEdge : Math.round(longEdge * 210 / 297);
    const pageHeight = isPassport4x6 ? Math.round(longEdge * 2 / 3) : isLandscape ? Math.round(longEdge * 210 / 297) : longEdge;
    const canvas = document.createElement("canvas");
    canvas.width = pageWidth;
    canvas.height = pageHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, pageWidth, pageHeight);
    ctx.filter = filter;
    const sx = image.naturalWidth * sourceCrop.left / 100;
    const sy = image.naturalHeight * sourceCrop.top / 100;
    const sw = image.naturalWidth * (100 - sourceCrop.left - sourceCrop.right) / 100;
    const sh = image.naturalHeight * (100 - sourceCrop.top - sourceCrop.bottom) / 100;
    const rotated = edit.rotate % 180 !== 0;
    const visualWidth = rotated ? image.naturalHeight : image.naturalWidth;
    const visualHeight = rotated ? image.naturalWidth : image.naturalHeight;
    const marginPx = isPassportSheet ? 0 : edit.cropFit ? pageWidth * edit.cropMarginMm / (isLandscape ? 297 : 210) : pageWidth * 0.035;
    const printableWidth = pageWidth - marginPx * 2;
    const printableHeight = isPassportSheet ? pageHeight : pageHeight - (edit.cropFit ? pageHeight * edit.cropMarginMm / (isLandscape ? 210 : 297) * 2 : pageHeight * 0.07);
    const croppedVisualWidth = rotated ? sh : sw;
    const croppedVisualHeight = rotated ? sw : sh;
    const scale = Math.min(printableWidth / (edit.cropFit ? croppedVisualWidth : visualWidth), printableHeight / (edit.cropFit ? croppedVisualHeight : visualHeight));
    ctx.save();
    ctx.translate(pageWidth / 2, pageHeight / 2);
    // Keep-position crop is defined in screen/rotated coordinates. Clip before
    // rotating the canvas so its Top/Right/Bottom/Left edges stay horizontal.
    if (!edit.cropFit) {
      const renderedWidth = visualWidth * scale;
      const renderedHeight = visualHeight * scale;
      ctx.beginPath();
      ctx.rect(
        -renderedWidth / 2 + renderedWidth * edit.crop.left / 100,
        -renderedHeight / 2 + renderedHeight * edit.crop.top / 100,
        renderedWidth * cropWidthRatio,
        renderedHeight * cropHeightRatio,
      );
      ctx.clip();
    }
    ctx.rotate((edit.rotate + edit.deskew) * Math.PI / 180);
    ctx.scale(edit.flipH ? -scale : scale, edit.flipV ? -scale : scale);
    if (edit.cropFit) {
      ctx.drawImage(image, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
    } else ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2, image.naturalWidth, image.naturalHeight);
    ctx.restore();
    return canvas.toDataURL("image/jpeg", quality);
  }, [cropHeightRatio, cropWidthRatio, edit, filter, isLandscape, isPassport4x6, isPassportSheet, sourceCrop]);

  /** Latest canonical tight image. Rotation/crop/filter are baked once at source quality. */
  const renderMaster = useCallback((targetLongEdge: number, preventDownscale: boolean, quality = 1) => {
    const image = imgRef.current;
    if (!image?.naturalWidth || !image.naturalHeight) return null;
    const sideways = edit.rotate % 180 !== 0;
    const rotatedWidth = sideways ? image.naturalHeight : image.naturalWidth;
    const rotatedHeight = sideways ? image.naturalWidth : image.naturalHeight;
    const transformed = document.createElement("canvas");
    transformed.width = rotatedWidth;
    transformed.height = rotatedHeight;
    const transformedCtx = transformed.getContext("2d");
    if (!transformedCtx) return null;
    transformedCtx.filter = filter;
    transformedCtx.translate(rotatedWidth / 2, rotatedHeight / 2);
    transformedCtx.rotate((edit.rotate + edit.deskew) * Math.PI / 180);
    transformedCtx.scale(edit.flipH ? -1 : 1, edit.flipV ? -1 : 1);
    transformedCtx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    const sx = Math.round(rotatedWidth * edit.crop.left / 100);
    const sy = Math.round(rotatedHeight * edit.crop.top / 100);
    const sw = Math.max(1, Math.round(rotatedWidth * cropWidthRatio));
    const sh = Math.max(1, Math.round(rotatedHeight * cropHeightRatio));
    const requestedScale = targetLongEdge / Math.max(sw, sh);
    const outputScale = preventDownscale ? Math.max(1, requestedScale) : requestedScale;
    const output = document.createElement("canvas");
    output.width = Math.max(1, Math.round(sw * outputScale));
    output.height = Math.max(1, Math.round(sh * outputScale));
    output.getContext("2d")?.drawImage(transformed, sx, sy, sw, sh, 0, 0, output.width, output.height);
    return output.toDataURL("image/jpeg", quality);
  }, [cropHeightRatio, cropWidthRatio, edit, filter]);

  useEffect(() => {
    if (!naturalSize.width || !contactId) return;
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    const timer = window.setTimeout(async () => {
      const preview = renderMaster(3508, true, 1);
      if (!preview) return;
      await fetch(gatewayUrl("/api/jobs/working-preview"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId, fileId: file.id, dataUrl: preview, edit }),
      }).catch(() => {});
    }, 300);
    return () => window.clearTimeout(timer);
  }, [contactId, edit, file.id, naturalSize.width, renderMaster]);

  useEffect(() => {
    if (!naturalSize.width || !onLivePreview) return;
    const timer = window.setTimeout(() => {
      const preview = renderMaster(720, false, 0.9);
      if (preview) onLivePreview(preview);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [naturalSize, onLivePreview, renderMaster]);

  useEffect(() => {
    if (!onSaveHandler) return;
    onSaveHandler(async () => {
      const output = renderMaster(3508, true, 1);
      if (!output) throw new Error("Image is not ready yet.");
      const base = (file.originalFile?.name || file.name).replace(/\.[^.]+$/, "");
      const response = await fetch(gatewayUrl("/api/jobs/processed"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId, fileName: `${base}_edited.jpg`, mimeType: "image/jpeg", dataUrl: output, originalFileId: file.originalFileId || file.id }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Save failed");
    });
    return () => onSaveHandler(null);
  }, [contactId, file.id, file.name, onSaveHandler, renderMaster]);

  const visualCropInsets = useMemo(
    () => ({
      top: `${edit.crop.top}%`,
      right: `${edit.crop.right}%`,
      bottom: `${edit.crop.bottom}%`,
      left: `${edit.crop.left}%`,
    }),
    [edit.crop],
  );
  const dragBox =
    drag.kind === "new"
      ? {
          left: `${Math.min(drag.startX, drag.curX)}%`,
          top: `${Math.min(drag.startY, drag.curY)}%`,
          width: `${Math.abs(drag.curX - drag.startX)}%`,
          height: `${Math.abs(drag.curY - drag.startY)}%`,
        }
      : null;

  return (
    <div className="grid h-full grid-cols-[1fr_280px] overflow-hidden">
      {/* Preview stage */}
      <div className="flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-1 border-b border-border bg-card/40 px-3 py-1.5">
          <button
            onClick={undo}
            disabled={historyIdx === 0}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-accent/40 px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-40"
          >
            <Undo2 className="h-3 w-3" /> Undo
          </button>
          <button
            onClick={redo}
            disabled={historyIdx >= history.length - 1}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-accent/40 px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-40"
          >
            <Redo2 className="h-3 w-3" /> Redo
          </button>
          <button
            onClick={resetAll}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-accent/40 px-2 py-1 text-[11px] hover:bg-accent"
          >
            <RefreshCw className="h-3 w-3" /> Reset Original
          </button>
          {file.processedSrc && (
            <div className="ml-2 inline-flex rounded-md border border-border bg-accent/40 p-0.5 text-[11px]">
              <button
                onClick={() => selectSource("original")}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-all ${
                  (file.selectedSrc === file.originalSrc || !file.selectedSrc || file.selectedSrc === file.src)
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "hover:bg-accent text-muted-foreground"
                }`}
              >
                Original
              </button>
              <button
                onClick={() => selectSource("processed")}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-all ${
                  file.selectedSrc === file.processedSrc
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "hover:bg-accent text-muted-foreground"
                }`}
              >
                AI Result
              </button>
            </div>
          )}
          <span className="ml-2 text-[10px] text-muted-foreground">
            {historyIdx + 1} / {history.length}
          </span>
          <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            {isLandscape ? <RectangleHorizontal className="h-3 w-3" /> : <RectangleVertical className="h-3 w-3" />}
            {isPassport4x6 ? "Photo Paper 6 × 4 inch" : `A4 ${orientation} · ${isLandscape ? "297 × 210 mm" : "210 × 297 mm"}`}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => {setGuidedMode((value)=>!value);setReviewStep(false);}} className="rounded-md border border-border bg-accent/40 px-2 py-1 text-[10px] hover:bg-accent">{guidedMode ? "Advanced Mode" : "Guided Mode"}</button>
            <button
              onClick={() => setCropMode((c) => !c)}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
                cropMode
                  ? "border-primary bg-primary/20 text-primary"
                  : "border-border bg-accent/40 hover:bg-accent"
              }`}
            >
              <CropIcon className="h-3 w-3" />
              {cropMode ? "Cropping..." : "Drag Crop"}
            </button>
          </div>
        </div>

        {/* Stage */}
        <div className="flex flex-1 items-center justify-center overflow-auto bg-background p-6">
          <div
            className="relative max-h-full max-w-full overflow-hidden border border-slate-300 bg-white shadow-2xl"
            style={{ width: isLandscape ? "min(100%, 760px)" : "min(72%, 520px)", aspectRatio: pageRatio }}
          >
            <div className="pointer-events-none absolute left-2 top-2 z-20 rounded bg-slate-900/75 px-2 py-1 text-[10px] font-medium text-white">
              {isPassport4x6 ? "6 × 4 inch" : `A4 ${orientation}`}
            </div>
            <div
              className={`absolute overflow-hidden border border-dashed border-slate-300 bg-white ${isPassportSheet ? "inset-0" : "inset-[3.5%]"}`}
              title="A4 printable area"
            >
              <div
                ref={stageRef}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
                className={`absolute overflow-hidden ${cropMode ? "cursor-crosshair" : ""}`}
                style={edit.cropFit && !cropMode ? fitCropBounds : imageBounds}
                title="Image crop area"
              >
                <div
                  className="absolute inset-0"
                  style={!edit.cropFit ? { clipPath: `inset(${visualCropInsets.top} ${visualCropInsets.right} ${visualCropInsets.bottom} ${visualCropInsets.left})` } : undefined}
                >
                <img
                  ref={imgRef}
                  src={perspectiveSrc || baseSource}
                  alt={file.name}
                  crossOrigin="anonymous"
                  draggable={false}
                  onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
                  className="absolute select-none object-fill transition-[filter] duration-75"
                  style={{
                    filter,
                    transform,
                    transformOrigin: "center center",
                    ...(edit.cropFit && !cropMode ? {
                      left: `${-edit.crop.left / cropWidthRatio}%`, top: `${-edit.crop.top / cropHeightRatio}%`,
                      width: `${100 / cropWidthRatio}%`, height: `${100 / cropHeightRatio}%`,
                    } : quarterTurn ? {
                      left: "50%", top: "50%", width: `${100 / displayAspect}%`, height: `${displayAspect * 100}%`,
                      transform: `translate(-50%, -50%) ${transform}`,
                    } : { inset: 0, width: "100%", height: "100%" }),
                  }}
                />
                </div>
            {/* Crop rulers */}
              {(edit.crop.top || edit.crop.right || edit.crop.bottom || edit.crop.left) && (!edit.cropFit || cropMode) ? (
              <div className="pointer-events-none absolute inset-0">
                {edit.crop.top > 0 && <div className="absolute left-0 right-0 top-0 bg-black/35" style={{ height: visualCropInsets.top }} />}
                {edit.crop.bottom > 0 && <div className="absolute bottom-0 left-0 right-0 bg-black/35" style={{ height: visualCropInsets.bottom }} />}
                {edit.crop.left > 0 && <div className="absolute left-0 bg-black/35" style={{ top: visualCropInsets.top, bottom: visualCropInsets.bottom, width: visualCropInsets.left }} />}
                {edit.crop.right > 0 && <div className="absolute right-0 bg-black/35" style={{ top: visualCropInsets.top, bottom: visualCropInsets.bottom, width: visualCropInsets.right }} />}
                <div
                  className="absolute border-2 border-primary/90"
                  style={{
                    top: visualCropInsets.top,
                    right: visualCropInsets.right,
                    bottom: visualCropInsets.bottom,
                    left: visualCropInsets.left,
                  }}
                />
              </div>
              ) : null}
            {/* Active drag box */}
              {dragBox ? (
              <div
                className="pointer-events-none absolute border-2 border-primary bg-primary/10"
                style={dragBox}
              />
              ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tools panel */}
      <aside className="flex flex-col overflow-hidden border-l border-border bg-card/30">
        {guidedMode && <div className="border-b border-border p-2"><div className="grid grid-cols-4 gap-1">{(["Rotate","Crop","Adjust","Review"] as const).map((label,index)=>{const current=reviewStep?3:activeTab==="transform"?0:activeTab==="crop"?1:2;return <div key={label} className={`rounded px-1 py-1.5 text-center text-[9px] ${index===current?"bg-primary text-primary-foreground":index<current?"bg-primary/15 text-primary":"bg-accent/30 text-muted-foreground"}`}>{index+1}. {label}</div>;})}</div></div>}
        <div className="flex border-b border-border">
          {(
            [
              { id: "adjust", label: "Adjust", icon: Wand2 },
              { id: "crop", label: "Crop", icon: CropIcon },
              { id: "transform", label: "Rotate", icon: RotateCw },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`${guidedMode ? "hidden" : "flex"} flex-1 items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors ${
                activeTab === t.id
                  ? "border-b-2 border-primary bg-accent/40 text-primary"
                  : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className="h-3 w-3" />
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {reviewStep ? <div className="space-y-3"><h3 className="text-sm font-semibold">Review Changes</h3><p className="text-[10px] text-muted-foreground">Check the A4 preview. Changes remain non-destructive until you use Save New.</p><div className="rounded border border-border bg-background/50 p-3 text-[10px] leading-5">Brightness: {edit.brightness}%<br/>Contrast: {edit.contrast}%<br/>Crop: {Math.round(edit.crop.top + edit.crop.right + edit.crop.bottom + edit.crop.left)}% total<br/>Rotation: {edit.rotate + edit.deskew}°<br/>Page: A4 {orientation}</div></div> : activeTab === "adjust" && (
            <div className="space-y-4">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                <Sun className="h-3 w-3" /> Light
              </div>
              <Slider
                label="Brightness"
                value={edit.brightness}
                min={0}
                max={200}
                neutral={100}
                onChange={(v) => update({ brightness: v })}
                suffix="%"
              />
              <Slider
                label="Contrast"
                value={edit.contrast}
                min={0}
                max={200}
                neutral={100}
                onChange={(v) => update({ contrast: v })}
                suffix="%"
              />
              <Slider
                label="Highlights"
                value={edit.highlights}
                min={-100}
                max={100}
                neutral={0}
                onChange={(v) => update({ highlights: v })}
              />
              <div className="mt-4 flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                <Droplet className="h-3 w-3" /> Color
              </div>
              <Slider
                label="Saturation"
                value={edit.saturation}
                min={0}
                max={200}
                neutral={100}
                onChange={(v) => update({ saturation: v })}
                suffix="%"
              />
              <button
                onClick={() => update({ invert: !edit.invert })}
                className={`w-full rounded-md border py-2 text-[11px] ${edit.invert ? "border-primary bg-primary/15 text-primary" : "border-border bg-accent/40 hover:bg-accent"}`}
              >
                {edit.invert ? "Negative Invert: ON" : "Make Black Background White"}
              </button>
              <div className="mt-4 flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                <Sparkles className="h-3 w-3" /> Geometry
              </div>
              <Slider
                label="Deskew (fine rotate)"
                value={edit.deskew}
                min={-15}
                max={15}
                step={0.1}
                neutral={0}
                onChange={(v) => update({ deskew: v })}
                suffix="°"
              />
              <button
                onClick={() => update({ deskew: 0, brightness: 100, contrast: 108, saturation: 100 })}
                className="mt-2 w-full rounded-md border border-border bg-accent/40 py-1.5 text-[11px] hover:bg-accent"
              >
                Auto-enhance (mock)
              </button>
            </div>
          )}

          {activeTab === "crop" && (
            <div className="space-y-4">
              <div className="rounded-md border border-border bg-background/50 p-2.5">
                <div className="mb-2 text-[11px] font-semibold">After crop</div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => update({ cropFit: false })} className={`rounded border px-2 py-2 text-[10px] ${!edit.cropFit ? "border-primary bg-primary/15 text-primary" : "border-border"}`}>Keep Position</button>
                  <button onClick={() => update({ cropFit: true })} className={`rounded border px-2 py-2 text-[10px] ${edit.cropFit ? "border-primary bg-primary/15 text-primary" : "border-border"}`}>Fit Crop to A4</button>
                </div>
                {edit.cropFit && <div className="mt-3"><Slider label="Page margin" value={edit.cropMarginMm} min={0} max={30} step={1} suffix=" mm" onChange={(v) => update({ cropMarginMm: v })} /></div>}
                <p className="mt-2 text-[9px] text-muted-foreground">Reversible: switch back to Keep Position, Undo, or Reset Original.</p>
              </div>
              <div className="rounded-md border border-border bg-background/50 p-2.5"><div className="mb-2 text-[11px] font-semibold">Perspective Crop</div><button onClick={() => setPerspectiveOpen(true)} className="w-full rounded border border-primary/50 bg-primary/10 py-2 text-[10px] text-primary">Select 4 Corners</button>{edit.perspective?.enabled && <button onClick={() => update({ perspective: { ...edit.perspective, enabled: false } })} className="mt-2 w-full rounded border border-border py-1.5 text-[10px]">Reset Perspective</button>}<p className="mt-1 text-[9px] text-muted-foreground">Optional layer. Normal crop remains unchanged when disabled.</p></div>
              <div className="rounded-md border border-border bg-accent/20 p-2 text-[10px] text-muted-foreground">
                Tip: Enable <span className="text-primary">Drag Crop</span> in the toolbar and draw a
                box on the image — sliders update automatically.
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                <Contrast className="h-3 w-3" /> Crop from each side (%)
              </div>
              <Slider
                label="Top"
                value={edit.crop.top}
                min={0}
                max={45}
                onChange={(v) => updateCrop({ top: v })}
                suffix="%"
              />
              <Slider
                label="Bottom"
                value={edit.crop.bottom}
                min={0}
                max={45}
                onChange={(v) => updateCrop({ bottom: v })}
                suffix="%"
              />
              <Slider
                label="Left"
                value={edit.crop.left}
                min={0}
                max={45}
                onChange={(v) => updateCrop({ left: v })}
                suffix="%"
              />
              <Slider
                label="Right"
                value={edit.crop.right}
                min={0}
                max={45}
                onChange={(v) => updateCrop({ right: v })}
                suffix="%"
              />
              <button
                onClick={() => updateCrop({ top: 0, right: 0, bottom: 0, left: 0 })}
                className="w-full rounded-md border border-border bg-accent/40 py-1.5 text-[11px] hover:bg-accent"
              >
                Clear crop
              </button>
              <button
                onClick={applyCrop}
                disabled={!edit.crop.top && !edit.crop.right && !edit.crop.bottom && !edit.crop.left && !edit.rotate && !edit.deskew && !edit.flipH && !edit.flipV}
                className="w-full rounded-md bg-primary py-2 text-[11px] font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                Apply Crop &amp; Continue Editing
              </button>
            </div>
          )}

          {activeTab === "transform" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => update({ rotate: (edit.rotate - 90 + 360) % 360 })}
                  className="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-accent/40 py-2 text-[11px] hover:bg-accent"
                >
                  <RotateCcw className="h-3 w-3" /> Rotate -90°
                </button>
                <button
                  onClick={() => update({ rotate: (edit.rotate + 90) % 360 })}
                  className="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-accent/40 py-2 text-[11px] hover:bg-accent"
                >
                  <RotateCw className="h-3 w-3" /> Rotate +90°
                </button>
                <button
                  onClick={() => update({ flipH: !edit.flipH })}
                  className={`inline-flex items-center justify-center gap-1 rounded-md border py-2 text-[11px] ${
                    edit.flipH
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-border bg-accent/40 hover:bg-accent"
                  }`}
                >
                  <FlipHorizontal2 className="h-3 w-3" /> Flip H
                </button>
                <button
                  onClick={() => update({ flipV: !edit.flipV })}
                  className={`inline-flex items-center justify-center gap-1 rounded-md border py-2 text-[11px] ${
                    edit.flipV
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-border bg-accent/40 hover:bg-accent"
                  }`}
                >
                  <FlipVertical2 className="h-3 w-3" /> Flip V
                </button>
              </div>
              <Slider
                label="Fine rotate"
                value={edit.deskew}
                min={-15}
                max={15}
                step={0.1}
                neutral={0}
                onChange={(v) => update({ deskew: v })}
                suffix="°"
              />
              <div className="rounded-md border border-border bg-accent/20 p-2 text-[10px] text-muted-foreground">
                Current rotation: {edit.rotate}° + {edit.deskew.toFixed(1)}° fine
              </div>
            </div>
          )}
        </div>
        {guidedMode && <div className="flex shrink-0 items-center justify-between border-t border-border p-2"><button onClick={()=>{if(reviewStep){setReviewStep(false);setActiveTab("adjust");}else if(activeTab==="adjust")setActiveTab("crop");else if(activeTab==="crop")setActiveTab("transform");}} disabled={!reviewStep&&activeTab==="transform"} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1.5 text-[10px] disabled:opacity-30"><ArrowLeft className="h-3 w-3"/>Back</button><button onClick={()=>{if(activeTab==="transform")setActiveTab("crop");else if(activeTab==="crop")setActiveTab("adjust");else setReviewStep(true);}} disabled={reviewStep} className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1.5 text-[10px] text-primary-foreground disabled:opacity-30">Apply & Next<ArrowRight className="h-3 w-3"/></button></div>}
      </aside>
      {perspectiveOpen && <PerspectiveCropDialog source={baseSource} initial={edit.perspective?.points} onClose={() => setPerspectiveOpen(false)} onApply={(dataUrl, points) => { setPerspectiveSrc(dataUrl); update({ perspective: { enabled: true, points } }); setPerspectiveOpen(false); }} />}
    </div>
  );
}

import { Fragment, useMemo, useRef, useState } from "react";
import { Layers, Plus, RotateCcw, Sparkles, ArrowLeftRight, ArrowLeft, ArrowRight, Unlink, X, RectangleHorizontal, RectangleVertical } from "lucide-react";
import type { PrintFile } from "@/lib/mock-data";
import { Slider } from "./Slider";

/**
 * Aadhaar 130% Smart Layout.
 * Two blocks scaled 130% of physical Aadhaar card (85.6 x 54 mm) placed on A4.
 * User assigns two images from Col 2 (selected images are reported hidden).
 * Generate produces a merged PNG + adds it back to Col 2 as a generated file.
 */

// A4 @ 96dpi ~ 794 x 1123 px. Preview scaled by CSS.
const A4_W = 794;
const A4_H = 1123;
// Aadhaar card physical: 85.6 x 54 mm => at 96dpi ~ 323 x 204 px
const CARD_W = 323;
const CARD_H = 204;

type Slot = { imageId: string | null; rotate: number };
export type AadhaarLayoutState = {
  slots: Slot[];
  scale: number;
  gapY: number;
  marginTop: number;
  marginLeft: number;
  blockOrientation: "landscape" | "portrait";
  keepSources?: boolean;
  cardCount?: 1 | 2 | 3;
  sizeMode?: "original" | "custom";
  cuttingMarks?: boolean;
};

export function AadhaarLayout({
  availableImages,
  onHide,
  onUnhide,
  onGenerate,
  initialState,
  initialGeneratedSrc,
}: {
  availableImages: PrintFile[];
  onHide: (id: string) => void;
  onUnhide: (id: string) => void;
  onGenerate: (dataUrl: string, name: string, state: AadhaarLayoutState) => void | Promise<void>;
  initialState?: AadhaarLayoutState;
  initialGeneratedSrc?: string;
}) {
  const initialCount = initialState?.cardCount ?? Math.min(3, Math.max(1, Math.ceil((initialState?.slots?.length ?? 2) / 2))) as 1 | 2 | 3;
  const [cardCount, setCardCount] = useState<1 | 2 | 3>(initialCount);
  const [slots, setSlots] = useState<Slot[]>(() => Array.from({ length: initialCount * 2 }, (_, index) => initialState?.slots?.[index] ?? { imageId: null, rotate: 0 }));
  const [scale, setScale] = useState(initialState?.scale ?? (initialCount === 1 ? 130 : 100));
  const [sizeMode, setSizeMode] = useState<"original" | "custom">(initialState?.sizeMode ?? ((initialState?.scale ?? 130) === 100 ? "original" : "custom"));
  const [cuttingMarks, setCuttingMarks] = useState(initialState?.cuttingMarks ?? true);
  const [gapY, setGapY] = useState(initialState?.gapY ?? 30);
  const [marginTop, setMarginTop] = useState(initialState?.marginTop ?? 80);
  const [marginLeft, setMarginLeft] = useState(initialState?.marginLeft ?? 120);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [generated, setGenerated] = useState<string | null>(initialGeneratedSrc || null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [blockOrientation, setBlockOrientation] = useState<"landscape" | "portrait">(initialState?.blockOrientation ?? "landscape");
  const [keepSources, setKeepSources] = useState(initialState?.keepSources ?? true);
  const [step, setStep] = useState(initialGeneratedSrc ? 3 : 0);
  const pageRef = useRef<HTMLDivElement>(null);

  const imageById = useMemo(() => {
    const m = new Map<string, PrintFile>();
    for (const im of availableImages) m.set(im.id, im);
    return m;
  }, [availableImages]);
  // Aadhaar must use the tight crop shown in Col 2. `workingSrc` is a complete
  // A4 print page and `src` may still be the uncropped WhatsApp original.
  // Prefer the persisted crop, then the current tight crop held by the UI.
  // Never prefer `livePreview`: it is only a 360px A4 thumbnail and contains
  // baked page padding. That made Aadhaar text blurry and left white space in
  // the block. Use the tight crop when available, otherwise the full-quality
  // received source; keep the thumbnail strictly as a last-resort fallback.
  const cardSource = (file?: PrintFile | null) => file?.workingSrc || file?.appliedCropSrc || file?.src || file?.originalFile?.workingSrc || file?.originalFile?.appliedCropSrc || file?.originalFile?.src || file?.livePreview;

  const blockCount = cardCount * 2;
  const columns = cardCount === 1 ? (blockOrientation === "portrait" ? 2 : 1) : 2;
  const rows = Math.ceil(blockCount / columns);
  const baseCardW = blockOrientation === "landscape" ? CARD_W : CARD_H;
  const baseCardH = blockOrientation === "landscape" ? CARD_H : CARD_W;
  const maxMultiScale = Math.max(50, Math.min(
    ((A4_W - 40 - (columns - 1) * gapY) / (columns * baseCardW)) * 100,
    ((A4_H - 40 - (rows - 1) * gapY) / (rows * baseCardH)) * 100,
  ));
  const effectiveScale = Math.min(scale, maxMultiScale);
  const landscapeW = (CARD_W * effectiveScale) / 100;
  const landscapeH = (CARD_H * effectiveScale) / 100;
  const cardW = blockOrientation === "landscape" ? landscapeW : landscapeH;
  const cardH = blockOrientation === "landscape" ? landscapeH : landscapeW;
  const gridW = columns * cardW + (columns - 1) * gapY;
  const gridH = rows * cardH + (rows - 1) * gapY;
  const autoLeft = Math.max(20, (A4_W - gridW) / 2);
  const autoTop = Math.max(20, (A4_H - gridH) / 2);
  const positions = Array.from({ length: blockCount }, (_, index) => ({
    x: (cardCount > 1 ? autoLeft : (marginLeft === 120 ? autoLeft : marginLeft)) + (index % columns) * (cardW + gapY),
    y: (cardCount > 1 ? autoTop : (marginTop === 80 ? autoTop : marginTop)) + Math.floor(index / columns) * (cardH + gapY),
  }));

  const changeCardCount = (count: 1 | 2 | 3) => {
    setCardCount(count);
    setScale(count === 1 ? 130 : 100);
    if (count > 1) setGapY((current) => Math.min(current, 30));
    setSizeMode("custom");
    setSlots((current) => Array.from({ length: count * 2 }, (_, index) => current[index] ?? { imageId: null, rotate: 0 }));
    setSelectedSlot(null);
    setGenerated(null);
  };

  const assign = (slotIdx: number, imageId: string) => {
    const assignedFile = imageById.get(imageId);
    // The high-resolution original does not physically contain the non-
    // destructive Editor rotation. Carry that stored rotation into the slot.
    // Apply Crop images already have rotation baked into their pixels.
    const editorRotation = assignedFile?.workingSrc || assignedFile?.appliedCropSrc ? 0 : (assignedFile?.workingEdit?.rotate || 0);
    setSlots((prev) => {
      const next = [...prev];
      const previous = next[slotIdx].imageId;
      if (previous && !next.some((item, index) => index !== slotIdx && item.imageId === previous)) onUnhide(previous);
      next[slotIdx] = { imageId, rotate: editorRotation };
      return next;
    });
    if (!keepSources) onHide(imageId);
    setPickerFor(null);
    setGenerated(null);
  };

  const clearSlot = (idx: number) => {
    setSlots((prev) => {
      const next = [...prev];
      const prevId = next[idx].imageId;
      if (prevId && !next.some((item, index) => index !== idx && item.imageId === prevId)) onUnhide(prevId);
      next[idx] = { imageId: null, rotate: 0 };
      return next;
    });
    setGenerated(null);
  };

  const swap = () => {
    setSlots((prev) => prev.length < 2 ? prev : [prev[1], prev[0], ...prev.slice(2)]);
    setGenerated(null);
  };

  const rotateSlot = (idx: number) => {
    setSlots((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], rotate: (next[idx].rotate + 90) % 360 };
      return next;
    });
    setGenerated(null);
  };

  const unbindSingle = () => {
    if (selectedSlot === null) return;
    clearSlot(selectedSlot);
    setSelectedSlot(null);
  };

  const unbindBoth = () => {
    slots.forEach((_, index) => clearSlot(index));
    setSelectedSlot(null);
    setGenerated(null);
  };

  const generate = async () => {
    const outputScale = 300 / 96;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(A4_W * outputScale);
    canvas.height = Math.round(A4_H * outputScale);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(outputScale, outputScale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, A4_W, A4_H);

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot.imageId) continue;
      const file = imageById.get(slot.imageId);
      const source = cardSource(file);
      if (!source) continue;
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const p = positions[i];
          ctx.save();
          ctx.translate(p.x + cardW / 2, p.y + cardH / 2);
          ctx.rotate((slot.rotate * Math.PI) / 180);
          const rotated = slot.rotate % 180 !== 0;
          const boxW = rotated ? cardH : cardW;
          const boxH = rotated ? cardW : cardH;
          // Fill without distortion: preserve aspect ratio and crop only overflow.
          const imageRatio = img.width / img.height;
          const boxRatio = boxW / boxH;
          let sx = 0, sy = 0, sw = img.width, sh = img.height;
          if (imageRatio > boxRatio) { sw = img.height * boxRatio; sx = (img.width - sw) / 2; }
          else { sh = img.width / boxRatio; sy = (img.height - sh) / 2; }
          ctx.drawImage(img, sx, sy, sw, sh, -boxW / 2, -boxH / 2, boxW, boxH);
          ctx.restore();
          if (cuttingMarks) {
            ctx.save();
            ctx.strokeStyle = "#111111";
            ctx.lineWidth = 0.8;
            ctx.strokeRect(p.x, p.y, cardW, cardH);
            const mark = 10;
            ctx.beginPath();
            ctx.moveTo(p.x - mark, p.y); ctx.lineTo(p.x + mark, p.y);
            ctx.moveTo(p.x, p.y - mark); ctx.lineTo(p.x, p.y + mark);
            ctx.moveTo(p.x + cardW - mark, p.y); ctx.lineTo(p.x + cardW + mark, p.y);
            ctx.moveTo(p.x + cardW, p.y - mark); ctx.lineTo(p.x + cardW, p.y + mark);
            ctx.moveTo(p.x - mark, p.y + cardH); ctx.lineTo(p.x + mark, p.y + cardH);
            ctx.moveTo(p.x, p.y + cardH - mark); ctx.lineTo(p.x, p.y + cardH + mark);
            ctx.moveTo(p.x + cardW - mark, p.y + cardH); ctx.lineTo(p.x + cardW + mark, p.y + cardH);
            ctx.moveTo(p.x + cardW, p.y + cardH - mark); ctx.lineTo(p.x + cardW, p.y + cardH + mark);
            ctx.stroke();
            ctx.restore();
          }
          resolve();
        };
        img.onerror = () => resolve();
        img.src = source;
      });
    }
    const url = canvas.toDataURL("image/png");
    setGenerated(url);
    setSaving(true);
    setSaveError("");
    try {
      await onGenerate(url, `Aadhaar_${sizeMode === "original" ? "Original" : `${scale}pct`}_${cardCount}Cards_${Date.now()}.png`, { slots, scale: effectiveScale, gapY, marginTop, marginLeft, blockOrientation, keepSources, cardCount, sizeMode, cuttingMarks });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Layout save failed");
      setGenerated(null);
    } finally {
      setSaving(false);
    }
  };

  const canGenerate = slots.length === blockCount && slots.every((slot) => !!slot.imageId);

  // scale preview to fit
  const previewScale = 0.45;

  return (
    <div className="flex h-full min-h-0">
      {/* Preview */}
      <div className="flex flex-1 min-w-0 items-center justify-center overflow-auto bg-muted/20 p-4">
        {generated ? (
          <div className="relative">
            <img
              src={generated}
              alt="Generated Aadhaar layout"
              className="rounded border border-border shadow-lg"
              style={{ width: A4_W * previewScale, height: A4_H * previewScale }}
            />
            <div className="absolute -top-2 left-2 rounded bg-status-ready px-1.5 py-0.5 text-[9px] font-medium text-status-ready-foreground">
              GENERATED
            </div>
          </div>
        ) : (
          <div
            ref={pageRef}
            className="relative bg-white shadow-lg"
            style={{
              width: A4_W * previewScale,
              height: A4_H * previewScale,
            }}
          >
            {slots.map((slot, i) => {
              const file = slot.imageId ? imageById.get(slot.imageId) : null;
              const top = positions[i].y * previewScale;
              const left = positions[i].x * previewScale;
              const w = cardW * previewScale;
              const h = cardH * previewScale;
              const isSelected = selectedSlot === i;
              return (
                <Fragment key={i}>
                <button
                  onClick={() => setSelectedSlot(isSelected ? null : i)}
                  className={`absolute overflow-hidden border-2 ${
                    isSelected ? "border-primary" : "border-dashed border-primary/60"
                  } bg-primary/5 transition-colors`}
                  style={{ top, left, width: w, height: h }}
                >
                  {cardSource(file) ? (
                    <img
                      src={cardSource(file)}
                      alt=""
                      className="absolute left-1/2 top-1/2 max-w-none object-fill"
                      style={{
                        width: slot.rotate % 180 !== 0 ? h : w,
                        height: slot.rotate % 180 !== 0 ? w : h,
                        transform: `translate(-50%, -50%) rotate(${slot.rotate}deg)`,
                      }}
                    />
                  ) : (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setPickerFor(i);
                      }}
                      className="flex h-full w-full items-center justify-center text-[10px] font-medium text-primary/80"
                    >
                      Slot {i + 1} — click to assign
                    </span>
                  )}
                  <span className="pointer-events-none absolute left-0.5 top-0.5 rounded bg-black/60 px-1 py-0.5 text-[8px] font-medium text-white">
                    {effectiveScale}% · {blockOrientation}
                  </span>
                </button>
                {file && <button
                  onClick={() => rotateSlot(i)}
                  className="absolute z-10 rounded border border-primary/60 bg-slate-900/90 px-1.5 py-0.5 text-[8px] font-medium text-white hover:bg-primary"
                  style={{ top: top + h + 2, left: left + w / 2, transform: "translateX(-50%)" }}
                  title={`Rotate block ${i + 1} by 90 degrees`}
                >↻ Rotate 90°</button>}
                </Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* Right tools rail */}
      <div className="flex w-72 flex-col border-l border-border bg-card/40">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Layers className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Aadhaar Card Layout</h3>
        </div>
        <div className="grid grid-cols-4 gap-1 border-b border-border p-2">{["Select","Arrange","Size","Preview"].map((label,index)=><div key={label} className={`rounded px-1 py-1.5 text-center text-[9px] ${step===index?"bg-primary text-primary-foreground":index<step?"bg-primary/15 text-primary":"bg-accent/30 text-muted-foreground"}`}>{index+1}. {label}</div>)}</div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Slot summary */}
          <div className={`${step <= 1 ? "block" : "hidden"} space-y-1.5`}>
            <div className="mb-2 grid grid-cols-3 gap-1.5">
              {([1, 2, 3] as const).map((count) => <button key={count} onClick={() => changeCardCount(count)} className={`rounded border py-1.5 text-[10px] ${cardCount === count ? "border-primary bg-primary/15 text-primary" : "border-border bg-card"}`}>{count} Card · {count * 2} Blocks</button>)}
            </div>
            {slots.map((slot, i) => {
              const file = slot.imageId ? imageById.get(slot.imageId) : null;
              return (
                <div
                  key={i}
                  className={`flex items-center gap-2 rounded border p-1.5 ${
                    selectedSlot === i ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <div className="flex h-8 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted text-[9px] text-muted-foreground">
                    {file?.src ? <img src={file.src} className="h-full w-full object-cover" /> : `A${i + 1}`}
                  </div>
                  <div className="min-w-0 flex-1 text-[11px]">
                    <div className="truncate font-medium">{file?.name ?? `Slot ${i + 1}`}</div>
                    <div className="text-[9px] text-muted-foreground">{file ? "Assigned · ready for layout" : "Empty"}</div>
                  </div>
                  {file ? (
                    <>
                      {i < slots.length - 1 && <button onClick={() => assign(i + 1, slot.imageId!)} className="rounded px-1 py-0.5 text-[8px] hover:bg-accent" title="Repeat in next block">Repeat</button>}
                      <button onClick={() => rotateSlot(i)} className="rounded p-1 hover:bg-accent" title="Rotate 90°">
                        <RotateCcw className="h-3 w-3" />
                      </button>
                      <button onClick={() => clearSlot(i)} className="rounded p-1 hover:bg-destructive/15 hover:text-destructive" title="Unbind">
                        <X className="h-3 w-3" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setPickerFor(i)}
                      className="rounded bg-primary/10 p-1 text-primary hover:bg-primary/20"
                      title="Assign image"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Sliders */}
          <div className={`${step === 2 ? "block" : "hidden"} space-y-3 rounded-md border border-border bg-background/40 p-2.5`}>
            <div>
              <div className="mb-1.5 text-[10px] font-medium text-muted-foreground">Cards on this A4 page (Front + Back)</div>
              <div className="grid grid-cols-3 gap-1.5">
                {([1, 2, 3] as const).map((count) => <button key={count} onClick={() => changeCardCount(count)} className={`rounded border py-1.5 text-[10px] ${cardCount === count ? "border-primary bg-primary/15 text-primary" : "border-border bg-card"}`}>{count} Card<br/><span className="text-[8px] opacity-70">{count * 2} Blocks</span></button>)}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[10px] font-medium text-muted-foreground">Automatic A4 arrangement</div>
              <div className="grid grid-cols-1 gap-1.5">
                <button disabled className="rounded border border-primary bg-primary/15 py-1.5 text-[10px] text-primary">{blockCount} blocks · centered inside A4</button>
              </div>
            </div>
            <label className="flex items-center justify-between rounded border border-border bg-card/60 p-2 text-[10px]"><span><b>Keep source single images</b><small className="block text-[9px] text-muted-foreground">Keep originals visible in Column 2</small></span><input type="checkbox" checked={keepSources} onChange={(event) => { const next=event.target.checked; setKeepSources(next); for (const slot of slots) if (slot.imageId) next ? onUnhide(slot.imageId) : onHide(slot.imageId); }} className="accent-cyan-500" /></label>
            <div>
              <div className="mb-1.5 text-[10px] font-medium text-muted-foreground">Block orientation</div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => { setBlockOrientation("landscape"); setGenerated(null); }} className={`inline-flex items-center justify-center gap-1 rounded border py-1.5 text-[10px] ${blockOrientation === "landscape" ? "border-primary bg-primary/15 text-primary" : "border-border bg-card"}`}>
                  <RectangleHorizontal className="h-3 w-3" /> Landscape
                </button>
                <button onClick={() => { setBlockOrientation("portrait"); setGenerated(null); }} className={`inline-flex items-center justify-center gap-1 rounded border py-1.5 text-[10px] ${blockOrientation === "portrait" ? "border-primary bg-primary/15 text-primary" : "border-border bg-card"}`}>
                  <RectangleVertical className="h-3 w-3" /> Portrait
                </button>
              </div>
              <p className="mt-1 text-[9px] text-muted-foreground">Landscape: ઉપર-નીચે · Portrait: બાજુ-બાજુ</p>
            </div>
            <Slider label="Card size" value={Math.min(scale, Math.floor(maxMultiScale))} min={40} max={Math.max(40, Math.floor(maxMultiScale))} step={1} suffix="%" onChange={(v) => { setScale(v); setSizeMode("custom"); setGenerated(null); }} />
            <Slider label="Gap between" value={gapY} min={0} max={cardCount === 1 ? 200 : 60} step={1} suffix="px" onChange={(v) => { setGapY(v); setGenerated(null); }} />
            {cardCount === 1 && <><Slider label="Margin top" value={marginTop} min={0} max={400} step={1} suffix="px" onChange={(v) => { setMarginTop(v); setGenerated(null); }} /><Slider label="Margin left" value={marginLeft} min={0} max={400} step={1} suffix="px" onChange={(v) => { setMarginLeft(v); setGenerated(null); }} /></>}
            <label className="flex items-center justify-between rounded border border-border bg-card/60 p-2 text-[10px]"><span><b>Black cutting marks</b><small className="block text-[9px] text-muted-foreground">Safe cut line outside every card</small></span><input type="checkbox" checked={cuttingMarks} onChange={(event) => { setCuttingMarks(event.target.checked); setGenerated(null); }} className="accent-cyan-500" /></label>
          </div>

          {/* Generated tools */}
          {step === 3 && generated && (
            <div className="space-y-1.5 rounded-md border border-status-ready/30 bg-status-ready/5 p-2">
              <div className="text-[11px] font-semibold text-status-ready">Generated image tools</div>
              <button onClick={swap} className="flex w-full items-center gap-2 rounded border border-border bg-card/60 px-2 py-1.5 text-[11px] hover:bg-accent">
                <ArrowLeftRight className="h-3 w-3" /> Swap A ⇄ B
              </button>
              <button
                onClick={unbindSingle}
                disabled={selectedSlot === null}
                className="flex w-full items-center gap-2 rounded border border-border bg-card/60 px-2 py-1.5 text-[11px] hover:bg-accent disabled:opacity-40"
              >
                <Unlink className="h-3 w-3" /> Unbind selected {selectedSlot !== null ? `(Slot ${selectedSlot + 1})` : ""}
              </button>
              <button onClick={unbindBoth} className="flex w-full items-center gap-2 rounded border border-border bg-card/60 px-2 py-1.5 text-[11px] hover:bg-accent">
                <Unlink className="h-3 w-3" /> Unbind both
              </button>
              <button onClick={() => { setGenerated(null); setStep(1); }} className="w-full rounded bg-primary px-2 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90">
                Update layout
              </button>
            </div>
          )}
        </div>

        <div className="border-t border-border p-2">
          {saveError && <p className="mb-2 text-[10px] text-destructive">{saveError}</p>}
          <div className="flex gap-2"><button onClick={()=>setStep((value)=>Math.max(0,value-1))} disabled={step===0} className="inline-flex items-center gap-1 rounded border border-border px-3 py-2 text-xs disabled:opacity-30"><ArrowLeft className="h-3 w-3"/>Back</button>{step < 3 ? <button onClick={()=>setStep((value)=>Math.min(3,value+1))} disabled={step===0&&!canGenerate} className="ml-auto inline-flex items-center gap-1 rounded bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-30">Apply & Next<ArrowRight className="h-3 w-3"/></button> : <button
            onClick={generate}
            disabled={!canGenerate || saving}
            className="ml-auto flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {saving ? "Saving 300 DPI..." : "Generate 300 DPI & Open Editor"}
          </button>}</div>
        </div>
      </div>

      {/* Image picker modal */}
      {pickerFor !== null && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 p-6" onClick={() => setPickerFor(null)}>
          <div className="max-h-[80vh] w-[520px] overflow-hidden rounded-lg border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center border-b border-border p-3">
              <h4 className="text-sm font-semibold">Assign image to Slot {pickerFor + 1}</h4>
              <button onClick={() => setPickerFor(null)} className="ml-auto rounded p-1 hover:bg-accent"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-3">
              {availableImages.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">No images available from this customer.</div>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {availableImages.map((im) => (
                      <button
                        key={im.id}
                        onClick={() => assign(pickerFor, im.id)}
                        className="group overflow-hidden rounded border border-border bg-muted hover:border-primary"
                      >
                        {cardSource(im) ? <img src={cardSource(im)} style={{ transform: `rotate(${im.workingSrc || im.appliedCropSrc ? 0 : (im.workingEdit?.rotate || 0)}deg)` }} className="aspect-square w-full object-cover" alt="" /> : <div className="aspect-square" />}
                        <div className="truncate p-1 text-[9px] text-muted-foreground group-hover:text-foreground">{im.name}</div>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

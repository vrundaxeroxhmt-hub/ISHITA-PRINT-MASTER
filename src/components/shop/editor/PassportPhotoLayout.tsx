import { useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Eraser, ImagePlus, Sparkles } from "lucide-react";
import { removeBackground } from "@imgly/background-removal";
import type { PrintFile } from "@/lib/mock-data";

type Preset = "4x6-8" | "a4-32" | "a4-45";
type PhotoConfig = {
  background: string;
  caption: string;
  zoom: number;
  x: number;
  y: number;
  brightness: number;
  contrast: number;
  crop: { left: number; top: number; width: number; height: number };
  croppedSrc?: string;
  removedSrc?: string;
};
export type PassportLayoutState = {
  sourceFileIds: string[];
  preset: Preset;
  configs: Record<string, PhotoConfig>;
  gapMm: number;
  borderWidth: number;
  borderColor: string;
  cuttingMarks: boolean;
  hideSources: boolean;
  saveSingles: boolean;
};
const defaults = (): PhotoConfig => ({
  background: "#ffffff",
  caption: "",
  zoom: 1,
  x: 0,
  y: 0,
  brightness: 100,
  contrast: 100,
  crop: { left: 0, top: 0, width: 100, height: 100 },
});
// Col 2 livePreview is intentionally small for speed. Passport crop/layout must
// prefer the persisted high-resolution working file to avoid blurry enlargements.
const sourceOf = (file: PrintFile) => file.workingSrc || file.src || file.livePreview || "";
const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
const blobDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

export function PassportPhotoLayout({
  files,
  onGenerate,
  initialState,
}: {
  files: PrintFile[];
  onGenerate: (
    page: string,
    state: PassportLayoutState,
    singles: Array<{ id: string; dataUrl: string }>,
  ) => Promise<void>;
  initialState?: PassportLayoutState;
}) {
  const images = useMemo(
    () => files.filter((file) => file.kind === "image" && file.src && !file.layoutType),
    [files],
  );
  const [selected, setSelected] = useState<string[]>(initialState?.sourceFileIds || []);
  const [active, setActive] = useState<string | null>(initialState?.sourceFileIds[0] || null);
  const [configs, setConfigs] = useState<Record<string, PhotoConfig>>(initialState?.configs || {});
  const [preset, setPreset] = useState<Preset>(initialState?.preset || "4x6-8");
  const [gapMm, setGapMm] = useState(initialState?.gapMm ?? 2);
  const [borderWidth, setBorderWidth] = useState(initialState?.borderWidth ?? 2);
  const [borderColor, setBorderColor] = useState(initialState?.borderColor || "#6b7280");
  const [cuttingMarks, setCuttingMarks] = useState(initialState?.cuttingMarks ?? true);
  const [hideSources, setHideSources] = useState(initialState?.hideSources ?? true);
  const [saveSingles, setSaveSingles] = useState(initialState?.saveSingles ?? false);
  const [step, setStep] = useState(initialState ? 4 : 0);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const resolvedConfig = (id: string) => ({
    ...defaults(),
    ...(configs[id] || {}),
    crop: { ...defaults().crop, ...(configs[id]?.crop || {}) },
  });
  const config = active ? resolvedConfig(active) : defaults();
  const patchConfig = (patch: Partial<PhotoConfig>) =>
    active &&
    setConfigs((current) => ({
      ...current,
      [active]: { ...(current[active] || defaults()), ...patch },
    }));
  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length < 4
          ? [...current, id]
          : current,
    );
    setActive(id);
  };
  const removeBg = async () => {
    const file = images.find((item) => item.id === active);
    if (!file || busy) return;
    setBusy("Removing background (first time may download AI model)...");
    setError("");
    try {
      patchConfig({
        removedSrc: await blobDataUrl(await removeBackground(config.croppedSrc || sourceOf(file))),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Background removal failed");
    } finally {
      setBusy("");
    }
  };
  const confirmCrop = async () => {
    if (!activeFile || config.crop.width < 1 || config.crop.height < 1) return;
    const image = await loadImage(sourceOf(activeFile));
    const canvas = document.createElement("canvas");
    const sx = (image.width * config.crop.left) / 100,
      sy = (image.height * config.crop.top) / 100,
      sw = (image.width * config.crop.width) / 100,
      sh = (image.height * config.crop.height) / 100;
    canvas.width = Math.max(1, Math.round(sw));
    canvas.height = Math.max(1, Math.round(sh));
    canvas.getContext("2d")!.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    patchConfig({ croppedSrc: canvas.toDataURL("image/png"), removedSrc: undefined });
  };
  const cropPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
    };
  };
  const cropDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = cropPoint(event);
    const point = cropPoint(event); patchConfig({ crop: { left: point.x, top: point.y, width: 0, height: 0 } });
  };
  const cropMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const point = cropPoint(event),
      start = dragStart.current;
    const left = Math.min(start.x, point.x),
      top = Math.min(start.y, point.y);
    patchConfig({
      crop: { left, top, width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) },
    });
  };
  const cropUp = () => {
    dragStart.current = null;
  };
  const generate = async () => {
    if (!selected.length || busy) return;
    setBusy("Generating passport sheet...");
    setError("");
    try {
      const spec =
        preset === "4x6-8"
          ? { width: 1800, height: 1200, cols: 4, rows: 2, paperWidthMm: 152.4 }
          : preset === "a4-32"
            ? { width: 2480, height: 3508, cols: 4, rows: 8, paperWidthMm: 210 }
            : { width: 2480, height: 3508, cols: 5, rows: 9, paperWidthMm: 210 };
      const pxPerMm = spec.width / spec.paperWidthMm,
        gap = gapMm * pxPerMm,
        margin = 2 * pxPerMm;
      const canvas = document.createElement("canvas");
      canvas.width = spec.width;
      canvas.height = spec.height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const slotW = (spec.width - margin * 2 - gap * (spec.cols - 1)) / spec.cols,
        slotH = (spec.height - margin * 2 - gap * (spec.rows - 1)) / spec.rows;
      const loaded = new Map<string, HTMLImageElement>();
      for (const id of selected) {
        const file = images.find((item) => item.id === id)!;
        const cfg = resolvedConfig(id);
        loaded.set(id, await loadImage(cfg.removedSrc || cfg.croppedSrc || sourceOf(file)));
      }
      for (let index = 0; index < spec.cols * spec.rows; index++) {
        const id = selected[index % selected.length],
          image = loaded.get(id)!,
          cfg = resolvedConfig(id);
        const col = index % spec.cols,
          row = Math.floor(index / spec.cols),
          x = margin + col * (slotW + gap),
          y = margin + row * (slotH + gap);
        const captionH = cfg.caption.trim() ? Math.min(74, slotH * 0.16) : 0,
          photoH = slotH - captionH;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, slotW, slotH);
        ctx.clip();
        ctx.fillStyle = cfg.background;
        ctx.fillRect(x, y, slotW, photoH);
        const prepared = Boolean(cfg.removedSrc || cfg.croppedSrc);
        const sourceX = prepared ? 0 : (image.width * cfg.crop.left) / 100,
          sourceY = prepared ? 0 : (image.height * cfg.crop.top) / 100;
        const sourceW = prepared ? image.width : (image.width * Math.max(1, cfg.crop.width)) / 100,
          sourceH = prepared ? image.height : (image.height * Math.max(1, cfg.crop.height)) / 100;
        const scale = Math.max(slotW / sourceW, photoH / sourceH) * cfg.zoom,
          drawW = sourceW * scale,
          drawH = sourceH * scale;
        ctx.filter = `brightness(${cfg.brightness}%) contrast(${cfg.contrast}%)`;
        ctx.drawImage(
          image,
          sourceX,
          sourceY,
          sourceW,
          sourceH,
          x + (slotW - drawW) / 2 + (cfg.x * slotW) / 100,
          y + (photoH - drawH) / 2 + (cfg.y * photoH) / 100,
          drawW,
          drawH,
        );
        ctx.filter = "none";
        if (captionH) {
          ctx.fillStyle = "white";
          ctx.fillRect(x, y + photoH, slotW, captionH);
          ctx.fillStyle = "#111827";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = `600 ${Math.max(18, captionH * 0.42)}px Arial`;
          ctx.fillText(cfg.caption, x + slotW / 2, y + photoH + captionH / 2, slotW - 12);
        }
        ctx.restore();
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = borderWidth;
        if (borderWidth > 0) ctx.strokeRect(x, y, slotW, slotH);
      }
      if (cuttingMarks) {
        ctx.save(); ctx.strokeStyle = "#000000"; ctx.lineWidth = Math.max(2, pxPerMm * 0.18); ctx.beginPath();
        for (let column = 1; column < spec.cols; column++) { const x = margin + column * slotW + (column - 0.5) * gap; ctx.moveTo(x, 0); ctx.lineTo(x, spec.height); }
        for (let row = 1; row < spec.rows; row++) { const y = margin + row * slotH + (row - 0.5) * gap; ctx.moveTo(0, y); ctx.lineTo(spec.width, y); }
        ctx.stroke(); ctx.restore();
      }
      const singles: Array<{ id: string; dataUrl: string }> = [];
      if (saveSingles)
        for (const id of selected) {
          const image = loaded.get(id)!,
            cfg = resolvedConfig(id),
            single = document.createElement("canvas");
          single.width = 700;
          single.height = 900;
          const singleCtx = single.getContext("2d")!;
          singleCtx.fillStyle = cfg.background;
          singleCtx.fillRect(0, 0, 700, 900);
          const prepared = Boolean(cfg.removedSrc || cfg.croppedSrc),
            sx = prepared ? 0 : (image.width * cfg.crop.left) / 100,
            sy = prepared ? 0 : (image.height * cfg.crop.top) / 100,
            sw = prepared ? image.width : (image.width * Math.max(1, cfg.crop.width)) / 100,
            sh = prepared ? image.height : (image.height * Math.max(1, cfg.crop.height)) / 100;
          const scale = Math.max(700 / sw, 900 / sh) * cfg.zoom,
            dw = sw * scale,
            dh = sh * scale;
          singleCtx.filter = `brightness(${cfg.brightness}%) contrast(${cfg.contrast}%)`;
          singleCtx.drawImage(
            image,
            sx,
            sy,
            sw,
            sh,
            (700 - dw) / 2 + cfg.x * 7,
            (900 - dh) / 2 + cfg.y * 9,
            dw,
            dh,
          );
          singles.push({ id, dataUrl: single.toDataURL("image/jpeg", 1) });
        }
      await onGenerate(
        canvas.toDataURL("image/jpeg", 1),
        {
          sourceFileIds: selected,
          preset,
          configs: Object.fromEntries(selected.map((id) => [id, resolvedConfig(id)])),
          gapMm,
          borderWidth,
          borderColor,
          cuttingMarks,
          hideSources,
          saveSingles,
        },
        singles,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Passport sheet failed");
    } finally {
      setBusy("");
    }
  };
  const activeFile =
    images.find((file) => file.id === active) || images.find((file) => file.id === selected[0]);
  const steps = ["Select", "Manual Crop", "Background", "Adjust", "Layout"];
  const nextStep = () => {
    if (step === 0 && !active) setActive(selected[0] || null);
    setStep((value) => Math.min(4, value + 1));
  };
  const header = (
    <div className="sticky top-0 z-30 flex items-center gap-1 border-b border-border bg-card p-2 shadow-sm">
      <button
        onClick={() => setStep((value) => Math.max(0, value - 1))}
        disabled={step === 0}
        className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-[10px] disabled:opacity-30"
      >
        <ArrowLeft className="h-3 w-3" />
        Back
      </button>
      {steps.map((label, index) => (
        <div
          key={label}
          className={`flex-1 rounded px-2 py-1 text-center text-[10px] ${step === index ? "bg-primary text-primary-foreground" : index < step ? "bg-primary/15 text-primary" : "bg-background text-muted-foreground"}`}
        >
          {index + 1}. {label}
        </div>
      ))}
      <button
        onClick={nextStep}
        disabled={(step === 0 && !selected.length) || step === 4}
        className="inline-flex shrink-0 items-center gap-1 rounded bg-primary px-3 py-1 text-[10px] font-semibold text-primary-foreground disabled:opacity-30"
      >
        Next
        <ArrowRight className="h-3 w-3" />
      </button>
    </div>
  );
  const nav = (
    <div className="flex items-center justify-between border-t border-border bg-card/70 p-3">
      <button
        onClick={() => setStep((value) => Math.max(0, value - 1))}
        disabled={step === 0}
        className="inline-flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs disabled:opacity-30"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back
      </button>
      <span className="text-[10px] text-muted-foreground">
        {selected.length} photo{selected.length === 1 ? "" : "s"} selected
      </span>
      <button
        onClick={nextStep}
        disabled={(step === 0 && !selected.length) || step === 4}
        className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-30"
      >
        Next
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  if (step === 0)
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex-1 overflow-y-auto p-5">
          <h3 className="text-sm font-semibold">Select 1 to 4 photos</h3>
          <p className="mb-4 text-[10px] text-muted-foreground">
            The latest Editor preview is used. Click photos in the order you want them repeated.
          </p>
          <div className="grid grid-cols-6 gap-3">
            {images.map((file) => (
              <button
                key={file.id}
                onClick={() => toggle(file.id)}
                className={`overflow-hidden rounded border ${selected.includes(file.id) ? "border-primary ring-2 ring-primary/40" : "border-border"}`}
              >
                <img src={sourceOf(file)} className="aspect-square w-full object-cover" />
                <div className="truncate p-1 text-[9px]">{file.name}</div>
              </button>
            ))}
          </div>
        </div>
        {nav}
      </div>
    );

  if (step === 1)
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 items-center justify-center overflow-auto bg-muted/20 p-6">
            {activeFile && (
              <div className="relative inline-block max-w-full select-none">
                <img
                  src={config.croppedSrc || sourceOf(activeFile)}
                  className="block max-h-[620px] max-w-full"
                  draggable={false}
                />
                {!config.croppedSrc && (
                  <div
                    onPointerDown={cropDown}
                    onPointerMove={cropMove}
                    onPointerUp={cropUp}
                    className="absolute inset-0 cursor-crosshair bg-black/20"
                  >
                    <div
                      className="absolute border-2 border-primary bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
                      style={{
                        left: `${config.crop.left}%`,
                        top: `${config.crop.top}%`,
                        width: `${config.crop.width}%`,
                        height: `${config.crop.height}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          <aside className="w-72 border-l border-border bg-card/50 p-4">
            <h3 className="text-sm font-semibold">Manual Drag Crop</h3>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Drag a box directly on the photo. Only this selected area will be used.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {selected.map((id, index) => (
                <button
                  key={id}
                  onClick={() => setActive(id)}
                  className={`rounded border p-2 text-[10px] ${active === id ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  Photo {index + 1}
                </button>
              ))}
            </div>
            {!config.croppedSrc ? (
              <button
                onClick={confirmCrop}
                disabled={config.crop.width < 1 || config.crop.height < 1}
                className="mt-4 w-full rounded bg-primary p-2 text-xs font-semibold text-primary-foreground disabled:opacity-40"
              >
                OK · Apply Crop
              </button>
            ) : (
              <button
                onClick={() => patchConfig({ croppedSrc: undefined, removedSrc: undefined })}
                className="mt-4 w-full rounded bg-primary/15 p-2 text-xs font-semibold text-primary"
              >
                Crop Again
              </button>
            )}
            <button
              onClick={() =>
                patchConfig({
                  crop: { left: 0, top: 0, width: 100, height: 100 },
                  croppedSrc: undefined,
                  removedSrc: undefined,
                })
              }
              className="mt-4 w-full rounded border border-border p-2 text-xs"
            >
              Reset Crop
            </button>
          </aside>
        </div>
        {nav}
      </div>
    );

  if (step === 2)
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex min-h-0 flex-1">
          <div className="flex flex-1 items-center justify-center bg-muted/20 p-6">
            {activeFile && (
              <div
                className="aspect-[7/9] h-[70%] overflow-hidden border-2 border-primary"
                style={{ backgroundColor: config.background }}
              >
                <img
                  src={config.removedSrc || config.croppedSrc || sourceOf(activeFile)}
                  className="h-full w-full object-cover"
                />
              </div>
            )}
          </div>
          <aside className="w-80 space-y-4 border-l border-border bg-card/50 p-4">
            <h3 className="text-sm font-semibold">Background</h3>
            <div className="grid grid-cols-2 gap-2">
              {selected.map((id, index) => (
                <button
                  key={id}
                  onClick={() => setActive(id)}
                  className={`rounded border p-2 text-[10px] ${active === id ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  Photo {index + 1}
                </button>
              ))}
            </div>
            <button
              onClick={removeBg}
              disabled={!!busy}
              className="flex w-full items-center justify-center gap-2 rounded bg-primary p-2 text-xs text-primary-foreground"
            >
              <Eraser className="h-4 w-4" />
              {busy || "Remove Background"}
            </button>
            <label className="flex items-center justify-between text-xs">
              Background colour
              <input
                type="color"
                value={config.background}
                onChange={(e) => patchConfig({ background: e.target.value })}
              />
            </label>
            {error && <p className="text-[10px] text-destructive">{error}</p>}
          </aside>
        </div>
        {nav}
      </div>
    );

  if (step === 3)
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex min-h-0 flex-1">
          <div className="flex flex-1 items-center justify-center bg-muted/20 p-6">
            {activeFile && (
              <div
                className="aspect-[7/9] h-[70%] overflow-hidden border-2 border-primary"
                style={{ backgroundColor: config.background }}
              >
                <img
                  src={config.removedSrc || config.croppedSrc || sourceOf(activeFile)}
                  className="h-full w-full object-cover"
                  style={{
                    filter: `brightness(${config.brightness}%) contrast(${config.contrast}%)`,
                    transform: `translate(${config.x}%, ${config.y}%) scale(${config.zoom})`,
                  }}
                />
              </div>
            )}
          </div>
          <aside className="w-80 space-y-3 overflow-y-auto border-l border-border bg-card/50 p-4">
            <h3 className="text-sm font-semibold">Photo Adjust</h3>
            <div className="grid grid-cols-2 gap-2">
              {selected.map((id, index) => (
                <button
                  key={id}
                  onClick={() => setActive(id)}
                  className={`rounded border p-2 text-[10px] ${active === id ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  Photo {index + 1}
                </button>
              ))}
            </div>
            {[
              ["Brightness", 50, 160, "brightness"],
              ["Contrast", 50, 160, "contrast"],
              ["Zoom", 100, 250, "zoom"],
              ["Left / Right", -40, 40, "x"],
              ["Up / Down", -40, 40, "y"],
            ].map(([label, min, max, key]) => (
              <label key={String(key)} className="block text-[10px]">
                {label}
                <input
                  type="range"
                  min={Number(min)}
                  max={Number(max)}
                  value={
                    key === "zoom"
                      ? config.zoom * 100
                      : (config[key as keyof PhotoConfig] as number)
                  }
                  onChange={(e) =>
                    patchConfig({ [key]: key === "zoom" ? +e.target.value / 100 : +e.target.value })
                  }
                  className="w-full accent-cyan-500"
                />
              </label>
            ))}
            <label className="block text-[10px]">
              Text below photo
              <input
                value={config.caption}
                onChange={(e) => patchConfig({ caption: e.target.value })}
                className="mt-1 w-full rounded border border-border bg-background p-2"
              />
            </label>
          </aside>
        </div>
        {nav}
      </div>
    );
  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto bg-muted/20 p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold">1. Select 1 to 4 photos</h3>
          <p className="text-[10px] text-muted-foreground">
            Editor crop/brightness/rotation is used first. Then frame each photo below.
          </p>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {images.map((file) => (
            <button
              key={file.id}
              onClick={() => toggle(file.id)}
              className={`overflow-hidden rounded border ${selected.includes(file.id) ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border bg-card"}`}
            >
              <img
                src={configs[file.id]?.removedSrc || sourceOf(file)}
                className="aspect-[3/4] w-full object-cover"
              />
              <div className="truncate p-1 text-[9px]">{file.name}</div>
            </button>
          ))}
        </div>
        {active && images.find((file) => file.id === active) && (
          <div className="mx-auto mt-5 w-[300px]">
            <div className="mb-2 text-center text-[11px] font-semibold">
              2. Select exact passport area
            </div>
            <div
              className="relative aspect-[7/9] overflow-hidden border-2 border-primary bg-white shadow-xl"
              style={{ backgroundColor: config.background }}
            >
              <img
                src={config.removedSrc || sourceOf(images.find((file) => file.id === active)!)}
                className="h-full w-full object-cover"
                style={{
                  filter: `brightness(${config.brightness}%)`,
                  transform: `translate(${config.x}%, ${config.y}%) scale(${config.zoom})`,
                }}
              />
              <div className="pointer-events-none absolute inset-0 border-[10px] border-black/15" />
              <div className="pointer-events-none absolute left-1/2 top-[12%] h-[48%] w-[54%] -translate-x-1/2 rounded-[50%] border border-dashed border-white/80" />
              {config.caption && (
                <div className="absolute inset-x-0 bottom-0 bg-white py-1 text-center text-xs font-semibold text-black">
                  {config.caption}
                </div>
              )}
            </div>
            <p className="mt-1 text-center text-[9px] text-muted-foreground">
              Only the area inside this frame will repeat in the final sheet.
            </p>
          </div>
        )}
      </div>
      <aside className="flex w-80 flex-col overflow-y-auto border-l border-border bg-card/50 p-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setStep(3)} className="rounded border border-border p-1">
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <div className="text-xs font-semibold">5. Layout Preview</div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(
            [
              ["4x6-8", "4×6 · 8"],
              ["a4-32", "A4 · 32"],
              ["a4-45", "A4 · 45"],
            ] as Array<[Preset, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setPreset(value)}
              className={`rounded border p-2 text-[10px] ${preset === value ? "border-primary bg-primary/10" : "border-border"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {active ? (
          <div className="mt-4 space-y-3 rounded border border-border bg-background/40 p-3">
            <div className="text-[10px] font-semibold">Selected photo settings</div>
            <button
              onClick={removeBg}
              disabled={!!busy}
              className="flex w-full items-center justify-center gap-2 rounded bg-primary/15 p-2 text-[10px] text-primary"
            >
              <Eraser className="h-3.5 w-3.5" />
              Remove Background
            </button>
            <label className="block text-[10px]">
              Background colour
              <input
                type="color"
                value={config.background}
                onChange={(e) => patchConfig({ background: e.target.value })}
                className="ml-3 h-7 w-14 align-middle"
              />
            </label>
            <label className="block text-[10px]">
              Text below photo
              <input
                value={config.caption}
                onChange={(e) => patchConfig({ caption: e.target.value })}
                placeholder="Name / Date / ID"
                className="mt-1 w-full rounded border border-border bg-background p-1.5"
              />
            </label>
            <label className="block text-[10px]">
              Brightness {config.brightness}%
              <input
                type="range"
                min="50"
                max="160"
                value={config.brightness}
                onChange={(e) => patchConfig({ brightness: +e.target.value })}
                className="w-full accent-cyan-500"
              />
            </label>
            <label className="block text-[10px]">
              Zoom {config.zoom.toFixed(2)}×
              <input
                type="range"
                min="1"
                max="2.5"
                step="0.02"
                value={config.zoom}
                onChange={(e) => patchConfig({ zoom: +e.target.value })}
                className="w-full accent-cyan-500"
              />
            </label>
            <label className="block text-[10px]">
              Left / Right
              <input
                type="range"
                min="-40"
                max="40"
                value={config.x}
                onChange={(e) => patchConfig({ x: +e.target.value })}
                className="w-full accent-cyan-500"
              />
            </label>
            <label className="block text-[10px]">
              Up / Down
              <input
                type="range"
                min="-40"
                max="40"
                value={config.y}
                onChange={(e) => patchConfig({ y: +e.target.value })}
                className="w-full accent-cyan-500"
              />
            </label>
          </div>
        ) : (
          <div className="mt-4 rounded border border-dashed border-border p-4 text-center text-[10px] text-muted-foreground">
            <ImagePlus className="mx-auto mb-2 h-5 w-5" />
            Select a photo to edit.
          </div>
        )}
        <div className="mt-3 space-y-2 rounded border border-border bg-background/40 p-3">
          <div className="text-[10px] font-semibold">3. Border & cutting space</div>
          <label className="block text-[10px]">
            Cutting gap: {gapMm} mm
            <input
              type="range"
              min="2"
              max="8"
              value={gapMm}
              onChange={(e) => setGapMm(+e.target.value)}
              className="w-full accent-cyan-500"
            />
          </label>
          <label className="block text-[10px]">
            Border: {borderWidth}px
            <input
              type="range"
              min="0"
              max="8"
              value={borderWidth}
              onChange={(e) => setBorderWidth(+e.target.value)}
              className="w-full accent-cyan-500"
            />
          </label>
          <label className="flex items-center justify-between text-[10px]">
            Border colour
            <input
              type="color"
              value={borderColor}
              onChange={(e) => setBorderColor(e.target.value)}
              className="h-6 w-12"
            />
          </label>
          <label className="flex items-center justify-between text-[10px]">
            Full black cutting lines
            <input
              type="checkbox"
              checked={cuttingMarks}
              onChange={(e) => setCuttingMarks(e.target.checked)}
              className="accent-cyan-500"
            />
          </label>
          <label className="flex items-center justify-between text-[10px]">
            Hide source photos after generate
            <input
              type="checkbox"
              checked={hideSources}
              onChange={(e) => setHideSources(e.target.checked)}
              className="accent-cyan-500"
            />
          </label>
          <label className="flex items-center justify-between text-[10px]">
            Save prepared single photos
            <input
              type="checkbox"
              checked={saveSingles}
              onChange={(e) => setSaveSingles(e.target.checked)}
              className="accent-cyan-500"
            />
          </label>
          <p className="text-[9px] text-muted-foreground">Black horizontal/vertical lines stay in the exact centre of the white gap. Cut directly on the line; photo borders remain protected.</p>
        </div>
        <div className="mt-auto pt-4">
          {error && <p className="mb-2 text-[10px] text-destructive">{error}</p>}
          <button
            onClick={generate}
            disabled={!selected.length || !!busy}
            className="flex w-full items-center justify-center gap-2 rounded bg-primary p-2 text-xs text-primary-foreground disabled:opacity-40"
          >
            <Sparkles className="h-4 w-4" />
            {busy ||
              `Generate ${preset === "4x6-8" ? "8" : preset === "a4-32" ? "32" : "45"} Photos`}
          </button>
        </div>
      </aside>
    </div>
  );
}


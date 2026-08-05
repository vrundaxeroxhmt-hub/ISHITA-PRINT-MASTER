import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export type PdfEnhanceSettings = {
  mode: "preserve" | "scan";
  crop: { left: number; top: number; right: number; bottom: number };
  deskew: number;
  brightness: number;
  contrast: number;
  darkness: number;
  treatment: "original" | "grayscale" | "bw";
  whiteBackground: number;
  cleanup: number;
  invert: boolean;
};

export const DEFAULT_PDF_ENHANCE: PdfEnhanceSettings = {
  mode: "preserve",
  crop: { left: 0, top: 0, right: 0, bottom: 0 },
  deskew: 0,
  brightness: 100,
  contrast: 100,
  darkness: 0,
  treatment: "original",
  whiteBackground: 0,
  cleanup: 0,
  invert: false,
};

function Range({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return <label className="block text-[10px]"><span className="mb-1 flex justify-between"><span>{label}</span><span className="text-primary">{value}</span></span><input className="w-full accent-cyan-400" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /></label>;
}

async function estimateDeskew(src: string) {
  const img = new Image(); img.src = src; await img.decode();
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight));
  canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d")!; ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let best = 0, bestScore = -1;
  for (let angle = -5; angle <= 5; angle += 0.25) {
    const rad = angle * Math.PI / 180, sin = Math.sin(rad), cos = Math.cos(rad);
    const bins = new Uint16Array(canvas.height + canvas.width);
    for (let y = 0; y < canvas.height; y += 3) for (let x = 0; x < canvas.width; x += 3) {
      const i = (y * canvas.width + x) * 4;
      if ((data[i] + data[i + 1] + data[i + 2]) / 3 < 150) {
        const row = Math.round(y * cos - x * sin + canvas.width / 2);
        if (row >= 0 && row < bins.length) bins[row]++;
      }
    }
    let score = 0; for (const count of bins) score += count * count;
    if (score > bestScore) { bestScore = score; best = -angle; }
  }
  return best;
}

export function PdfPageEnhanceDialog({ source, initial, onClose, onApply }: { source: string; initial?: PdfEnhanceSettings; onClose: () => void; onApply: (settings: PdfEnhanceSettings, all: boolean) => void }) {
  const [settings, setSettings] = useState(initial || DEFAULT_PDF_ENHANCE);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => { if (settings.mode === "preserve") setBox(null); }, [settings.mode]);
  const patch = (next: Partial<PdfEnhanceSettings>) => setSettings((s) => ({ ...s, ...next, mode: "scan" }));
  const finishBox = () => {
    if (!box || box.w < 5 || box.h < 5) return setBox(null);
    const el = imageRef.current!;
    patch({ crop: { left: box.x / el.clientWidth * 100, top: box.y / el.clientHeight * 100, right: 100 - (box.x + box.w) / el.clientWidth * 100, bottom: 100 - (box.y + box.h) / el.clientHeight * 100 } });
  };
  const filter = `brightness(${settings.brightness}%) contrast(${settings.contrast + settings.darkness}%) ${settings.treatment === "grayscale" || settings.treatment === "bw" ? "grayscale(1)" : ""} ${settings.invert ? "invert(1)" : ""}`;
  return <div className="absolute inset-0 z-[70] flex bg-black/85">
    <div className="flex min-w-0 flex-1 flex-col p-4"><div className="mb-2 flex items-center text-sm font-semibold">PDF Page Editor <span className="ml-2 text-[10px] font-normal text-muted-foreground">Drag a rectangle for Manual Border Crop</span></div><div className="relative min-h-0 flex-1 select-none overflow-hidden rounded border border-border bg-neutral-900 p-3"><div className="relative mx-auto h-full w-fit max-w-full" onPointerDown={(e) => { if (settings.mode !== "scan") return; const r = e.currentTarget.getBoundingClientRect(); const x=e.clientX-r.left,y=e.clientY-r.top; setDrag({x,y}); setBox({x,y,w:0,h:0}); }} onPointerMove={(e) => { if (!drag) return; const r=e.currentTarget.getBoundingClientRect(); const x=Math.max(0,Math.min(r.width,e.clientX-r.left)),y=Math.max(0,Math.min(r.height,e.clientY-r.top)); setBox({x:Math.min(drag.x,x),y:Math.min(drag.y,y),w:Math.abs(x-drag.x),h:Math.abs(y-drag.y)}); }} onPointerUp={() => { setDrag(null); finishBox(); }}>
      <img
  ref={imageRef}
  src={source}
  className="h-full max-w-full object-contain"
  style={{
    filter,
    transform: `rotate(${settings.deskew}deg)`,
    clipPath: `inset(
      ${settings.crop.top}%
      ${settings.crop.right}%
      ${settings.crop.bottom}%
      ${settings.crop.left}%
    )`,
  }}
  alt="PDF page"
/>
      {box && <div className="pointer-events-none absolute border-2 border-cyan-400 bg-cyan-400/10" style={{left:box.x,top:box.y,width:box.w,height:box.h}} />}</div></div></div>
    <aside className="w-[290px] overflow-auto border-l border-border bg-card p-4"><div className="mb-3 flex items-center"><h3 className="text-sm font-semibold">Crop / Deskew / Enhance</h3><button onClick={onClose} className="ml-auto"><X className="h-4 w-4" /></button></div>
      <div className="mb-3 grid grid-cols-2 gap-1"><button onClick={() => setSettings(DEFAULT_PDF_ENHANCE)} className={`rounded border p-2 text-[10px] ${settings.mode === "preserve" ? "border-primary text-primary" : "border-border"}`}>Preserve Quality</button><button onClick={() => patch({})} className={`rounded border p-2 text-[10px] ${settings.mode === "scan" ? "border-primary text-primary" : "border-border"}`}>Scan Enhancement</button></div>
      <div className="space-y-3"><button onClick={() => patch({ invert: !settings.invert })} className={`w-full rounded border py-2 text-[10px] ${settings.invert ? "border-primary bg-primary/15 text-primary" : "border-border"}`}>{settings.invert ? "Negative Invert: ON" : "Make Black Background White"}</button><button onClick={async () => patch({ deskew: await estimateDeskew(source) })} className="w-full rounded border border-border py-1.5 text-[10px]">Auto Deskew</button>
      <Range
  label="Crop Left %"
  value={settings.crop.left}
  min={0}
  max={45}
  step={0.5}
  onChange={(value) =>
    patch({
      crop: {
        ...settings.crop,
        left: Math.min(value, 95 - settings.crop.right),
      },
    })
  }
/>

<Range
  label="Crop Right %"
  value={settings.crop.right}
  min={0}
  max={45}
  step={0.5}
  onChange={(value) =>
    patch({
      crop: {
        ...settings.crop,
        right: Math.min(value, 95 - settings.crop.left),
      },
    })
  }
/>

<Range
  label="Crop Top %"
  value={settings.crop.top}
  min={0}
  max={45}
  step={0.5}
  onChange={(value) =>
    patch({
      crop: {
        ...settings.crop,
        top: Math.min(value, 95 - settings.crop.bottom),
      },
    })
  }
/>

<Range
  label="Crop Bottom %"
  value={settings.crop.bottom}
  min={0}
  max={45}
  step={0.5}
  onChange={(value) =>
    patch({
      crop: {
        ...settings.crop,
        bottom: Math.min(value, 95 - settings.crop.top),
      },
    })
  }
/>
      <Range label="Fine Deskew °" value={settings.deskew} min={-10} max={10} step={0.1} onChange={(v) => patch({deskew:v})} /><Range label="Brightness" value={settings.brightness} min={50} max={160} onChange={(v) => patch({brightness:v})} /><Range label="Contrast" value={settings.contrast} min={50} max={200} onChange={(v) => patch({contrast:v})} /><Range label="Print Darkness" value={settings.darkness} min={0} max={100} onChange={(v) => patch({darkness:v})} /><Range label="Background Whitening" value={settings.whiteBackground} min={0} max={100} onChange={(v) => patch({whiteBackground:v})} /><Range label="Noise / Spot Cleanup" value={settings.cleanup} min={0} max={100} onChange={(v) => patch({cleanup:v})} />
      <div className="grid grid-cols-3 gap-1">{(["original","grayscale","bw"] as const).map((t) => <button key={t} onClick={() => patch({treatment:t})} className={`rounded border p-1.5 text-[9px] ${settings.treatment===t?"border-primary text-primary":"border-border"}`}>{t === "bw" ? "B & W" : t}</button>)}</div>
      <button onClick={() => { setSettings((s) => ({...s,crop:{left:0,top:0,right:0,bottom:0}})); setBox(null); }} className="w-full rounded border border-border py-1.5 text-[10px]">Reset Manual Crop</button>
      <div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => onApply(settings,false)} className="rounded bg-primary p-2 text-[10px] text-primary-foreground">Apply Current</button><button onClick={() => onApply(settings,true)} className="rounded border border-primary p-2 text-[10px] text-primary">Apply All Pages</button></div></div>
    </aside>
  </div>;
}

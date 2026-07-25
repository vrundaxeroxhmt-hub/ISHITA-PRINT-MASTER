import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CreditCard, Plus, RotateCw, Sparkles, X } from "lucide-react";
import type { PrintFile } from "@/lib/mock-data";
import type { MultiLayoutState } from "./MultiPageLayout";

const PAGE_W = 2480;
const PAGE_H = 3508;
const CARD_W = 1011; // 85.6 mm at 300 DPI
const CARD_H = 638;  // 54 mm at 300 DPI
const COLS = 2;
const ROWS = 5;
const PER_PAGE = COLS * ROWS;
const GAP_X = 90;
const GAP_Y = 42;

export type PvcLayoutState = MultiLayoutState & {
  layoutKind: "pvc";
  cardCount: number;
  slots: Array<string | null>;
  rotations: number[];
  cuttingMarks: boolean;
};

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image(); image.crossOrigin = "anonymous"; image.onload = () => resolve(image); image.onerror = reject; image.src = src;
});

export function PvcCardLayout({ files, initialState, initialPreview, onGenerate }: {
  files: PrintFile[];
  initialState?: PvcLayoutState;
  initialPreview?: string;
  onGenerate: (pages: string[], state: PvcLayoutState) => Promise<void>;
}) {
  const images = useMemo(() => files.filter((file) => file.kind === "image" && file.src && !file.layoutType), [files]);
  const [cardCount, setCardCount] = useState(initialState?.cardCount ?? 1);
  const [slots, setSlots] = useState<Array<string | null>>(() => initialState?.slots ?? [null, null]);
  const [rotations, setRotations] = useState<number[]>(() => initialState?.rotations ?? Array((initialState?.slots ?? [null, null]).length).fill(0));
  const [cuttingMarks, setCuttingMarks] = useState(initialState?.cuttingMarks ?? true);
  const [picker, setPicker] = useState<number | null>(null);
  const [step, setStep] = useState(initialState ? 2 : 0);
  const [pages, setPages] = useState<string[]>(initialPreview ? [initialPreview] : []);
  const [pageIndex, setPageIndex] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const byId = useMemo(() => new Map(images.map((file) => [file.id, file])), [images]);

  const changeCount = (value: number) => {
    const count = Math.max(1, Math.min(20, value));
    setCardCount(count);
    setSlots((current) => Array.from({ length: count * 2 }, (_, index) => current[index] ?? null));
    setRotations((current) => Array.from({ length: count * 2 }, (_, index) => current[index] ?? 0));
    setPages([]);
  };
  const assign = (index: number, id: string) => { setSlots((current) => current.map((value, i) => i === index ? id : value)); setPicker(null); setPages([]); };
  const rotateSlot = (index: number) => { setRotations((current) => current.map((value, i) => i === index ? (value + 90) % 360 : value)); setPages([]); };
  const build = async () => {
    if (slots.some((id) => !id)) { setError("Assign an image to every front/back block."); return; }
    setBusy("Building 300 DPI pages..."); setError("");
    try {
      const output: string[] = [];
      for (let offset = 0; offset < slots.length; offset += PER_PAGE) {
        const canvas = document.createElement("canvas"); canvas.width = PAGE_W; canvas.height = PAGE_H;
        const ctx = canvas.getContext("2d")!; ctx.fillStyle = "white"; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
        const gridW = COLS * CARD_W + GAP_X; const gridH = ROWS * CARD_H + (ROWS - 1) * GAP_Y;
        const left = (PAGE_W - gridW) / 2; const top = (PAGE_H - gridH) / 2;
        const pageSlots = slots.slice(offset, offset + PER_PAGE);
        for (let index = 0; index < pageSlots.length; index++) {
          const file = byId.get(pageSlots[index]!); const src = file?.workingSrc || file?.src || file?.livePreview; if (!src) continue;
          const image = await loadImage(src); const x = left + (index % COLS) * (CARD_W + GAP_X); const y = top + Math.floor(index / COLS) * (CARD_H + GAP_Y);
          let source: CanvasImageSource = image; let sourceWidth = image.naturalWidth; let sourceHeight = image.naturalHeight;
          const manualRotation = rotations[offset + index] ?? 0;
          const rotation = manualRotation || (image.naturalHeight > image.naturalWidth ? 90 : 0);
          if (rotation) {
            const sideways = rotation % 180 !== 0;
            const rotated = document.createElement("canvas"); rotated.width = sideways ? image.naturalHeight : image.naturalWidth; rotated.height = sideways ? image.naturalWidth : image.naturalHeight;
            const rotatedCtx = rotated.getContext("2d")!; rotatedCtx.translate(rotated.width / 2, rotated.height / 2); rotatedCtx.rotate(rotation * Math.PI / 180); rotatedCtx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
            source = rotated; sourceWidth = rotated.width; sourceHeight = rotated.height;
          }
          ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, x, y, CARD_W, CARD_H);
          if (cuttingMarks) { ctx.strokeStyle = "#111"; ctx.lineWidth = 3; ctx.strokeRect(x, y, CARD_W, CARD_H); }
        }
        output.push(canvas.toDataURL("image/png"));
      }
      setPages(output); setPageIndex(0); setStep(2);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "PVC preview failed"); }
    finally { setBusy(""); }
  };
  const generate = async () => {
    if (!pages.length) return; setBusy("Saving PVC pages...");
    try { await onGenerate(pages, { layoutKind: "pvc", cardCount, slots, rotations, cuttingMarks, sourceFileIds: [...new Set(slots.filter(Boolean) as string[])], copies: {}, rows: ROWS, columns: COLS, orientation: "portrait", gap: GAP_Y, keepSources: true }); }
    finally { setBusy(""); }
  };

  return <div className="flex h-full min-h-0">
    <main className="min-w-0 flex-1 overflow-y-auto bg-muted/20 p-4">
      {step < 2 ? <div className="grid grid-cols-4 gap-3">{slots.map((id, index) => { const file = id ? byId.get(id) : null; return <div key={index} className="overflow-hidden rounded border border-border bg-card"><button onClick={() => setPicker(index)} className="flex aspect-[1.585/1] w-full items-center justify-center overflow-hidden bg-black/20">{file ? <img src={file.livePreview || file.workingSrc || file.src} style={{ transform: `rotate(${rotations[index] || 0}deg)` }} className="h-full w-full object-fill" alt=""/> : <Plus className="h-5 w-5 text-primary"/>}</button><div className="flex items-center gap-1 p-1.5 text-[9px]"><b className="min-w-0 flex-1 truncate">Card {Math.floor(index / 2) + 1} · {index % 2 ? "Back" : "Front"}</b>{id && <button onClick={() => rotateSlot(index)} className="inline-flex items-center gap-0.5 rounded border px-1 py-0.5" title="Rotate this block 90 degrees"><RotateCw className="h-2.5 w-2.5"/>Rotate</button>}{index > 0 && <button onClick={() => slots[index - 1] && assign(index, slots[index - 1]!)} className="rounded border px-1 py-0.5">Repeat</button>}{id && <button onClick={() => assign(index, "")}><X className="h-3 w-3"/></button>}</div></div>; })}</div> : pages.length > 0 ? <div><div className="mb-2 text-center text-xs">PVC A4 Preview · Page {pageIndex + 1}/{pages.length}</div><img src={pages[pageIndex]} className="mx-auto max-h-[72vh] border border-border object-contain shadow-xl" alt="PVC page"/><div className="mt-2 flex justify-center gap-2"><button disabled={!pageIndex} onClick={() => setPageIndex((value) => value - 1)} className="rounded border px-3 py-1 text-xs disabled:opacity-30">Previous</button><button disabled={pageIndex >= pages.length - 1} onClick={() => setPageIndex((value) => value + 1)} className="rounded border px-3 py-1 text-xs disabled:opacity-30">Next</button></div></div> : null}
    </main>
    <aside className="flex w-72 flex-col border-l border-border bg-card/50 p-3"><div className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-primary"/><b className="text-sm">PVC Card Print</b></div><p className="mt-1 text-[9px] text-muted-foreground">Fixed 85.6 × 54 mm · 300 DPI · 10 blocks per A4</p>
      <div className="mt-4"><label className="text-[10px] font-medium">Number of cards</label><div className="mt-1 grid grid-cols-3 gap-1">{[1,2,3].map((count) => <button key={count} onClick={() => changeCount(count)} className={`rounded border py-2 text-[10px] ${cardCount === count ? "border-primary bg-primary/15 text-primary" : "border-border"}`}>{count} Card<br/>{count * 2} Blocks</button>)}</div><input type="number" min="1" max="20" value={cardCount} onChange={(event) => changeCount(+event.target.value)} className="mt-2 w-full rounded border border-border bg-background p-1.5 text-xs"/></div>
      <div className="mt-3 rounded border border-border bg-background/40 p-2 text-[10px]"><b>{slots.length} blocks · {Math.ceil(slots.length / PER_PAGE)} A4 page(s)</b><span className="block text-[9px] text-muted-foreground">Extra cards automatically continue on the next page.</span><span className="mt-1 block text-[9px] text-primary">Auto-rotate portrait images to landscape: ON</span></div>
      <label className="mt-3 flex items-center justify-between rounded border border-border p-2 text-[10px]"><span>Black cutting border</span><input type="checkbox" checked={cuttingMarks} onChange={(event) => { setCuttingMarks(event.target.checked); setPages([]); }} className="accent-cyan-500"/></label>
      {error && <p className="mt-2 text-[10px] text-destructive">{error}</p>}<div className="mt-auto flex gap-2"><button onClick={() => { setStep(0); setPages([]); }} disabled={step === 0 || !!busy} className="inline-flex items-center gap-1 rounded border px-3 py-2 text-xs disabled:opacity-30"><ArrowLeft className="h-3 w-3"/>Back</button>{step < 2 ? <button onClick={() => void build()} disabled={!!busy} className="ml-auto inline-flex items-center gap-1 rounded bg-primary px-3 py-2 text-xs text-primary-foreground">{busy || "Preview"}<ArrowRight className="h-3 w-3"/></button> : <button onClick={() => void generate()} disabled={!!busy} className="ml-auto inline-flex items-center gap-1 rounded bg-primary px-3 py-2 text-xs text-primary-foreground"><Sparkles className="h-3 w-3"/>{busy || "Generate 300 DPI"}</button>}</div>
    </aside>
    {picker !== null && <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6" onClick={() => setPicker(null)}><div className="max-h-[75vh] w-[620px] overflow-y-auto rounded border border-border bg-card p-3" onClick={(event) => event.stopPropagation()}><div className="mb-3 flex"><b className="text-sm">Select Card {Math.floor(picker / 2) + 1} · {picker % 2 ? "Back" : "Front"}</b><button onClick={() => setPicker(null)} className="ml-auto"><X className="h-4 w-4"/></button></div><div className="grid grid-cols-5 gap-2">{images.map((file) => <button key={file.id} onClick={() => assign(picker, file.id)} className="overflow-hidden rounded border border-border hover:border-primary"><img src={file.livePreview || file.workingSrc || file.src} className="aspect-square w-full object-cover" alt=""/><div className="truncate p-1 text-[8px]">{file.name}</div></button>)}</div></div></div>}
  </div>;
}

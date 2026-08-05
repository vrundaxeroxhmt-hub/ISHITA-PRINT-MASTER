import { FileText, Image as ImageIcon, RotateCcw, Trash2 } from "lucide-react";
import { getFileSource, type PrintFile } from "@/lib/mock-data";

export function FileThumb({
  file,
  selected,
  onClick,
  onResetOriginal,
  checked,
  onCheck,
  onDelete,
}: {
  file: PrintFile;
  selected?: boolean;
  onClick?: () => void;
  onResetOriginal?: () => void;
  checked?: boolean;
  onCheck?: (checked: boolean) => void;
  onDelete?: () => void;
}) {
  const isPdf = file.kind === "pdf";
  const previewUrl = file.livePreview || file.thumbUrl || getFileSource(file);
  return (
    <button
      onClick={onClick}
      className={`group relative aspect-square overflow-hidden rounded-md border transition-all ${
        selected
          ? "border-primary ring-2 ring-primary/40"
          : "border-border hover:border-primary/50"
      }`}
    >
      <div
        className={`flex h-full w-full items-center justify-center ${
          isPdf ? "bg-gradient-to-br from-rose-900/40 to-rose-950/60" : "bg-gradient-to-br from-sky-900/40 to-slate-900/60"
        }`}
      >
        {previewUrl && (!isPdf || file.livePreview) ? (
          <img
            src={previewUrl}
            alt={file.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : isPdf ? (
          <FileText className="h-8 w-8 text-rose-300/70" />
        ) : (
          <ImageIcon className="h-8 w-8 text-sky-300/70" />
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-0.5 text-[9px] text-white/90 truncate">
        {file.name}
      </div>
      {isPdf && file.pages ? (
        <div className="absolute top-1 right-1 rounded bg-black/60 px-1 text-[9px] text-white">
          {file.pages}p
        </div>
      ) : null}
      {onCheck && <span role="checkbox" aria-checked={checked} onClick={(event) => { event.stopPropagation(); onCheck(!checked); }} className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded border-2 text-[12px] font-bold shadow ${checked ? "border-primary bg-primary text-primary-foreground" : "border-white/80 bg-black/50 text-transparent"}`}>✓</span>}
      {(file.originalFileId || file.workingSrc || file.layoutType === "multiPage" || file.layoutType === "passport") && onResetOriginal ? (
        <span
          role="button"
          title={file.layoutType === "multiPage" ? "Reset multi layout" : "Reset to original"}
          onClick={(event) => { event.stopPropagation(); onResetOriginal(); }}
          className="absolute left-1 top-1 inline-flex items-center gap-1 rounded bg-amber-500/90 px-1.5 py-1 text-[9px] font-medium text-black shadow hover:bg-amber-400"
        >
          <RotateCcw className="h-3 w-3" /> Reset
        </span>
      ) : null}
      {onDelete && <span role="button" title="Delete this file" onClick={(event) => { event.stopPropagation(); onDelete(); }} className="absolute bottom-6 right-1 inline-flex h-6 w-6 items-center justify-center rounded bg-red-600/90 text-white opacity-0 shadow transition-opacity hover:bg-red-500 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></span>}
    </button>
  );
}

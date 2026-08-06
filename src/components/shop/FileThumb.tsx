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
      className={`group relative aspect-square overflow-hidden rounded-xl border transition-all duration-150 shadow-xs ${
        selected
          ? "border-primary ring-2 ring-primary/60 shadow-md shadow-purple-950/50 scale-[1.02]"
          : "border-border/80 hover:border-primary/50 hover:shadow-sm"
      }`}
    >
      <div
        className={`flex h-full w-full items-center justify-center ${
          isPdf ? "bg-gradient-to-br from-rose-950/60 to-purple-950/80" : "bg-gradient-to-br from-purple-950/50 to-slate-900/80"
        }`}
      >
        {previewUrl && (!isPdf || file.livePreview) ? (
          <img
            src={previewUrl}
            alt={file.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : isPdf ? (
          <FileText className="h-8 w-8 text-rose-300/80 drop-shadow-sm" />
        ) : (
          <ImageIcon className="h-8 w-8 text-purple-300/80 drop-shadow-sm" />
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-2 pb-1 pt-3 text-[9px] font-medium text-white/95 truncate">
        {file.name}
      </div>
      {isPdf && file.pages ? (
        <div className="absolute top-1.5 right-1.5 rounded-md bg-black/70 backdrop-blur-sm px-1.5 py-0.2 text-[9px] font-semibold text-rose-200 border border-white/10">
          {file.pages}p
        </div>
      ) : null}
      {onCheck && (
        <span
          role="checkbox"
          aria-checked={checked}
          onClick={(event) => { event.stopPropagation(); onCheck(!checked); }}
          className={`absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-lg border-2 text-[11px] font-bold transition-all shadow-md ${
            checked
              ? "border-primary bg-primary text-primary-foreground scale-105"
              : "border-white/70 bg-black/40 text-transparent hover:border-white"
          }`}
        >
          ✓
        </span>
      )}
      {(file.originalFileId || file.workingSrc || file.layoutType === "multiPage" || file.layoutType === "passport") && onResetOriginal ? (
        <span
          role="button"
          title={file.layoutType === "multiPage" ? "Reset multi layout" : "Reset to original"}
          onClick={(event) => { event.stopPropagation(); onResetOriginal(); }}
          className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-md bg-amber-500/90 backdrop-blur-xs px-1.5 py-0.5 text-[9px] font-bold text-black shadow-md hover:bg-amber-400 transition-colors"
        >
          <RotateCcw className="h-3 w-3" /> Reset
        </span>
      ) : null}
      {onDelete && (
        <span
          role="button"
          title="Delete this file"
          onClick={(event) => { event.stopPropagation(); onDelete(); }}
          className="absolute bottom-6 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-lg bg-rose-600/90 text-white opacity-0 shadow-md transition-all hover:bg-rose-500 group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </span>
      )}
    </button>
  );
}

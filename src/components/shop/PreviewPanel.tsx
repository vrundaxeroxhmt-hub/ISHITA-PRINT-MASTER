import { useCallback, useEffect, useRef, useState } from "react";
import { Printer, Save, Share2, Wrench, Layers, X } from "lucide-react";
import {
  getFileSource,
  type JobCard,
  type PrintFile,
} from "@/lib/mock-data";
import { ImageEditor } from "./editor/ImageEditor";
import { PdfEditor } from "./editor/PdfEditor";
import { AadhaarLayout, type AadhaarLayoutState } from "./editor/AadhaarLayout";
import { createPhotoPrintPdf, openPrintWindow, printPdfBytes, type PhotoPrintLayout } from "./printSingleFile";
import { MultiPageLayout, type MultiLayoutState } from "./editor/MultiPageLayout";
import { PassportPhotoLayout, type PassportLayoutState } from "./editor/PassportPhotoLayout";
import { PvcCardLayout, type PvcLayoutState } from "./editor/PvcCardLayout";
import Swal from "sweetalert2";

type Mode = "editor" | "aadhaar" | "multi" | "passport" | "pvc";

export function PreviewPanel({
  file,
  customerImages,
  customerFiles,
  onHideImage,
  onUnhideImage,
  onGeneratedImage,
  onGeneratedMulti,
  onGeneratedPassport,
  customerId,
  onFilePreview,
  onPrinted,
  onUnbindLayout,
  onSelectSource,
  onJobsChanged,
}: {
 
  file: PrintFile | null;
  customerImages: PrintFile[];
  customerFiles: PrintFile[];
  onSelectSource?: (fileId: string, source: "original" | "processed") => Promise<void>;
  onHideImage: (id: string) => void;
  onUnhideImage: (id: string) => void;
  onGeneratedImage: (dataUrl: string, name: string, state: AadhaarLayoutState) => void;
  onGeneratedMulti: (pages: string[], state: MultiLayoutState) => Promise<void>;
  onGeneratedPassport: (
    page: string,
    state: PassportLayoutState,
    singles: Array<{ id: string; dataUrl: string }>
  ) => Promise<void>;
  customerId: string | null;
  onFilePreview: (fileId: string, dataUrl: string, appliedCrop?: boolean) => void;
  onPrinted: (fileId: string) => void | Promise<void>;
  onUnbindLayout: (fileId: string) => Promise<void>;
  onJobsChanged: (jobs: JobCard[]) => void;
}) {
  const [mode, setMode] = useState<Mode>("editor");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [printOpen, setPrintOpen] = useState(false);
  const [printLayout, setPrintLayout] = useState<PhotoPrintLayout>("full");
  const [repeatPrint, setRepeatPrint] = useState(true);
  const [printing, setPrinting] = useState(false);
  const saveHandler = useRef<
  (() => Promise<JobCard[]>) | null
>(null);
  const pdfOutputHandler = useRef<(() => Promise<Uint8Array>) | null>(null);
  const openGeneratedInEditor = useRef(false);
  const registerSave = useCallback(
  (handler: (() => Promise<JobCard[]>) | null) => {
    saveHandler.current = handler;
  },
  [],
);
  const registerPdfOutput = useCallback(
  (handler: (() => Promise<Uint8Array>) | null) => {
    pdfOutputHandler.current = handler;
  },
  [],
);
  const updateLivePreview = useCallback((dataUrl: string, appliedCrop?: boolean) => {
    if (file) onFilePreview(file.id, dataUrl, appliedCrop);
  }, [file?.id, onFilePreview]);
  useEffect(() => {
    if (!file) return;
    if (openGeneratedInEditor.current) { openGeneratedInEditor.current = false; setMode("editor"); return; }
    setMode(file.layoutType === "aadhaar130" ? "aadhaar" : file.layoutType === "multiPage" ? ((file.multiLayout as PvcLayoutState | undefined)?.layoutKind === "pvc" ? "pvc" : "multi") : "editor");
  }, [file?.id, file?.layoutType]);
  const saveProcessed = async () => {
  if (!saveHandler.current || saving) return;

  setSaving(true);
  setSaveMessage("");

  Swal.fire({
    title: "Saving changes...",
    text: "Please wait while the edited PDF is saved.",
    allowOutsideClick: false,
    allowEscapeKey: false,
    didOpen: () => {
      Swal.showLoading();
    },
  });

  try {
    const updatedJobs = await saveHandler.current();

    if (!Array.isArray(updatedJobs)) {
      throw new Error("Updated job list was not returned.");
    }

    onJobsChanged(updatedJobs);
    setSaveMessage("Changes saved");

    await Swal.fire({
      icon: "success",
      title: "Changes Saved",
      text: "The latest edited PDF is now active in the workspace and job list.",
      timer: 1800,
      showConfirmButton: false,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Save failed";

    setSaveMessage(message);

    await Swal.fire({
      icon: "error",
      title: "Save Failed",
      text: message,
      confirmButtonText: "OK",
    });
  } finally {
    setSaving(false);
  }
};
  const changeMode = async (nextMode: Mode) => {
    if (nextMode === mode) return;
    if (mode === "editor" && file?.kind === "image" && saveHandler.current && !saving) {
      setSaving(true); setSaveMessage("Saving high-resolution master...");
      try { await saveHandler.current(); setSaveMessage("High-resolution master saved"); }
      catch (error) { setSaveMessage(error instanceof Error ? error.message : "Auto-save failed"); setSaving(false); return; }
      finally { setSaving(false); }
    }
    setMode(nextMode);
  };
  const printSelected = async () => {
  if (!file || printing) return;

  const activeSrc = getFileSource(file);

  if (file.kind !== "pdf" && !activeSrc) return;

  let printWindow: Window | null;

  try {
    printWindow = openPrintWindow();
  } catch (error) {
    setSaveMessage(
      error instanceof Error
        ? error.message
        : "Print window was blocked",
    );
    return;
  }

  setPrinting(true);
  setSaveMessage("");

  try {
    if (file.kind === "pdf") {
      if (!pdfOutputHandler.current) {
        throw new Error(
          "PDF editor is still preparing the live output.",
        );
      }

      const bytes = await pdfOutputHandler.current();

      printPdfBytes(bytes, printWindow);
    } else {
      const bytes = await createPhotoPrintPdf(
        file,
        printLayout,
        repeatPrint,
      );

      printPdfBytes(bytes, printWindow);
    }

    setPrintOpen(false);

    await onPrinted(file.id);
  } catch (error) {
    printWindow?.close();

    setSaveMessage(
      error instanceof Error
        ? error.message
        : "Print preparation failed",
    );
    await Swal.fire({
  icon: "error",
  title: "Print Failed",
  text:
    error instanceof Error
      ? error.message
      : "Print preparation failed",
  confirmButtonText: "OK",
});
  } finally {
    setPrinting(false);
  }
};

  const Tabs = (
    <div className="flex items-center gap-1 rounded-md border border-border bg-background/60 p-0.5">
      <button
        onClick={() => void changeMode("editor")}
        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${mode === "editor" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
      >
        <Wrench className="h-3 w-3" /> Editor
      </button>
      <button
        onClick={() => void changeMode("aadhaar")}
        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${mode === "aadhaar" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
      >
        <Layers className="h-3 w-3" /> Aadhaar 130%
      </button>
      <button onClick={() => void changeMode("multi")} className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${mode === "multi" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}><Layers className="h-3 w-3" /> Multi Layout</button>
      <button onClick={() => void changeMode("passport")} className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${mode === "passport" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}><Layers className="h-3 w-3" /> Passport Photo</button>
      <button onClick={() => void changeMode("pvc")} className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${mode === "pvc" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}><Layers className="h-3 w-3" /> PVC Card</button>
    </div>
  );

  if (mode === "multi") return <div className="flex h-full flex-col"><div className="flex items-center gap-2 border-b border-border p-3"><h2 className="text-sm font-semibold">Multi Image / PDF Layout</h2><div className="ml-auto">{Tabs}</div></div><div className="relative min-h-0 flex-1 overflow-hidden"><MultiPageLayout key={file?.layoutType === "multiPage" ? file.id : `new-${customerId}`} files={customerFiles} initialState={file?.layoutType === "multiPage" ? file.multiLayout as MultiLayoutState : undefined} initialPreview={file?.layoutType === "multiPage" ? file.src : undefined} onGenerate={async (pages,state) => { openGeneratedInEditor.current=true; await onGeneratedMulti(pages,state); setMode("editor"); }} /></div></div>;
  if (mode === "passport") return <div className="flex h-full flex-col"><div className="flex items-center gap-2 border-b border-border p-3"><h2 className="text-sm font-semibold">Passport Photo Studio</h2><div className="ml-auto">{Tabs}</div></div><div className="relative min-h-0 flex-1 overflow-hidden"><PassportPhotoLayout key={file?.layoutType === "passport" ? file.id : `new-${customerId}`} files={customerFiles} initialState={file?.layoutType === "passport" ? file.passportLayout as PassportLayoutState : undefined} onGenerate={async (page, state, singles) => { await onGeneratedPassport(page, state, singles); setMode("editor"); }} /></div></div>;
  if (mode === "pvc") { const pvcState = file?.layoutType === "multiPage" && (file.multiLayout as PvcLayoutState | undefined)?.layoutKind === "pvc" ? file.multiLayout as PvcLayoutState : undefined; return <div className="flex h-full flex-col"><div className="flex items-center gap-2 border-b border-border p-3"><h2 className="text-sm font-semibold">PVC Card Print</h2><div className="ml-auto">{Tabs}</div></div><div className="relative min-h-0 flex-1 overflow-hidden"><PvcCardLayout key={pvcState ? file!.id : `new-pvc-${customerId}`} files={customerFiles} initialState={pvcState} initialPreview={pvcState ? file?.src : undefined} onGenerate={async (pages,state) => { openGeneratedInEditor.current=true; await onGeneratedMulti(pages,state); setMode("editor"); }}/></div></div>; }

  if (mode === "aadhaar") {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <h2 className="text-sm font-semibold">Aadhaar Smart Layout</h2>
          <div className="ml-auto">{Tabs}</div>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <AadhaarLayout
            key={`${customerId || "no-customer"}:${file?.layoutType === "aadhaar130" ? file.id : "new"}`}
            availableImages={customerImages}
            onHide={onHideImage}
            onUnhide={onUnhideImage}
            onGenerate={async (dataUrl,name,state) => { openGeneratedInEditor.current=true; await onGeneratedImage(dataUrl,name,state); setMode("editor"); }}
            initialState={file?.layoutType === "aadhaar130" ? file.aadhaarLayout : undefined}
            initialGeneratedSrc={file?.layoutType === "aadhaar130" ? file.src : undefined}
          />
        </div>
      </div>
    );
  }

  if (!file) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <h2 className="text-sm font-semibold">Preview & Tools</h2>
          <div className="ml-auto">{Tabs}</div>
        </div>
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
          Select a file from a job card to preview and edit.
        </div>
      </div>
    );
  }

  const isPdf = file.kind === "pdf";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{file.name}</h2>
          <p className="text-[10px] text-muted-foreground">
            {isPdf ? `PDF · ${file.pages} pages` : "Image"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {Tabs}
          {(file.layoutType === "multiPage" || file.layoutType === "aadhaar130" || /^Unbound_(?:Multi|Aadhaar)/.test(file.name)) && <button onClick={async () => { if (!window.confirm("Remove all generated layout pages and return to the original single files?")) return; await onUnbindLayout(file.id); setMode("editor"); }} className="inline-flex items-center gap-1 rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-500/20">Unbind / Remove Layout</button>}
          <button onClick={saveProcessed} disabled={saving || !customerId} className="inline-flex items-center gap-1 rounded-md border border-border bg-accent/40 px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-50">
            <Save className="h-3 w-3" /> {saving ? "Saving..." : "Save Changes"}
          </button>
          <button className="inline-flex items-center gap-1 rounded-md border border-border bg-accent/40 px-2 py-1 text-[11px] hover:bg-accent">
            <Share2 className="h-3 w-3" /> Export
          </button>
          <button onClick={() => file.kind === "pdf" ? void printSelected() : setPrintOpen(true)} disabled={printing} className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            <Printer className="h-3 w-3" /> Print
          </button>
        </div>
      </div>
      {saveMessage && <div className="border-b border-border bg-primary/10 px-3 py-1 text-[10px] text-primary">{saveMessage}</div>}
      <div className="min-h-0 flex-1 overflow-hidden">
        {isPdf ? (
  <PdfEditor
    file={file}
    chatFiles={customerFiles}
    contactId={customerId || ""}
    onLivePreview={updateLivePreview}
    onSaveHandler={registerSave}
    onOutputHandler={registerPdfOutput}
  />
) : (
  <ImageEditor
    file={file}
    contactId={customerId || ""}
    onLivePreview={updateLivePreview}
    onSaveHandler={registerSave}
    onSelectSource={onSelectSource}
  />
)}
      </div>
      {printOpen && <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/65 p-6" onClick={() => setPrintOpen(false)}>
        <div className="w-[460px] rounded-lg border border-border bg-card p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center"><div><h3 className="text-sm font-semibold">Print Selected Image</h3><p className="text-[10px] text-muted-foreground">Choose A4 photo layout</p></div><button onClick={() => setPrintOpen(false)} className="ml-auto rounded p-1 hover:bg-accent"><X className="h-4 w-4" /></button></div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {([
              ["full", "Full Page", "1 image on A4"],
              ["13x18-2", "13 × 18 cm", "2 copies on A4"],
              ["9x13-4", "9 × 13 cm", "4 copies on A4"],
            ] as Array<[PhotoPrintLayout, string, string]>).map(([value, title, detail]) => <button key={value} onClick={() => setPrintLayout(value)} className={`rounded-md border p-3 text-left ${printLayout === value ? "border-primary bg-primary/10" : "border-border hover:border-primary/60"}`}><div className={`mx-auto mb-3 grid h-20 w-14 gap-0.5 border border-muted-foreground/50 bg-white p-1 ${value === "13x18-2" ? "w-20 grid-cols-2" : value === "9x13-4" ? "grid-cols-2 grid-rows-2" : ""}`}>{Array.from({ length: value === "full" ? 1 : value === "13x18-2" ? 2 : 4 }).map((_, index) => <span key={index} className="bg-cyan-300/80" />)}</div><b className="block text-[11px]">{title}</b><span className="text-[9px] text-muted-foreground">{detail}</span></button>)}
          </div>
          {printLayout !== "full" && <label className="mt-3 flex cursor-pointer items-center justify-between rounded-md border border-border bg-background/50 px-3 py-2 text-xs"><span><b>Repeat selected image</b><small className="block text-[9px] text-muted-foreground">OFF = only one image in the first slot</small></span><input type="checkbox" checked={repeatPrint} onChange={(event) => setRepeatPrint(event.target.checked)} className="h-4 w-4 accent-cyan-500" /></label>}
          <button onClick={printSelected} disabled={printing} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"><Printer className="h-4 w-4" />{printing ? "Preparing print..." : "Open Print Preview"}</button>
        </div>
      </div>}
    </div>
  );
}

import { useEffect, useState } from "react";
import { Send, Trash2, Upload, Files, Printer, Sparkles, X, ChevronDown, ChevronRight } from "lucide-react";
import type { Customer, JobCard, PrintFile } from "@/lib/mock-data";
import { FileThumb } from "./FileThumb";
import { StatusBadge } from "./StatusBadge";
import { relTime } from "./utils";
import {
  createBatchQualityPrintPdf,
  openPrintWindow,
  printPdfBytes,
  type BatchPrintSource,
} from "./printSingleFile";
import { invertSelectedFiles } from "./bulkNegativeInvert";
import { DateFilterDropdown, type DateFilterValue } from "./DateFilterDropdown";
import { getDefaultAIManager } from "@/ai";
import { gatewayUrl } from "@/lib/gateway-url";

export function JobList({
  customer,
  jobs,
  selectedFileId,
  onSelectFile,
  onRemoveJob,
  onRemoveFile,
  onResetOriginal,
  onStatusChange,
  onJobsChanged,
}: {
  customer: Customer | null;
  jobs: JobCard[];
  selectedFileId: string | null;
  onSelectFile: (file: PrintFile, jobId: string) => void;
  onRemoveJob: (jobId: string) => void;
  onRemoveFile: (fileId: string) => void | Promise<void>;
  onResetOriginal: (originalFileId: string) => void;
  onStatusChange: (jobId: string, status: JobCard["status"]) => void;
  onJobsChanged: (jobs: JobCard[]) => void;
}) {
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState<Array<{ id: string; text: string; direction: "incoming" | "outgoing"; timestamp: number }>>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState("");
  const [batchMessage, setBatchMessage] = useState("");
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [printSelectedIds, setPrintSelectedIds] = useState<Set<string>>(new Set());
  const [printSourceMode, setPrintSourceMode] =
  useState<BatchPrintSource>("latest");
  const [uploading, setUploading] = useState(false);
  const [jobHistoryFilter, setJobHistoryFilter] = useState<DateFilterValue>("today");
  const [jobCustomDays, setJobCustomDays] = useState(7);
  const [, setAiQueueRevision] = useState(0);

  useEffect(() => {
    const queueController = getDefaultAIManager().getQueueController();
    const emitter = (queueController as any).getEventEmitter?.();
    if (!emitter) return;
    const events: Array<any> = [
      'ITEM_ENQUEUED',
      'ITEM_DEQUEUED',
      'ITEM_STATE_CHANGED',
      'COMPLETION_WINDOW_STARTED',
      'COMPLETION_WINDOW_EXPIRED',
      'PROCESSING_STARTED',
      'PROCESSING_COMPLETED',
      'PROCESSING_FAILED',
    ];

    const unsubscribes = events.map((evt) =>
      emitter.on(evt, () => setAiQueueRevision((r) => r + 1))
    );

    const timer = setInterval(() => setAiQueueRevision((r) => r + 1), 1000);

    return () => {
      unsubscribes.forEach((unsub) => unsub());
      clearInterval(timer);
    };
  }, []);

  const findQueueItemForJob = (job: JobCard) => {
    const queueController = getDefaultAIManager().getQueueController() as any;
    if (!queueController) return null;

    const allItems: any[] = queueController.getAllQueueItems?.() || queueController.queueStore?.getAllItems?.() || [];
    if (!allItems.length) return null;

    const jobFileIds = new Set(job.files.map((f) => f.id));
    const fileMatch = allItems.find((item) => item.fileIds?.some((id: string) => jobFileIds.has(id)));
    if (fileMatch) return fileMatch;

    const normalize = (id: string) => id.replace(/^meta:/, '');
    const targetCustIds = new Set<string>();
    if (customer?.id) targetCustIds.add(normalize(customer.id));
    if (job.customerId) targetCustIds.add(normalize(job.customerId));

    return allItems.find((item) => targetCustIds.has(normalize(item.customerId))) || null;
  };
  useEffect(() => {
    if (!customer) { setChat([]); return; }
    const load = () => fetch(gatewayUrl(`/api/messages/${encodeURIComponent(customer.id)}`)).then((response) => response.ok ? response.json() : []).then(setChat).catch(() => {});
    load();
    const timer = window.setInterval(load, 2500);
    return () => window.clearInterval(timer);
  }, [customer]);
  useEffect(() => {
    if (!selectedFileId) return;
    const selectedJob = jobs.find((job) => job.files.some((file) => file.id === selectedFileId));
    if (selectedJob) setExpandedJobs((current) => new Set(current).add(selectedJob.id));
  }, [jobs, selectedFileId]);
  const toggleJob = (jobId: string) => setExpandedJobs((current) => {
    const next = new Set(current);
    if (next.has(jobId)) next.delete(jobId); else next.add(jobId);
    return next;
  });
  const send = async () => {
    const text = message.trim();
    if (!customer || !text || sending) return;
    setSending(true); setSendError("");
    try {
      const response = await fetch(gatewayUrl(`/api/messages/${encodeURIComponent(customer.id)}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Message failed");
      setChat(result); setMessage("");
    } catch (error) { setSendError(error instanceof Error ? error.message : "Message failed"); }
    finally { setSending(false); }
  };
  const visibleJobs = jobs.filter((job) => {
    const now = new Date();
    const days = jobHistoryFilter === "today" ? 1 : jobHistoryFilter === "2days" ? 2 : jobHistoryFilter === "3days" ? 3 : Math.max(1, jobCustomDays);
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
    return job.lastAt >= cutoff;
  });
  const batchFiles = visibleJobs.flatMap((job) => job.files);
  const bytesToDataUrl = (bytes: Uint8Array, mime: string) => {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return `data:${mime};base64,${btoa(binary)}`;
  };
  const buildCombinedPdf = async (
  files = batchFiles,
  sourceMode: BatchPrintSource = printSourceMode,
) => {
  return createBatchQualityPrintPdf(files, sourceMode);
};
  const selectedPrintFiles = batchFiles.filter((file) => printSelectedIds.has(file.id));
  const manualUpload = async (files: File[]) => {
    if (!customer || !files.length || uploading) return; setUploading(true); setBatchMessage("");
    try { for (const item of files) { const dataUrl = await new Promise<string>((resolve,reject) => { const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(item); }); const response=await fetch(gatewayUrl("/api/jobs/manual-upload"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({contactId:customer.id,fileName:item.name,mimeType:item.type,dataUrl})});const result=await response.json();if(!response.ok)throw new Error(result.error||"Upload failed"); } setBatchMessage(`${files.length} file(s) uploaded`); }
    catch(error){setBatchMessage(error instanceof Error?error.message:"Upload failed");}finally{setUploading(false);}
  };
  const saveBatch = async (mode: "separate" | "combined" | "both") => {
    if (!customer || batchBusy) return;
    setBatchBusy("Preparing batch..."); setBatchMessage("");
    try {
      const combined = mode === "separate" ? undefined : bytesToDataUrl(await buildCombinedPdf(), "application/pdf");
      const liveFiles = batchFiles.filter((file) => file.kind === "image" && file.livePreview).map((file) => ({ id: file.id, dataUrl: file.livePreview }));
      const response = await fetch(gatewayUrl("/api/batches"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contactId: customer.id, mode, combinedPdf: combined, liveFiles, fileIds: batchFiles.map((file) => file.id) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Batch save failed");
      setBatchMessage(`Saved: ${result.folder}`);
    } catch (error) { setBatchMessage(error instanceof Error ? error.message : "Batch save failed"); }
    finally { setBatchBusy(""); }
  };
  const printBatch = async () => {
    if (batchBusy) return;
    let printWindow: Window | null;
    try { printWindow = openPrintWindow(); } catch (error) { setBatchMessage(error instanceof Error ? error.message : "Print window was blocked"); return; }
    setBatchBusy("Preparing print..."); setBatchMessage("");
    try {
      const bytes = await buildCombinedPdf();
      printPdfBytes(bytes, printWindow);
      jobs.forEach((job) => { void onStatusChange(job.id, "printed"); });
    } catch (error) { printWindow?.close(); setBatchMessage(error instanceof Error ? error.message : "Print preparation failed"); }
    finally { setBatchBusy(""); }
  };
  const printSelected = async (
  sourceMode: BatchPrintSource = printSourceMode,
) => {
  if (!selectedPrintFiles.length || batchBusy) return;

  let printWindow: Window | null;

  try {
    printWindow = openPrintWindow();
  } catch (error) {
    setBatchMessage(
      error instanceof Error
        ? error.message
        : "Print window was blocked",
    );
    return;
  }

  setBatchBusy(
    sourceMode === "latest"
      ? "Preparing latest edited print..."
      : "Preparing original print...",
  );
  setBatchMessage("");

  try {
    const bytes = await buildCombinedPdf(
      selectedPrintFiles,
      sourceMode,
    );

    printPdfBytes(bytes, printWindow);
  } catch (error) {
    printWindow?.close();

    setBatchMessage(
      error instanceof Error
        ? error.message
        : "Print preparation failed",
    );
  } finally {
    setBatchBusy("");
  }
};
  const invertSelected = async () => {
    if (!customer || !selectedPrintFiles.length || batchBusy) return;
    setBatchBusy(`Inverting 0/${selectedPrintFiles.length}...`); setBatchMessage("");
    try {
      const updated = await invertSelectedFiles(customer.id, selectedPrintFiles, (done, total) => setBatchBusy(`Inverting ${done}/${total}...`));
      if (Array.isArray(updated)) onJobsChanged(updated as JobCard[]);
      setPrintSelectedIds(new Set());
      setBatchMessage(`${selectedPrintFiles.length} selected file(s) inverted. All PDF pages were processed.`);
    } catch (error) { setBatchMessage(error instanceof Error ? error.message : "Negative invert failed"); }
    finally { setBatchBusy(""); }
  };
  if (!customer) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border p-3">
          <h2 className="text-sm font-semibold">Job Cards</h2>
        </div>
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
          Select a customer to see incoming jobs.
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 space-y-2 border-b border-border p-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">{customer.name}</h2>
            <p className="truncate text-[10px] text-muted-foreground">{customer.mobile}</p>
          </div>
          <DateFilterDropdown value={jobHistoryFilter} onChange={setJobHistoryFilter} customDays={jobCustomDays} onCustomDaysChange={setJobCustomDays} prefix="Jobs: " />
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          <label className="inline-flex min-w-0 cursor-pointer items-center justify-center gap-1 rounded-md border border-border bg-accent/40 px-1.5 py-1.5 text-[10px] hover:bg-accent">
            <Upload className="h-3 w-3 shrink-0" />
            <span className="truncate">{uploading ? "Uploading..." : "Manual Upload"}</span><input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(event)=>{const items=Array.from(event.target.files||[]);event.target.value="";void manualUpload(items);}} />
          </label>
          <button onClick={() => setBatchOpen(true)} className="inline-flex min-w-0 items-center justify-center gap-1 rounded-md border border-border bg-accent/40 px-1.5 py-1.5 text-[10px] hover:bg-accent"><Files className="h-3 w-3 shrink-0" /> <span className="truncate">Batch Save</span></button>
          <div className="col-span-2 grid grid-cols-[1fr_120px] overflow-hidden rounded-md border border-primary">
  <button
    onClick={() => void printSelected(printSourceMode)}
    disabled={!selectedPrintFiles.length || !!batchBusy}
    className="inline-flex min-w-0 items-center justify-center gap-1 bg-primary px-2 py-1.5 text-[10px] font-medium text-primary-foreground disabled:opacity-40"
  >
    <Printer className="h-3 w-3 shrink-0" />

    <span className="truncate">
      {batchBusy
        ? "Preparing..."
        : printSourceMode === "latest"
          ? `Print Latest (${selectedPrintFiles.length})`
          : `Print Original (${selectedPrintFiles.length})`}
    </span>
  </button>

  <select
    value={printSourceMode}
    onChange={(event) =>
      setPrintSourceMode(
        event.target.value as BatchPrintSource,
      )
    }
    disabled={!!batchBusy}
    className="border-l border-primary/40 bg-background px-2 text-[10px] text-foreground outline-none disabled:opacity-40"
    title="Choose print version"
  >
    <option value="latest">Latest Edited</option>
    <option value="original">Original</option>
  </select>
</div>
          <button onClick={invertSelected} disabled={!selectedPrintFiles.length || !!batchBusy} className="inline-flex min-w-0 items-center justify-center gap-1 rounded-md border border-primary/60 bg-primary/10 px-1.5 py-1.5 text-[10px] text-primary disabled:opacity-40"><Sparkles className="h-3 w-3 shrink-0" /> <span className="truncate">Invert ({selectedPrintFiles.length})</span></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
        {visibleJobs.map((job) => (
          <div
            key={job.id}
            className="rounded-lg border border-border bg-card/60 p-2.5"
          >
            <div className={`flex items-center gap-2 ${expandedJobs.has(job.id) ? "mb-2" : ""}`}>
              <button onClick={() => toggleJob(job.id)} className="flex min-w-0 flex-1 items-center gap-2 rounded p-1 text-left hover:bg-accent/50">
              {expandedJobs.has(job.id) ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-primary" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <StatusBadge status={job.status} />
              <span className="text-[10px] text-muted-foreground">
                {job.files.length} file{job.files.length > 1 ? "s" : ""} · {relTime(job.lastAt)}
              </span>
              </button>
              <select
                value={job.status}
                onChange={(event) => onStatusChange(job.id, event.target.value as JobCard["status"])}
                onClick={(event) => event.stopPropagation()}
                className="max-w-24 rounded border border-border bg-background px-1 py-1 text-[9px] outline-none focus:border-primary"
                title="Change job status"
              >
                <option value="in_review">In Review</option>
                <option value="in_process">In Process</option>
                <option value="print_ready">Print Ready</option>
                <option value="printed">Printed</option>
              </select>
              <button
                onClick={() => onRemoveJob(job.id)}
                className="ml-auto rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                title="Remove job"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {(() => {
              const aiQueueItem = findQueueItemForJob(job);
              if (!aiQueueItem) return null;
              const isWaiting = aiQueueItem.state === 'WAITING_COMPLETION_WINDOW';
              const category = aiQueueItem.classification?.category.toUpperCase() || (isWaiting ? 'WAITING' : 'CLASSIFYING');
              const statusText = aiQueueItem.processingResult?.status || aiQueueItem.processingState || (isWaiting ? 'waiting-completion' : 'queued');
              return (
                <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 p-1.5 text-[10px]">
                  <Sparkles className="h-3 w-3 shrink-0 text-primary" />
                  <span className="font-semibold text-primary">
                    AI: {category}
                  </span>
                  {aiQueueItem.classification?.confidence && (
                    <span className="text-[9px] text-muted-foreground font-mono">
                      {Math.round(aiQueueItem.classification.confidence * 100)}%
                    </span>
                  )}
                  <span className="rounded bg-background px-1 py-0.5 text-[9px] text-muted-foreground border border-border">
                    Tool: {aiQueueItem.route?.tool || 'pending'}
                  </span>
                  <span className={`ml-auto rounded px-1.5 py-0.5 font-medium text-[9px] ${
                    statusText === 'ready-for-review'
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : statusText === 'manual-review'
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-primary/10 text-primary'
                  }`}>
                    {statusText}
                  </span>
                  <button
                    onClick={() => {
                      if (job.files[0]) {
                        setExpandedJobs((cur) => new Set(cur).add(job.id));
                        onSelectFile(job.files[0], job.id);
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-[9px] font-medium text-primary-foreground hover:opacity-90"
                  >
                    Open for Review
                  </button>
                </div>
              );
            })()}
            {expandedJobs.has(job.id) && <><div className="mb-1 flex justify-end"><button onClick={()=>setPrintSelectedIds((current)=>{const next=new Set(current);const all=job.files.every((file)=>next.has(file.id));for(const file of job.files)all?next.delete(file.id):next.add(file.id);return next;})} className="text-[9px] text-primary hover:underline">{job.files.every((file)=>printSelectedIds.has(file.id))?"Clear job":"Select job for print"}</button></div><div className="grid grid-cols-3 gap-1.5">
              {job.files.map((f) => (
                <FileThumb
                  key={f.id}
                  file={f}
                  selected={f.id === selectedFileId}
                  onClick={() => onSelectFile(f, job.id)}
                  onResetOriginal={f.isEdited || !!f.workingSrc || f.selectedSrc === f.processedSrc || f.layoutType === "multiPage" || f.layoutType === "passport" ? () => onResetOriginal(f.id) : undefined}
                  checked={printSelectedIds.has(f.id)}
                  onCheck={(checked)=>setPrintSelectedIds((current)=>{const next=new Set(current);checked?next.add(f.id):next.delete(f.id);return next;})}
                  onDelete={() => { if (window.confirm(`Delete only ${f.name} from this batch?`)) void onRemoveFile(f.id); }}
                />
              ))}
            </div></>}
          </div>
        ))}
        {visibleJobs.length === 0 && (
          <div className="pt-8 text-center text-xs text-muted-foreground">
            No jobs found for this date filter.
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-border bg-card/50 p-3">
        {chat.length > 0 && <div className="mb-2 max-h-32 space-y-1 overflow-y-auto rounded-md bg-background/60 p-2">
          {chat.slice(-20).map((item) => <div key={item.id} className={`flex ${item.direction === "outgoing" ? "justify-end" : "justify-start"}`}><span className={`max-w-[85%] rounded-lg px-2 py-1 text-[11px] ${item.direction === "outgoing" ? "bg-primary text-primary-foreground" : "bg-accent"}`}>{item.text}</span></div>)}
        </div>}
        <div className="flex gap-2">
          <input value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") send(); }} placeholder={`Message via ${customer.source || "WhatsApp"}`} className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-primary" />
          <button onClick={send} disabled={!message.trim() || sending} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"><Send className="h-3.5 w-3.5" />Send</button>
        </div>
        {sendError && <p className="mt-1 text-[10px] text-destructive">{sendError}</p>}
      </div>
      {batchOpen && <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onClick={() => setBatchOpen(false)}>
        <div className="w-[430px] rounded-lg border border-border bg-card p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center"><div><h3 className="text-sm font-semibold">Batch Save</h3><p className="text-[10px] text-muted-foreground">{batchFiles.length} files · {customer.name}</p></div><button onClick={() => setBatchOpen(false)} className="ml-auto rounded p-1 hover:bg-accent"><X className="h-4 w-4" /></button></div>
          <div className="mt-4 grid gap-2">
            <button onClick={() => saveBatch("separate")} disabled={!!batchBusy} className="rounded-md border border-border p-3 text-left hover:border-primary disabled:opacity-50"><b className="text-xs">Save All Separately</b><p className="text-[10px] text-muted-foreground">Original અને Edited foldersમાં અલગ files</p></button>
            <button onClick={() => saveBatch("combined")} disabled={!!batchBusy} className="rounded-md border border-border p-3 text-left hover:border-primary disabled:opacity-50"><b className="text-xs">Create Combined Printable PDF</b><p className="text-[10px] text-muted-foreground">બધી images અને PDF pagesનું એક Batch_Printable.pdf</p></button>
            <button onClick={() => saveBatch("both")} disabled={!!batchBusy} className="rounded-md border border-primary/50 bg-primary/10 p-3 text-left hover:bg-primary/15 disabled:opacity-50"><b className="text-xs">Save Separately + Combined PDF</b><p className="text-[10px] text-muted-foreground">બંને outputs એક જ time-based batch folderમાં</p></button>
          </div>
          {batchBusy && <p className="mt-3 text-xs text-primary">{batchBusy}</p>}
          {batchMessage && <p className="mt-3 break-all text-[10px] text-muted-foreground">{batchMessage}</p>}
        </div>
      </div>}
    </div>
  );
}

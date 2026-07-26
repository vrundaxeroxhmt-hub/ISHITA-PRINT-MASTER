import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare, Printer, Settings } from "lucide-react";
import { type PrintFile, type JobCard } from "@/lib/mock-data";
import { CustomerList } from "@/components/shop/CustomerList";
import { JobList } from "@/components/shop/JobList";
import { PreviewPanel } from "@/components/shop/PreviewPanel";
import { WhatsAppConnections } from "@/components/shop/WhatsAppConnections";
import type { Customer } from "@/lib/mock-data";
import type { AadhaarLayoutState } from "@/components/shop/editor/AadhaarLayout";
import type { MultiLayoutState } from "@/components/shop/editor/MultiPageLayout";
import type { PassportLayoutState } from "@/components/shop/editor/PassportPhotoLayout";
import { DateFilterDropdown, type DateFilterValue } from "@/components/shop/DateFilterDropdown";
import type { PrintSettings } from "@/desktop-main";
import { getInboundJobSynchronizer } from "@/ai";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PrintDesk — WhatsApp Xerox Automation" },
      { name: "description", content: "Automate WhatsApp print jobs: customer batching, image & PDF editing, Aadhaar 130% layout, direct print." },
      { property: "og:title", content: "PrintDesk — WhatsApp Xerox Automation" },
      { property: "og:description", content: "Automate WhatsApp print jobs: customer batching, image & PDF editing, Aadhaar 130% layout, direct print." },
    ],
  }),
  component: Index,
});

export function Index() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [jobs, setJobs] = useState<JobCard[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [historyFilter, setHistoryFilter] = useState<DateFilterValue>("today");
  const [customDays, setCustomDays] = useState(7);
  const [showSettings, setShowSettings] = useState(false);
  const [customerNameFontSize, setCustomerNameFontSize] = useState(() => typeof window === "undefined" ? 12 : Number(localStorage.getItem("printdesk.customerNameFontSize") || 12));
  const [customerMobileFontSize, setCustomerMobileFontSize] = useState(() => typeof window === "undefined" ? 10 : Number(localStorage.getItem("printdesk.customerMobileFontSize") || 10));
  const [masterFolder, setMasterFolder] = useState("");
  const [folderBusy, setFolderBusy] = useState(false);
  const [printSettings, setPrintSettings] = useState<PrintSettings>({ printerName:"", paperSize:"A4", copies:1, landscape:false, color:true, duplexMode:"simplex", pagesPerSheet:1, scaleFactor:100 });
  const [printers, setPrinters] = useState<Array<{name:string;displayName?:string;isDefault?:boolean}>>([]);
  const [completionWindowSeconds, setCompletionWindowSeconds] = useState<number>(45);
  useEffect(() => {
    fetch("http://127.0.0.1:3001/api/settings")
      .then((r) => r.json())
      .then((res) => {
        if (res.completionWindowSeconds) setCompletionWindowSeconds(res.completionWindowSeconds);
      })
      .catch(() => {});
  }, []);
  const handleUpdateCompletionWindow = async (seconds: number) => {
    setCompletionWindowSeconds(seconds);
    const { updateAISettings } = await import("@/ai");
    updateAISettings({ customerCompletionWindowSeconds: seconds });
    try {
      await fetch("http://127.0.0.1:3001/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ completionWindowSeconds: seconds }),
      });
    } catch {}
  };
  useEffect(() => { localStorage.setItem("printdesk.customerNameFontSize", String(customerNameFontSize)); }, [customerNameFontSize]);
  useEffect(() => { localStorage.setItem("printdesk.customerMobileFontSize", String(customerMobileFontSize)); }, [customerMobileFontSize]);
  useEffect(() => { fetch("http://127.0.0.1:3001/api/settings/storage").then((response)=>response.json()).then((result)=>setMasterFolder(result.masterFolder||"")).catch(()=>{}); }, []);
  useEffect(() => { window.printDeskDesktop?.getPrintSettings().then((result)=>{setPrintSettings(result.settings);setPrinters(result.printers||[]);}); }, []);
  const updatePrintSettings = (patch: Partial<PrintSettings>) => { const next={...printSettings,...patch};setPrintSettings(next);void window.printDeskDesktop?.setPrintSettings(next); };
  const handleLiveContacts = useCallback((live: unknown[]) => {
    const incoming = live as Customer[];
    setCustomers((current) => {
      const liveIds = new Set(incoming.map((customer) => customer.id));
      return [...incoming, ...current.filter((customer) => !liveIds.has(customer.id))];
    });
  }, []);
  useEffect(() => {
    const loadJobs = () => fetch("http://127.0.0.1:3001/api/jobs").then((response) => response.ok ? response.json() : []).then((incoming: JobCard[]) => {
      getInboundJobSynchronizer().synchronizeJobs(incoming);
      setJobs((current) => {
        const currentFiles = new Map(current.flatMap((item) => item.files).map((file) => [file.id, file]));
        return incoming.map((job) => ({
          ...job,
          files: job.files.map((file) => {
            const existing = currentFiles.get(file.id);
            return {
              ...file,
              livePreview: existing?.livePreview || file.workingSrc,
              appliedCropSrc: existing?.appliedCropSrc || file.appliedCropSrc,
            };
          }),
        }));
      });
    }).catch(() => {});
    loadJobs();
    const timer = window.setInterval(loadJobs, 500);
    return () => window.clearInterval(timer);
  }, []);

  const isSameCustomer = useCallback((id1?: string | null, id2?: string | null) => {
    if (!id1 || !id2) return false;
    if (id1 === id2) return true;
    return id1.replace(/^meta:/, '') === id2.replace(/^meta:/, '');
  }, []);

  const selectedCustomer = useMemo(
    () => customers.find((c) => isSameCustomer(c.id, selectedCustomerId)) ?? null,
    [customers, selectedCustomerId, isSameCustomer],
  );
  const filteredCustomers = useMemo(() => {
    const now = new Date();
    const days = historyFilter === "today" ? 1 : historyFilter === "2days" ? 2 : historyFilter === "3days" ? 3 : Math.max(1, customDays);
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
    return customers.filter((customer) => customer.lastMessageAt >= cutoff);
  }, [customers, historyFilter, customDays]);

  useEffect(() => {
    if (!selectedCustomerId && filteredCustomers.length > 0) {
      setSelectedCustomerId(filteredCustomers[0].id);
    }
  }, [selectedCustomerId, filteredCustomers]);

  const customerJobs = useMemo<JobCard[]>(() => {
    if (!selectedCustomerId) return [];
    const generatedSourceIds = new Set(jobs.filter((job) => isSameCustomer(job.customerId, selectedCustomerId)).flatMap((job) => job.files.flatMap((file) => file.layoutType === "multiPage" && file.multiLayout?.keepSources !== true ? file.multiLayout?.sourceFileIds || [] : file.layoutType === "passport" && file.passportLayout?.hideSources !== false ? file.passportLayout?.sourceFileIds || [] : [])));
    const base = jobs
      .filter((j) => isSameCustomer(j.customerId, selectedCustomerId))
      .map((j) => ({ ...j, files: j.files.filter((f) => !hiddenIds.has(f.id) && (!generatedSourceIds.has(f.id) || f.layoutType === "multiPage")) }))
      .filter((j) => j.files.length > 0)
      .sort((a, b) => b.lastAt - a.lastAt);
    return base;
  }, [jobs, selectedCustomerId, hiddenIds, isSameCustomer]);

  const customerImages = useMemo<PrintFile[]>(() => {
    if (!selectedCustomerId) return [];
    const files: PrintFile[] = [];
    for (const j of jobs) {
      if (!isSameCustomer(j.customerId, selectedCustomerId)) continue;
      for (const f of j.files) if (f.kind === "image" && f.layoutType !== "aadhaar130") files.push(f);
    }
    return files;
  }, [jobs, selectedCustomerId, isSameCustomer]);
  const customerFiles = useMemo(() => jobs.filter((job) => isSameCustomer(job.customerId, selectedCustomerId)).flatMap((job) => job.files), [jobs, selectedCustomerId, isSameCustomer]);

  const selectedFile = useMemo(() => {
    for (const j of jobs) {
      const f = j.files.find((f) => f.id === selectedFileId);
      if (f) return f;
    }
    return null;
  }, [jobs, selectedFileId]);

  const handleHideImage = (id: string) => setHiddenIds((prev) => new Set(prev).add(id));
  const handleUnhideImage = (id: string) =>
    setHiddenIds((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
  const handleGenerated = async (dataUrl: string, _name: string, aadhaarLayout: AadhaarLayoutState) => {
    if (!selectedCustomerId) return;
    const response = await fetch("http://127.0.0.1:3001/api/jobs/aadhaar-layout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contactId: selectedCustomerId, dataUrl, layout: aadhaarLayout }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Aadhaar layout save failed");
    setJobs(result.jobs);
    setSelectedFileId(result.file.id);
  };
  const handleMultiGenerated = async (pages: string[], layout: MultiLayoutState) => {
    if (!selectedCustomerId) return;
    const response = await fetch("http://127.0.0.1:3001/api/jobs/multi-layout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contactId: selectedCustomerId, pages, layout }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Multi layout save failed");
    setJobs(result.jobs); setHiddenIds(new Set()); setSelectedFileId(result.files[0]?.id || null);
  };
  const handlePassportGenerated = async (page: string, layout: PassportLayoutState, singles: Array<{ id: string; dataUrl: string }>) => {
    if (!selectedCustomerId) return;
    const response = await fetch("http://127.0.0.1:3001/api/jobs/passport-layout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contactId: selectedCustomerId, page, layout, singles }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Passport sheet save failed");
    setJobs(result.jobs); setSelectedFileId(result.file.id);
  };

  const handleRename = (id: string, name: string) => {
    setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  };

  const handleSelectCustomer = (id: string) => {
    setSelectedCustomerId(id);
    setSelectedFileId(null);
    setHiddenIds(new Set());
  };

  const handleSelectFile = (file: PrintFile) => {
    setSelectedFileId(file.id);
    if (!selectedCustomerId) return;
    setCustomers((prev) => prev.map((customer) => customer.id === selectedCustomerId ? { ...customer, unread: 0 } : customer));
    fetch(`http://127.0.0.1:3001/api/contacts/${encodeURIComponent(selectedCustomerId)}/read`, { method: "POST" }).catch(() => {});
    const owningJob = jobs.find((job) => job.files.some((item) => item.id === file.id));
    if (owningJob && owningJob.status === "in_review") {
      fetch(`http://127.0.0.1:3001/api/jobs/${encodeURIComponent(owningJob.id)}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "in_process" }) })
        .then((response) => response.ok ? response.json() : null).then((result) => { if (result?.jobs) setJobs(result.jobs); }).catch(() => {});
    }
  };
  const handleJobStatus = async (jobId: string, status: JobCard["status"]) => {
    const response = await fetch(`http://127.0.0.1:3001/api/jobs/${encodeURIComponent(jobId)}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    const result = await response.json(); if (response.ok) setJobs(result.jobs);
  };
  const handleFilePrinted = async (fileId: string) => {
    const response = await fetch(`http://127.0.0.1:3001/api/jobs/files/${encodeURIComponent(fileId)}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "printed" }) });
    const result = await response.json(); if (response.ok) setJobs(result.jobs);
  };
  const handleUnbindLayout = async (fileId: string) => {
    const response = await fetch(`http://127.0.0.1:3001/api/jobs/files/${encodeURIComponent(fileId)}/unbind-layout`, { method: "POST" });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unbind failed");
    setJobs(result.jobs);
  };
  const handleFilePreview = useCallback((fileId: string, dataUrl: string, appliedCrop?: boolean) => {
    setJobs((current) => current.map((job) => ({ ...job, files: job.files.map((file) => file.id === fileId ? { ...file, livePreview: dataUrl, ...(appliedCrop ? { appliedCropSrc: dataUrl } : {}) } : file) })));
  }, []);
  const handleResetOriginal = async (fileId: string) => {
    try {
      const response = await fetch(`http://127.0.0.1:3001/api/jobs/files/${encodeURIComponent(fileId)}/reset`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Reset failed");
      setJobs(result.jobs);
      setSelectedFileId(result.jobs.some((job: JobCard) => job.files.some((file: PrintFile) => file.id === fileId)) ? fileId : null);
    } catch (error) { console.error(error); }
  };

  const handleRemoveJob = (jobId: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
    fetch(`http://127.0.0.1:3001/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }).catch(() => {});
    if (selectedFile && jobs.find((j) => j.id === jobId)?.files.some((f) => f.id === selectedFile.id)) {
      setSelectedFileId(null);
    }
  };
  const handleRemoveFile = async (fileId: string) => {
    const response = await fetch(`http://127.0.0.1:3001/api/jobs/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "File delete failed");
    setJobs(result.jobs);
    if (selectedFileId === fileId) setSelectedFileId(null);
  };

  const totalPending = jobs.filter((j) => j.status !== "printed").length;

  return (
    <div className="flex h-dvh max-h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Printer className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold leading-tight">ISHTA PRINT MASTER</h1>
            <p className="text-[10px] leading-tight text-muted-foreground">WhatsApp Xerox Automation</p>
          </div>
        </div>
        <WhatsAppConnections onContacts={handleLiveContacts} />
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <DateFilterDropdown value={historyFilter} onChange={setHistoryFilter} customDays={customDays} onCustomDaysChange={setCustomDays} prefix="Customers: " />
          <div className="flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            <span>{totalPending} pending</span>
          </div>
          <div className="relative">
            <button onClick={() => setShowSettings((value) => !value)} className={`rounded-md p-1.5 hover:bg-accent ${showSettings ? "bg-accent text-foreground" : ""}`} title="Settings">
              <Settings className="h-4 w-4" />
            </button>
            {showSettings && <div className="absolute right-0 top-full z-[80] mt-2 max-h-[82vh] w-80 overflow-y-auto rounded-lg border border-border bg-card p-4 text-foreground shadow-2xl">
              <div className="mb-3 flex items-center"><div><h3 className="text-xs font-semibold">Display Settings</h3><p className="text-[9px] text-muted-foreground">Column 1 customer text</p></div><button onClick={() => setShowSettings(false)} className="ml-auto rounded px-2 py-1 text-xs hover:bg-accent">×</button></div>
              <label className="mb-4 block"><span className="mb-1 flex justify-between text-[10px]"><span>Name text size</span><span className="text-primary">{customerNameFontSize}px</span></span><input type="range" min={9} max={22} step={1} value={customerNameFontSize} onChange={(event) => setCustomerNameFontSize(Number(event.target.value))} className="w-full accent-cyan-400" /><div style={{fontSize:customerNameFontSize}} className="mt-1 truncate rounded bg-background/60 px-2 py-1 font-medium">Customer Name Preview</div></label>
              <label className="block"><span className="mb-1 flex justify-between text-[10px]"><span>Mobile number size</span><span className="text-primary">{customerMobileFontSize}px</span></span><input type="range" min={8} max={18} step={1} value={customerMobileFontSize} onChange={(event) => setCustomerMobileFontSize(Number(event.target.value))} className="w-full accent-cyan-400" /><div style={{fontSize:customerMobileFontSize}} className="mt-1 rounded bg-background/60 px-2 py-1 text-muted-foreground">+91 98765 43210</div></label>
              <button onClick={() => {setCustomerNameFontSize(12);setCustomerMobileFontSize(10);}} className="mt-4 w-full rounded border border-border py-1.5 text-[10px] hover:bg-accent">Reset Default</button>
              <div className="mt-4 space-y-2 border-t border-border pt-3">
                <div><div className="text-[10px] font-semibold">Direct Print Settings</div><p className="text-[9px] text-muted-foreground">Foxit Preview ignores these; Direct Print uses them.</p></div>
                <label className="block text-[9px]">Printer<select value={printSettings.printerName} onChange={(e)=>updatePrintSettings({printerName:e.target.value})} className="mt-1 w-full rounded border border-border bg-background p-1.5 text-[10px]"><option value="">Windows default printer</option>{printers.map((printer)=><option key={printer.name} value={printer.name}>{printer.displayName||printer.name}{printer.isDefault?" (Default)":""}</option>)}</select></label>
                <div className="grid grid-cols-2 gap-2"><label className="text-[9px]">Copies<input type="number" min={1} max={99} value={printSettings.copies} onChange={(e)=>updatePrintSettings({copies:Math.max(1,+e.target.value||1)})} className="mt-1 w-full rounded border border-border bg-background p-1.5 text-[10px]"/></label><label className="text-[9px]">Pages per sheet<select value={printSettings.pagesPerSheet} onChange={(e)=>updatePrintSettings({pagesPerSheet:+e.target.value})} className="mt-1 w-full rounded border border-border bg-background p-1.5 text-[10px]">{[1,2,4,6,9,16].map((value)=><option key={value} value={value}>{value}</option>)}</select></label></div>
                <div className="grid grid-cols-2 gap-2"><label className="text-[9px]">Orientation<select value={printSettings.landscape?"landscape":"portrait"} onChange={(e)=>updatePrintSettings({landscape:e.target.value==="landscape"})} className="mt-1 w-full rounded border border-border bg-background p-1.5 text-[10px]"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label><label className="text-[9px]">Duplex<select value={printSettings.duplexMode} onChange={(e)=>updatePrintSettings({duplexMode:e.target.value as PrintSettings["duplexMode"]})} className="mt-1 w-full rounded border border-border bg-background p-1.5 text-[10px]"><option value="simplex">Single side</option><option value="longEdge">Long edge</option><option value="shortEdge">Short edge</option></select></label></div>
                <label className="block text-[9px]">Scale: {printSettings.scaleFactor}%<input type="range" min={10} max={200} value={printSettings.scaleFactor} onChange={(e)=>updatePrintSettings({scaleFactor:+e.target.value})} className="w-full accent-cyan-400"/></label>
                <label className="flex items-center justify-between rounded border border-border p-2 text-[9px]"><span>Color printing</span><input type="checkbox" checked={printSettings.color} onChange={(e)=>updatePrintSettings({color:e.target.checked})} className="accent-cyan-400"/></label>
                <button onClick={()=>updatePrintSettings({printerName:"",paperSize:"A4",copies:1,landscape:false,color:true,duplexMode:"simplex",pagesPerSheet:1,scaleFactor:100})} className="w-full rounded border border-primary/50 py-1.5 text-[10px] text-primary">Safe A4 defaults</button>
              </div>
              <div className="mt-4 border-t border-border pt-3">
                <div className="text-[10px] font-semibold">Job Completion Window</div>
                <p className="mt-0.5 text-[9px] text-muted-foreground">
                  Time allowed to combine consecutive customer files and instructions into one job.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <select
                    value={completionWindowSeconds}
                    onChange={(e) => handleUpdateCompletionWindow(Number(e.target.value))}
                    className="w-full rounded border border-border bg-background p-1.5 text-[10px]"
                  >
                    <option value={15}>15 seconds</option>
                    <option value={30}>30 seconds</option>
                    <option value={45}>45 seconds (Default)</option>
                    <option value={60}>60 seconds (1 min)</option>
                    <option value={90}>90 seconds (1.5 min)</option>
                    <option value={120}>120 seconds (2 min)</option>
                    <option value={180}>180 seconds (3 min)</option>
                    <option value={300}>300 seconds (5 min)</option>
                  </select>
                </div>
              </div>
              <div className="mt-4 border-t border-border pt-3"><div className="text-[10px] font-semibold">Master Save Folder</div><p className="mt-0.5 text-[9px] text-muted-foreground">Files save inside Year / Month / Date / Mobile / Batch_Time</p><div className="mt-2 break-all rounded border border-border bg-background/60 p-2 text-[9px] text-muted-foreground">{masterFolder || "Not configured"}</div><button disabled={folderBusy} onClick={async()=>{setFolderBusy(true);try{const response=await fetch("http://127.0.0.1:3001/api/settings/storage/pick",{method:"POST"});const result=await response.json();if(!response.ok)throw new Error(result.error||"Folder selection failed");if(result.masterFolder)setMasterFolder(result.masterFolder);}finally{setFolderBusy(false);}}} className="mt-2 w-full rounded bg-primary py-1.5 text-[10px] text-primary-foreground disabled:opacity-50">{folderBusy?"Opening Folder Picker...":"Browse & Select Master Folder"}</button></div>
            </div>}
          </div>
        </div>
      </header>
      <main className="grid min-h-0 flex-1 overflow-hidden grid-cols-[280px_360px_1fr]">
        <aside className="min-h-0 overflow-hidden border-r border-border bg-card/30">
          <CustomerList
            customers={filteredCustomers}
            selectedId={selectedCustomerId}
            onSelect={handleSelectCustomer}
            onRename={handleRename}
            nameFontSize={customerNameFontSize}
            mobileFontSize={customerMobileFontSize}
          />
        </aside>
        <section className="min-h-0 overflow-hidden border-r border-border bg-card/20">
          <JobList
            customer={selectedCustomer}
            jobs={customerJobs}
            selectedFileId={selectedFileId}
            onSelectFile={handleSelectFile}
            onRemoveJob={handleRemoveJob}
            onRemoveFile={handleRemoveFile}
            onResetOriginal={handleResetOriginal}
            onStatusChange={handleJobStatus}
            onJobsChanged={setJobs}
          />
        </section>
        <section className="min-h-0 overflow-hidden bg-background">
          <PreviewPanel
            file={selectedFile}
            customerImages={customerImages}
            customerFiles={customerFiles}
            onHideImage={handleHideImage}
            onUnhideImage={handleUnhideImage}
            onGeneratedImage={handleGenerated}
            onGeneratedMulti={handleMultiGenerated}
            onGeneratedPassport={handlePassportGenerated}
            customerId={selectedCustomerId}
            onFilePreview={handleFilePreview}
            onPrinted={handleFilePrinted}
            onUnbindLayout={handleUnbindLayout}
          />
        </section>
      </main>
    </div>
  );
}

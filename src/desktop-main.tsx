import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { Index } from "./routes/index";

export type PrintSettings = { printerName:string; paperSize:string; copies:number; landscape:boolean; color:boolean; duplexMode:"simplex"|"longEdge"|"shortEdge"; pagesPerSheet:number; scaleFactor:number };
type Entitlement = { active:boolean; licensed?:boolean; trial?:boolean; machineCode:string; error?:string; expiresAt?:string; daysRemaining?:number };
type SetupState = { complete:boolean; masterFolder:string };

declare global {
  interface Window { printDeskDesktop?: {
    gatewayUrl:string;
    getBackendStatus:()=>Promise<{ready:boolean;port:number|null;error:string|null;logFile:string}>;
    getSetup:()=>Promise<SetupState>;
    completeSetup:(folder:string)=>Promise<{ok:boolean;masterFolder:string}>;
    selectSaveFolder:()=>Promise<{ok?:boolean;cancelled?:boolean;folder?:string}>;
    getLicense:()=>Promise<Entitlement>;
    activateLicense:(key:string)=>Promise<{ok:boolean;error?:string}>;
    printPdf:(base64:string)=>Promise<{ok:boolean;error?:string}>;
    getPrintSettings:()=>Promise<{settings:PrintSettings;printers:Array<{name:string;displayName?:string;isDefault?:boolean}>}>;
    setPrintSettings:(settings:PrintSettings)=>Promise<{ok:boolean;settings:PrintSettings}>;
  } }
}

const nativeFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === "string" && input.startsWith("http://127.0.0.1:3001")) {
    const gatewayUrl = window.printDeskDesktop?.gatewayUrl;
    if (!gatewayUrl) return Promise.reject(new Error("Bundled backend URL was not provided by Electron."));
    input = input.replace("http://127.0.0.1:3001", gatewayUrl);
  }
  return nativeFetch(input, init);
};

function DesktopApp() {
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [licence, setLicence] = useState<Entitlement | null>(null);
  const [folder, setFolder] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [backendError, setBackendError] = useState("");
  const [backendLog, setBackendLog] = useState("");
  useEffect(() => {
    Promise.all([window.printDeskDesktop!.getSetup(), window.printDeskDesktop!.getLicense(), window.printDeskDesktop!.getBackendStatus()])
      .then(async ([nextSetup, nextLicence, backend]) => {
        setSetup(nextSetup); setLicence(nextLicence); setBackendLog(backend.logFile);
        if (!nextLicence.active) return;
        if (!backend.ready || !window.printDeskDesktop!.gatewayUrl) throw new Error(backend.error || "The bundled backend did not start.");
        const response = await nativeFetch(`${window.printDeskDesktop!.gatewayUrl}/api/health`);
        if (!response.ok) throw new Error(`Bundled backend health check failed (${response.status}).`);
      }).catch((cause) => setBackendError(cause instanceof Error ? cause.message : "The bundled backend failed to start."));
  }, []);
  if (!setup || !licence) return <div className="flex h-dvh items-center justify-center bg-background text-foreground">Starting SMART PRINT...</div>;
  if (licence.active && backendError) return <div className="flex h-dvh items-center justify-center bg-background p-6 text-foreground"><div className="w-full max-w-2xl rounded-xl border border-red-500/50 bg-card p-6 shadow-2xl"><h1 className="text-xl font-bold text-red-400">SMART PRINT backend failed to start</h1><pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-3 text-xs">{backendError}</pre><p className="mt-3 break-all text-xs text-muted-foreground">Startup log: {backendLog}</p></div></div>;
  if (!setup.complete) return <div className="flex h-dvh items-center justify-center bg-background p-6 text-foreground"><div className="w-full max-w-xl rounded-xl border border-border bg-card p-6 shadow-2xl"><div className="text-xs font-medium text-primary">FIRST RUN SETUP</div><h1 className="mt-1 text-2xl font-bold">Welcome to SMART PRINT</h1><p className="mt-2 text-sm text-muted-foreground">Choose the master folder where customer files, jobs, exports and WhatsApp data will be stored.</p><div className="mt-5 min-h-12 break-all rounded border border-border bg-background p-3 text-sm text-muted-foreground">{folder || "No folder selected"}</div><button disabled={busy} onClick={async()=>{const result=await window.printDeskDesktop!.selectSaveFolder();if(result.folder)setFolder(result.folder);}} className="mt-3 w-full rounded border border-primary px-3 py-2 text-sm text-primary disabled:opacity-50">Choose Master Save Folder</button><button disabled={!folder||busy} onClick={async()=>{setBusy(true);setError("");try{const completed=await window.printDeskDesktop!.completeSetup(folder);const response=await fetch("http://127.0.0.1:3001/api/settings/storage",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({masterFolder:completed.masterFolder})});if(!response.ok)throw new Error((await response.json()).error||"Setup failed");setSetup({complete:true,masterFolder:completed.masterFolder});}catch(e){setError(e instanceof Error?e.message:"Setup failed");}finally{setBusy(false);}}} className="mt-3 w-full rounded bg-primary py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">{busy?"Creating folders...":"Complete Setup"}</button>{error&&<p className="mt-3 text-xs text-red-400">{error}</p>}<p className="mt-4 text-[11px] text-muted-foreground">© IM TECHNOLOGY</p></div></div>;
  if (!licence.active) return <div className="flex h-dvh items-center justify-center bg-background p-6 text-foreground"><div className="w-full max-w-xl rounded-xl border border-border bg-card p-6 shadow-2xl"><h1 className="text-xl font-bold">Activate SMART PRINT</h1><p className="mt-2 text-sm text-muted-foreground">Your 7-day free trial has expired. Activate a licence to restore WhatsApp, printing and customer processing.</p><div className="mt-3 select-all rounded border border-border bg-background p-3 text-center font-mono text-lg tracking-wider text-primary">{licence.machineCode}</div><textarea value={key} onChange={(event)=>setKey(event.target.value)} placeholder="Paste licence key" className="mt-4 h-28 w-full rounded border border-border bg-background p-3 text-xs outline-none focus:border-primary"/><button onClick={async()=>{setError("");const result=await window.printDeskDesktop!.activateLicense(key);if(result.ok)setLicence(await window.printDeskDesktop!.getLicense());else setError(result.error||"Activation failed");}} className="mt-3 w-full rounded bg-primary py-2 text-sm font-medium text-primary-foreground">Activate Licence</button>{error&&<p className="mt-3 text-xs text-red-400">{error}</p>}</div></div>;
  return <><Index />{licence.trial&&!licence.licensed&&<div className="pointer-events-none fixed bottom-2 right-2 z-[100] rounded bg-primary/90 px-2 py-1 text-[10px] font-medium text-primary-foreground shadow">Free trial: {licence.daysRemaining} day(s) remaining</div>}</>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><DesktopApp /></React.StrictMode>);

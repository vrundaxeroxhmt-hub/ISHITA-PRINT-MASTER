import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { Index } from "./routes/index";

declare global {
  interface Window { printDeskDesktop?: { getLicense: () => Promise<{ active: boolean; machineCode: string; error?: string }>; activateLicense: (key: string) => Promise<{ ok: boolean; error?: string }>; printPdf: (base64: string) => Promise<{ ok: boolean; error?: string }>; getPrintSettings: () => Promise<{settings: PrintSettings; printers: Array<{name:string;displayName?:string;isDefault?:boolean}>}>; setPrintSettings: (settings: PrintSettings) => Promise<{ok:boolean;settings:PrintSettings}> } }
}

export type PrintSettings = { printerName:string; paperSize:string; copies:number; landscape:boolean; color:boolean; duplexMode:"simplex"|"longEdge"|"shortEdge"; pagesPerSheet:number; scaleFactor:number };

function DesktopApp() {
  const [licence, setLicence] = useState<{ active: boolean; machineCode: string; error?: string } | null>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { window.printDeskDesktop?.getLicense().then(setLicence); }, []);
  if (!licence) return <div className="flex h-dvh items-center justify-center bg-background text-foreground">Starting ISHTA PRINT MASTER...</div>;
  if (!licence.active) return <div className="flex h-dvh items-center justify-center bg-background p-6 text-foreground"><div className="w-full max-w-xl rounded-xl border border-border bg-card p-6 shadow-2xl"><h1 className="text-xl font-bold">Activate ISHTA PRINT MASTER</h1><p className="mt-2 text-sm text-muted-foreground">Send this machine code to your licence administrator.</p><div className="mt-3 select-all rounded border border-border bg-background p-3 text-center font-mono text-lg tracking-wider text-primary">{licence.machineCode}</div><textarea value={key} onChange={(event) => setKey(event.target.value)} placeholder="Paste licence key (spaces and new lines are accepted)" className="mt-4 h-28 w-full rounded border border-border bg-background p-3 text-xs outline-none focus:border-primary" /><button onClick={async () => { setError(""); const result=await window.printDeskDesktop!.activateLicense(key); if(result.ok) setLicence(await window.printDeskDesktop!.getLicense()); else setError(result.error||"Activation failed"); }} className="mt-3 w-full rounded bg-primary py-2 text-sm font-medium text-primary-foreground">Activate Licence</button>{(error||licence.error)&&<p className="mt-3 text-xs text-red-400">{error||licence.error}</p>}</div></div>;
  return <Index />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DesktopApp />
  </React.StrictMode>,
);

import { useState } from "react";
import { CheckCircle2, Clipboard, FileKey2, KeyRound, ShieldCheck } from "lucide-react";

export type LicenseDetails = { customer?:string; licenseType?:string; issuedAt?:string; expiresAt?:string|null; machine?:string };
export type Entitlement = { active:boolean; licensed?:boolean; trial?:boolean; machineCode:string; error?:string; startedAt?:string; expiresAt?:string; daysRemaining?:number; licence?:LicenseDetails };

type Props = { entitlement:Entitlement; onActivated:(entitlement:Entitlement)=>void; onContinue:()=>void };

function displayDate(value?:string|null) {
  if (!value) return "Lifetime";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });
}

export function LicenseWindow({ entitlement, onActivated, onContinue }:Props) {
  const [key, setKey] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const activated = Boolean(entitlement.licensed && entitlement.licence);
  const copyMachineId = async () => navigator.clipboard.writeText(entitlement.machineCode);
  const loadFile = async () => {
    setError("");
    const result = await window.printDeskDesktop!.selectLicenseFile();
    if (result.key) { setKey(result.key); setFileName(result.fileName || "Selected license.lic"); }
    else if (result.error) setError(result.error);
  };
  const activate = async () => {
    setBusy(true); setError("");
    try {
      const result = await window.printDeskDesktop!.activateLicense(key);
      if (!result.ok) setError(result.error || "Activation failed.");
      else onActivated(await window.printDeskDesktop!.getLicense());
    } finally { setBusy(false); }
  };

  return <main className="flex min-h-dvh items-center justify-center bg-background p-5 text-foreground">
    <section className="w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
      <header className="flex items-center justify-between border-b border-border bg-gradient-to-r from-primary/15 to-transparent px-7 py-5">
        <div className="flex items-center gap-4"><div className="rounded-xl bg-primary/15 p-3 text-primary"><ShieldCheck className="h-7 w-7"/></div><div><h1 className="text-2xl font-bold tracking-tight">SMART PRINT</h1><p className="text-xs font-medium tracking-[0.22em] text-muted-foreground">IM TECHNOLOGY</p></div></div>
        <div className={`rounded-full border px-4 py-1.5 text-xs font-semibold ${activated ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : entitlement.active ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-red-500/40 bg-red-500/10 text-red-400"}`}>{activated ? "ACTIVATED" : entitlement.active ? `TRIAL · ${entitlement.daysRemaining} DAY(S) LEFT` : "TRIAL EXPIRED"}</div>
      </header>
      <div className="grid gap-6 p-7 md:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-5">
          <div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">License Status</p><h2 className="mt-1 text-xl font-semibold">{activated ? "License activated" : entitlement.active ? "Trial remaining" : "Activation required"}</h2><p className="mt-2 text-sm text-muted-foreground">{activated ? "This computer has a verified SMART PRINT license." : entitlement.active ? `You can continue using your trial for ${entitlement.daysRemaining} more day(s).` : "Your trial has ended. Enter a valid license to continue."}</p></div>
          <div><label className="text-xs font-medium text-muted-foreground">Machine ID</label><div className="mt-2 flex gap-2"><input readOnly aria-label="Machine ID" value={entitlement.machineCode} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-3 font-mono text-sm tracking-wider text-primary outline-none"/><button type="button" onClick={copyMachineId} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium hover:bg-accent"><Clipboard className="h-4 w-4"/>Copy</button></div></div>
          {activated ? <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm"><dt className="text-muted-foreground">Customer Name</dt><dd className="text-right font-medium">{entitlement.licence?.customer || "Licensed Customer"}</dd><dt className="text-muted-foreground">License Type</dt><dd className="text-right font-medium">{entitlement.licence?.licenseType || (entitlement.licence?.expiresAt ? "Fixed Term" : "Lifetime")}</dd><dt className="text-muted-foreground">Issue Date</dt><dd className="text-right">{displayDate(entitlement.licence?.issuedAt)}</dd><dt className="text-muted-foreground">Expiry Date</dt><dd className="text-right">{displayDate(entitlement.licence?.expiresAt)}</dd><dt className="text-muted-foreground">License Status</dt><dd className="flex items-center justify-end gap-1 text-emerald-400"><CheckCircle2 className="h-4 w-4"/>Verified</dd></dl> : null}
        </div>
        <div className="rounded-xl border border-border bg-background/60 p-5">
          <div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary"/><h2 className="font-semibold">Enter License Key</h2></div>
          <textarea value={key} onChange={(event)=>{setKey(event.target.value);setFileName("");}} placeholder="Paste the PD1 license key here" className="mt-4 h-36 w-full resize-none rounded-lg border border-border bg-background p-3 font-mono text-xs outline-none focus:border-primary"/>
          <div className="my-3 flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground"><span className="h-px flex-1 bg-border"/>or<span className="h-px flex-1 bg-border"/></div>
          <button type="button" onClick={loadFile} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-primary/50 px-3 py-3 text-sm text-primary hover:bg-primary/5"><FileKey2 className="h-4 w-4"/>{fileName || "Select License File (.lic)"}</button>
          {error ? <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">{error}</p> : null}
          <button type="button" disabled={!key.trim()||busy} onClick={activate} className="mt-4 w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-40">{busy ? "Validating…" : "Activate"}</button>
          {(entitlement.active || activated) ? <button type="button" onClick={onContinue} className="mt-2 w-full rounded-lg border border-border py-3 text-sm font-medium hover:bg-accent">{activated ? "Continue to SMART PRINT" : "Continue Trial"}</button> : null}
          <p className="mt-4 text-center text-[11px] text-muted-foreground">Whitespace and common WhatsApp formatting are cleaned automatically before secure signature validation.</p>
        </div>
      </div>
    </section>
  </main>;
}

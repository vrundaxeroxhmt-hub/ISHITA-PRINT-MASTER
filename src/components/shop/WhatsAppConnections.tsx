import { useCallback, useEffect, useState } from "react";
import { Cloud, LogOut, QrCode, RefreshCw, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { gatewayUrl } from "@/lib/gateway-url";

const API = gatewayUrl("/api");
type GatewayStatus = {
  baileys: { state: string; qr?: string | null; user?: { name: string; number: string; avatarUrl?: string } | null; error?: string | null };
  meta: { state: string; phoneNumber: string; displayName: string; webhookPath: string; error?: string | null };
};

export function WhatsAppConnections({ onContacts }: { onContacts: (contacts: unknown[]) => void }) {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [baileysOpen, setBaileysOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState({ accessToken: "", phoneNumberId: "", phoneNumber: "", displayName: "", verifyToken: "" });

  const refresh = useCallback(async () => {
    try {
      const [statusResponse, contactsResponse] = await Promise.all([fetch(`${API}/status`), fetch(`${API}/contacts`)]);
      if (!statusResponse.ok) throw new Error("WhatsApp gateway unavailable");
      setStatus(await statusResponse.json());
      if (contactsResponse.ok) onContacts(await contactsResponse.json());
      setError("");
    } catch { setError("Gateway offline"); }
  }, [onContacts]);

  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 500); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => { if (status?.baileys.state === "connected") setBaileysOpen(false); }, [status?.baileys.state]);
  const post = async (path: string, body?: unknown) => {
    const response = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Request failed");
    setStatus(result);
  };
  const connectBaileys = async () => { setBaileysOpen(true); setError(""); try { await post("/baileys/connect"); } catch (e) { setError(e instanceof Error ? e.message : "Connection failed"); } };
  const resetBaileys = async () => { setBaileysOpen(true); setError(""); try { await post("/baileys/reset"); } catch (e) { setError(e instanceof Error ? e.message : "Session reset failed"); } };
  const saveMeta = async () => { try { await post("/meta/config", meta); setMetaOpen(false); setMeta({ ...meta, accessToken: "" }); } catch (e) { setError(e instanceof Error ? e.message : "Meta setup failed"); } };
  const connected = status?.baileys.state === "connected";
  const metaConnected = status?.meta.state === "connected";

  return <>
    <div className="ml-4 flex items-center gap-2">
      <div className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium transition-all shadow-sm ${connected ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-300 shadow-emerald-950/20" : "border-border bg-card/60 text-muted-foreground"}`}>
        <span className="relative flex h-2 w-2">
          {connected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${connected ? "bg-emerald-400" : "bg-amber-500/80"}`}></span>
        </span>
        <Smartphone className="h-3.5 w-3.5" />
        <span className="truncate max-w-[170px]">{connected ? `${status?.baileys.user?.name} ${status?.baileys.user?.number}` : "Baileys disconnected"}</span>
        {!connected ? (
          <button onClick={connectBaileys} title="Show QR" className="ml-1 rounded p-1 transition-colors hover:bg-white/10 hover:text-foreground">
            <QrCode className="h-3.5 w-3.5" />
          </button>
        ) : (
          <div className="flex items-center gap-1 ml-1 border-l border-emerald-500/30 pl-1.5">
            <button onClick={resetBaileys} title="Reset WhatsApp Session" className="rounded p-0.5 transition-colors hover:bg-emerald-500/20 hover:text-emerald-200">
              <RefreshCw className="h-3 w-3" />
            </button>
            <button onClick={() => post("/baileys/logout")} title="Logout" className="rounded p-0.5 transition-colors hover:bg-rose-500/20 hover:text-rose-300">
              <LogOut className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      <div className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium transition-all shadow-sm ${metaConnected ? "border-sky-500/40 bg-sky-950/30 text-sky-300 shadow-sky-950/20" : "border-border bg-card/60 text-muted-foreground"}`}>
        <span className="relative flex h-2 w-2">
          {metaConnected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${metaConnected ? "bg-sky-400" : "bg-muted-foreground/60"}`}></span>
        </span>
        <Cloud className="h-3.5 w-3.5" />
        <span className="truncate max-w-[170px]">{metaConnected ? `${status?.meta.displayName} ${status?.meta.phoneNumber}` : "Meta disconnected"}</span>
        {!metaConnected ? (
          <div className="flex items-center gap-1 ml-1 border-l border-border pl-1.5">
            <button onClick={() => setMetaOpen(true)} className="rounded px-1.5 py-0.5 text-[10px] bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30">Connect</button>
            {status?.meta.state !== "disconnected" && (
              <button onClick={() => post("/meta/check")} title="Check connection" className="rounded p-0.5 transition-colors hover:bg-accent">
                <RefreshCw className="h-3 w-3" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1 ml-1 border-l border-sky-500/30 pl-1.5">
            <button onClick={() => post("/meta/check")} title="Check connection" className="rounded p-0.5 transition-colors hover:bg-sky-500/20 hover:text-sky-200">
              <RefreshCw className="h-3 w-3" />
            </button>
            <button onClick={() => post("/meta/logout")} title="Disconnect" className="rounded p-0.5 transition-colors hover:bg-rose-500/20 hover:text-rose-300">
              <LogOut className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
      {error && <span className="rounded-full bg-rose-950/40 border border-rose-500/30 px-2 py-0.5 text-[10px] font-medium text-rose-300">{error}</span>}
    </div>
    <Dialog open={baileysOpen} onOpenChange={setBaileysOpen}>
      <DialogContent className="sm:max-w-sm"><DialogHeader><DialogTitle>Connect Baileys WhatsApp</DialogTitle><DialogDescription>WhatsApp → Linked devices → Link a deviceથી QR scan કરો.</DialogDescription></DialogHeader>
        <div className="flex min-h-64 items-center justify-center">{status?.baileys.qr ? <img src={status.baileys.qr} className="h-64 w-64" alt="WhatsApp QR code" /> : connected ? <div className="text-center text-status-ready">Connected as<br/><b>{status?.baileys.user?.name} {status?.baileys.user?.number}</b></div> : status?.baileys.error ? <div className="max-w-xs text-center text-sm text-destructive">{status.baileys.error}</div> : <div className="text-center text-sm text-muted-foreground">Waiting for WhatsApp...</div>}</div>
        <Button variant="outline" className="w-full" onClick={resetBaileys}><RefreshCw className="mr-2 h-4 w-4"/>Reset WhatsApp Session</Button>
      </DialogContent>
    </Dialog>
    <Dialog open={metaOpen} onOpenChange={setMetaOpen}>
      <DialogContent><DialogHeader><DialogTitle>Connect Meta Cloud API</DialogTitle><DialogDescription>Meta Developer Dashboard → WhatsApp → API Setupમાંથી credentials અહીં નાખો. તે ફક્ત આ local PC પર save થશે.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1 text-xs">Permanent Access Token<Input type="password" placeholder="EAAG..." value={meta.accessToken} onChange={(e) => setMeta({ ...meta, accessToken: e.target.value })} /></label>
          <label className="grid gap-1 text-xs">Phone Number ID<Input placeholder="Meta Phone Number ID" value={meta.phoneNumberId} onChange={(e) => setMeta({ ...meta, phoneNumberId: e.target.value })} /></label>
          <label className="grid gap-1 text-xs">WhatsApp Number<Input placeholder="+91..." value={meta.phoneNumber} onChange={(e) => setMeta({ ...meta, phoneNumber: e.target.value })} /></label>
          <label className="grid gap-1 text-xs">Display Name<Input placeholder="Your business name" value={meta.displayName} onChange={(e) => setMeta({ ...meta, displayName: e.target.value })} /></label>
          <label className="grid gap-1 text-xs">Webhook Verify Token<Input placeholder="Create any private verify token" value={meta.verifyToken} onChange={(e) => setMeta({ ...meta, verifyToken: e.target.value })} /></label>
          <Button onClick={saveMeta}>Save Meta connection</Button>
          <p className="text-xs text-muted-foreground">Webhook: your public HTTPS URL + <code>/api/meta/webhook</code></p>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}

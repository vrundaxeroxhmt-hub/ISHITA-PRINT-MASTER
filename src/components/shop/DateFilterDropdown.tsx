import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";

export type DateFilterValue = "today" | "2days" | "3days" | "custom";

const labels: Record<DateFilterValue, string> = {
  today: "Today",
  "2days": "Last 2 Days",
  "3days": "Last 3 Days",
  custom: "Custom Days",
};

export function DateFilterDropdown({ value, onChange, customDays, onCustomDaysChange, prefix = "" }: { value: DateFilterValue; onChange: (value: DateFilterValue) => void; customDays: number; onCustomDaysChange: (days: number) => void; prefix?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return <div ref={root} className="flex items-center gap-1.5"><div className="relative">
    <button type="button" onClick={() => setOpen((current) => !current)} className="flex min-w-[125px] items-center gap-2 rounded-xl border border-border bg-card/70 px-2.5 py-1 text-[11px] font-medium text-foreground transition-all hover:border-primary/50 hover:bg-card shadow-sm">
      <CalendarDays className="h-3.5 w-3.5 text-primary" /><span className="flex-1 truncate text-left">{prefix}{labels[value]}</span><ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180 text-primary" : ""}`} />
    </button>
    {open && <div className="absolute right-0 top-full z-[100] mt-1.5 min-w-[155px] overflow-hidden rounded-xl border border-border bg-card/95 p-1.5 shadow-2xl backdrop-blur-xl">
      {(Object.keys(labels) as DateFilterValue[]).map((option) => <button type="button" key={option} onClick={() => { onChange(option); setOpen(false); }} className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] font-medium transition-all ${value === option ? "bg-primary text-primary-foreground shadow-sm" : "text-foreground hover:bg-primary/15 hover:text-primary"}`}>{labels[option]}</button>)}
    </div>}
  </div>{value === "custom" && <label className="flex items-center gap-1 rounded-xl border border-border bg-card/70 px-2.5 py-1 text-[10px] text-muted-foreground"><input type="number" min={1} max={365} value={customDays} onChange={(event) => onCustomDaysChange(Math.max(1, Number(event.target.value) || 1))} className="w-10 bg-transparent font-medium text-foreground outline-none accent-primary" /> days</label>}</div>;
}

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
  return <div ref={root} className="flex items-center gap-1"><div className="relative">
    <button type="button" onClick={() => setOpen((current) => !current)} className="flex min-w-[118px] items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1 text-[10px] text-foreground hover:border-primary/60">
      <CalendarDays className="h-3 w-3 text-muted-foreground" /><span className="flex-1 truncate text-left">{prefix}{labels[value]}</span><ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    {open && <div className="absolute right-0 top-full z-[100] mt-1 min-w-[150px] overflow-hidden rounded-md border border-border bg-card p-1 shadow-2xl">
      {(Object.keys(labels) as DateFilterValue[]).map((option) => <button type="button" key={option} onClick={() => { onChange(option); setOpen(false); }} className={`block w-full rounded px-2 py-1.5 text-left text-[10px] ${value === option ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent"}`}>{labels[option]}</button>)}
    </div>}
  </div>{value === "custom" && <label className="flex items-center gap-1 rounded border border-border bg-background/60 px-2 py-1 text-[9px]"><input type="number" min={1} max={365} value={customDays} onChange={(event) => onCustomDaysChange(Math.max(1, Number(event.target.value) || 1))} className="w-12 bg-transparent text-foreground outline-none" /> days</label>}</div>;
}

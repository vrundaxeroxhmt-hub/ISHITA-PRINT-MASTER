import { useState } from "react";
import { Search, Pencil, Check, X } from "lucide-react";
import type { Customer } from "@/lib/mock-data";
import { Avatar } from "./Avatar";
import { relTime } from "./utils";

export function CustomerList({
  customers,
  selectedId,
  onSelect,
  onRename,
  nameFontSize,
  mobileFontSize,
}: {
  customers: Customer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  nameFontSize: number;
  mobileFontSize: number;
}) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.mobile.includes(query),
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card/10">
      <div className="shrink-0 border-b border-border/80 p-3 bg-gradient-to-r from-card/60 to-card/40 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold tracking-wider uppercase text-foreground/90">Customers</h2>
          <span className="ml-auto rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary border border-primary/30">
            {customers.length}
          </span>
        </div>
        <div className="relative mt-2.5">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-primary/70 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or mobile..."
            className="w-full rounded-xl border border-border/80 bg-card/60 py-1.5 pl-8 pr-3 text-xs outline-none transition-all placeholder:text-muted-foreground/60 focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/30 shadow-inner"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 space-y-1">
        {filtered.map((c) => {
          const active = c.id === selectedId;
          const isEditing = editingId === c.id;
          return (
            <button
              key={c.id}
              onClick={() => !isEditing && onSelect(c.id)}
              className={`group relative flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-150 ${
                active
                  ? "border-primary/60 bg-gradient-to-r from-primary/20 via-primary/10 to-card/70 text-foreground shadow-md shadow-purple-950/40 ring-1 ring-primary/40"
                  : "border-transparent bg-card/20 hover:border-border/60 hover:bg-card/50 text-foreground"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-2.5 bottom-2.5 w-1 rounded-r-full bg-primary shadow-sm shadow-primary" />
              )}
              <Avatar name={c.name} hue={c.avatarHue} size={38} src={c.avatarUrl} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {isEditing ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          onRename(c.id, draft.trim() || c.name);
                          setEditingId(null);
                        } else if (e.key === "Escape") {
                          setEditingId(null);
                        }
                      }}
                      style={{ fontSize: nameFontSize }}
                      className="min-w-0 flex-1 rounded-lg border border-primary bg-card px-2 py-0.5 text-xs outline-none ring-2 ring-primary/30"
                    />
                  ) : (
                    <span style={{ fontSize: nameFontSize }} className={`truncate font-semibold leading-tight ${active ? "text-foreground" : "text-foreground/90 group-hover:text-foreground"}`}>{c.name}</span>
                  )}
                  {isEditing ? (
                    <>
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRename(c.id, draft.trim() || c.name);
                          setEditingId(null);
                        }}
                        className="rounded p-0.5 text-emerald-400 hover:bg-emerald-950/50"
                      >
                        <Check className="h-3 w-3" />
                      </span>
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(null);
                        }}
                        className="rounded p-0.5 text-rose-400 hover:bg-rose-950/50"
                      >
                        <X className="h-3 w-3" />
                      </span>
                    </>
                  ) : (
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDraft(c.name);
                        setEditingId(c.id);
                      }}
                      className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-primary/20 hover:text-primary transition-all group-hover:opacity-100"
                    >
                      <Pencil className="h-3 w-3" />
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground font-medium">
                  <span style={{ fontSize: mobileFontSize }} className="truncate leading-tight">{c.mobile}</span>
                  {c.source && c.source !== "mock" && (
                    <span className="rounded-md border border-primary/30 bg-primary/15 px-1.5 py-0.2 uppercase text-[9px] font-bold text-primary">{c.source}</span>
                  )}
                  <span>·</span>
                  <span className="shrink-0 text-muted-foreground/80">{relTime(c.lastMessageAt)}</span>
                </div>
              </div>
              {c.unread > 0 && (
                <span className="rounded-full bg-gradient-to-tr from-purple-600 to-indigo-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-md shadow-purple-900/50">
                  {c.unread}
                </span>
              )}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="p-8 text-center text-xs font-medium text-muted-foreground/70">No customers found.</div>
        )}
      </div>
    </div>
  );
}

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
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border p-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Customers</h2>
          <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
            {customers.length}
          </span>
        </div>
        <div className="relative mt-2">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or mobile"
            className="w-full rounded-md border border-input bg-input/30 py-1.5 pl-7 pr-2 text-xs outline-none focus:border-primary"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {filtered.map((c) => {
          const active = c.id === selectedId;
          const isEditing = editingId === c.id;
          return (
            <button
              key={c.id}
              onClick={() => !isEditing && onSelect(c.id)}
              className={`flex w-full items-center gap-3 border-b border-border/50 px-3 py-2.5 text-left transition-colors ${
                active ? "bg-primary/10" : "hover:bg-accent/40"
              }`}
            >
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
                      className="min-w-0 flex-1 rounded border border-primary bg-input/40 px-1 py-0.5 outline-none"
                    />
                  ) : (
                    <span style={{ fontSize: nameFontSize }} className="truncate font-medium leading-tight">{c.name}</span>
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
                        className="rounded p-0.5 text-status-ready hover:bg-accent"
                      >
                        <Check className="h-3 w-3" />
                      </span>
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(null);
                        }}
                        className="rounded p-0.5 text-destructive hover:bg-accent"
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
                      className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
                    >
                      <Pencil className="h-3 w-3" />
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span style={{ fontSize: mobileFontSize }} className="truncate leading-tight">{c.mobile}</span>
                  {c.source && c.source !== "mock" && (
                    <span className="rounded bg-primary/10 px-1 uppercase text-primary">{c.source}</span>
                  )}
                  <span>·</span>
                  <span className="shrink-0">{relTime(c.lastMessageAt)}</span>
                </div>
              </div>
              {c.unread > 0 && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                  {c.unread}
                </span>
              )}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="p-6 text-center text-xs text-muted-foreground">No customers found.</div>
        )}
      </div>
    </div>
  );
}

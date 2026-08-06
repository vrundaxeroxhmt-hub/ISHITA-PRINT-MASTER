import { statusClasses, statusLabel } from "./utils";
import type { JobStatus } from "@/lib/mock-data";

export function StatusBadge({ status }: { status: JobStatus }) {
  const isLive = status === "in_review" || status === "in_process";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase shadow-xs ${statusClasses(status)}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {isLive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
      </span>
      {statusLabel(status)}
    </span>
  );
}
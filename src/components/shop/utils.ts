export function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function statusLabel(s: string) {
  switch (s) {
    case "in_review":
      return "In Review";
    case "in_process":
      return "In Process";
    case "print_ready":
      return "Print Ready";
    case "printed":
      return "Printed";
    default:
      return s;
  }
}

export function statusClasses(s: string) {
  switch (s) {
    case "in_review":
      return "bg-status-review/15 text-status-review border-status-review/30";
    case "in_process":
      return "bg-status-process/15 text-status-process border-status-process/30";
    case "print_ready":
      return "bg-status-ready/15 text-status-ready border-status-ready/30";
    case "printed":
      return "bg-status-printed/20 text-muted-foreground border-status-printed/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}
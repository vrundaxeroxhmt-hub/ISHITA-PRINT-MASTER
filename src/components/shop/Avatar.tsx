import { initials } from "./utils";

export function Avatar({ name, hue, size = 40, src }: { name: string; hue: number; size?: number; src?: string }) {
  const bg = `oklch(0.52 0.16 ${hue})`;
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className="shrink-0 rounded-full object-cover ring-1 ring-white/15 shadow-sm"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-sm ring-1 ring-white/15"
      style={{ width: size, height: size, backgroundColor: bg, fontSize: size * 0.36 }}
    >
      {initials(name)}
    </div>
  );
}

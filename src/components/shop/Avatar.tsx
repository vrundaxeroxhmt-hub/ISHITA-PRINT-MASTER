import { initials } from "./utils";

export function Avatar({ name, hue, size = 40, src }: { name: string; hue: number; size?: number; src?: string }) {
  const bg = `oklch(0.55 0.14 ${hue})`;
  if (src) {
    return <img src={src} alt={name} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: bg, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </div>
  );
}

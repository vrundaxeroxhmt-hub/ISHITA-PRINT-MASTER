import { useRef } from "react";

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  neutral = 0,
  onChange,
  suffix = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  neutral?: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  const dbl = useRef<number>(0);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-medium text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className={`tabular-nums ${value === neutral ? "text-muted-foreground" : "text-primary"}`}>
            {value > 0 && neutral === 0 ? "+" : ""}
            {Number.isInteger(step) ? value : value.toFixed(1)}
            {suffix}
          </span>
          <button
            onClick={() => onChange(neutral)}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Reset"
          >
            ↺
          </button>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onDoubleClick={() => {
          const now = Date.now();
          if (now - dbl.current < 400) onChange(neutral);
          dbl.current = now;
        }}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary"
      />
    </div>
  );
}
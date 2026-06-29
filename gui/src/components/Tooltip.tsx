import { useRef, useState } from "react";
import { HelpCircle } from "lucide-react";

/** Hover/focus tooltip rendered in a fixed overlay (no clipping). */
export function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.top });
  };
  const hide = () => setPos(null);

  return (
    <span className="tip" ref={ref} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} tabIndex={0}>
      {children}
      {pos && (
        <span className="tip-pop" style={{ left: pos.x, top: pos.y, transform: "translate(-50%, calc(-100% - 8px))" }}>
          {text}
        </span>
      )}
    </span>
  );
}

/** A small "?" help affordance with a tooltip. */
export function Help({ text }: { text: string }) {
  return (
    <Tooltip text={text}>
      <span className="help"><HelpCircle size={13} /></span>
    </Tooltip>
  );
}

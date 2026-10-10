import { useRef } from "react";
import { cn } from "../utils/cn";

const MAX_TILT = 6; // degrees

/**
 * A card that tilts in 3D toward the pointer (CSS perspective + rotateX/Y). Pure decoration over
 * normal, fully usable content: it does nothing for touch / coarse pointers or reduced motion, and
 * never intercepts clicks or keyboard focus.
 */
export function TiltCard({ children, className, innerClassName, max = MAX_TILT, ...rest }) {
  const ref = useRef(null);
  const enabled = () =>
    typeof window !== "undefined" &&
    window.matchMedia &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
    window.matchMedia("(pointer: fine)").matches;

  const onMove = (e) => {
    const el = ref.current;
    if (!el || !enabled()) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `rotateX(${(-y * max * 2).toFixed(2)}deg) rotateY(${(x * max * 2).toFixed(2)}deg)`;
  };
  const reset = () => {
    if (ref.current) ref.current.style.transform = "";
  };

  return (
    <div
      className={cn("tilt-scene", className)}
      onPointerMove={onMove}
      onPointerLeave={reset}
      {...rest}
    >
      <div ref={ref} className={cn("tilt-card", innerClassName)} data-testid="tilt-card">
        {children}
      </div>
    </div>
  );
}
export default TiltCard;

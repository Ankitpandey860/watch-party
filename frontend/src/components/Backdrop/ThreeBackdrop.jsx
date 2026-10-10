import { useEffect, useRef, useState } from "react";
import { detectCapabilities, EFFECTS_EVENT } from "../../three/capabilities";
import { cn } from "../../utils/cn";

/**
 * Interactive 3D backdrop. Three.js is loaded LAZILY (dynamic import) and only when the device can
 * and should run it; a CSS gradient fallback is always rendered underneath, so there is never a
 * blank frame and no-WebGL / reduced-motion / low-power / opted-out users get a fully working page.
 *
 * The canvas is decorative (aria-hidden). Anything it can trigger (e.g. clicking the screen) is
 * also available as a real, labelled button in the page, so nothing depends on the 3D layer.
 */
export function ThreeBackdrop({
  variant = "hero",
  interactive = true,
  playing = false,
  participants,
  onActivate,
  controllerRef,
  className,
}) {
  const canvasRef = useRef(null);
  const ctrl = useRef(null);
  const latest = useRef({ playing, participants, onActivate });
  latest.current = { playing, participants, onActivate };

  // Start "off" so server and first client render match; real capabilities are read after mount.
  const [caps, setCaps] = useState({ mode: "off", reason: "pending" });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const read = () => setCaps(detectCapabilities());
    read();
    window.addEventListener(EFFECTS_EVENT, read);
    return () => window.removeEventListener(EFFECTS_EVENT, read);
  }, []);

  const active = caps.mode !== "off" && !failed;

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let controller = null;
    import("../../three/scene")
      .then(({ mountScene }) => {
        if (cancelled || !canvasRef.current) return;
        controller = mountScene({
          canvas: canvasRef.current,
          variant,
          mode: caps.mode,
          interactive,
          onActivate: () => latest.current.onActivate?.(),
          onContextLost: () => setFailed(true),
        });
        ctrl.current = controller;
        if (controllerRef) controllerRef.current = controller;
        controller.setState({
          playing: latest.current.playing,
          participants: latest.current.participants,
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      controller?.dispose();
      ctrl.current = null;
      if (controllerRef) controllerRef.current = null;
    };
  }, [active, caps.mode, variant, interactive, controllerRef]);

  useEffect(() => {
    ctrl.current?.setState({ playing, participants });
  }, [playing, participants]);

  return (
    <div
      className={cn("absolute inset-0 overflow-hidden", className)}
      aria-hidden="true"
      data-testid="backdrop"
      data-mode={active ? caps.mode : "off"}
    >
      <div className="backdrop-static" />
      {active && <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />}
    </div>
  );
}

export default ThreeBackdrop;

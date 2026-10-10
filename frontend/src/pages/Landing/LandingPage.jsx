import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Link2, MessageCircle, ShieldCheck, Users, Sparkles, Hand } from "lucide-react";
import { TopBar } from "../../components/TopBar/TopBar";
import { ThreeBackdrop } from "../../components/Backdrop/ThreeBackdrop";
import { TiltCard } from "../../components/TiltCard";
import { Button } from "../../components/Buttons/Button";
import { useAuth } from "../../context/AuthContext";

const STEPS = [
  {
    icon: Sparkles,
    title: "Sign in & create",
    text: "Create a room with Google or a one-time email code. You become the host.",
  },
  {
    icon: Link2,
    title: "Share the link",
    text: "Friends open the invite link, type a name, and they're in. No account needed.",
  },
  {
    icon: Users,
    title: "Watch in sync",
    text: "Play, pause and seek together. Chat, and hand out moderator controls.",
  },
];

export function LandingPage() {
  const navigate = useNavigate();
  const { isUser, status } = useAuth();
  const sceneRef = useRef(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");

  const start = () => {
    if (isUser) navigate({ to: "/create" });
    else navigate({ to: "/auth", search: { returnTo: "/create" } });
  };

  // The CTA button and the 3D screen are two doors to the same action: the button first plays the
  // "dive through the screen" animation when the 3D scene is running, then navigates.
  const onCta = () => {
    if (sceneRef.current) sceneRef.current.activate();
    else start();
  };

  const join = (e) => {
    e.preventDefault();
    const roomId = code
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (roomId.length < 4) {
      setCodeError("Enter the room code from your invite.");
      return;
    }
    setCodeError("");
    navigate({ to: "/room/$roomId", params: { roomId } });
  };

  return (
    <div className="relative min-h-dvh">
      <TopBar returnTo="/" />

      <main>
        {/* ---- hero: interactive 3D cinema ------------------------------------------------------ */}
        <section
          className="relative isolate min-h-[calc(100dvh-4rem)] overflow-hidden"
          aria-labelledby="hero-title"
        >
          <ThreeBackdrop variant="hero" interactive onActivate={start} controllerRef={sceneRef} />
          <div className="pointer-events-none relative z-10 mx-auto flex min-h-[calc(100dvh-4rem)] max-w-7xl flex-col justify-between px-4 pb-8 pt-10 sm:px-6 lg:pt-16">
            <div className="max-w-xl">
              <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Private rooms · secure
                sign-in
              </p>
              <h1
                id="hero-title"
                className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl"
              >
                Watch together,
                <br />
                <span className="gradient-text">perfectly in sync.</span>
              </h1>
              <p className="mt-4 max-w-md text-base text-muted-foreground sm:text-lg">
                Pause once and everyone pauses. Drop a YouTube link, share the invite, and press
                play together.
              </p>
              <div className="pointer-events-auto mt-6 flex flex-wrap items-center gap-3">
                <Button size="lg" onClick={onCta} disabled={status === "loading"}>
                  {isUser ? "Create a room" : "Start a party"}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
                <form
                  onSubmit={join}
                  className="flex items-start gap-2"
                  aria-label="Join a room with a code"
                >
                  <div>
                    <label htmlFor="join-code" className="sr-only">
                      Room code
                    </label>
                    <input
                      id="join-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 16))}
                      placeholder="Room code"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      aria-invalid={Boolean(codeError)}
                      aria-describedby={codeError ? "join-code-error" : undefined}
                      className="h-12 w-36 rounded-xl border border-white/10 bg-white/[0.06] px-4 font-mono text-sm uppercase tracking-widest backdrop-blur placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground/70 focus:border-primary/60 focus:outline-none"
                    />
                    {codeError && (
                      <p id="join-code-error" className="mt-1 text-xs text-destructive">
                        {codeError}
                      </p>
                    )}
                  </div>
                  <Button type="submit" variant="glass" size="lg">
                    Join
                  </Button>
                </form>
              </div>
            </div>
            <p className="mt-10 hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <Hand className="h-3.5 w-3.5" aria-hidden="true" /> Drag the scene to look around ·
              click the screen to start
            </p>
          </div>
        </section>

        {/* ---- how it works --------------------------------------------------------------------- */}
        <section
          className="mx-auto max-w-7xl px-4 py-16 sm:px-6"
          aria-labelledby="how-title"
          id="features"
        >
          <h2 id="how-title" className="text-2xl font-semibold tracking-tight">
            How it works
          </h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, text }, i) => (
              <li key={title}>
                <TiltCard innerClassName="glass h-full rounded-2xl p-6">
                  <div className="tilt-lift">
                    <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl gradient-hero text-white shadow-glow">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                      Step {i + 1}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold">{title}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground">{text}</p>
                  </div>
                </TiltCard>
              </li>
            ))}
          </ol>
          <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
            <MessageCircle className="h-4 w-4" aria-hidden="true" /> Live chat, host &amp; moderator
            controls, and removal tools are built in.
          </p>
        </section>
      </main>
    </div>
  );
}
export default LandingPage;

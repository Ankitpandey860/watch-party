import { useEffect, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Mail, MailCheck } from "lucide-react";
import { TopBar } from "../../components/TopBar/TopBar";
import { ThreeBackdrop } from "../../components/Backdrop/ThreeBackdrop";
import { TiltCard } from "../../components/TiltCard";
import { Button } from "../../components/Buttons/Button";
import { Input } from "../../components/Input";
import { Spinner } from "../../components/Loader";
import { useAuth } from "../../context/AuthContext";

const URL_ERRORS = {
  cancelled: "Google sign-in was cancelled.",
  oauth_failed: "Google sign-in didn't complete. Please try again.",
  email_unverified: "Your Google email address isn't verified, so we can't sign you in with it.",
  google_unavailable: "Google sign-in isn't available right now.",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"
      />
      <path
        fill="#FBBC05"
        d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

export function AuthPage() {
  const { returnTo = "/", error: urlError } = useSearch({ strict: false });
  const auth = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState("choose"); // choose | email | code | done
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    urlError ? URL_ERRORS[urlError] || "Sign-in failed. Please try again." : "",
  );
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const explain = (err) => {
    if (err?.code === "RATE_LIMITED")
      return `Too many attempts. Try again in ${err.retryAfterSeconds || 60} seconds.`;
    return err?.message || "Something went wrong. Please try again.";
  };

  const sendCode = async (e) => {
    e?.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await auth.requestOtp(email.trim());
      setCooldown(res?.resendAfterSeconds ?? 60);
      setCode("");
      setStep("code");
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await auth.verifyOtp(email.trim(), code);
      setStep("done");
      navigate({ to: returnTo });
    } catch (err) {
      setError(explain(err));
      setBusy(false);
    }
  };

  const showGoogle = auth.providers.google;
  const showEmail = auth.providers.email;

  let body;
  if (auth.status === "loading") {
    body = (
      <div className="flex flex-col items-center gap-3 py-8" role="status">
        <Spinner />
        <p className="text-sm text-muted-foreground">
          {auth.slow ? "Waking up the server… this can take up to a minute." : "Loading…"}
        </p>
      </div>
    );
  } else if (auth.status === "unreachable") {
    body = (
      <div className="space-y-4 text-center" role="alert">
        <p className="text-sm text-muted-foreground">We can't reach the server right now.</p>
        <Button onClick={() => auth.refresh()} variant="outline">
          Try again
        </Button>
      </div>
    );
  } else if (auth.isUser && step !== "done") {
    body = (
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-success" aria-hidden="true" />
        <p className="text-sm">
          You're signed in as <strong>{auth.principal.displayName}</strong>.
        </p>
        <div className="flex justify-center gap-2">
          <Button onClick={() => navigate({ to: returnTo })}>Continue</Button>
          <Button variant="ghost" onClick={() => auth.logout()}>
            Sign out
          </Button>
        </div>
      </div>
    );
  } else if (step === "code") {
    body = (
      <form onSubmit={verify} className="space-y-4" noValidate>
        <button
          type="button"
          onClick={() => {
            setStep("email");
            setError("");
          }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Use a different email
        </button>
        <div className="text-center">
          <MailCheck className="mx-auto mb-2 h-8 w-8 text-primary" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Check your email</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            We sent a 6-digit code to <strong className="text-foreground">{email.trim()}</strong>.
          </p>
        </div>
        <Input
          id="otp-code"
          label="6-digit code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="••••••"
          autoFocus
          className="text-center font-mono text-xl tracking-[0.5em]"
          error={error}
        />
        <Button type="submit" className="w-full" loading={busy} disabled={code.length !== 6}>
          Verify &amp; continue
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Didn't get it?{" "}
          <button
            type="button"
            onClick={sendCode}
            disabled={cooldown > 0 || busy}
            className="font-medium text-foreground underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
        </p>
      </form>
    );
  } else if (step === "email") {
    body = (
      <form onSubmit={sendCode} className="space-y-4" noValidate>
        <button
          type="button"
          onClick={() => {
            setStep("choose");
            setError("");
          }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back
        </button>
        <Input
          id="email"
          type="email"
          label="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          autoFocus
          error={error}
        />
        <Button type="submit" className="w-full" loading={busy} disabled={!email.trim()}>
          Email me a code
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          We'll create your account the first time you sign in.
        </p>
      </form>
    );
  } else {
    body = (
      <div className="space-y-3">
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {showGoogle && (
          <a
            href={auth.googleStartUrl(returnTo)}
            className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-white text-sm font-medium text-neutral-900 transition hover:bg-white/90"
          >
            <GoogleMark /> Continue with Google
          </a>
        )}
        {showEmail && (
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={() => {
              setError("");
              setStep("email");
            }}
          >
            <Mail className="h-4 w-4" aria-hidden="true" /> Continue with email
          </Button>
        )}
        {!showGoogle && !showEmail && (
          <p className="text-center text-sm text-muted-foreground" role="alert">
            Sign-in isn't configured on this server yet.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="relative min-h-dvh">
      <ThreeBackdrop variant="calm" interactive={false} className="fixed" />
      <TopBar showAccount={false} />
      <main className="relative z-10 mx-auto flex max-w-md flex-col items-center px-4 py-12 sm:py-20">
        <TiltCard className="w-full" innerClassName="glass rounded-3xl p-6 shadow-elevated sm:p-8">
          <div className="tilt-lift">
            <h1 className="text-2xl font-semibold tracking-tight">
              {step === "code" ? "Enter your code" : "Sign in to Watchly"}
            </h1>
            {step === "choose" && (
              <p className="mb-5 mt-1 text-sm text-muted-foreground">
                Hosting needs an account. Joining a friend's room never does.
              </p>
            )}
            <div className={step === "choose" ? "" : "mt-4"}>{body}</div>
          </div>
        </TiltCard>
      </main>
    </div>
  );
}
export default AuthPage;

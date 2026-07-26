import { Play, Users, Zap, Sparkles } from "lucide-react";
import { Navbar } from "../../components/Navbar/Navbar";
import { CreateRoomCard } from "./CreateRoomCard";
import { JoinRoomCard } from "./JoinRoomCard";

const features = [
  {
    icon: Zap,
    title: "Perfectly in sync",
    desc: "Play, pause, seek — everyone sees the same frame at the same moment.",
  },
  {
    icon: Users,
    title: "Roles & moderation",
    desc: "Hosts and moderators keep the party smooth with granular controls.",
  },
  {
    icon: Sparkles,
    title: "One link away",
    desc: "Create a room, share the code, watch together instantly.",
  },
];

export function HomePage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 pb-24 pt-12 sm:px-6 sm:pt-20">
        <section className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.7_0.17_155)]" />
              Live watch parties. Zero setup.
            </div>
            <h1 className="text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
              Watch YouTube <br />
              <span className="gradient-text">Together</span>
            </h1>
            <p className="mt-5 max-w-lg text-base text-muted-foreground sm:text-lg">
              Spin up a room, drop a link, and enjoy videos with friends in perfect
              sync — with playful controls, roles, and a beautiful dark UI.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {features.map(({ icon: Icon, title, desc }) => (
                <div
                  key={title}
                  className="rounded-2xl border border-white/10 bg-white/[0.02] p-4"
                >
                  <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06]">
                    <Icon className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <CreateRoomCard />
            <JoinRoomCard />
          </div>
        </section>

        <section id="features" className="mt-24">
          <div className="glass overflow-hidden rounded-3xl p-6 sm:p-10">
            <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
              <div>
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                  Made for movie nights
                </p>
                <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">
                  A cinema in your browser.
                </h2>
                <p className="mt-2 max-w-lg text-sm text-muted-foreground">
                  Every action — play, pause, seek, change video — feels instant.
                  Built for late-night rewatches and Friday premieres.
                </p>
              </div>
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl gradient-hero shadow-glow">
                <Play className="h-6 w-6 fill-white text-white" />
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default HomePage;
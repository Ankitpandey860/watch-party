import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { Button } from "../Buttons/Button";

export function Navbar({ right }) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-hero shadow-glow group-hover:brightness-110 transition">
            <Play className="h-4 w-4 fill-white text-white" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight">Watchly</p>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Watch Party
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          {right ?? (
            <>
              <a
                href="#features"
                className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline"
              >
                Features
              </a>
              <Link to="/">
                <Button variant="glass" size="sm">
                  New Room
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export default Navbar;
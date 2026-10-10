import { Link } from "@tanstack/react-router";
import { Logo } from "../Logo";
import { EffectsToggle } from "../Backdrop/EffectsToggle";
import { AccountMenu } from "../Account/AccountMenu";

/** App header: brand, optional page-specific controls (`children`), 3D toggle and the account menu. */
export function TopBar({ children, returnTo = "/", showAccount = true }) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link to="/" className="group flex items-center gap-2.5" aria-label="Watchly home">
          <Logo size={34} className="transition group-hover:brightness-110" />
          <span className="leading-tight">
            <span className="block text-sm font-semibold tracking-tight">Watchly</span>
            <span className="hidden text-[10px] uppercase tracking-widest text-muted-foreground sm:block">
              Watch Party
            </span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          {children}
          <EffectsToggle className="hidden sm:inline-flex" />
          {showAccount && <AccountMenu returnTo={returnTo} />}
        </div>
      </div>
    </header>
  );
}
export default TopBar;

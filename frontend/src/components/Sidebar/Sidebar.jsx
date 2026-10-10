import { cn } from "../../utils/cn";

export function Sidebar({ className = "", children }) {
  return (
    <aside
      className={cn(
        "flex h-full flex-col rounded-2xl border border-white/10 bg-sidebar",
        className,
      )}
    >
      {children}
    </aside>
  );
}

export default Sidebar;

import { cn } from "../../utils/cn";

export function Skeleton({ className = "" }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-lg bg-white/[0.06]",
        className,
      )}
    />
  );
}

export function ParticipantSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl p-3">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-2.5 w-16" />
      </div>
    </div>
  );
}

export function PlayerSkeleton() {
  return <Skeleton className="aspect-video w-full rounded-2xl" />;
}

export default Skeleton;
/** Shimmer placeholder block; compose into page-level skeletons. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton rounded-xl ${className}`} />;
}

export function CardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="glass space-y-3 rounded-3xl p-5">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-3.5 ${i % 2 ? "w-1/2" : "w-3/4"}`} />
      ))}
    </div>
  );
}

export function ExpenseSkeleton() {
  return (
    <div className="glass flex items-center gap-4 rounded-3xl p-4">
      <Skeleton className="size-11 rounded-2xl" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <Skeleton className="h-4 w-14" />
    </div>
  );
}

export function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <ExpenseSkeleton key={i} />
      ))}
    </div>
  );
}

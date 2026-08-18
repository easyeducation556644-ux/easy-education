export default function LearningPageSkeleton({ variant = "list" }) {
  if (variant === "watch") {
    return (
      <div className="min-h-screen bg-background" aria-busy="true" aria-label="Loading class">
        <div className="container mx-auto max-w-6xl px-4 py-6">
          <div className="mb-6 h-5 w-40 animate-pulse rounded bg-muted" />
          <div className="mb-4 h-8 w-2/3 animate-pulse rounded bg-muted" />
          <div className="mb-8 h-4 w-1/3 animate-pulse rounded bg-muted" />

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <div className="aspect-video w-full animate-pulse rounded-xl bg-muted" />
              <div className="rounded-xl border border-border bg-card p-6">
                <div className="mb-4 h-7 w-3/4 animate-pulse rounded bg-muted" />
                <div className="space-y-3">
                  <div className="h-4 w-full animate-pulse rounded bg-muted" />
                  <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="h-24 animate-pulse rounded-xl border border-border bg-card" />
              <div className="h-16 animate-pulse rounded-xl border border-border bg-card" />
              <div className="h-16 animate-pulse rounded-xl border border-border bg-card" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  const cardCount = variant === "classes" ? 6 : 6

  return (
    <div className="min-h-screen bg-background" aria-busy="true" aria-label="Loading course content">
      <div className="container mx-auto max-w-6xl px-4 py-6">
        <div className="mb-8">
          <div className="mb-5 h-5 w-40 animate-pulse rounded bg-muted" />
          <div className="mb-3 h-9 w-2/3 max-w-xl animate-pulse rounded bg-muted" />
          <div className="h-4 w-72 max-w-full animate-pulse rounded bg-muted" />
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: cardCount }).map((_, index) => (
            <div key={index} className="overflow-hidden rounded-xl border border-border bg-card">
              {variant === "classes" && (
                <div className="h-48 w-full animate-pulse bg-muted" />
              )}
              <div className="p-6">
                <div className="mb-4 h-12 w-12 animate-pulse rounded-lg bg-muted" />
                <div className="mb-3 h-6 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

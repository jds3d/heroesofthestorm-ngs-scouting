export type SlTrackStatus = "queued" | "pulling" | "found" | "miss";

export type SlTrackRow = {
  name: string;
  side: "us" | "them";
  status: SlTrackStatus;
  games: number;
};

const STAGES = [
  { id: "screen", label: "Names" },
  { id: "history", label: "Storm League" },
  { id: "ready", label: "Suggestions" },
] as const;

function stageAt(rows: readonly SlTrackRow[]): number {
  if (!rows.length) return 0;
  if (rows.some((row) => row.status === "queued" || row.status === "pulling")) return 1;
  return 2;
}

function statusLine(row: SlTrackRow): string {
  if (row.status === "queued") return "Waiting";
  if (row.status === "pulling") return "Pulling history";
  if (row.status === "miss") return "No Storm League history";
  const games = Math.round(row.games);
  return games === 1 ? "1 game" : `${games} games`;
}

/** Stage bar for a live draft: names read, each Storm League lookup, then suggestions. */
export function DraftTracker({
  rows,
  error,
}: {
  rows: readonly SlTrackRow[];
  error?: string | null;
}) {
  const stage = stageAt(rows);
  const found = rows.filter((row) => row.status === "found").length;
  const settled = rows.length > 0 && rows.every((row) => row.status === "found" || row.status === "miss");

  return (
    <div className="rounded-md border border-[#2a3a48] bg-[#0f1821] px-4 py-3 text-[#e8eef2]">
      <ol className="grid grid-cols-3 gap-2">
        {STAGES.map((item, index) => {
          const done = index < stage || (index === 2 && settled);
          const current = index === stage && !settled;
          return (
            <li key={item.id} className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                    done
                      ? "border-[#72d1b1] bg-[#72d1b1] text-[#0f1821]"
                      : current
                        ? "border-[#72d1b1] text-[#72d1b1] ring-4 ring-[#72d1b1]/20"
                        : "border-[#3d5163] text-[#5a6b78]"
                  }`}
                >
                  {done ? "✓" : index + 1}
                </span>
                <span
                  className={`h-0.5 flex-1 ${
                    index < STAGES.length - 1
                      ? done
                        ? "bg-[#72d1b1]"
                        : "bg-[#2a3a48]"
                      : "bg-transparent"
                  }`}
                />
              </div>
              <p
                className={`mt-1 text-xs font-semibold uppercase tracking-wide ${
                  done || current ? "text-[#dfeaf4]" : "text-[#5a6b78]"
                }`}
              >
                {item.label}
              </p>
              <p className="text-[11px] text-[#8aa0b2]">
                {index === 0
                  ? rows.length
                    ? `${rows.length} on screen`
                    : "Watching the draft"
                  : index === 1
                    ? settled
                      ? `${found} of ${rows.length} found`
                      : current
                        ? "One player at a time"
                        : "After the names"
                    : settled
                      ? "Ready"
                      : "After history"}
              </p>
            </li>
          );
        })}
      </ol>

      {rows.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-[#2a3a48] pt-3">
          {rows.map((row) => (
            <li key={`${row.side}-${row.name}`} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                <span className="mr-2 text-[10px] font-bold uppercase tracking-wide text-[#8aa0b2]">
                  {row.side === "them" ? "Them" : "Us"}
                </span>
                <span className={row.status === "pulling" ? "text-[#72d1b1]" : "text-[#e8eef2]"}>
                  {row.name}
                </span>
              </span>
              <span
                className={`shrink-0 text-xs ${
                  row.status === "found"
                    ? "text-[#9dceb0]"
                    : row.status === "miss"
                      ? "text-amber-200/90"
                      : row.status === "pulling"
                        ? "text-[#72d1b1]"
                        : "text-[#5a6b78]"
                }`}
              >
                {statusLine(row)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error ? <p className="mt-2 text-sm text-amber-200/90">{error}</p> : null}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import {
  NGS_MAP_POOL,
  ngsMapImageUrl,
  type NgsMap,
} from "@/config/ngsMaps";

export function MapPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (mapName: string | null) => void;
}) {
  const [filter, setFilter] = useState("");
  const maps = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return [...NGS_MAP_POOL];
    return NGS_MAP_POOL.filter((m) => m.name.toLowerCase().includes(q));
  }, [filter]);

  return (
    <div className="space-y-3 rounded-md border border-[var(--line)] bg-[var(--panel)] px-4 py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Map
          </h4>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Current NGS pool only. Draft plan updates for the map you pick.
          </p>
        </div>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-sm font-semibold text-[var(--accent)] hover:underline"
          >
            Clear map
          </button>
        )}
      </div>

      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search maps…"
        className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]"
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {maps.map((m) => (
          <MapTile
            key={m.name}
            map={m}
            selected={value === m.name}
            onSelect={() => onChange(m.name)}
          />
        ))}
        {maps.length === 0 && (
          <p className="col-span-full text-sm text-[var(--muted)]">
            No maps match.
          </p>
        )}
      </div>
    </div>
  );
}

function MapTile({
  map,
  selected,
  onSelect,
}: {
  map: NgsMap;
  selected: boolean;
  onSelect: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`overflow-hidden rounded-md border text-left transition ${
        selected
          ? "border-[var(--accent)] ring-2 ring-[var(--accent)]"
          : "border-[var(--line)] hover:border-[var(--accent)]"
      }`}
    >
      <div className="relative aspect-[16/10] bg-[#1a2430]">
        {!failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ngsMapImageUrl(map)}
            alt={map.name}
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="flex h-full items-center justify-center px-2 text-center text-xs font-semibold text-[#c5d4e0]">
            {map.name}
          </span>
        )}
      </div>
      <div className="px-2 py-1.5">
        <p className="text-sm font-semibold text-[var(--ink)]">{map.name}</p>
        <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
          {map.size === "large" ? "Large / rotate" : "Point fight"}
        </p>
      </div>
    </button>
  );
}

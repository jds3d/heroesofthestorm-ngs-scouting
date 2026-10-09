type HotsParser = {
  processReplay: (
    file: string,
    opts: { overrideVerifiedBuild?: boolean; getBMData?: boolean },
  ) => {
    status: number;
    players?: Record<
      string,
      { name?: string; tag?: number; date?: string | Date }
    >;
  };
};

export type ParsedReplayPlayers = {
  seen: string;
  players: { name: string; tag: string }[];
};

function isoSeen(value: string | Date | undefined, fallback: string): string {
  if (!value) return fallback;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

/** Read battletags from a `.StormReplay` on disk. */
export async function parseLocalReplay(file: string): Promise<ParsedReplayPlayers | null> {
  const mod = (await import("hots-parser")) as unknown as HotsParser & {
    default?: HotsParser;
  };
  const parser = mod.default ?? mod;
  const out = parser.processReplay(file, {
    overrideVerifiedBuild: true,
    getBMData: false,
  });
  if (out.status < 0) return null;
  const players = Object.values(out.players ?? {});
  if (!players.length) return null;
  const seen = isoSeen(
    players.find((p) => p.date)?.date,
    new Date().toISOString(),
  );
  const tags = players
    .filter((p) => p.name && typeof p.tag === "number")
    .map((p) => ({
      name: String(p.name),
      tag: `${p.name}#${p.tag}`,
    }));
  if (!tags.length) return null;
  return { seen, players: tags };
}

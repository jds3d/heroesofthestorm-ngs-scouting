import os from "node:os";
import path from "node:path";

/** Local `.StormReplay` folder for incremental battletag indexing. */
export function replayFolder(): string {
  const fromEnv = process.env.HOTS_REPLAY_DIR?.trim();
  if (fromEnv) return fromEnv;
  const home = process.env.USERPROFILE ?? os.homedir();
  return path.join(
    home,
    "OneDrive",
    "Documents",
    "Heroes of the Storm",
    "Accounts",
    "63350841",
    "1-Hero-1-6177491",
    "Replays",
    "Multiplayer",
  );
}

export function battletagStorePath(root = process.cwd()): string {
  return path.join(root, ".cache", "replay-battletags.json");
}

export function replaySyncStatePath(root = process.cwd()): string {
  return path.join(root, ".cache", "replay-sync-state.json");
}

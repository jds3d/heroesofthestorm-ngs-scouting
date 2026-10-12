/** Runs once when the Node server starts (`next dev` / `next start`). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { scheduleReplaySyncOnStartup } = await import("@/lib/replay/startupSync");
  scheduleReplaySyncOnStartup();
}

import { NextResponse } from "next/server";
import { scheduleReplaySyncOnStartup } from "@/lib/replay/startupSync";
import { syncReplayBattletags } from "@/lib/replay/syncReplays";

export const dynamic = "force-dynamic";

/** Index new local `.StormReplay` files into `replay-battletags.json`. */
export async function POST() {
  const pending = scheduleReplaySyncOnStartup();
  const result = pending ? await pending : await syncReplayBattletags();
  return NextResponse.json(result);
}

export async function GET() {
  return POST();
}

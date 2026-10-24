import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import path from "path";
import readline from "readline";

export type OcrLine = { text: string; top: number; score: number; x?: number };

type Reply = {
  id: number;
  left: OcrLine[];
  right: OcrLine[];
  picksLeft?: OcrLine[];
  picksRight?: OcrLine[];
  center?: OcrLine[];
  slots?: SlotOcr[];
  error?: string;
};

export type SlotOcr = {
  side: "left" | "right";
  index: number;
  lines: OcrLine[];
};

let child: ChildProcessWithoutNullStreams | null = null;
let sequence = 0;
/** One JSON line at a time. Two in-flight reads must not interleave on the pipe. */
let stdinChain: Promise<void> = Promise.resolve();
export type ColumnRead = {
  left: OcrLine[];
  right: OcrLine[];
  picksLeft: OcrLine[];
  picksRight: OcrLine[];
  center: OcrLine[];
};

const slotWaiting = new Map<
  number,
  {
    resolve: (slots: SlotOcr[]) => void;
    reject: (error: Error) => void;
  }
>();

const waiting = new Map<
  number,
  {
    picks: boolean;
    center: boolean;
    resolve: (value: ColumnRead) => void;
    reject: (error: Error) => void;
  }
>();

function pythonBin(): string {
  if (process.env.OCR_PYTHON) return process.env.OCR_PYTHON;
  return process.platform === "win32" ? "python" : "python3";
}

function failAll(error: Error) {
  for (const waiter of waiting.values()) waiter.reject(error);
  waiting.clear();
  for (const waiter of slotWaiting.values()) waiter.reject(error);
  slotWaiting.clear();
}

function writeRequest(proc: ChildProcessWithoutNullStreams, line: string): Promise<void> {
  const next = stdinChain.then(
    () =>
      new Promise<void>((resolve, reject) => {
        proc.stdin.write(line, (error) => (error ? reject(error) : resolve()));
      }),
  );
  stdinChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function ensureChild(): ChildProcessWithoutNullStreams {
  if (child && !child.killed && child.exitCode == null) return child;
  const script = path.join(process.cwd(), "scripts", "ocr_names.py");
  const next = spawn(pythonBin(), [script], { stdio: ["pipe", "pipe", "pipe"] });
  next.stderr.on("data", () => {});
  const lines = readline.createInterface({ input: next.stdout });
  lines.on("line", (line) => {
    let reply: Reply;
    try {
      reply = JSON.parse(line) as Reply;
    } catch {
      return;
    }
    const slotWaiter = slotWaiting.get(reply.id);
    if (slotWaiter) {
      slotWaiting.delete(reply.id);
      if (reply.error) slotWaiter.reject(new Error(reply.error));
      else slotWaiter.resolve(reply.slots ?? []);
      return;
    }
    const waiter = waiting.get(reply.id);
    if (!waiter) return;
    waiting.delete(reply.id);
    if (reply.error) waiter.reject(new Error(reply.error));
    else if (
      (waiter.picks && reply.picksLeft === undefined) ||
      (waiter.center && reply.center === undefined)
    ) {
      if (child === next) child = null;
      next.kill();
      waiter.reject(new Error("name reader restarted"));
    } else {
      waiter.resolve({
        left: reply.left ?? [],
        right: reply.right ?? [],
        picksLeft: reply.picksLeft ?? [],
        picksRight: reply.picksRight ?? [],
        center: reply.center ?? [],
      });
    }
  });
  next.on("exit", () => {
    const current = child === next;
    if (current) child = null;
    if (current) failAll(new Error("name reader stopped"));
  });
  child = next;
  return next;
}

/** Stop the name reader. Tests call this so the process can exit. */
export function closeNameReader(): void {
  const current = child;
  child = null;
  current?.kill();
}

/** One changed nameplate. These readers are not the column readers, so a lock is not stuck behind a full column. */
export function readSlotPlates(
  slots: { side: "left" | "right"; index: number; image: string }[],
): Promise<SlotOcr[]> {
  const proc = ensureChild();
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!slotWaiting.has(id)) return;
      slotWaiting.delete(id);
      reject(new Error("name reader timed out"));
    }, 15000);
    slotWaiting.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    void writeRequest(proc, `${JSON.stringify({ id, slots })}\n`).catch((error: unknown) => {
      if (!slotWaiting.has(id)) return;
      slotWaiting.delete(id);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error("name reader write failed"));
    });
  });
}

/** Deskewed column pictures in, text lines out. Name and pick crops run together. */
export function readNameColumns(
  left: string,
  right: string,
  picks?: { left?: string; right?: string },
  center?: string,
): Promise<ColumnRead> {
  return readNameColumnsOnce(left, right, picks, center).catch((error: unknown) => {
    if (error instanceof Error && error.message === "name reader restarted") {
      return readNameColumnsOnce(left, right, picks, center);
    }
    throw error;
  });
}

function readNameColumnsOnce(
  left: string,
  right: string,
  picks?: { left?: string; right?: string },
  center?: string,
): Promise<ColumnRead> {
  const proc = ensureChild();
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!waiting.has(id)) return;
      waiting.delete(id);
      reject(new Error("name reader timed out"));
    }, 90000);
    waiting.set(id, {
      picks: Boolean(picks?.left || picks?.right),
      center: Boolean(center),
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    void writeRequest(
      proc,
      `${JSON.stringify({
        id,
        left,
        right,
        picksLeft: picks?.left ?? "",
        picksRight: picks?.right ?? "",
        center: center ?? "",
      })}\n`,
    ).catch((error: unknown) => {
      if (!waiting.has(id)) return;
      waiting.delete(id);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error("name reader write failed"));
    });
  });
}

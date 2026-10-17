/** Printer: a transport plus the job/status logic. */
import type { Bitmap } from "./bitmap";
import { M02, type Model, type Notification, QUERY, buildJob, decodeNotification, feedBytes, queryBytes } from "./protocol";

/** Anything that can move bytes to the printer and deliver its notifications. */
export interface Transport {
  write(data: Uint8Array): Promise<void>;
  /** Subscribe to notify frames. Returns an unsubscribe function. */
  onNotify(fn: (data: Uint8Array) => void): () => void;
  /** Optional: called once when the link drops (printer powered off, out of range...). */
  onDisconnect?(fn: () => void): () => void;
  close(): Promise<void>;
}

/** A bitmap, or something that renders to one at a given page width (e.g. Document). Keeps Printer free of renderer imports. */
export type Printable = Bitmap | { render(pageWidth: number): Promise<Bitmap> | Bitmap };

export interface Status {
  firmware?: string;
  battery?: number;
  serial?: string;
  paper?: boolean;
  cover?: boolean;
  temperature?: boolean;
}

export interface PrinterOptions {
  model?: Model;
  log?: (msg: string) => void;
}

export class Printer {
  readonly model: Model;
  private readonly log: (msg: string) => void;
  private acks = 0;
  private waiters: Array<(n: Notification) => void> = [];

  constructor(readonly transport: Transport, opts: PrinterOptions = {}) {
    this.model = opts.model ?? M02;
    this.log = opts.log ?? (() => {});
    transport.onNotify((d) => {
      const n = decodeNotification(d);
      if (n.kind === "ack") {
        this.acks++;
        return;
      }
      this.log(`<- ${JSON.stringify(n)}`);
      this.waiters.forEach((fn) => fn(n));
    });
  }

  /** Resolve with the next notification matching `pred`, or undefined after timeoutMs. */
  private next(pred: (n: Notification) => boolean, timeoutMs: number): Promise<Notification | undefined> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== fn);
        resolve(undefined);
      }, timeoutMs);
      const fn = (n: Notification) => {
        if (!pred(n)) return;
        clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== fn);
        resolve(n);
      };
      this.waiters.push(fn);
    });
  }

  /** Printable width in px (384 for the M02). Documents are rendered at this width. */
  get width(): number {
    return this.model.widthPx;
  }

  /** Print a Document (anything with render(width)) or a bitmap. Resolves when the printer reports completion. */
  async print(input: Printable, opts: { feedLines?: number; timeoutMs?: number } = {}) {
    const bmp = "render" in input ? await input.render(this.width) : input;
    const job = buildJob(bmp, { feedLines: opts.feedLines, model: this.model });

    const acks0 = this.acks;
    const t0 = Date.now();
    await this.transport.write(job);
    const chunksAcked = this.acks - acks0;
    this.log(`sent ${job.length} bytes (${bmp.width}x${bmp.height}) in ${Date.now() - t0} ms, ${chunksAcked} acks`);

    // Arm the wait only after the transfer: a stale print-complete from an earlier job can arrive mid-send.
    const done = await this.next((n) => n.kind === "printComplete", opts.timeoutMs ?? 30000);
    if (!done) throw new Error("Timed out waiting for the printer to finish");
    this.log(`print complete after ${Date.now() - t0} ms`);
  }

  /** Feed n blank lines. */
  async feed(lines = 2) {
    await this.transport.write(feedBytes(lines));
  }

  /** Query firmware, battery, serial, paper, cover and temperature. */
  async status(): Promise<Status> {
    const s: Status = {};
    const ask = async <K extends Notification["kind"]>(op: number, kind: K) => {
      const p = this.next((n) => n.kind === kind, 1500);
      await this.transport.write(queryBytes(op));
      return (await p) as Extract<Notification, { kind: K }> | undefined;
    };
    s.firmware = (await ask(QUERY.firmware, "firmware"))?.version;
    s.battery = (await ask(QUERY.battery, "battery"))?.percent;
    s.serial = (await ask(QUERY.serial, "serial"))?.serial;
    s.paper = (await ask(QUERY.paper, "paper"))?.ok;
    s.cover = (await ask(QUERY.cover, "cover"))?.closed;
    s.temperature = (await ask(QUERY.temperature, "temperature"))?.ok;
    return s;
  }

  private keepAliveTimer?: ReturnType<typeof setInterval>;

  /**
   * Keep the printer awake by sending a harmless battery query periodically. The M02 powers
   * itself off after a few idle minutes, even on the charger. Default every 60 s.
   */
  keepAlive(intervalMs = 60_000, onTick?: (battery: number | undefined) => void): this {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(async () => {
      try {
        const p = this.next((n) => n.kind === "battery", 1500);
        await this.transport.write(queryBytes(QUERY.battery));
        const n = (await p) as Extract<Notification, { kind: "battery" }> | undefined;
        onTick?.(n?.percent);
      } catch (e) {
        this.log(`keep-alive failed: ${(e as Error).message}`);
      }
    }, intervalMs);
    return this;
  }

  stopKeepAlive() {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = undefined;
  }

  /** Register a callback for when the link drops. No-op if the transport can't report it. */
  onDisconnect(fn: () => void): () => void {
    return this.transport.onDisconnect?.(fn) ?? (() => {});
  }

  async disconnect() {
    this.stopKeepAlive();
    await this.transport.close();
  }
}

import noble from "@abandonware/noble";

/**
 * Advertised-name substrings to auto-connect to. Override with
 * PRINTER_NAME=whatever (case-insensitive substring match).
 */
const DEFAULT_NAMES = ["M02", "Q02", "T02", "MX0", "MX1", "GB0", "GT0", "YT0", "MEMO"];

export type Connection = {
  peripheral: noble.Peripheral;
  services: noble.Service[];
  characteristics: noble.Characteristic[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function poweredOn() {
  // @ts-ignore - `state` exists at runtime but isn't in the types
  if (noble.state === "poweredOn") return;
  await new Promise<void>((resolve) => {
    const onState = (s: string) => {
      if (s === "poweredOn") {
        noble.removeListener("stateChange", onState);
        resolve();
      }
    };
    noble.on("stateChange", onState);
  });
}

export async function connect(timeoutMs = 20_000): Promise<Connection> {
  const wanted = process.env.PRINTER_NAME
    ? [process.env.PRINTER_NAME.toUpperCase()]
    : DEFAULT_NAMES;
  const seen = new Set<string>();

  await poweredOn();
  console.log(`Scanning for a printer matching: ${wanted.join(", ")}`);

  const peripheral = await new Promise<noble.Peripheral>((resolve, reject) => {
    const timer = setTimeout(() => {
      noble.stopScanningAsync();
      reject(
        new Error(
          `No match in ${timeoutMs / 1000}s. Named devices seen: ${
            [...seen].join(", ") || "(none)"
          }. Set PRINTER_NAME to one of these.`
        )
      );
    }, timeoutMs);

    noble.on("discover", (p) => {
      const name = p.advertisement.localName;
      if (!name) return;
      if (!seen.has(name)) {
        seen.add(name);
        console.log(`  saw "${name}" (${p.address || p.id}) rssi ${p.rssi}`);
      }
      if (wanted.some((w) => name.toUpperCase().includes(w))) {
        clearTimeout(timer);
        noble.stopScanningAsync().then(() => resolve(p));
      }
    });
    noble.startScanningAsync([], false).catch(reject);
  });

  console.log(`Connecting to "${peripheral.advertisement.localName}"...`);
  await peripheral.connectAsync();
  const { services, characteristics } =
    await peripheral.discoverAllServicesAndCharacteristicsAsync();

  dumpGatt(services);
  return { peripheral, services, characteristics };
}

/**
 * The GATT table alone usually identifies the protocol:
 *   service ae30 (write ae01 / notify ae02) → cat printer
 *   service ff00 (write ff02 / notify ff03) → Phomemo-style ESC/POS
 */
function dumpGatt(services: noble.Service[]) {
  console.log("\nGATT table:");
  for (const s of services) {
    console.log(`  service ${s.uuid}`);
    for (const c of s.characteristics ?? []) {
      console.log(`    char ${c.uuid}  [${c.properties.join(", ")}]`);
    }
  }
  const uuids = new Set(services.map((s) => s.uuid));
  if (uuids.has("ae30")) console.log("  → has ae30: looks like a CAT PRINTER");
  if (uuids.has("ff00")) console.log("  → has ff00: looks like PHOMEMO / ESC-POS");
  console.log();
}

/** Prefer a known UUID; otherwise first matching char outside the generic 18xx services. */
export function pickChar(
  conn: Connection,
  preferred: string[],
  prop: "write" | "notify"
): noble.Characteristic | undefined {
  for (const u of preferred) {
    const c = conn.characteristics.find((c) => c.uuid === u);
    if (c) return c;
  }
  const props = prop === "write" ? ["write", "writeWithoutResponse"] : ["notify", "indicate"];
  const generic = new Set(
    conn.services
      .filter((s) => s.uuid.startsWith("18"))
      .flatMap((s) => s.characteristics ?? [])
  );
  return conn.characteristics.find(
    (c) => !generic.has(c) && c.properties.some((p) => props.includes(p))
  );
}

export async function logNotifications(c: noble.Characteristic | undefined, label: string) {
  if (!c) {
    console.log(`(no notify characteristic for ${label})`);
    return;
  }
  c.on("data", (d: Buffer) => console.log(`  ← ${label} ${c.uuid}: ${d.toString("hex")}`));
  await c.subscribeAsync();
  console.log(`Subscribed to notifications on ${c.uuid}`);
}

/**
 * Sending a whole image in one writeAsync (what index.ts did) relies on the
 * OS to split it, and cheap printers drop data when flooded. Chunk to the ATT
 * payload size and pace it instead.
 *   CHUNK_SIZE      bytes per write (default: MTU-3, or 20 if MTU unknown)
 *   CHUNK_DELAY_MS  pause between writes (default 15)
 *   WITH_RESPONSE=1 use acknowledged writes (slower, but built-in flow control)
 */
export async function writeChunked(
  peripheral: noble.Peripheral,
  c: noble.Characteristic,
  data: Uint8Array
) {
  // @ts-ignore - mtu exists at runtime
  const mtu: number | null = peripheral.mtu ?? null;
  const size = Number(process.env.CHUNK_SIZE) || (mtu ? mtu - 3 : 20);
  const delay = Number(process.env.CHUNK_DELAY_MS ?? 15);
  const withResponse =
    process.env.WITH_RESPONSE === "1" || !c.properties.includes("writeWithoutResponse");

  for (let o = 0; o < data.length; o += size) {
    // noble's second arg is `withoutResponse`
    await c.writeAsync(Buffer.from(data.subarray(o, o + size)), !withResponse);
    if (delay) await sleep(delay);
  }
}

export const describeWrite = (peripheral: noble.Peripheral) => {
  // @ts-ignore
  const mtu = peripheral.mtu ?? "unknown";
  return `MTU ${mtu}, CHUNK_SIZE=${process.env.CHUNK_SIZE ?? "auto"}, CHUNK_DELAY_MS=${
    process.env.CHUNK_DELAY_MS ?? 15
  }, WITH_RESPONSE=${process.env.WITH_RESPONSE ?? "0"}`;
};

export { sleep };

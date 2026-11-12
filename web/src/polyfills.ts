// snarkjs / blake-hash (pulled in by the eERC SDK) expect Node's Buffer and process.
import { Buffer } from "buffer";
const g = globalThis as unknown as { Buffer?: typeof Buffer; process?: { env: Record<string, string>; browser: boolean; version: string } };
g.Buffer ??= Buffer;
g.process ??= { env: {}, browser: true, version: "" };

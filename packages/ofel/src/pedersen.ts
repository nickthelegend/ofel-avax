// Pedersen commitments on BN254 G1 — must match contracts/src/Pedersen.sol exactly.
import { bn254 } from "@noble/curves/bn254";
import { randomBytes } from "@noble/hashes/utils";

const G1 = bn254.G1.ProjectivePoint;
export const N = bn254.fields.Fr.ORDER;
export const H = G1.fromAffine({
  x: 8151045900381500765177190642963759502868535262511941714456713950147686507285n,
  y: 19053106054203193574146046438424995143590580634524738320696592359494972851142n,
});

export interface Point {
  x: bigint;
  y: bigint;
}

function mulOrZero(p: InstanceType<typeof G1>, s: bigint) {
  const k = ((s % N) + N) % N;
  return k === 0n ? G1.ZERO : p.multiply(k);
}

export function commit(value: bigint, blind: bigint): Point {
  const c = mulOrZero(G1.BASE, value).add(mulOrZero(H, blind));
  if (c.equals(G1.ZERO)) return { x: 0n, y: 0n };
  return c.toAffine();
}

export function randomBlind(): bigint {
  let n = 0n;
  for (const b of randomBytes(48)) n = (n << 8n) | BigInt(b);
  return n % N;
}

export function addBlinds(blinds: bigint[]): bigint {
  return blinds.reduce((a, b) => (a + b) % N, 0n);
}

export function sumCommitments(cs: Point[]): Point {
  let acc = G1.ZERO;
  for (const c of cs) if (c.x !== 0n || c.y !== 0n) acc = acc.add(G1.fromAffine(c));
  return acc.equals(G1.ZERO) ? { x: 0n, y: 0n } : acc.toAffine();
}

export function opens(c: Point, value: bigint, blind: bigint): boolean {
  const want = commit(value, blind);
  return want.x === c.x && want.y === c.y;
}

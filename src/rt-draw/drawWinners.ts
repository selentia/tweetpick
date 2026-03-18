import crypto from 'node:crypto';

interface DrawWinnersOptions<TParticipant> {
  participants: TParticipant[];
  winners?: number;
  seed?: string | number | null;
}

function createSeed(): string {
  return crypto.randomBytes(16).toString('hex');
}

function seedToUint32(seed: string | number): number {
  const digest = crypto.createHash('sha256').update(String(seed)).digest();
  return digest.readUInt32BE(0);
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return function random() {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleBySeed<TParticipant>(list: TParticipant[], seed: string | number): TParticipant[] {
  const rng = mulberry32(seedToUint32(seed));
  const shuffled = list.slice();

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }

  return shuffled;
}

function drawWinners<TParticipant>({
  participants,
  winners = 1,
  seed = undefined,
}: DrawWinnersOptions<TParticipant>): { seed: string; winners: TParticipant[] } {
  if (!Array.isArray(participants)) {
    throw new Error('participants must be an array.');
  }

  const winnersCount = Number(winners);
  if (!Number.isInteger(winnersCount) || winnersCount < 1) {
    throw new Error('winners must be a positive integer.');
  }

  if (participants.length < winnersCount) {
    throw new Error(`Not enough participants. requested=${winnersCount}, available=${participants.length}`);
  }

  const resolvedSeed = seed ? String(seed) : createSeed();
  const shuffled = shuffleBySeed(participants, resolvedSeed);

  return {
    seed: resolvedSeed,
    winners: shuffled.slice(0, winnersCount),
  };
}

export { createSeed, drawWinners, mulberry32, seedToUint32, shuffleBySeed };

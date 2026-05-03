export type LshOptions = {
  type: "lsh";
  numTables: number;
  numHyperplanes: number;
  seed?: number | undefined;
};

export class LshIndex {
  private readonly hyperplanes: number[][];
  private readonly tables: Array<Map<string, Set<string>>>;

  constructor(
    dimensions: number,
    private readonly options: LshOptions,
  ) {
    const rng = seededRandom(options.seed ?? 42);
    this.hyperplanes = [];
    for (let index = 0; index < options.numTables * options.numHyperplanes; index += 1) {
      const plane = Array.from({ length: dimensions }, () => rng() * 2 - 1);
      const norm = Math.sqrt(plane.reduce((sum, value) => sum + value ** 2, 0));
      this.hyperplanes.push(norm === 0 ? plane : plane.map((value) => value / norm));
    }
    this.tables = Array.from({ length: options.numTables }, () => new Map());
  }

  insert(id: string, vector: number[]): void {
    for (let table = 0; table < this.options.numTables; table += 1) {
      const hash = this.hash(vector, table);
      const bucket = this.tables[table]?.get(hash) ?? new Set<string>();
      bucket.add(id);
      this.tables[table]?.set(hash, bucket);
    }
  }

  query(vector: number[]): Set<string> {
    const candidates = new Set<string>();
    for (let table = 0; table < this.options.numTables; table += 1) {
      const hash = this.hash(vector, table);
      for (const id of this.tables[table]?.get(hash) ?? []) {
        candidates.add(id);
      }
    }
    return candidates;
  }

  private hash(vector: number[], table: number): string {
    let hash = "";
    const start = table * this.options.numHyperplanes;
    for (let offset = 0; offset < this.options.numHyperplanes; offset += 1) {
      const plane = this.hyperplanes[start + offset] as number[];
      const dot = vector.reduce((sum, value, index) => sum + value * (plane[index] ?? 0), 0);
      hash += dot >= 0 ? "1" : "0";
    }
    return hash;
  }
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// Grille spatiale reconstruite à chaque tick pour trouver les voisins sans tout parcourir.
export interface Positioned {
  x: number;
  y: number;
}

export class SpatialGrid<T extends Positioned> {
  private cells = new Map<number, T[]>();

  constructor(private readonly cellSize: number) {}

  private key(cx: number, cy: number): number {
    return (cx + 1024) * 4096 + (cy + 1024);
  }

  rebuild(items: readonly T[], include: (item: T) => boolean): void {
    for (const bucket of this.cells.values()) bucket.length = 0;
    for (const item of items) {
      if (!include(item)) continue;
      const k = this.key(Math.floor(item.x / this.cellSize), Math.floor(item.y / this.cellSize));
      let bucket = this.cells.get(k);
      if (!bucket) this.cells.set(k, (bucket = []));
      bucket.push(item);
    }
  }

  /** Appelle visit pour chaque élément dont la cellule recoupe le disque (filtrage fin à la charge de l'appelant). */
  query(x: number, y: number, radius: number, visit: (item: T) => void): void {
    const x0 = Math.floor((x - radius) / this.cellSize);
    const x1 = Math.floor((x + radius) / this.cellSize);
    const y0 = Math.floor((y - radius) / this.cellSize);
    const y1 = Math.floor((y + radius) / this.cellSize);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (bucket) for (const item of bucket) visit(item);
      }
    }
  }
}

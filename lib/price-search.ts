/** First threshold crossing at/after start, preserving chronological scan semantics. */
export class PriceSearch {
  private size = 1;
  private tree: Float64Array;
  constructor(private values: number[], private direction: "min" | "max") {
    while (this.size < values.length) this.size *= 2;
    this.tree = new Float64Array(this.size * 2);
    this.tree.fill(direction === "min" ? Infinity : -Infinity);
    this.tree.set(values, this.size);
    for (let i = this.size - 1; i > 0; i--)
      this.tree[i] = direction === "min" ? Math.min(this.tree[i * 2], this.tree[i * 2 + 1]) : Math.max(this.tree[i * 2], this.tree[i * 2 + 1]);
  }
  first(start: number, threshold: number, strict = false): number {
    const matches = (v: number) => this.direction === "min" ? (strict ? v < threshold : v <= threshold) : (strict ? v > threshold : v >= threshold);
    const visit = (node: number, left: number, right: number): number => {
      if (right <= start || left >= this.values.length || !matches(this.tree[node])) return -1;
      if (right - left === 1) return left;
      const mid = (left + right) / 2;
      const found = visit(node * 2, left, mid);
      return found >= 0 ? found : visit(node * 2 + 1, mid, right);
    };
    return visit(1, 0, this.size);
  }
}

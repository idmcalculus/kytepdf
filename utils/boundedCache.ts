/**
 * A `Map` that caps its own size. Document analysis engines cache extracted
 * envelopes/markdown per content hash for the session; without a bound, a
 * long session processing many large documents accumulates unbounded
 * memory. `Map` preserves insertion order, so evicting the oldest entry on
 * overflow gives simple, predictable FIFO behavior without pulling in a
 * full LRU dependency.
 */
export class BoundedMap<K, V> extends Map<K, V> {
  constructor(private readonly maxEntries: number) {
    super();
  }

  set(key: K, value: V): this {
    if (!this.has(key) && this.size >= this.maxEntries) {
      const oldestKey = this.keys().next().value;
      if (oldestKey !== undefined) this.delete(oldestKey);
    }
    super.set(key, value);
    return this;
  }
}

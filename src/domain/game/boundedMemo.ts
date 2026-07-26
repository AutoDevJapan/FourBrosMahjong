/** 挿入順で古い1件だけを退避する固定容量memo。 */
export class BoundedMemo<K, V> {
  readonly #entries = new Map<K, V>();

  constructor(readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError("BoundedMemo capacity must be a positive integer");
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: K): V | undefined {
    return this.#entries.get(key);
  }

  set(key: K, value: V): void {
    if (!this.#entries.has(key) && this.#entries.size >= this.capacity) {
      const oldestEntry = this.#entries.keys().next();
      if (!oldestEntry.done) this.#entries.delete(oldestEntry.value);
    }
    this.#entries.set(key, value);
  }

  clear(): void {
    this.#entries.clear();
  }
}

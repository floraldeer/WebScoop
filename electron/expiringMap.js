export default class ExpiringMap {
  constructor({ ttlMs, maxSize, now = Date.now }) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
    this.now = now;
    this.items = new Map();
  }

  set(key, value) {
    this.prune();
    if (this.items.has(key)) this.items.delete(key);
    while (this.items.size >= this.maxSize) {
      this.items.delete(this.items.keys().next().value);
    }
    this.items.set(key, { value, seenAt: this.now() });
    return this;
  }

  get(key) {
    const item = this.items.get(key);
    if (!item) return undefined;
    if (this.now() - item.seenAt > this.ttlMs) {
      this.items.delete(key);
      return undefined;
    }
    return item.value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    return this.items.delete(key);
  }

  clear() {
    this.items.clear();
  }

  prune() {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, item] of this.items) {
      if (item.seenAt <= cutoff) this.items.delete(key);
    }
  }

  get size() {
    this.prune();
    return this.items.size;
  }
}

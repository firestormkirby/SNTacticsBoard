/**
 * In-memory stand-in for @react-native-async-storage/async-storage.
 *
 * Seeding this map before your plugin boots is the whole mechanism by which a
 * scenario reaches the real UI: your stores load themselves from AsyncStorage
 * exactly as they do on a device and never learn they were staged.
 *
 * Nothing persists. A reload is a clean device, which is what you want when
 * capturing the same screen twice.
 */

const store = new Map<string, string>();

/** Replace the whole store. Called before boot, never after. */
export function seed(values: Record<string, unknown>): void {
  store.clear();
  for (const [k, v] of Object.entries(values)) {
    store.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
}

/** Everything currently stored, for working out what a screen reads. */
export function dump(): Record<string, string> {
  return Object.fromEntries(store);
}

const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    return store.has(key) ? store.get(key)! : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    store.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    store.delete(key);
  },
  async clear(): Promise<void> {
    store.clear();
  },
  async getAllKeys(): Promise<string[]> {
    return [...store.keys()];
  },
  async multiGet(keys: string[]): Promise<Array<[string, string | null]>> {
    return keys.map(k => [k, store.has(k) ? store.get(k)! : null]);
  },
  async multiSet(pairs: Array<[string, string]>): Promise<void> {
    for (const [k, v] of pairs) store.set(k, v);
  },
  async multiRemove(keys: string[]): Promise<void> {
    for (const k of keys) store.delete(k);
  },
  async mergeItem(key: string, value: string): Promise<void> {
    const existing = store.get(key);
    if (!existing) { store.set(key, value); return; }
    store.set(key, JSON.stringify({ ...JSON.parse(existing), ...JSON.parse(value) }));
  },
};

export default AsyncStorage;

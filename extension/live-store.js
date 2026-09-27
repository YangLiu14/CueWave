import { liveSessionKey } from "./live-core.js";

export function createLiveStore(storage) {
  let queue = Promise.resolve();
  const enqueue = (operation) => {
    queue = queue.catch(() => {}).then(operation);
    return queue;
  };
  return {
    save(record) {
      const key = liveSessionKey(record.id);
      return enqueue(() => storage.set({ [key]: record }));
    },
    remove(id) {
      const key = liveSessionKey(id);
      return enqueue(() => storage.remove(key));
    },
    async get(id) {
      const key = liveSessionKey(id);
      const result = await storage.get(key);
      return result[key];
    },
    async list() {
      const result = await storage.get(null);
      return Object.entries(result).filter(([key, record]) => key.startsWith("cuewave:live:")
        && record?.format === "cuewave-live-pitch" && record.id).map(([, record]) => record)
        .sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
    }
  };
}

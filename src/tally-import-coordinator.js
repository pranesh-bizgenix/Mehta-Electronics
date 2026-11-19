// A restart loses only this scheduling state; XML and completion remain in RDS.
export function createTallyImportCoordinator(importSession) {
  const pending = new Map();
  return {
    isPending: id => pending.has(id),
    start(id) {
      if (pending.has(id)) return pending.get(id);
      const task = Promise.resolve().then(() => importSession(id))
        // Importer records failures. A rejected task must not terminate CRM.
        .catch(() => undefined).finally(() => pending.delete(id));
      pending.set(id, task);
      return task;
    }
  };
}

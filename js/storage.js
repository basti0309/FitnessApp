/* Tiny persistence layer over localStorage. */
const Store = (() => {
  const KEY = "wodbox.entries.v2";

  function read() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || [];
    } catch {
      return [];
    }
  }

  function write(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
  }

  return {
    all() {
      // newest first
      return read().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    },
    add(entry) {
      const list = read();
      entry.id = String(Date.now());
      list.push(entry);
      write(list);
      return entry;
    },
    remove(id) {
      write(read().filter((e) => e.id !== id));
    },
  };
})();

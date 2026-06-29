/* App shell: tab navigation + wiring the modules together. */
const App = (() => {
  function go(tab) {
    document.querySelectorAll(".tab").forEach((t) =>
      t.classList.toggle("is-active", t.dataset.tab === tab));
    document.querySelectorAll(".panel").forEach((p) =>
      p.classList.toggle("is-active", p.id === "tab-" + tab));
  }

  function init() {
    document.querySelectorAll(".tab").forEach((t) =>
      t.addEventListener("click", () => go(t.dataset.tab)));

    Timer.init();
    Log.init();
    Settings.init();
    Running.init();
    Drive.init();

    // when a remote Drive pull replaces local data, refresh the views
    document.addEventListener("data-applied", () => {
      Log.render();
      Running.refresh();
    });

    // "Log this result" jumps from a finished timer to a pre-filled form.
    document.getElementById("logResultBtn").addEventListener("click", () => {
      Log.prefillFromTimer(Timer.getSummary());
      go("log");
    });
  }

  return { go, init };
})();

document.addEventListener("DOMContentLoaded", App.init);

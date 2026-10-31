// Resolves the light / dark theme before the first paint so the window never
// flashes the wrong colors. Loaded as a plain (blocking) script from
// index.html; kept out of the HTML so the Content Security Policy needs no
// inline scripts.
(function () {
  try {
    if (new URLSearchParams(location.search).has("print")) {
      return;
    }

    var stored = localStorage.getItem("markdownpad.theme.v1");
    var mode = stored === "light" || stored === "dark" ? stored : "system";
    var prefersDark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    var theme = mode === "dark" || (mode === "system" && prefersDark)
      ? "dark"
      : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (error) {
    // Ignore and fall back to the default light theme.
  }
})();

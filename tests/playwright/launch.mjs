// Shared browser launcher for the Playwright checks.
//
// By default the checks use the locally installed Google Chrome (CI installs
// nothing else). Set MARKDOWNPAD_CHROMIUM to a Chromium executable to run
// them where Google Chrome is not available.
import { chromium } from "playwright";

export function launchBrowser(options = {}) {
  const executablePath = process.env.MARKDOWNPAD_CHROMIUM;

  if (executablePath) {
    return chromium.launch({
      headless: true,
      ...options,
      executablePath,
      args: [...(options.args ?? []), "--no-sandbox"],
    });
  }

  return chromium.launch({ channel: "chrome", headless: true, ...options });
}

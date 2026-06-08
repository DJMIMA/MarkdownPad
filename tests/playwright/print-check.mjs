import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.MARKDOWNPAD_URL ?? "http://127.0.0.1:1420";
const blankUrl = new URL("?blank=1", baseUrl).toString();
const sampleMarkdown = `# Print Check

Visit https://example.com and [site](https://example.com).

| A | B |
|---|---|
| 1 | 2 |
`;

async function run() {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });

  try {
    const context = await browser.newContext({
      viewport: {
        width: 1100,
        height: 760,
      },
    });
    const consoleErrors = [];

    await context.addInitScript(() => {
      Object.defineProperty(window, "print", {
        configurable: true,
        value: () => {
          window.__markdownPadPrintCalls =
            (window.__markdownPadPrintCalls ?? 0) + 1;
        },
      });
    });

    context.on("page", (page) => {
      page.on("console", (message) => {
        if (
          ["error", "warning"].includes(message.type()) &&
          !message.text().includes("React DevTools")
        ) {
          consoleErrors.push(`${message.type()}: ${message.text()}`);
        }
      });
      page.on("pageerror", (error) =>
        consoleErrors.push(`pageerror: ${error.message}`),
      );
    });

    const page = await context.newPage();
    await page.goto(blankUrl, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector(".cm-content");
    await page.click(".cm-content");
    await page.keyboard.insertText(sampleMarkdown);

    const popupPromise = page.waitForEvent("popup");
    await page.keyboard.press("Control+P");
    const printPage = await popupPromise;

    await printPage.waitForSelector(".markdown-print-document h1");
    await printPage.waitForFunction(
      () => window.__markdownPadPrintCalls === 1,
    );

    const metrics = await printPage.evaluate(() => {
      const links = [...document.querySelectorAll("a")].map((link) => ({
        href: link.getAttribute("href"),
        text: link.textContent,
      }));

      return {
        title: document.title,
        bodyClass: document.body.className,
        rootOverflow: getComputedStyle(document.querySelector("#root")).overflow,
        h1: document.querySelector(".markdown-print-document h1")?.textContent,
        paragraph: document.querySelector(".markdown-print-document p")
          ?.textContent,
        links,
        tableText: document.querySelector(".markdown-print-document table")
          ?.textContent,
        printCalls: window.__markdownPadPrintCalls,
      };
    });

    assert.equal(metrics.title, "印刷 - 無題-1");
    assert.match(metrics.bodyClass, /print-route/);
    assert.equal(metrics.rootOverflow, "visible");
    assert.equal(metrics.h1, "Print Check");
    assert.match(metrics.paragraph ?? "", /Visit https:\/\/example\.com and site\./);
    assert.deepEqual(metrics.links, [
      {
        href: "https://example.com",
        text: "site",
      },
    ]);
    assert.match(metrics.tableText ?? "", /A\s+B\s+1\s+2/);
    assert.equal(metrics.printCalls, 1);
    assert.deepEqual(consoleErrors, []);

    console.log(JSON.stringify(metrics, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

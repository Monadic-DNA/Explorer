import { chromium } from "playwright";
export async function openBrowser() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    ...(process.env.HTTP_PROXY
      ? {
          proxy: {
            server: process.env.HTTP_PROXY,
            bypass: "localhost,127.0.0.1",
          },
        }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  // Forward external HTTP through Node's configured proxy and CA trust, preserving TLS verification.
  await page.route(/^https:\/\//, async (route) => {
    const req = route.request();
    if (!req.url().startsWith("https://cdn.jsdelivr.net/npm/sql.js")) {
      await route.abort();
      return;
    }
    try {
      const response = await fetch(req.url(), {
        method: req.method(),
        headers: req.headers(),
        body: ["GET", "HEAD"].includes(req.method())
          ? undefined
          : req.postDataBuffer(),
        signal: AbortSignal.timeout(60000),
      });
      const headers = Object.fromEntries(response.headers);
      delete headers["content-encoding"];
      delete headers["content-length"];
      delete headers["transfer-encoding"];
      await route.fulfill({
        status: response.status,
        headers,
        body: Buffer.from(await response.arrayBuffer()),
      });
    } catch {
      await route.abort();
    }
  });
  return { browser, page };
}

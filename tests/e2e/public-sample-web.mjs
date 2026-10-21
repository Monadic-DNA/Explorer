import { openBrowser } from "./public-sample-browser.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { pbkdf2Sync, createDecipheriv } from "node:crypto";
const root = new URL("../../.test-data/public-sample/", import.meta.url)
  .pathname;
const origin = process.env.EXPLORER_TEST_URL || "http://127.0.0.1:3000";
const expected = JSON.parse(readFileSync(root + "expected.json"));
const studies = JSON.parse(readFileSync(root + "studies.json"));
const { browser, page } = await openBrowser();
page.setDefaultTimeout(60000);
try {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", async (dialog) => {
    console.log("DIALOG", dialog.type(), dialog.message().slice(0, 120));
    await dialog.accept();
  });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.evaluate(async (studies) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("gwas-catalog", 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        const store = db.createObjectStore("studies", { keyPath: "id" });
        store.createIndex("snps", "snps");
        db.createObjectStore("metadata", { keyPath: "key" });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction(["studies", "metadata"], "readwrite");
      studies.forEach((s) => tx.objectStore("studies").put(s));
      tx.objectStore("metadata").put({
        key: "catalog",
        downloadDate: new Date().toISOString(),
        fileUrl: "local-api-catalog-snapshot",
        totalStudies: studies.length,
        version: "1.0.2",
      });
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, studies);
  await page.getByRole("button", { name: /my data/i }).click();
  console.log("Uploading public sample");
  const start = Date.now();
  await page
    .locator("input[type=file]")
    .setInputFiles(root + "23andme-public.txt");
  await page
    .getByText("929,696 variants loaded", { exact: false })
    .first()
    .waitFor({ timeout: 120000 });
  console.log(
    "PASS actual Web upload:",
    expected.parsedVariants,
    "variants in",
    Date.now() - start,
    "ms",
  );
  await page.screenshot({ path: root + "web-uploaded.png", fullPage: true });
  await page.mouse.click(1350, 950);
  await page.locator(".my-data-dropdown").waitFor({ state: "hidden" });
  console.log(
    "RUN buttons",
    await page.getByRole("button", { name: /run all/i }).count(),
  );
  await page.getByRole("button", { name: /run all/i }).click();
  await page.locator(".disclaimer-text").evaluate((e) => {
    e.scrollTop = e.scrollHeight;
    e.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.getByRole("button", { name: /I Understand/ }).click();
  await page
    .getByRole("heading", { name: "Analysis Complete!", exact: true })
    .waitFor();

  await page.screenshot({ path: root + "web-runall.png", fullPage: true });
  writeFileSync(root + "web-errors.json", JSON.stringify(errors, null, 2));
  await page.getByRole("button", { name: "Close", exact: true }).last().click();
  await page.getByRole("button", { name: /^results/i }).click();

  await page.screenshot({ path: root + "web-results.png", fullPage: true });
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: /save.*file|export/i }).click();
  const download = await downloadEvent;
  await download.saveAs(root + "web-results.tsv");
  writeFileSync(
    root + "web-check.json",
    JSON.stringify(
      {
        variants: expected.parsedVariants,
        uploadMilliseconds: Date.now() - start,
        errors,
      },
      null,
      2,
    ),
  );
  const lines = readFileSync(root + "web-results.tsv", "utf8")
    .trim()
    .split(/\r?\n/);
  const headers = lines.shift().split("\t");
  const rows = lines.map((line) =>
    Object.fromEntries(line.split("\t").map((value, i) => [headers[i], value])),
  );
  assert.equal(rows.length, expected.matches);
  const byId = new Map(rows.map((row) => [Number(row["Study ID"]), row]));
  for (const wanted of expected.results) {
    const row = byId.get(wanted.studyId);
    assert.ok(row);
    assert.equal(row["Matched SNP"], wanted.matchedSnp);
    assert.equal(row["Your Genotype"], wanted.userGenotype);
    assert.equal(row["Effect Type"], wanted.effectType);
    assert.equal(row["Risk Level"], wanted.riskLevel);
    assert.ok(Math.abs(Number(row["Risk Score"]) - wanted.riskScore) < 1e-12);
  }
  console.log(
    "PASS all " +
      rows.length +
      " exported Web scores, genotypes, SNPs, effect types and directions match independent Python reference",
  );
  console.log("PASS web exported results", root + "web-results.tsv");
  await page.getByRole("button", { name: /my data/i }).click();
  await page
    .getByRole("link", { name: "Import or export a portable encrypted vault" })
    .click();
  await page
    .getByRole("heading", { name: "Portable encrypted vault", exact: true })
    .waitFor();
  await page.waitForLoadState("networkidle");
  const password = "public sample test only";
  await page.getByLabel("Vault passphrase").fill(password);
  const backupEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export encrypted vault", exact: true })
    .click();
  const backup = await backupEvent;
  await backup.saveAs(root + "web-portable-vault.json");
  const sealed = JSON.parse(
    readFileSync(root + "web-portable-vault.json", "utf8"),
  );
  const key = pbkdf2Sync(
    password,
    Buffer.from(sealed.salt, "base64"),
    sealed.iterations,
    32,
    "sha256",
  );
  const encrypted = Buffer.from(sealed.ciphertext, "base64");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(sealed.iv, "base64"),
  );
  cipher.setAuthTag(encrypted.subarray(-16));
  const snapshot = JSON.parse(
    Buffer.concat([
      cipher.update(encrypted.subarray(0, -16)),
      cipher.final(),
    ]).toString("utf8"),
  );
  assert.equal(
    Object.keys(snapshot.genotypes).length,
    expected.parsedVariants,
    "Route navigation must retain in-memory DNA",
  );
  assert.equal(
    snapshot.results.length,
    expected.matches,
    "Route navigation must retain saved results",
  );
  console.log(
    "PASS encrypted portable vault retains the full genome and all results across navigation",
  );
} finally {
  await browser.close();
}

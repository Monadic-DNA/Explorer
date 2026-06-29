#!/usr/bin/env node

/**
 * Downloads public raw DNA sample files from multiple providers and validates
 * that the local parser can detect and parse them.
 *
 * Run with:
 *   node --experimental-transform-types scripts/validate-genotype-samples.mjs
 *
 * Network access is required because the samples are fetched from GitHub.
 */

import { mkdirSync, writeFileSync } from "fs";
import { gzipSync } from "zlib";
import { join } from "path";
import pako from "pako";

const { detectAndParseGenotypeFile } = await import("../lib/genotype-parser.ts");

const SAMPLE_SPECS = [
  {
    provider: "23andMe",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/23andme.txt",
    acceptedFormats: ["23andme"],
  },
  {
    provider: "AncestryDNA",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/ancestry.txt",
    acceptedFormats: ["ancestrydna"],
  },
  {
    provider: "MyHeritage",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/myheritage.csv",
    acceptedFormats: ["myheritage"],
  },
  {
    provider: "FTDNA CSV",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/ftdna.csv",
    acceptedFormats: ["ftdna", "monadic"],
  },
  {
    provider: "FTDNA FamFinder",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/ftdna_famfinder.csv",
    acceptedFormats: ["ftdna"],
  },
  {
    provider: "LivingDNA",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/livingdna.csv",
    acceptedFormats: ["livingdna"],
  },
  {
    provider: "MyHeritage extra quotes",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/myheritage_extra_quotes.csv",
    acceptedFormats: ["myheritage"],
  },
  {
    provider: "AncestryDNA multi separator",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/ancestry_multi_sep.txt",
    acceptedFormats: ["ancestrydna"],
  },
];

function sanitizeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "codex" },
  });

  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }

  return response.text();
}

async function main() {
  const outputDir = join("/tmp", "genotype-samples", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
  mkdirSync(outputDir, { recursive: true });

  const results = [];

  for (const spec of SAMPLE_SPECS) {
    const content = await fetchText(spec.url);
    const parsed = detectAndParseGenotypeFile(content);
    const baseName = sanitizeName(spec.provider);
    writeFileSync(join(outputDir, `${baseName}.txt`), content);

    results.push({
      provider: spec.provider,
      variant: "plain",
      acceptedFormats: spec.acceptedFormats,
      detectedFormat: parsed.detectedFormat || null,
      success: parsed.success,
      variantCount: parsed.data?.length || 0,
      error: parsed.error || null,
      url: spec.url,
    });

    if (spec.provider === "23andMe" || spec.provider === "AncestryDNA" || spec.provider === "MyHeritage") {
      const gzBytes = gzipSync(Buffer.from(content, "utf8"));
      writeFileSync(join(outputDir, `${baseName}.txt.gz`), gzBytes);

      const gzText = new TextDecoder().decode(pako.ungzip(gzBytes));
      const gzParsed = detectAndParseGenotypeFile(gzText);
      results.push({
        provider: spec.provider,
        variant: "gz_roundtrip",
        acceptedFormats: spec.acceptedFormats,
        detectedFormat: gzParsed.detectedFormat || null,
        success: gzParsed.success,
        variantCount: gzParsed.data?.length || 0,
        error: gzParsed.error || null,
        url: `${spec.url} (gzipped locally after download)`,
      });
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    outputDir,
    successCount: results.filter((entry) => entry.success && entry.acceptedFormats.includes(entry.detectedFormat)).length,
    totalCount: results.length,
    results,
  };

  writeFileSync(join(outputDir, "validation-results.json"), JSON.stringify(summary, null, 2));

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

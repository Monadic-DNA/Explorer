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
import { inflateRawSync } from "zlib";
import { join } from "path";

const { detectAndParseGenotypeFile } = await import("../lib/genotype-parser.ts");

const SAMPLE_SPECS = [
  {
    provider: "23andMe",
    sample: "apriha/basic",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/23andme.txt",
    acceptedFormats: ["23andme"],
  },
  {
    provider: "23andMe",
    sample: "apriha/allele-columns",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/23andme_allele.txt",
    acceptedFormats: ["23andme", "livingdna"],
  },
  {
    provider: "23andMe",
    sample: "apriha/windows-newlines",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/23andme_win.txt",
    acceptedFormats: ["23andme"],
  },
  {
    provider: "AncestryDNA",
    sample: "apriha/basic",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/ancestry.txt",
    acceptedFormats: ["ancestrydna"],
  },
  {
    provider: "AncestryDNA",
    sample: "apriha/mt",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/ancestry_mt.txt",
    acceptedFormats: ["ancestrydna"],
  },
  {
    provider: "AncestryDNA",
    sample: "apriha/multi-separator",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/ancestry_multi_sep.txt",
    acceptedFormats: ["ancestrydna"],
  },
  {
    provider: "FTDNA",
    sample: "apriha/four-column",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/ftdna.csv",
    acceptedFormats: ["ftdna", "monadic"],
  },
  {
    provider: "FTDNA",
    sample: "apriha/famfinder",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/ftdna_famfinder.csv",
    acceptedFormats: ["ftdna"],
  },
  {
    provider: "LivingDNA",
    sample: "apriha/basic",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/livingdna.csv",
    acceptedFormats: ["livingdna"],
  },
  {
    provider: "Mapmygenome",
    sample: "apriha/basic",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/mapmygenome.txt",
    acceptedFormats: ["mapmygenome"],
  },
  {
    provider: "Mapmygenome",
    sample: "apriha/alt-header",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/mapmygenome_alt_header.txt",
    acceptedFormats: ["mapmygenome"],
  },
  {
    provider: "Mapmygenome",
    sample: "apriha/new-format",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/mapmygenome_new_format.txt",
    acceptedFormats: ["mapmygenome", "monadic", "23andme"],
  },
  {
    provider: "MyHeritage",
    sample: "apriha/basic",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/myheritage.csv",
    acceptedFormats: ["myheritage"],
  },
  {
    provider: "MyHeritage extra quotes",
    sample: "apriha/extra-quotes",
    url: "https://raw.githubusercontent.com/apriha/snps/main/tests/input/myheritage_extra_quotes.csv",
    acceptedFormats: ["myheritage"],
  },
  {
    provider: "23andMe",
    sample: "OpenDNA/sample",
    url: "https://raw.githubusercontent.com/corbett3000/OpenDNA/master/tests/fixtures/sample_23andme.txt",
    acceptedFormats: ["23andme"],
  },
  {
    provider: "23andMe",
    sample: "milaza/basic",
    url: "https://raw.githubusercontent.com/milaza/dna-raw-data-converter-23andme-myheritage-ancestry/main/examples/sample_23andme.txt",
    acceptedFormats: ["23andme"],
    expectSuccess: false,
  },
  {
    provider: "AncestryDNA",
    sample: "milaza/converter",
    url: "https://raw.githubusercontent.com/milaza/dna-raw-data-converter-23andme-myheritage-ancestry/main/examples/sam%D0%B7le_AncestryDNA.txt",
    acceptedFormats: ["ancestrydna"],
    expectSuccess: false,
  },
  {
    provider: "FTDNA",
    sample: "milaza/four-column",
    url: "https://raw.githubusercontent.com/milaza/dna-raw-data-converter-23andme-myheritage-ancestry/main/examples/sample_FamilyTreeDNA.csv",
    acceptedFormats: ["ftdna", "monadic"],
    expectSuccess: false,
  },
  {
    provider: "MyHeritage",
    sample: "milaza/basic",
    url: "https://raw.githubusercontent.com/milaza/dna-raw-data-converter-23andme-myheritage-ancestry/main/examples/sample_MyHeritage.csv",
    acceptedFormats: ["myheritage"],
    expectSuccess: false,
  },
  {
    provider: "MyHeritage",
    sample: "melvincarvalho/full-export",
    url: "https://raw.githubusercontent.com/melvincarvalho/dna/master/dna.csv",
    acceptedFormats: ["myheritage"],
  },
  {
    provider: "23andMe",
    sample: "DeepImpute/full-export",
    url: "https://raw.githubusercontent.com/aaronge-2020/DeepImpute/main/test_files/11576.23andme.9465.txt",
    acceptedFormats: ["23andme"],
  },
  {
    provider: "Genes for Good",
    sample: "PGP/plain-text",
    url: "https://d58995d3742b2243a00f53567e7c31c5-95.collections.ac2it.arvadosapi.com/_/GFGFilteredUnphasedGenotypes23andMe.txt",
    acceptedFormats: ["23andme"],
  },
  {
    provider: "23andMe",
    sample: "PGP/zip-2019-03-27",
    url: "https://2df8bd76617b789834be9a7f50e00477-100.collections.ac2it.arvadosapi.com/_/genome_dennis_gallo_v5_Full_20190327181104.zip",
    acceptedFormats: ["23andme"],
    kind: "zip",
  },
  {
    provider: "23andMe",
    sample: "PGP/zip-2019-01-10",
    url: "https://ac07513af7d69bf95f3f9b98e7914bed-91.collections.ac2it.arvadosapi.com/_/2019-01-10_23andMe-genome_v5_Full.zip",
    acceptedFormats: ["23andme"],
    kind: "zip",
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

function findEndOfCentralDirectory(bytes) {
  const minOffset = Math.max(0, bytes.length - 0xffff - 22);

  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }

  return -1;
}

function extractFirstZipEntry(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(bytes);
  if (eocdOffset < 0) throw new Error("ZIP end-of-central-directory not found");

  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  if (centralDirectoryOffset + 46 > bytes.length) throw new Error("ZIP central directory is truncated");
  if (view.getUint32(centralDirectoryOffset, true) !== 0x02014b50) throw new Error("ZIP central directory signature missing");

  const compressionMethod = view.getUint16(centralDirectoryOffset + 10, true);
  const compressedSize = view.getUint32(centralDirectoryOffset + 20, true);
  const fileNameLength = view.getUint16(centralDirectoryOffset + 28, true);
  const localHeaderOffset = view.getUint32(centralDirectoryOffset + 42, true);
  const filenameStart = centralDirectoryOffset + 46;
  const filenameEnd = filenameStart + fileNameLength;
  const filename = new TextDecoder().decode(bytes.slice(filenameStart, filenameEnd));

  if (localHeaderOffset + 30 > bytes.length) throw new Error("ZIP local header is truncated");
  if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) throw new Error("ZIP local file header signature missing");

  const localNameLength = view.getUint16(localHeaderOffset + 26, true);
  const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
  const dataEnd = dataStart + compressedSize;
  if (dataEnd > bytes.length) throw new Error("ZIP file entry is truncated");

  const compressed = bytes.slice(dataStart, dataEnd);

  if (compressionMethod === 0) {
    return { filename, data: compressed };
  }

  if (compressionMethod === 8) {
    return { filename, data: inflateRawSync(compressed) };
  }

  throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
}

async function fetchSample(spec) {
  if (spec.kind === "zip") {
    const response = await fetch(spec.url, {
      headers: { "User-Agent": "codex" },
    });
    if (!response.ok) {
      throw new Error(`Download failed (${response.status}) for ${spec.url}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const extracted = extractFirstZipEntry(bytes);
    return {
      content: new TextDecoder().decode(extracted.data),
      filename: extracted.filename,
    };
  }

  return {
    content: await fetchText(spec.url),
    filename: null,
  };
}

async function main() {
  const outputDir = join("/tmp", "genotype-samples", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
  mkdirSync(outputDir, { recursive: true });

  const results = [];

  for (const spec of SAMPLE_SPECS) {
    const { content, filename } = await fetchSample(spec);
    const parsed = detectAndParseGenotypeFile(content);
    const baseName = sanitizeName(`${spec.provider}-${spec.sample}`);
    writeFileSync(join(outputDir, `${baseName}.txt`), content);

    results.push({
      provider: spec.provider,
      sample: spec.sample,
      variant: spec.kind || "text",
      acceptedFormats: spec.acceptedFormats,
      expectSuccess: spec.expectSuccess ?? true,
      detectedFormat: parsed.detectedFormat || null,
      success: parsed.success,
      variantCount: parsed.data?.length || 0,
      error: parsed.error || null,
      url: spec.url,
      extractedFilename: filename,
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    outputDir,
    successCount: results.filter((entry) => {
      if (!entry.expectSuccess) return !entry.success;
      return entry.success && entry.acceptedFormats.includes(entry.detectedFormat);
    }).length,
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

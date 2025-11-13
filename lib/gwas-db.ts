// IndexedDB manager for GWAS Catalog local storage
import pako from 'pako';

const DB_NAME = 'gwas-catalog';
const DB_VERSION = 1;
const STORE_NAME = 'studies';
const META_STORE = 'metadata';

export type GWASStudy = {
  id: number;
  study_accession: string | null;
  disease_trait: string | null;
  study: string | null;
  snps: string | null;
  strongest_snp_risk_allele: string | null;
  or_or_beta: string | null;
  ci_text?: string | null;
  p_value?: string | null;
  pvalue_mlog?: string | null;
  mapped_gene?: string | null;
  initial_sample_size?: string | null;
  replication_sample_size?: string | null;
};

export type GWASMetadata = {
  key: string;
  downloadDate: string;
  fileUrl: string;
  totalStudies: number;
  version: string;
};

export class GWASDatabase {
  private db: IDBDatabase | null = null;

  async open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create studies store
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          // Index by SNPs for faster lookups
          store.createIndex('snps', 'snps', { unique: false });
        }

        // Create metadata store
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'key' });
        }
      };
    });
  }

  async downloadAndStore(
    url: string,
    onProgress?: (progress: { loaded: number; total: number; phase: string }) => void
  ): Promise<void> {
    if (!this.db) await this.open();

    // Download compressed file
    onProgress?.({ loaded: 0, total: 100, phase: 'downloading' });

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);

    const contentLength = parseInt(response.headers.get('content-length') || '0');
    const reader = response.body!.getReader();

    let receivedLength = 0;
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      receivedLength += value.length;

      onProgress?.({
        loaded: receivedLength,
        total: contentLength,
        phase: 'downloading'
      });
    }

    // Concatenate chunks into a single Uint8Array
    const compressed = new Uint8Array(receivedLength);
    let offset = 0;
    for (const chunk of chunks) {
      compressed.set(chunk, offset);
      offset += chunk.length;
    }

    console.log('Downloaded bytes:', receivedLength);
    console.log('First bytes (hex):', Array.from(compressed.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));

    // If server applied content-encoding gzip, browser may have already decompressed.
    // Otherwise this is a real .gz payload we must decompress.
    const looksGzipped = compressed.length >= 2 && compressed[0] === 0x1f && compressed[1] === 0x8b;
    const contentEncoding = response.headers.get('content-encoding') || '';
    const shouldDecompress = looksGzipped && !contentEncoding.toLowerCase().includes('gzip');

    onProgress?.({ loaded: 0, total: 100, phase: 'decompressing' });

    let decompressed: Uint8Array;

    // Always use pako for reliability
    if (shouldDecompress) {
      console.log('Decompressing with pako...');
      try {
        decompressed = pako.ungzip(compressed);
        console.log('Decompressed size:', decompressed.length, 'bytes');
      } catch (e) {
        console.error('Decompression failed:', e);
        throw new Error('Failed to decompress GWAS catalog file');
      }
    } else {
      console.log('Data already decompressed by browser or not gzipped; using as-is');
      decompressed = compressed;
    }

    // Parse decompressed data line by line without converting entire buffer to string
    onProgress?.({ loaded: 0, total: 100, phase: 'parsing' });

    // Process first line to get headers
    let headerEndIdx = 0;
    for (let i = 0; i < decompressed.length; i++) {
      if (decompressed[i] === 0x0a || (decompressed[i] === 0x0d && decompressed[i + 1] === 0x0a)) {
        headerEndIdx = i;
        break;
      }
    }

    const decoder = new TextDecoder('utf-8');
    const headerLine = decoder.decode(decompressed.slice(0, headerEndIdx));
    const headers = headerLine.split('\t');

    console.log('TSV Headers:', headers.slice(0, 10));
    console.log('Headers length:', headers.length);

    if (headers.length <= 1 || headers.every(h => h.trim() === '')) {
      throw new Error('Invalid TSV headers - file may be corrupted or improperly formatted');
    }

    // Find column indices
    const colMap: Record<string, number> = {};
    headers.forEach((header, idx) => {
      colMap[header.trim()] = idx;
    });

    // Required columns
    const snpsIdx = colMap['SNPS'];
    const accessionIdx = colMap['STUDY ACCESSION'];
    const traitIdx = colMap['DISEASE/TRAIT'];
    const studyIdx = colMap['STUDY'];
    const riskAlleleIdx = colMap['STRONGEST SNP-RISK ALLELE'];
    const orBetaIdx = colMap['OR or BETA'];

    // Optional metadata columns
    const ciTextIdx = colMap['95% CI (TEXT)'];
    const pValueIdx = colMap['P-VALUE'];
    const pValueMlogIdx = colMap['PVALUE_MLOG'];
    const mappedGeneIdx = colMap['MAPPED_GENE'];
    const sampleSizeIdx = colMap['INITIAL SAMPLE SIZE'];
    const replicationSizeIdx = colMap['REPLICATION SAMPLE SIZE'];

    console.log('Column indices:', { snpsIdx, accessionIdx, traitIdx, studyIdx, riskAlleleIdx, orBetaIdx, ciTextIdx, pValueIdx, pValueMlogIdx, mappedGeneIdx, sampleSizeIdx, replicationSizeIdx });

    // Process rest of file in chunks to avoid memory issues
    const batchSize = 5000;
    let currentBatch: GWASStudy[] = [];
    let studyId = 0;
    let storedCount = 0;
    let skippedNoSnps = 0;
    let lineNumber = 0;

    // Estimate total lines for progress (rough estimate: avg 500 bytes per line)
    const estimatedTotalLines = Math.floor(decompressed.length / 500);
    onProgress?.({ loaded: 0, total: estimatedTotalLines, phase: 'storing' });

    // Process buffer in chunks to avoid string size limits
    const chunkSize = 10 * 1024 * 1024; // 10MB chunks
    let position = headerEndIdx + (decompressed[headerEndIdx] === 0x0d ? 2 : 1); // Skip header
    let leftover = new Uint8Array(0);

    while (position < decompressed.length) {
      const chunkEnd = Math.min(position + chunkSize, decompressed.length);
      const chunk = decompressed.slice(position, chunkEnd);

      // Combine leftover from previous chunk with current chunk
      const combined = new Uint8Array(leftover.length + chunk.length);
      combined.set(leftover);
      combined.set(chunk, leftover.length);

      // Find last complete line in this chunk
      let lastNewline = combined.length - 1;
      for (let i = combined.length - 1; i >= 0; i--) {
        if (combined[i] === 0x0a) {
          lastNewline = i;
          break;
        }
      }

      // Decode up to last complete line
      const textChunk = decoder.decode(combined.slice(0, lastNewline + 1));
      const lines = textChunk.split(/\r?\n/);

      // Process lines
      for (const line of lines) {
        if (!line.trim()) continue;

        lineNumber++;

        if (lineNumber % 10000 === 0) {
          onProgress?.({ loaded: storedCount, total: estimatedTotalLines, phase: 'storing' });
          console.log(`Processed ${lineNumber} lines, found ${studyId} studies with SNPs, skipped ${skippedNoSnps}`);
        }

        const cols = line.split('\t');

        // Only store studies with SNP data
        const snps = cols[snpsIdx]?.trim();
        if (!snps) {
          skippedNoSnps++;
          continue;
        }

        currentBatch.push({
          id: studyId++,
          study_accession: cols[accessionIdx] || null,
          disease_trait: cols[traitIdx] || null,
          study: cols[studyIdx] || null,
          snps: snps,
          strongest_snp_risk_allele: cols[riskAlleleIdx] || null,
          or_or_beta: cols[orBetaIdx] || null,
          ci_text: cols[ciTextIdx] || null,
          p_value: cols[pValueIdx] || null,
          pvalue_mlog: cols[pValueMlogIdx] || null,
          mapped_gene: cols[mappedGeneIdx] || null,
          initial_sample_size: cols[sampleSizeIdx] || null,
          replication_sample_size: cols[replicationSizeIdx] || null,
        });

        // Store batch when it reaches size limit
        if (currentBatch.length >= batchSize) {
          await this.storeBatch(currentBatch);
          storedCount += currentBatch.length;
          currentBatch = [];
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      // Save incomplete line for next iteration
      leftover = combined.slice(lastNewline + 1);
      position = chunkEnd;
    }

    // Store remaining records
    if (currentBatch.length > 0) {
      await this.storeBatch(currentBatch);
      storedCount += currentBatch.length;
    }

    console.log(`Finished processing. Total lines: ${lineNumber}, Studies stored: ${storedCount}, Skipped: ${skippedNoSnps}`);

    onProgress?.({ loaded: storedCount, total: storedCount, phase: 'storing' });
    console.log("Successfully stored", storedCount, "studies in IndexedDB");

    // Store metadata
    await this.setMetadata({
      key: 'catalog',
      downloadDate: new Date().toISOString(),
      fileUrl: url,
      totalStudies: storedCount,
      version: '1.0.2',
    });
    console.log("Metadata stored. Total studies:", storedCount);

    // Close and reopen database to ensure all data is committed
    this.close();
    await this.open();
    console.log("Database connection refreshed after storing data");
  }

  private async storeBatch(studies: GWASStudy[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not opened');
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      let successCount = 0;
      for (const study of studies) {
        const request = store.put(study);
        request.onsuccess = () => successCount++;
        request.onerror = () => console.error('Failed to store study:', study.id, request.error);
      }

      tx.oncomplete = () => {
        console.log(`Batch stored: ${successCount}/${studies.length} studies`);
        resolve();
      };
      tx.onerror = () => {
        console.error('Transaction error:', tx.error);
        reject(tx.error);
      };
    });
  }

  async getMetadata(): Promise<GWASMetadata | null> {
    if (!this.db) await this.open();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(META_STORE, 'readonly');
      const store = tx.objectStore(META_STORE);
      const request = store.get('catalog');

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  private async setMetadata(meta: GWASMetadata): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(META_STORE, 'readwrite');
      const store = tx.objectStore(META_STORE);
      store.put(meta);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAllStudies(): Promise<GWASStudy[]> {
    if (!this.db) await this.open();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getStudyCount(): Promise<number> {
    if (!this.db) await this.open();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async *streamStudies(batchSize: number = 10000): AsyncGenerator<GWASStudy[]> {
    if (!this.db) await this.open();

    let lastKey: number | undefined = undefined;
    let batchNumber = 0;

    while (true) {
      batchNumber++;
      const batchStart = Date.now();
      const batch = await new Promise<GWASStudy[]>((resolve, reject) => {
        const tx = this.db!.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);

        // Use IDBKeyRange to start from last key, much faster than skipping
        const range = lastKey !== undefined
          ? IDBKeyRange.lowerBound(lastKey, true) // exclusive
          : undefined;

        const request = store.openCursor(range);

        const results: GWASStudy[] = [];

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor && results.length < batchSize) {
            results.push(cursor.value);
            lastKey = cursor.key as number;
            cursor.continue();
          } else {
            resolve(results);
          }
        };

        request.onerror = () => reject(request.error);
      });

      const batchTime = Date.now() - batchStart;
      console.log(`IndexedDB batch ${batchNumber}: ${batch.length} records in ${batchTime}ms`);

      if (batch.length === 0) {
        console.log('Stream complete - no more records');
        break;
      }

      yield batch;
    }
  }

  async clearDatabase(): Promise<void> {
    if (!this.db) await this.open();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME, META_STORE], 'readwrite');

      tx.objectStore(STORE_NAME).clear();
      tx.objectStore(META_STORE).clear();

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getStorageSize(): Promise<number> {
    if (!navigator.storage?.estimate) return 0;

    const estimate = await navigator.storage.estimate();
    return estimate.usage || 0;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

export const gwasDB = new GWASDatabase();

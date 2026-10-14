// IndexedDB storage for the encrypted on-device vault.
// Only the header is plaintext, and it holds no genetic or personal data.

import {
  EncryptedBytes,
  VAULT_PBKDF2_ITERATIONS,
  decryptBytes,
  deriveVaultKey,
  encryptBytes,
} from "./encryption-utils";

const DB_NAME = "monadic_vault";
const DB_VERSION = 1;
const STORE_NAME = "records";
const HEADER_KEY = "header";
const VERIFIER_TEXT = "monadic-vault-v1";

export type VaultSection = "genotype" | "results" | "personalization";

export type VaultHeader = {
  version: 1;
  id: string; // Random per vault, so writes can detect a vault deleted or recreated elsewhere
  salt: Uint8Array;
  iterations: number;
  verifier: EncryptedBytes;
  createdAt: string;
  sections: Partial<Record<VaultSection, string>>; // section name -> ISO date of last save
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
  const db = await openDB();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = run(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function getVaultHeader(): Promise<VaultHeader | null> {
  if (typeof indexedDB === "undefined") return null;
  const header = await withStore<VaultHeader>("readonly", (store) => store.get(HEADER_KEY));
  return header ?? null;
}

export async function createVault(passphrase: string): Promise<{ key: CryptoKey; header: VaultHeader }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveVaultKey(passphrase, salt, VAULT_PBKDF2_ITERATIONS);
  const verifier = await encryptBytes(key, new TextEncoder().encode(VERIFIER_TEXT));
  const header: VaultHeader = {
    version: 1,
    id: crypto.randomUUID(),
    salt,
    iterations: VAULT_PBKDF2_ITERATIONS,
    verifier,
    createdAt: new Date().toISOString(),
    sections: {},
  };

  await withStore("readwrite", (store) => {
    store.clear();
    store.put(header, HEADER_KEY);
  });

  return { key, header };
}

// Returns null when the passphrase is wrong.
export async function unlockVault(header: VaultHeader, passphrase: string): Promise<CryptoKey | null> {
  const key = await deriveVaultKey(passphrase, header.salt, header.iterations);
  try {
    const check = await decryptBytes(key, header.verifier);
    return new TextDecoder().decode(check) === VERIFIER_TEXT ? key : null;
  } catch {
    return null;
  }
}

export class VaultChangedError extends Error {
  constructor() {
    super("Saved data was deleted or replaced in another tab");
  }
}

// Writes and removes sections atomically. Everything is encrypted first, then one
// transaction re-reads the current header, checks it is the same vault, merges the
// section dates, and writes all records. A failure (e.g. quota) leaves the vault unchanged.
export async function writeVaultSections(
  key: CryptoKey | null,
  vaultId: string,
  changes: Partial<Record<VaultSection, Uint8Array | null>>
): Promise<VaultHeader> {
  const encrypted: Partial<Record<VaultSection, EncryptedBytes>> = {};
  for (const [section, data] of Object.entries(changes) as [VaultSection, Uint8Array | null][]) {
    if (!data) continue;
    if (!key) throw new Error("Saved data is locked");
    encrypted[section] = await encryptBytes(key, data);
  }

  const db = await openDB();
  try {
    return await new Promise<VaultHeader>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      let updated: VaultHeader | null = null;
      let failure: unknown = null;

      const headerRequest = store.get(HEADER_KEY);
      headerRequest.onsuccess = () => {
        const current = headerRequest.result as VaultHeader | undefined;
        if (!current || current.id !== vaultId) {
          failure = new VaultChangedError();
          tx.abort();
          return;
        }

        const now = new Date().toISOString();
        const sections = { ...current.sections };
        for (const [section, data] of Object.entries(changes) as [VaultSection, Uint8Array | null][]) {
          if (data) {
            store.put(encrypted[section], section);
            sections[section] = now;
          } else {
            store.delete(section);
            delete sections[section];
          }
        }
        updated = { ...current, sections };
        store.put(updated, HEADER_KEY);
      };

      tx.oncomplete = () => resolve(updated!);
      tx.onerror = () => reject(failure ?? tx.error);
      tx.onabort = () => reject(failure ?? tx.error);
    });
  } finally {
    db.close();
  }
}

export async function readVaultSection(key: CryptoKey, section: VaultSection): Promise<Uint8Array | null> {
  const encrypted = await withStore<EncryptedBytes>("readonly", (store) => store.get(section));
  if (!encrypted) return null;
  return decryptBytes(key, encrypted);
}

export function deleteVault(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    // Another tab holding the DB open blocks deletion until it closes.
    request.onblocked = () => resolve();
  });
}

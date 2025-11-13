/**
 * Dev Mode Utilities
 *
 * SECURITY: Dev mode is ONLY enabled when:
 * 1. NODE_ENV === 'development'
 * 2. Running on localhost
 *
 * Dev mode allows auto-loading of genotype and results files to speed up development.
 * Uses IndexedDB to store persistent file handles from the File System Access API.
 * Files are loaded automatically on app start without manual selection.
 *
 * This should NEVER be enabled in production.
 */

const DB_NAME = 'gwasifier_dev_mode';
const DB_VERSION = 1;
const STORE_NAME = 'file_handles';
const GENOTYPE_HANDLE_KEY = 'genotype_file_handle';
const RESULTS_HANDLE_KEY = 'results_file_handle';
const PASSWORD_KEY = 'personalization_password';

// Fallback for browsers without File System Access API
const LOCALSTORAGE_GENOTYPE_PATH = 'gwasifier_dev_genotype_path';
const LOCALSTORAGE_RESULTS_PATH = 'gwasifier_dev_results_path';

/**
 * Check if dev mode is enabled
 * Only requires:
 * - NODE_ENV === 'development'
 * - Running on localhost
 */
export function isDevModeEnabled(): boolean {
  // Must be in development environment
  if (process.env.NODE_ENV !== 'development') {
    return false;
  }

  // Must be on localhost (client-side check)
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return false;
    }
  }

  return true;
}

/**
 * Check if File System Access API is supported
 */
export function isFileSystemAccessSupported(): boolean {
  const supported = typeof window !== 'undefined' && 'showOpenFilePicker' in window;

  if (!supported && typeof window !== 'undefined') {
    // Check if we're in a Chromium-based browser that might have it disabled
    const isChromium = !!(window as any).chrome;
    if (isChromium) {
      console.log('[Dev Mode] ℹ️ File System Access API not available.');
      console.log('[Dev Mode] This might be disabled in your browser settings (common in Brave).');
      console.log('[Dev Mode] Fallback mode: File pickers will appear automatically on load.');
    }
  }

  return supported;
}

/**
 * Open IndexedDB for storing file handles
 */
async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

/**
 * Save genotype file handle to IndexedDB
 */
export async function saveGenotypeFileHandle(fileHandle: FileSystemFileHandle): Promise<void> {
  if (!isDevModeEnabled()) return;

  try {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(fileHandle, GENOTYPE_HANDLE_KEY);

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    console.log('[Dev Mode] ✓ Saved genotype file handle for auto-load');
  } catch (error) {
    console.error('[Dev Mode] Failed to save genotype file handle:', error);
  }
}

/**
 * Get saved genotype file handle from IndexedDB
 */
export async function getGenotypeFileHandle(): Promise<FileSystemFileHandle | null> {
  if (!isDevModeEnabled()) return null;

  try {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(GENOTYPE_HANDLE_KEY);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[Dev Mode] Failed to get genotype file handle:', error);
    return null;
  }
}

/**
 * Save results file handle to IndexedDB
 */
export async function saveResultsFileHandle(fileHandle: FileSystemFileHandle): Promise<void> {
  if (!isDevModeEnabled()) return;

  try {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(fileHandle, RESULTS_HANDLE_KEY);

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    console.log('[Dev Mode] ✓ Saved results file handle for auto-load');
  } catch (error) {
    console.error('[Dev Mode] Failed to save results file handle:', error);
  }
}

/**
 * Get saved results file handle from IndexedDB
 */
export async function getResultsFileHandle(): Promise<FileSystemFileHandle | null> {
  if (!isDevModeEnabled()) return null;

  try {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(RESULTS_HANDLE_KEY);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[Dev Mode] Failed to get results file handle:', error);
    return null;
  }
}

/**
 * Request file picker and save genotype file handle
 */
export async function selectAndSaveGenotypeFile(): Promise<File | null> {
  if (!isDevModeEnabled()) return null;

  // Use File System Access API if available
  if (isFileSystemAccessSupported()) {
    try {
      const [fileHandle] = await (window as any).showOpenFilePicker({
        types: [
          {
            description: 'Genotype Files',
            accept: {
              'text/plain': ['.txt', '.tsv', '.csv'],
            },
          },
        ],
        multiple: false,
        startIn: 'downloads',
      });

      // Save the file handle for future use
      await saveGenotypeFileHandle(fileHandle);

      // Return the file
      const file = await fileHandle.getFile();
      return file;
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('[Dev Mode] Failed to select genotype file:', error);
      }
      return null;
    }
  }

  // Fallback: Just mark that a file was used
  localStorage.setItem(LOCALSTORAGE_GENOTYPE_PATH, 'true');
  console.log('[Dev Mode] Marked genotype as used (fallback mode)');
  return null;
}

/**
 * Request file picker and save results file handle
 */
export async function selectAndSaveResultsFile(): Promise<File | null> {
  if (!isDevModeEnabled()) return null;

  // Use File System Access API if available
  if (isFileSystemAccessSupported()) {
    try {
      const [fileHandle] = await (window as any).showOpenFilePicker({
        types: [
          {
            description: 'Results Files',
            accept: {
              'text/tab-separated-values': ['.tsv'],
            },
          },
        ],
        multiple: false,
        startIn: 'downloads',
      });

      // Save the file handle for future use
      await saveResultsFileHandle(fileHandle);

      // Return the file
      const file = await fileHandle.getFile();
      return file;
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('[Dev Mode] Failed to select results file:', error);
      }
      return null;
    }
  }

  // Fallback: Just mark that a file was used
  localStorage.setItem(LOCALSTORAGE_RESULTS_PATH, 'true');
  console.log('[Dev Mode] Marked results as used (fallback mode)');
  return null;
}

/**
 * Load genotype file from saved handle (automatic, no picker)
 * Falls back to prompting for file if File System Access API not supported
 */
export async function loadGenotypeFile(): Promise<File | null> {
  if (!isDevModeEnabled()) return null;

  // Try File System Access API first
  if (isFileSystemAccessSupported()) {
    try {
      const fileHandle = await getGenotypeFileHandle();
      if (!fileHandle) {
        console.log('[Dev Mode] No genotype file handle saved. Upload a file to enable auto-load.');
        return null;
      }

      // Request permission to read the file
      const permission = await (fileHandle as any).queryPermission({ mode: 'read' });
      if (permission !== 'granted') {
        const requestPermission = await (fileHandle as any).requestPermission({ mode: 'read' });
        if (requestPermission !== 'granted') {
          console.log('[Dev Mode] Permission denied to read genotype file');
          return null;
        }
      }

      const file = await fileHandle.getFile();
      console.log('[Dev Mode] ✓ Auto-loaded genotype file:', file.name);
      return file;
    } catch (error) {
      console.error('[Dev Mode] Failed to load genotype file:', error);
      console.log('[Dev Mode] Please select the file again using "Load genetic data"');
      return null;
    }
  }

  // Fallback: Check if we have a previously used file (localStorage marker)
  const hasGenotypeMarker = localStorage.getItem(LOCALSTORAGE_GENOTYPE_PATH);
  console.log('[Dev Mode] Checking for genotype marker:', hasGenotypeMarker);

  if (!hasGenotypeMarker) {
    console.log('[Dev Mode] No saved genotype marker. Upload a file once to enable auto-load prompt on next session.');
    return null;
  }

  console.log('[Dev Mode] 🚀 Genotype marker found! Opening file picker...');
  console.log('[Dev Mode] (Brave/Firefox fallback mode: File System Access API not available)');

  // Prompt user to select the file
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.tsv,.csv';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        console.log('[Dev Mode] ✓ Genotype file selected:', file.name);
        resolve(file);
      } else {
        resolve(null);
      }
    };
    input.click();
  });
}

/**
 * Load results file from saved handle (automatic, no picker)
 * Falls back to prompting for file if File System Access API not supported
 */
export async function loadResultsFile(): Promise<File | null> {
  if (!isDevModeEnabled()) return null;

  // Try File System Access API first
  if (isFileSystemAccessSupported()) {
    try {
      const fileHandle = await getResultsFileHandle();
      if (!fileHandle) {
        console.log('[Dev Mode] No results file handle saved. Export results to enable auto-load.');
        return null;
      }

      // Request permission to read the file
      const permission = await (fileHandle as any).queryPermission({ mode: 'read' });
      if (permission !== 'granted') {
        const requestPermission = await (fileHandle as any).requestPermission({ mode: 'read' });
        if (requestPermission !== 'granted') {
          console.log('[Dev Mode] Permission denied to read results file');
          return null;
        }
      }

      const file = await fileHandle.getFile();
      console.log('[Dev Mode] ✓ Auto-loaded results file:', file.name);
      return file;
    } catch (error) {
      console.error('[Dev Mode] Failed to load results file:', error);
      console.log('[Dev Mode] Please load the file again using the "Load" button');
      return null;
    }
  }

  // Fallback: Check if we have a previously used file (localStorage marker)
  const hasResultsMarker = localStorage.getItem(LOCALSTORAGE_RESULTS_PATH);
  console.log('[Dev Mode] Checking for results marker:', hasResultsMarker);

  if (!hasResultsMarker) {
    console.log('[Dev Mode] No saved results marker. Load or export results once to enable auto-load prompt on next session.');
    return null;
  }

  console.log('[Dev Mode] 🚀 Results marker found! Opening file picker...');
  console.log('[Dev Mode] (Brave/Firefox fallback mode: File System Access API not available)');

  // Prompt user to select the file
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.tsv';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        console.log('[Dev Mode] ✓ Results file selected:', file.name);
        resolve(file);
      } else {
        resolve(null);
      }
    };
    input.click();
  });
}

/**
 * Clear all dev mode storage
 */
export async function clearDevModeStorage(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.clear();

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    console.log('[Dev Mode] Cleared dev mode storage');
  } catch (error) {
    console.error('[Dev Mode] Failed to clear dev mode storage:', error);
  }
}

/**
 * Mark genotype file as used (for fallback browsers)
 */
export function markGenotypeUsed(): void {
  if (!isDevModeEnabled()) return;
  localStorage.setItem(LOCALSTORAGE_GENOTYPE_PATH, 'true');
  console.log('[Dev Mode] ✓ Marked genotype as used for auto-load');
}

/**
 * Mark results file as used (for fallback browsers)
 */
export function markResultsUsed(): void {
  if (!isDevModeEnabled()) return;
  localStorage.setItem(LOCALSTORAGE_RESULTS_PATH, 'true');
  console.log('[Dev Mode] ✓ Marked results as used for auto-load');
}

/**
 * Save personalization password to IndexedDB (dev mode only)
 */
export async function savePersonalizationPassword(password: string): Promise<void> {
  if (!isDevModeEnabled()) return;

  try {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(password, PASSWORD_KEY);

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    console.log('[Dev Mode] ✓ Saved personalization password for auto-unlock');
  } catch (error) {
    console.error('[Dev Mode] Failed to save password:', error);
  }
}

/**
 * Get saved personalization password from IndexedDB
 */
export async function getPersonalizationPassword(): Promise<string | null> {
  if (!isDevModeEnabled()) return null;

  try {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(PASSWORD_KEY);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[Dev Mode] Failed to get password:', error);
    return null;
  }
}

/**
 * Log dev mode status (helpful for debugging)
 */
export async function logDevModeStatus(): Promise<void> {
  console.log('[Dev Mode] Status:', {
    enabled: isDevModeEnabled(),
    nodeEnv: process.env.NODE_ENV,
    hostname: typeof window !== 'undefined' ? window.location.hostname : 'N/A',
    fileSystemAccessSupported: isFileSystemAccessSupported(),
    genotypeHandleSaved: !!(await getGenotypeFileHandle()),
    resultsHandleSaved: !!(await getResultsFileHandle()),
    passwordSaved: !!(await getPersonalizationPassword()),
  });
}

/**
 * Encryption utilities for sensitive user data
 * Uses Web Crypto API for secure client-side encryption
 */

// Derive encryption key from password using PBKDF2
async function deriveKey(password: string, salt: Uint8Array, iterations: number = 100000): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  salt: string;
}

export async function encryptData(data: string, password: string): Promise<EncryptedData> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const key = await deriveKey(password, salt);

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    encoder.encode(data)
  );

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encryptedBuffer))),
    iv: btoa(String.fromCharCode(...iv)),
    salt: btoa(String.fromCharCode(...salt)),
  };
}

export async function decryptData(
  encryptedData: EncryptedData,
  password: string
): Promise<string> {
  const decoder = new TextDecoder();

  // Convert base64 back to Uint8Array
  const ciphertext = Uint8Array.from(atob(encryptedData.ciphertext), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(encryptedData.iv), c => c.charCodeAt(0));
  const salt = Uint8Array.from(atob(encryptedData.salt), c => c.charCodeAt(0));

  const key = await deriveKey(password, salt);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      ciphertext
    );

    return decoder.decode(decryptedBuffer);
  } catch (error) {
    throw new Error('Decryption failed - incorrect password');
  }
}

// Binary, key-based helpers for the on-device vault. Payloads stay as
// ArrayBuffers so large genotype data never goes through base64 strings.

export const VAULT_PBKDF2_ITERATIONS = 600000;

export interface EncryptedBytes {
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
}

export function deriveVaultKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  return deriveKey(password, salt, iterations);
}

export async function encryptBytes(key: CryptoKey, data: Uint8Array): Promise<EncryptedBytes> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    data as BufferSource
  );
  return { iv, ciphertext };
}

export async function decryptBytes(key: CryptoKey, encrypted: EncryptedBytes): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: encrypted.iv as BufferSource },
    key,
    encrypted.ciphertext
  );
  return new Uint8Array(plaintext);
}

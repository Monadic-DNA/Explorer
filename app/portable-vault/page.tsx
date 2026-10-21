'use client';

import { useRef, useState } from 'react';
import { coreCall } from '@/lib/core';
import { useGenotype } from '@/app/components/UserDataUpload';
import { useResults } from '@/app/components/ResultsContext';
import { useCustomization, type UserCustomization } from '@/app/components/CustomizationContext';
import type { SavedResult } from '@/lib/results-manager';

type PortableSnapshot = { version: 1; genotypes: Record<string, string>; results: SavedResult[]; customization?: { fields: Record<string,string>; context: string }; metadata: { fileHash?: string; fileName?: string; detectedFormat?: string; count?: number } };
const entropy = (count: number) => btoa(Array.from(crypto.getRandomValues(new Uint8Array(count)), b => String.fromCharCode(b)).join(''));

export default function PortableVaultPage() {
  const genotype = useGenotype();
  const results = useResults();
  const personalization = useCustomization();
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  async function exportVault() {
    setBusy(true); setMessage('');
    try {
      if (password.length < 12) throw new Error('Use a recovery passphrase with at least 12 characters.');
      const snapshot: PortableSnapshot = {
        customization: { fields: Object.fromEntries(Object.entries(personalization.customization || {}).filter(([key]) => key !== 'additionalContext').map(([key,value]) => [key, Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value)])), context: personalization.customization?.additionalContext || '' },
        version: 1, genotypes: Object.fromEntries(genotype.genotypeData || []), results: results.savedResults,
        metadata: { fileHash: genotype.fileHash || undefined, fileName: genotype.originalFileName || undefined, detectedFormat: genotype.detectedFormat || undefined, count: genotype.genotypeData?.size || 0 },
      };
      const key=entropy(32), vaultId=crypto.randomUUID();
      const envelope=coreCall('vault_seal',{snapshot:JSON.stringify(snapshot),key,vaultId,revision:1,nonce:entropy(12)});
      const wrappedKey=coreCall('vault_wrap_key',{key,vaultId,password,salt:entropy(16),nonce:entropy(12)});
      const archive={version:2,envelope,wrappedKey};
      const sealed={...archive,mac:coreCall('vault_record_mac',{key,record:archive})};
      const url = URL.createObjectURL(new Blob([JSON.stringify(sealed)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'monadic-vault.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPassword(''); setMessage('Encrypted portable vault exported.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Export failed.'); }
    finally { setBusy(false); }
  }
  async function importVault(selected: File) {
    setBusy(true); setMessage('');
    let session: number | undefined;
    try {
      if (selected.size > 300 * 1024 * 1024) throw new Error('Vault exceeds 300 MB.');
      const envelope = JSON.parse(await selected.text());
      let plaintext:string;
      if(envelope.version===2) {
        if(envelope.envelope?.vaultId!==envelope.wrappedKey?.vaultId)throw new Error('Invalid recovery archive.');
        const key=coreCall<string>('vault_unwrap_key',{wrappedKey:envelope.wrappedKey,password});
        coreCall('vault_record_verify',{key,record:envelope});
        plaintext=coreCall<string>('vault_open',{envelope:envelope.envelope,key});
      } else { plaintext=coreCall<string>('open',{...envelope,password}); }
      session = coreCall<number>('session_create');
      coreCall('session_restore', { session, snapshot: plaintext }); // Validate before altering UI state.
      const snapshot = JSON.parse(plaintext) as PortableSnapshot;
      genotype.restoreGenotype({ data: new Map(Object.entries(snapshot.genotypes)), fileHash: snapshot.metadata.fileHash || null, originalFileName: snapshot.metadata.fileName || null, originalFileSize: null, detectedFormat: snapshot.metadata.detectedFormat || null, fileExtension: snapshot.metadata.fileName?.split('.').pop() || null });
      await results.restoreResults(snapshot.results);
      personalization.setSessionCustomization({...coreCall<UserCustomization>('parse_profile',snapshot.customization?.fields || {}),additionalContext:snapshot.customization?.context || ''});
      setPassword(''); setMessage(`Restored ${Object.keys(snapshot.genotypes).length.toLocaleString()} variants and ${snapshot.results.length.toLocaleString()} results into memory.`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Import failed.'); }
    finally { if (session !== undefined) coreCall('session_close', { session }); setBusy(false); if (file.current) file.current.value = ''; }
  }
  return <main style={{ maxWidth: 680, padding: 24, margin: '32px auto' }}>
    <h1>Portable encrypted vault</h1>
    <p>Move your DNA, saved study results and customization between Web, Android, and iOS. Encryption and the file format come from the same Rust library on all three platforms.</p>
    <p>The passphrase protects the exported file. Imports replace your in-memory DNA, results and customization; they do not overwrite an existing on-device vault. Your data stays on this device. Use the save controls for DNA, results and customization to persist imported data in the browser’s encrypted vault. Automatic cloud sync is currently available in the native apps.</p>
    <label>Vault passphrase <input type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
    <div style={{ display: 'flex', gap: 12, margin: '20px 0' }}>
      <button disabled={busy || password.length < 12} onClick={exportVault}>Export encrypted vault</button>
      <button disabled={busy || !password} onClick={() => file.current?.click()}>Import encrypted vault</button>
    </div>
    <input ref={file} hidden type="file" accept=".json,application/json" onChange={event => { const selected = event.target.files?.[0]; if (selected) void importVault(selected); }} />
    {busy && <p role="status">Processing encrypted vault…</p>}
    {message && <p role="status">{message}</p>}
  </main>;
}

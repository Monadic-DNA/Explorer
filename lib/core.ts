import { coreWasmBase64 } from './generated/core-wasm';

type CoreExports = {
  memory: WebAssembly.Memory;
  explorer_alloc(length: number): number;
  explorer_free(pointer: number, length: number): void;
  explorer_call(pointer: number, length: number): number;
  explorer_result_len(): number;
};
let core: CoreExports | undefined;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One synchronous, import-free WASM implementation for browsers, SSR and workers. */
export function coreCall<T>(operation: string, input: unknown = null): T {
  if (!core) {
    const bytes = Uint8Array.from(atob(coreWasmBase64), c => c.charCodeAt(0));
    core = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports as unknown as CoreExports;
  }
  const request = encoder.encode(JSON.stringify({ version: 1, operation, input }));
  const pointer = core.explorer_alloc(request.length);
  try {
    new Uint8Array(core.memory.buffer, pointer, request.length).set(request);
    const output = core.explorer_call(pointer, request.length);
    const envelope = JSON.parse(decoder.decode(new Uint8Array(core.memory.buffer, output, core.explorer_result_len()))) as { ok: boolean; value: T; error?: string };
    if (!envelope.ok) throw new Error(envelope.error || 'Shared core operation failed');
    return envelope.value;
  } finally {
    core.explorer_free(pointer, request.length);
  }
}

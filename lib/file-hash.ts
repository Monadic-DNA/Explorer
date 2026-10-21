import { coreCall } from "./core";

export function calculateFileHash(fileContent: string): string { return coreCall("file_hash", fileContent); }

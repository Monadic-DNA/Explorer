import { NextResponse } from 'next/server';
import { verifyWalletAuth } from '@/lib/dynamic-auth';
import { deleteSyncedVault, MAX_SYNC_BYTES, readSyncedVault, VaultSyncError, writeSyncedVault } from '@/lib/vault-sync';
export const runtime='nodejs';
async function body(request:Request):Promise<Record<string,unknown>> {
  if(Number(request.headers.get('content-length'))>MAX_SYNC_BYTES)throw new VaultSyncError('Encrypted vault is too large',413);
  const reader=request.body?.getReader();if(!reader) throw new VaultSyncError('Missing request');
  const parts:Uint8Array[]=[];let size=0;
  while(true) {const {done,value}=await reader.read();if(done) break;size+=value.length;if(size>MAX_SYNC_BYTES){await reader.cancel();throw new VaultSyncError('Encrypted vault is too large',413);}parts.push(value);}
  try{const value=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!value || typeof value!=='object' || Array.isArray(value))throw new Error();return value;}catch{throw new VaultSyncError('Invalid request');}
}
async function wallet(request:Request,value:unknown) {
  if(process.env.VAULT_SYNC_ENABLED!=='true') throw new VaultSyncError('Encrypted sync is not configured',503);
  if(typeof value!=='string' || !/^0x[0-9a-f]{40}$/i.test(value)) throw new VaultSyncError('Invalid account');
  const auth=await verifyWalletAuth(request.headers.get('authorization'),value);
  if(!auth.ok) throw new VaultSyncError(auth.error || 'Authentication required',auth.status || 401);
  return value.toLowerCase();
}
function failure(error:unknown) {const known=error instanceof VaultSyncError?error:new VaultSyncError('Encrypted sync is unavailable',503);return NextResponse.json({error:known.message},{status:known.status,headers:{'Cache-Control':'no-store'}});}
export async function POST(request:Request) {
  try {
    const data=await body(request), owner=await wallet(request,data.walletAddress);
    if(['write','delete'].includes(String(data.action)) && typeof data.baseRevision!=='number')throw new VaultSyncError('Invalid sync revision');
    switch(data.action) {
      case 'read':return NextResponse.json(await readSyncedVault(owner,typeof data.knownRevision==='number'?data.knownRevision:undefined,typeof data.knownGenotype==='string'?data.knownGenotype:undefined),{headers:{'Cache-Control':'no-store'}});
      case 'write':return NextResponse.json({revision:await writeSyncedVault(owner,Number(data.baseRevision),data.archive as Parameters<typeof writeSyncedVault>[2])},{headers:{'Cache-Control':'no-store'}});
      case 'delete':await deleteSyncedVault(owner,Number(data.baseRevision));return NextResponse.json({deleted:true},{headers:{'Cache-Control':'no-store'}});
      default:throw new VaultSyncError('Invalid sync action');
    }
  } catch(error) {return failure(error);}
}

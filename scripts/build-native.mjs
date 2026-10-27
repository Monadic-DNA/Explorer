import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const platform=process.argv[2];
const arch=process.argv[3] || (platform==='android'?'arm64-v8a':'simulator');
const cargo=process.env.CARGO || 'cargo';
function run(command,args,env=process.env){const result=spawnSync(command,args,{cwd:root,stdio:'inherit',env});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);}
function bind(library,language,out){mkdirSync(out,{recursive:true});run(cargo,['run','--locked','-p','explorer-bindgen','--','generate','--library',library,'--language',language,'--out-dir',out,'--config','crates/explorer-core/uniffi.toml','--no-format']);}
const targetDir=process.env.CARGO_TARGET_DIR||path.join(root,'target');
// Each app release bundles the catalog snapshot pinned in catalog/snapshot.json (see scripts/catalog-snapshot.mjs).
async function bundleCatalog(destination){
  const pinned=path.join(root,'catalog/snapshot.json');
  if(!existsSync(pinned))throw new Error('catalog/snapshot.json is missing. Run node scripts/catalog-snapshot.mjs first.');
  const snapshot=JSON.parse(readFileSync(pinned,'utf8'));
  const valid=file=>existsSync(file)&&createHash('sha256').update(readFileSync(file)).digest('hex')===snapshot.sha256;
  const local=path.join(root,'catalog/dist',snapshot.file);
  const cached=path.join(targetDir,'catalog',snapshot.file);
  let source=[local,cached].find(valid);
  if(!source){
    console.log(`Downloading research catalog ${snapshot.version} (${(snapshot.bytes/1048576).toFixed(1)} MB)`);
    const response=await fetch(snapshot.url);
    if(!response.ok)throw new Error(`Catalog download failed (HTTP ${response.status}): ${snapshot.url}`);
    mkdirSync(path.dirname(cached),{recursive:true});writeFileSync(cached,Buffer.from(await response.arrayBuffer()));
    if(!valid(cached))throw new Error(`Downloaded catalog does not match the SHA-256 pinned in catalog/snapshot.json: ${snapshot.url}`);
    source=cached;
  }
  mkdirSync(path.dirname(destination),{recursive:true});copyFileSync(source,destination);
  // The apps show the catalog version and size without opening the snapshot.
  copyFileSync(pinned,path.join(path.dirname(destination),'catalog.json'));
}
// Generate bindings from the host library's metadata; cross-built binaries use the same feature/lockfile.
run(cargo,['build','--locked','--release','-p','explorer-core','--features','ffi']);
const hostLibrary=path.join(targetDir,'release',process.platform==='darwin'?'libexplorer_core.dylib':process.platform==='win32'?'explorer_core.dll':'libexplorer_core.so');
if(platform==='android'){
  const targets={'arm64-v8a':['aarch64-linux-android','aarch64-linux-android26-clang'],'x86_64':['x86_64-linux-android','x86_64-linux-android26-clang']};
  if(!targets[arch])throw new Error('Android architecture must be arm64-v8a or x86_64');
  const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT;
  const ndk=process.env.ANDROID_NDK_HOME||(sdk&&path.join(sdk,'ndk','27.2.12479018'));
  if(!ndk||!existsSync(ndk))throw new Error('Install Android NDK 27.2.12479018 and set ANDROID_HOME or ANDROID_NDK_HOME');
  const prebuilt=path.join(ndk,'toolchains/llvm/prebuilt');
  const host=readdirSync(prebuilt).find(n=>n.startsWith(process.platform==='darwin'?'darwin-':'linux-'));
  if(!host)throw new Error('Unsupported NDK host');
  const [target,compiler]=targets[arch];
  run('rustup',['target','add',target]);
  const bin=path.join(prebuilt,host,'bin');
  const env={...process.env,[`CARGO_TARGET_${target.replaceAll('-','_').toUpperCase()}_LINKER`]:path.join(bin,compiler),[`CC_${target.replaceAll('-','_')}`]:path.join(bin,compiler),[`AR_${target.replaceAll('-','_')}`]:path.join(bin,'llvm-ar'),
    // The vendored OpenSSL that SQLCipher uses also needs ranlib, which modern NDKs ship only as llvm-ranlib.
    [`RANLIB_${target.replaceAll('-','_')}`]:path.join(bin,'llvm-ranlib')};
  run(cargo,['build','--locked','--release','-p','explorer-core','--features','ffi','--target',target],env);
  const libs=path.join(root,'apps/android/app/src/main/jniLibs',arch);mkdirSync(libs,{recursive:true});copyFileSync(path.join(targetDir,target,'release/libexplorer_core.so'),path.join(libs,'libexplorer_core.so'));
  bind(hostLibrary,'kotlin',path.join(root,'apps/android/app/src/main/java'));
  await bundleCatalog(path.join(root,'apps/android/app/src/main/assets/catalog.zst'));
}else if(platform==='ios'){
  if(process.platform!=='darwin')throw new Error('iOS builds require macOS with Xcode');
  const target=arch==='device'?'aarch64-apple-ios':arch==='simulator'?(process.arch==='arm64'?'aarch64-apple-ios-sim':'x86_64-apple-ios'):arch;
  if(!['aarch64-apple-ios','aarch64-apple-ios-sim','x86_64-apple-ios'].includes(target))throw new Error('Unknown iOS target');
  run('rustup',['target','add',target]);
  run(cargo,['build','--locked','--release','-p','explorer-core','--features','ffi','--target',target]);
  const generated=path.join(root,'apps/ios/Generated');bind(hostLibrary,'swift',generated);
  await bundleCatalog(path.join(generated,'catalog.zst'));
  // The Xcode project links the matching Rust static library per platform/architecture.
  run('xcodegen',['generate','--spec','apps/ios/project.yml']);
}else throw new Error('Usage: node scripts/build-native.mjs android [arm64-v8a|x86_64] | ios [simulator|device]');

/** Sign final native runtime files before the enclosing Desktop application is signed. */

import { createHash } from 'node:crypto'
import { closeSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { inventoryDesktopRuntime } from '../src/runtime-tree.ts'
import type { MacOSSigningEnvironment } from './desktop-release-environment.mjs'
import { cachedMacOSSignature, pruneMacOSSignatureCache } from './macos-signature-cache.ts'
import { macOSCachePolicy } from './macos-cache-policy.ts'
import { signMacOSRuntimeCode, signMacOSRuntimeCodeAdHoc, verifyMacOSRuntimeCode, verifyMacOSRuntimeCodeAdHoc } from './verify-macos-signature.mjs'

const MACH_O_MAGICS = new Set(['cafebabe', 'cafebabf', 'cefaedfe', 'cffaedfe', 'feedface', 'feedfacf', 'bebafeca', 'bfbafeca'])

function magic(path: string): string {
  const descriptor = openSync(path, 'r')
  try {
    const header = Buffer.alloc(4)
    return readSync(descriptor, header, 0, 4, 0) === 4 ? header.toString('hex') : ''
  } finally { closeSync(descriptor) }
}

/** Signs and verifies one native file of the materialized runtime. */
type RuntimeSigner = (path: string, identifier: string, entitlements: string | undefined) => Promise<void>

/** Verifies one native file of the materialized runtime. */
type RuntimeVerifier = (path: string) => void

/**
 * Sign and verify every materialized Mach-O file, awaiting all signers on failure.
 * @param root - Self-contained production runtime without symlinks.
 * @param appId - Release application identifier.
 * @param sign - Signs one native file with its stable identifier and optional entitlements.
 * @param verify - Verifies one native file.
 * @param cacheDirectory Optional content-addressed cache; requires the keychain-owned signing probe.
 * @param expected - Signing identity the cache probe requires; omit to sign without caching.
 * @returns Number of signed native files.
 */
async function signRuntime(
  root: string, appId: string, sign: RuntimeSigner, verify: RuntimeVerifier,
  cacheDirectory?: string, expected?: MacOSSigningEnvironment,
): Promise<number> {
  const files = inventoryDesktopRuntime(root).map(file => file.path).filter(path => MACH_O_MAGICS.has(magic(join(root, path))))
  const policy = cacheDirectory === undefined ? undefined : macOSCachePolicy(process.env.DSH_DESKTOP_MACOS_SIGNING_PROBE ?? '')
  let hits = 0
  let misses = 0
  let next = 0
  const workers = Array.from({ length: Math.min(4, files.length) }, async () => {
    for (;;) {
      const path = files[next++]
      if (path === undefined) return
      const identifier = `${appId}.runtime.${createHash('sha256').update(path).digest('hex')}`
      const needsJit = path === 'dependencies/node/bin/node'
        || /^node_modules\/@deepseek-ai\/libreoffice-kit-darwin-(?:arm64|x64)\/bin\/libreoffice-kit$/u.test(path)
      const entitlements = needsJit ? join(import.meta.dirname, 'jit-entitlements.plist') : undefined
      const file = join(root, path)
      const thin = ['cefaedfe', 'cffaedfe', 'feedface', 'feedfacf'].includes(magic(file))
      if (cacheDirectory !== undefined && policy !== undefined && expected !== undefined && thin) {
        if (await cachedMacOSSignature(file, cacheDirectory, policy(identifier, expected, entitlements))) hits++
        else misses++
      } else {
        await sign(file, identifier, entitlements)
        verify(file)
      }
    }
  })
  const results = await Promise.allSettled(workers)
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown)
  if (errors.length > 0) throw new AggregateError(errors, 'desktop runtime: native signing failed')
  if (cacheDirectory !== undefined) {
    pruneMacOSSignatureCache(cacheDirectory)
    console.info(`desktop macOS signing cache: ${hits} hits, ${misses} misses, ${files.length - hits - misses} uncached`)
  }
  return files.length
}

/**
 * Sign and verify every materialized Mach-O file, awaiting all signers on failure.
 * @param root - Self-contained production runtime without symlinks.
 * @param appId - Release application identifier.
 * @param expected - Required signing identity.
 * @param cacheDirectory Optional content-addressed cache; requires the keychain-owned signing probe.
 * @returns Number of signed native files.
 */
export async function signMacOSRuntime(
  root: string, appId: string, expected: MacOSSigningEnvironment, cacheDirectory?: string,
): Promise<number> {
  return signRuntime(root, appId,
    (path, identifier, entitlements) => signMacOSRuntimeCode(path, identifier, expected, entitlements),
    (path) => { verifyMacOSRuntimeCode(path, expected) }, cacheDirectory, expected)
}

/**
 * Ad-hoc sign and verify every materialized Mach-O file for a local unsigned package.
 * @param root - Self-contained production runtime without symlinks.
 * @param appId - Release application identifier supplying the stable signing identifiers.
 * @returns Number of signed native files.
 */
export async function signMacOSRuntimeAdHoc(root: string, appId: string): Promise<number> {
  return signRuntime(root, appId,
    (path, identifier, entitlements) => signMacOSRuntimeCodeAdHoc(path, identifier, entitlements),
    (path) => { verifyMacOSRuntimeCodeAdHoc(path) })
}

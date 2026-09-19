/** Sign final native runtime files before the enclosing Desktop application is signed. */

import { createHash } from 'node:crypto'
import { closeSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { inventoryDesktopRuntime } from '../src/runtime-tree.ts'
import type { MacOSSigningEnvironment } from './desktop-release-environment.mjs'
import { signMacOSRuntimeCode, signMacOSRuntimeCodeAdHoc, verifyMacOSRuntimeCode, verifyMacOSRuntimeCodeAdHoc } from './verify-macos-signature.mjs'

const MACH_O_MAGICS = new Set(['cafebabe', 'cafebabf', 'cefaedfe', 'cffaedfe', 'feedface', 'feedfacf', 'bebafeca', 'bfbafeca'])

function isMachO(path: string): boolean {
  const descriptor = openSync(path, 'r')
  try {
    const header = Buffer.alloc(4)
    return readSync(descriptor, header, 0, 4, 0) === 4 && MACH_O_MAGICS.has(header.toString('hex'))
  } finally { closeSync(descriptor) }
}

/** Signs and verifies one native file of the materialized runtime. */
type RuntimeSigner = (path: string, identifier: string, entitlements: string | undefined) => Promise<void>

/** Verifies one native file of the materialized runtime. */
type RuntimeVerifier = (path: string) => void

async function signRuntime(root: string, appId: string, sign: RuntimeSigner, verify: RuntimeVerifier): Promise<number> {
  const files = inventoryDesktopRuntime(root).map(file => file.path).filter(path => isMachO(join(root, path)))
  let next = 0
  const workers = Array.from({ length: Math.min(4, files.length) }, async () => {
    for (;;) {
      const path = files[next++]
      if (path === undefined) return
      const identifier = `${appId}.runtime.${createHash('sha256').update(path).digest('hex')}`
      const entitlements = path === 'dependencies/node/bin/node'
        ? join(import.meta.dirname, 'node-entitlements.plist') : undefined
      await sign(join(root, path), identifier, entitlements)
      verify(join(root, path))
    }
  })
  const results = await Promise.allSettled(workers)
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown)
  if (errors.length > 0) throw new AggregateError(errors, 'desktop runtime: native signing failed')
  return files.length
}

/**
 * Sign and verify every materialized Mach-O file, awaiting all signers on failure.
 * @param root - Self-contained production runtime without symlinks.
 * @param appId - Release application identifier.
 * @param expected - Required signing identity.
 * @returns Number of signed native files.
 */
export async function signMacOSRuntime(root: string, appId: string, expected: MacOSSigningEnvironment): Promise<number> {
  return signRuntime(root, appId,
    (path, identifier, entitlements) => signMacOSRuntimeCode(path, identifier, expected, entitlements),
    (path) => { verifyMacOSRuntimeCode(path, expected) })
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

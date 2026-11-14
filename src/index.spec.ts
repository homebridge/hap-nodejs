import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

// we just test that we can import index e.g. without any cyclic imports
import { HAPLibraryVersion } from './index.js'

describe('index', () => {
  it('index import', () => {
    expect(true).toBeTruthy()
  })

  it('should not read package.json again for every call of HAPLibraryVersion', () => {
    const readFileSync = vi.spyOn(fs, 'readFileSync')
    syncBuiltinESMExports() // makes the spy visible to the named import in hap.ts
    try {
      const version = HAPLibraryVersion()
      expect(version).toMatch(/^\d+\.\d+\.\d+/)
      expect(HAPLibraryVersion()).toBe(version)
      // the module already read the file when it was loaded
      expect(readFileSync).not.toHaveBeenCalled()
    } finally {
      readFileSync.mockRestore()
      syncBuiltinESMExports()
    }
  })
})

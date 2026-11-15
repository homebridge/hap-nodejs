import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const SRC = import.meta.dirname

// Not part of the published package: the example accessories, the test helpers and the definitions generator (a command line tool)
const IGNORED = [
  'accessories/',
  'test-utils/',
  'lib/definitions/generate-definitions.ts',
  'lib/definitions/generator-configuration.ts',
]

function listModules(): string[] {
  return fs.readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map(file => file.split(path.sep).join('/'))
    .filter(file => file.endsWith('.ts') && !file.endsWith('.spec.ts') && !file.endsWith('.d.ts'))
    .filter(file => !IGNORED.some(ignored => file.startsWith(ignored)))
    .sort()
}

/**
 * The enums here are normal enums, not `const` enums, so plugins built with `isolatedModules` can use them. A normal enum is an
 * object which exists only once its file has run. A `const` enum was copied into the code as a number, so it worked even when two
 * files import each other and the file with the enum had not run yet. A normal enum is `undefined` in that case.
 *
 * So this loads every file of the package first, on its own, the way a deep import does, and checks that it loads without an error
 * and that nothing it exports is undefined. `npx eslint .` is what refuses a new `const enum`.
 */
describe('enums', () => {
  const modules = listModules()

  it('finds the modules of the package', () => {
    expect(modules).toContain('index.ts')
    expect(modules).toContain('lib/HAPServer.ts')
    expect(modules.length).toBeGreaterThan(40)
  })

  it.each(modules)('%s loads on its own with every export defined', async (file) => {
    vi.resetModules()
    const loaded: Record<string, unknown> = await import(/* @vite-ignore */ path.join(SRC, file))

    const missing = Object.keys(loaded).filter(name => loaded[name] === undefined)
    expect(missing).toEqual([])
  })
})

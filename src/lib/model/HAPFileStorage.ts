import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/**
 * Init options supported by {@link HAPFileStorage.initSync}.
 *
 * This is the subset of node-persist's init options which was ever functional for HAP-NodeJS's storage.
 * Passing any other node-persist option throws instead of being silently ignored.
 *
 * @group Model
 */
export interface HAPFileStorageInitOptions {
  /**
   * Path of the storage directory. If provided, it must be an absolute path.
   * If omitted, storage defaults to the directory `persist` inside the current working directory.
   */
  dir?: string
}

const SUPPORTED_METHODS = 'initSync, getItem, setItemSync and removeItemSync'

/**
 * Every method of node-persist 0.0.12's `LocalStorage` prototype which {@link HAPFileStorage} does not implement.
 * They are assigned as throwing stubs in the constructor, so code depending on the removed node-persist API
 * fails with a clear error instead of exhibiting undefined behavior.
 */
const UNSUPPORTED_METHODS = [
  'setOptions',
  'init',
  'key',
  'keys',
  'length',
  'forEach',
  'values',
  'valuesWithKeyMatch',
  'setItem',
  'getItemSync',
  'removeItem',
  'clear',
  'clearSync',
  'persist',
  'persistSync',
  'persistKey',
  'persistKeySync',
  'removePersistedKey',
  'removePersistedKeySync',
  'parseString',
  'parseTTLDir',
  'parseTTLDirSync',
  'parseDataDir',
  'parseDataDirSync',
  'parseDir',
  'parseDirSync',
  'parseDataFile',
  'parseDataFileSync',
  'parseTTLFile',
  'parseTTLFileSync',
  'parseFile',
  'parseFileSync',
  'isExpired',
  'resolveDir',
  'stopInterval',
  'log',
] as const

/**
 * Minimal synchronous file storage, a drop-in replacement for the subset of `node-persist@0.0.12`
 * which HAP-NodeJS used: `initSync`, `getItem`, `setItemSync` and `removeItemSync`.
 *
 * The on-disk layout is kept byte-for-byte compatible with node-persist 0.0.12:
 * one file per key inside the storage directory, named after the raw key (no hashing or escaping),
 * containing the bare `JSON.stringify` representation of the value. Values are read once
 * at {@link initSync} and served from memory afterwards.
 *
 * Keys must therefore be plain filenames: one which names a subdirectory, escapes the storage directory
 * or starts with a dot is rejected rather than written somewhere it could never be read back from.
 *
 * Writes are atomic, which node-persist's were not: see {@link setItemSync}.
 *
 * @group Model
 */
export class HAPFileStorage {
  // node-persist 0.0.12 default: the relative directory "persist", resolved against the current working directory
  private dir = 'persist'

  private readonly data = new Map<string, unknown>()

  // keys whose file was not valid JSON at initSync. The folder is shared with plugins (one keeps a binary certificate
  // there), so such a file is only warned about when HAP-NodeJS reads its key, and only set aside when it saves or
  // removes that key: a file HAP-NodeJS never uses stays where it is, untouched and unmentioned
  private readonly unreadable = new Set<string>()
  private readonly warned = new Set<string>()

  constructor() {
    for (const method of UNSUPPORTED_METHODS) {
      // runtime-only stubs, deliberately absent from the class type: TypeScript consumers get a compile error,
      // JavaScript consumers get this error instead of "storage.keys is not a function"

      (this as Record<string, unknown>)[method] = () => {
        throw new Error(`${method}() is not supported anymore: HAP-NodeJS replaced node-persist with a minimal file storage `
          + `which only implements ${SUPPORTED_METHODS} (see https://github.com/homebridge/HAP-NodeJS/issues/1107).`)
      }
    }
  }

  initSync(options?: HAPFileStorageInitOptions): void {
    if (options) {
      const unsupportedOptions = Object.keys(options).filter(key => key !== 'dir')
      if (unsupportedOptions.length > 0) {
        throw new Error(`HAP-NodeJS's storage does not support the init options: ${unsupportedOptions.join(', ')}. `
          + 'Only "dir" is supported (see https://github.com/homebridge/HAP-NodeJS/issues/1107).')
      }

      if ('dir' in options) {
        if (typeof options.dir !== 'string' || !path.isAbsolute(options.dir)) {
          // node-persist silently redirected relative paths into its own module directory inside node_modules,
          // where the data was lost on the next npm install. There is no sane location to keep that behavior.
          throw new Error(`HAP-NodeJS's storage requires an absolute storage path, got ${JSON.stringify(options.dir)}!`)
        }
        this.dir = path.normalize(options.dir)
      }
    }

    if (fs.existsSync(this.dir)) {
      for (const entry of fs.readdirSync(this.dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) {
          continue
        }

        const file = path.join(this.dir, entry.name)
        // only regular files hold values: reading a directory here would abort startup with a cryptic EISDIR.
        // this resolves symlinks, which entry.isDirectory() does not, so a link to a directory is skipped
        // like the directory itself while a link to a file still loads
        if (!HAPFileStorage.isFile(file)) {
          continue
        }

        // a file which cannot be read at all (EIO, EACCES) still fails the start: only invalid JSON is let through
        const json = HAPFileStorage.read(file)
        try {
          this.data.set(entry.name, JSON.parse(json))
        } catch {
          // node-persist 0.0.12 swallowed unparseable files, leaving the value undefined. That stays (see `unreadable`)
          this.unreadable.add(entry.name)
        }
      }
    } else {
      fs.mkdirSync(this.dir, { recursive: true })
    }
  }

  /**
   * Returns the in-memory value for the given key.
   * node-persist's legacy `getItem(key, callback)` form throws, like every other removed API.
   *
   * The value is whatever was stored, or read from the file, under this key. Name the type you expect with `T`
   * and check it before relying on it; without `T` the value is typed as `any`, like node-persist did, so code
   * like `const info: MyInfo = storage.getItem(key)` keeps building.
   */
  getItem(key: string, ...legacyCallback: never[]): any
  getItem<T>(key: string, ...legacyCallback: never[]): T | undefined
  getItem(key: string, ...legacyCallback: never[]): unknown {
    if (legacyCallback.length > 0) {
      throw new Error('getItem() with a callback is not supported anymore: HAP-NodeJS replaced node-persist with a minimal file storage '
        + `which only implements ${SUPPORTED_METHODS} (see https://github.com/homebridge/HAP-NodeJS/issues/1107).`)
    }

    if (this.unreadable.has(key) && !this.warned.has(key)) {
      this.warned.add(key)
      // an accessory whose file reads as nothing starts as a new, unpaired one. Only the path is printed: the file can hold keys
      console.warn(`HAP-NodeJS WARNING: The storage file '${path.join(this.dir, key)}' does not hold valid JSON and was ignored. `
        + 'What it stored is treated as missing. It is kept under a new name before anything is saved in its place.')
    }

    return this.data.get(key)
  }

  /**
   * Persists the given value, replacing the file for this key atomically.
   *
   * The value is written to a temporary file which is then renamed over the target, so an interrupted write
   * leaves the previous contents intact instead of a truncated file. This matters because a truncated
   * `AccessoryInfo` file reads back as an accessory which lost its pairings.
   *
   * The in-memory value is only replaced once the new one reached the disk, so a failed write cannot leave
   * an accessory which reads as paired now and unpaired after a restart.
   */
  // eslint-disable-next-line ts/explicit-module-boundary-types
  setItemSync(key: string, value: any): void {
    HAPFileStorage.assertPlainKey(key)

    // node-persist 0.0.12 ran mkdirp.sync before every write, which recreated a storage directory removed at runtime
    fs.mkdirSync(this.dir, { recursive: true })

    const file = path.join(this.dir, key)
    this.setAsideUnreadable(key)
    // the dot prefix keeps a temporary file left behind by a crash from being loaded as a key by initSync,
    // the pid keeps processes sharing a storage directory (like child bridges) from racing on the same temporary file.
    // it sits in the storage directory next to its target, as renaming across directories would not be atomic
    const temporaryFile = path.join(this.dir, `.${key}.${process.pid}.tmp`)

    try {
      // 0600: AccessoryInfo holds the accessory's private key and the keys of its paired controllers, so no other
      // user of the system may read it. The temporary file is new every time, so the mode always applies
      fs.writeFileSync(temporaryFile, JSON.stringify(value), { mode: 0o600 })
      fs.renameSync(temporaryFile, file)
    } catch (error) {
      try {
        fs.unlinkSync(temporaryFile)
      } catch {
        // the temporary file may never have been created, in which case there is nothing to clean up
      }

      throw error
    }

    // only now that the value is on disk: everything is served from memory afterwards, so a value cached
    // for a write which never landed would be indistinguishable from a saved one until the next restart
    this.data.set(key, value)
  }

  removeItemSync(key: string): void {
    HAPFileStorage.assertPlainKey(key)

    this.setAsideUnreadable(key)

    // force ignores a file which is already gone, without the exists-then-unlink
    // gap in which another process (child bridges share a storage directory)
    // could remove the file first and turn this into an ENOENT crash
    fs.rmSync(path.join(this.dir, key), { force: true })

    this.data.delete(key)
  }

  /**
   * Rejects a key which is not a plain filename, before it reaches the filesystem.
   *
   * `path.join` would otherwise read a key as a path: `nested/key.json` writes into a subdirectory which
   * {@link initSync} skips, so the value comes back `undefined` after a restart, and `../escaped.json` writes
   * outside the storage directory altogether. node-persist 0.0.12 created such subdirectories too, but crashed
   * with `EISDIR` on the next load rather than losing the value quietly.
   *
   * A leading dot is rejected for the same reason: {@link initSync} skips dotfiles, so `.hidden` would be
   * written, served from memory while the process runs, and then be gone after a restart.
   */
  private static assertPlainKey(key: string): void {
    if (!key || key.startsWith('.') || /[/\\]/.test(key)) {
      throw new Error(`HAP-NodeJS's storage requires a key which is a plain filename, got ${JSON.stringify(key)}! `
        + 'One file is kept per key inside the storage directory, so a key can neither name a subdirectory, escape it, '
        + 'nor start with a dot, which would be skipped the next time the directory is loaded.')
    }
  }

  /**
   * Reads a storage file. A file which is not readable for this user gets an error which says how to fix it: the files are
   * readable by their owner only (they hold the pairing keys), so one start as another user, like root with sudo, leaves
   * files which the usual user cannot read anymore.
   */
  private static read(file: string): string {
    try {
      return fs.readFileSync(file, 'utf8')
    } catch (error) {
      const code = (error as { code?: unknown }).code
      if (code === 'EACCES' || code === 'EPERM') {
        throw Object.assign(new Error(`HAP-NodeJS's storage file '${file}' cannot be read by this user (${code}). It is only `
          + 'readable by its owner, so it was probably saved by a start as another user (like root with sudo). Give it back '
          + 'to the user which runs HAP-NodeJS, for example with chown.', { cause: error }), { code })
      }
      throw error
    }
  }

  /**
   * Whether the given path is a regular file, following symlinks.
   *
   * An entry which cannot be stat'ed at all, like a broken or circular symlink, is one to skip
   * rather than one to abort startup over.
   */
  private static isFile(file: string): boolean {
    try {
      return fs.statSync(file).isFile()
    } catch {
      return false
    }
  }

  /**
   * Renames the file of a key which could not be read at {@link initSync}, before a save or a removal of that key would
   * overwrite or delete what is left of it (an accessory which reads as unpaired saves new keys at once). The dot keeps
   * it from being loaded at the next start. A failed rename (another process sharing the directory may have done it
   * first) is left to the write or removal which follows.
   */
  private setAsideUnreadable(key: string): void {
    if (!this.unreadable.delete(key)) {
      return
    }

    const file = path.join(this.dir, key)
    const aside = path.join(this.dir, `.${key}.corrupt-${Date.now()}`)
    try {
      fs.renameSync(file, aside)
      console.warn(`HAP-NodeJS WARNING: The storage file '${file}', which does not hold valid JSON, was kept as '${aside}'.`)
    } catch {
      // nothing to keep
    }
  }
}

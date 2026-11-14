/* global NodeJS */

declare module 'simple-plist' {

  import { Buffer } from 'node:buffer'
  import { WriteFileOptions } from 'node:fs'

  export function parse(content: Buffer | string, path: string): unknown

  export function readFileSync(path: string): unknown

  export function readFile(path: string, callback: (err: Error | null, result: unknown) => void): void

  export function writeFileSync(path: string, object: unknown, options?: WriteFileOptions): void

  export function writeFile(path: string, object: unknown, callback: (err: NodeJS.ErrnoException | null) => void): void

  export function writeFile(path: string, object: unknown, options: WriteFileOptions, callback: (err: NodeJS.ErrnoException | null) => void): void

  export function writeBinaryFileSync(path: string, object: unknown, options?: WriteFileOptions): void

  export function writeBinaryFile(path: string, object: unknown, callback: (err: NodeJS.ErrnoException | null) => void): void

  export function writeBinaryFile(path: string, object: unknown, options: WriteFileOptions, callback: (err: NodeJS.ErrnoException | null) => void): void

}

import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { DataStreamParser, DataStreamReader, DataStreamWriter, Float64, Int64 } from './DataStreamParser.js'

describe('DataStreamParser', () => {
  describe('writeNumber Int32 range check', () => {
    it('should encode numbers in Int32 range as Int32, not Int64', () => {
      const writer = new DataStreamWriter()
      // 100000 is within Int32 range but was previously encoded as Int64
      writer.writeNumber(100000)
      const data = writer.getData()
      const reader = new DataStreamReader(data)

      // Tag byte (1) + 4 bytes for Int32 = 5 bytes total
      // If incorrectly encoded as Int64, it would be 1 + 8 = 9 bytes
      expect(data.length).toBe(5)

      // Verify it decodes back correctly
      const decoded = DataStreamParser.decode(reader)
      expect(decoded).toBe(100000)
    })

    it('should encode max Int32 value as Int32', () => {
      const writer = new DataStreamWriter()
      writer.writeNumber(2147483647)
      const data = writer.getData()

      // 1 tag byte + 4 data bytes = 5
      expect(data.length).toBe(5)

      const reader = new DataStreamReader(data)
      expect(DataStreamParser.decode(reader)).toBe(2147483647)
    })

    it('should encode min Int32 value as Int32', () => {
      const writer = new DataStreamWriter()
      writer.writeNumber(-2147483648)
      const data = writer.getData()

      // 1 tag byte + 4 data bytes = 5
      expect(data.length).toBe(5)

      const reader = new DataStreamReader(data)
      expect(DataStreamParser.decode(reader)).toBe(-2147483648)
    })

    it.each([0, 1, 38, 39])('should encode %d in a single byte and decode it again', (value) => {
      const writer = new DataStreamWriter()
      writer.writeNumber(value)
      const data = writer.getData()

      expect(data).toEqual(Buffer.from([0x08 + value]))
      expect(DataStreamParser.decode(new DataStreamReader(data))).toBe(value)
    })

    it.each([
      4294967295,
      4294967296,
      -2147483649,
      -4294967297,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
    ])('should encode %d as Int64 and decode it again', (value) => {
      const writer = new DataStreamWriter()
      writer.writeNumber(value)
      const data = writer.getData()

      expect(data.length).toBe(9) // 1 tag byte + 8 data bytes
      expect(DataStreamParser.decode(new DataStreamReader(data))).toBe(value)
    })

    it('should encode a negative number wrapped in Int64', () => {
      const writer = new DataStreamWriter()
      writer.writeInt64LE(new Int64(-5))

      expect(DataStreamParser.decode(new DataStreamReader(writer.getData()))).toBe(-5)
    })

    it('should encode numbers beyond Int32 range as Int64', () => {
      const writer = new DataStreamWriter()
      writer.writeNumber(2147483648) // one above Int32 max
      const data = writer.getData()

      // 1 tag byte + 8 data bytes = 9
      expect(data.length).toBe(9)

      const reader = new DataStreamReader(data)
      expect(DataStreamParser.decode(reader)).toBe(2147483648)
    })
  })

  describe('readFloat64LE reader index advance', () => {
    it('should advance reader index after reading Float64', () => {
      const writer = new DataStreamWriter()
      writer.writeFloat64LE(new Float64(3.14))
      writer.writeFloat64LE(new Float64(2.71))
      const data = writer.getData()

      const reader = new DataStreamReader(data)
      const first = DataStreamParser.decode(reader)
      const second = DataStreamParser.decode(reader)

      expect(first).toBeCloseTo(3.14)
      expect(second).toBeCloseTo(2.71)
      // If the reader index wasn't advancing, both would be 3.14
      expect(second).not.toBeCloseTo(3.14)
    })
  })

  describe('UTF-8 tag byte length', () => {
    it('should correctly encode multi-byte UTF-8 strings', () => {
      const writer = new DataStreamWriter()
      // "é" is 2 bytes in UTF-8 but 1 character in JS
      const testString = 'é'
      writer.writeUTF8(testString)
      const data = writer.getData()

      const reader = new DataStreamReader(data)
      const decoded = DataStreamParser.decode(reader)
      expect(decoded).toBe(testString)
    })

    it('should round-trip short strings with multi-byte characters', () => {
      const writer = new DataStreamWriter()
      // Mix of ASCII and multi-byte: 5 chars, 7 bytes in UTF-8
      const testString = 'hëllo'
      writer.writeUTF8(testString)
      const data = writer.getData()

      const reader = new DataStreamReader(data)
      const decoded = DataStreamParser.decode(reader)
      expect(decoded).toBe(testString)
    })
  })

  describe('short binary data', () => {
    it.each([0, 3, 32])('should decode %d bytes of data with the length in the tag', (length) => {
      const data = Buffer.alloc(length, 0xAB)
      const writer = new DataStreamWriter()
      DataStreamParser.encode({ packet: data }, writer)

      const decoded = DataStreamParser.decode(new DataStreamReader(writer.getData()))
      expect(decoded).toEqual({ packet: data })
    })
  })

  describe('dictionary keys', () => {
    function string(value: string): Buffer {
      return Buffer.concat([
        Buffer.from([0x40 + value.length]),
        Buffer.from(value),
      ])
    }

    const entries = Buffer.concat([
      string('__proto__'),
      Buffer.from([0xE1]),
      string('request'),
      string('hello'), // { request: 'hello' }
      string('x'),
      Buffer.from([0x09]), // 1
    ])

    it.each([
      [
        'with its length in the tag',
        Buffer.concat([
          Buffer.from([0xE2]),
          entries,
        ]),
      ],
      [
        'which ends with a terminator',
        Buffer.concat([
          Buffer.from([0xEF]),
          entries,
          Buffer.from([0x03]),
        ]),
      ],
    ])('should store the key __proto__ of a dictionary %s instead of replacing the prototype', (_name, data) => {
      const decoded = DataStreamParser.decode(new DataStreamReader(data)) as Record<string, unknown>

      expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
      expect(decoded.request).toBeUndefined()
      expect(Object.keys(decoded)).toEqual(['__proto__', 'x'])
      expect(Object.getOwnPropertyDescriptor(decoded, '__proto__')?.value).toEqual({ request: 'hello' })
      expect(decoded.x).toBe(1)
    })

    it('should write the key __proto__ back the way it was read', () => {
      const data = Buffer.concat([
        Buffer.from([0xE2]),
        entries,
      ])
      const writer = new DataStreamWriter()
      DataStreamParser.encode(DataStreamParser.decode(new DataStreamReader(data)), writer)

      expect(writer.getData()).toEqual(data)
    })

    it('should name a key which is not a string by its string form', () => {
      const data = Buffer.concat([
        Buffer.from([0xE2, 0x0D]),
        string('five'),
        Buffer.from([0x01]),
        string('yes'),
      ])

      expect(DataStreamParser.decode(new DataStreamReader(data))).toEqual({ 5: 'five', true: 'yes' })
    })
  })

  describe('terminator tag in the wrong place', () => {
    it.each([
      [
        'as the whole value',
        [0x03],
      ],
      [
        'as an element of an array with its length in the tag',
        [0xD1, 0x03],
      ],
      [
        'as a key of a dictionary with its length in the tag',
        [0xE1, 0x03, 0x09],
      ],
      [
        'as a value of a dictionary with its length in the tag',
        [0xE1, 0x41, 0x78, 0x03],
      ],
      [
        'as a value of a dictionary which ends with a terminator',
        [0xEF, 0x41, 0x78, 0x03, 0x03],
      ],
    ])('should refuse a terminator %s', (_name, bytes) => {
      expect(() => DataStreamParser.decode(new DataStreamReader(Buffer.from(bytes)))).toThrow('unexpected terminator tag')
    })

    it('should still end an array and a dictionary without a length', () => {
      const data = Buffer.from([
        0xDF,
        0x09,
        0xEF,
        0x41,
        0x78,
        0x0A,
        0x03,
        0x03,
      ])

      expect(DataStreamParser.decode(new DataStreamReader(data))).toEqual([
        1,
        { x: 2 },
      ])
    })
  })

  describe('nesting depth', () => {
    function nested(depth: number, tag: number): Buffer {
      // every array holds the next one, the innermost one is empty
      return Buffer.concat([
        Buffer.alloc(depth - 1, tag),
        Buffer.from([0xD0]),
        Buffer.alloc(tag === 0xDF
          ? depth - 1
          : 0, 0x03),
      ])
    }

    it.each([
      [
        'arrays with their length in the tag',
        Buffer.alloc(200_000, 0xD1),
      ],
      [
        'arrays which end with a terminator',
        Buffer.alloc(200_000, 0xDF),
      ],
      [
        'dictionaries',
        Buffer.concat(Array.from({ length: 50_000 }, () => Buffer.from([0xE1, 0x41, 0x78]))),
      ],
    ])('should refuse a message made of deeply nested %s with a clear error', (_name, data) => {
      expect(() => DataStreamParser.decode(new DataStreamReader(data))).toThrow('nested more than 32 levels deep')
    })

    it.each([0xD1, 0xDF])('should decode 32 arrays in each other but not 33 (tag %d)', (tag) => {
      let expected: unknown[] = []
      for (let i = 1; i < 32; i++) {
        expected = [expected]
      }

      expect(DataStreamParser.decode(new DataStreamReader(nested(32, tag)))).toEqual(expected)
      expect(() => DataStreamParser.decode(new DataStreamReader(nested(33, tag)))).toThrow('nested more than 32 levels deep')
    })
  })

  describe('back-references', () => {
    function roundTrip(value: any): any {
      const writer = new DataStreamWriter()
      DataStreamParser.encode(value, writer)
      return DataStreamParser.decode(new DataStreamReader(writer.getData()))
    }

    it('should round-trip a repeated string after a value encoded in the tag byte alone', () => {
      const message = {
        streamId: 1,
        type: 'ipcamera.recording',
        target: 'ipcamera.recording',
      }
      expect(roundTrip(message)).toEqual(message)
      expect(roundTrip({ a: true, b: 'same-string', c: 'same-string' })).toEqual({ a: true, b: 'same-string', c: 'same-string' })
    })

    it('should not count values encoded in the tag byte alone when reading a back-reference', () => {
      // { a: true, b: <reference to index 1> }: "a" is index 0, true is not tracked, "b" is index 1
      const data = Buffer.from([
        0xE2,
        0x41,
        0x61,
        0x01,
        0x41,
        0x62,
        0xA1,
      ])
      expect(DataStreamParser.decode(new DataStreamReader(data))).toEqual({ a: true, b: 'b' })
    })

    it('should not track the empty string', () => {
      // { a: '', b: 'x', c: <reference to index 2> }: "a" is index 0, "" is not tracked, "b" is 1, "x" is 2, "c" is 3
      const data = Buffer.from([
        0xE3,
        0x41,
        0x61,
        0x40,
        0x41,
        0x62,
        0x41,
        0x78,
        0x41,
        0x63,
        0xA2,
      ])
      expect(DataStreamParser.decode(new DataStreamReader(data))).toEqual({ a: '', b: 'x', c: 'x' })

      const writer = new DataStreamWriter()
      DataStreamParser.encode({ a: '', b: 'x', c: 'x' }, writer)
      expect(writer.getData()).toEqual(data)
    })

    it('should only write back-references up to index 0x20 as a single tag', () => {
      const strings = Array.from({ length: 0x30 }, (_, i) => `s${i.toString().padStart(2, '0')}`)
      const value = [
        ...strings,
        ...strings,
      ] // the second half repeats every string

      const writer = new DataStreamWriter()
      DataStreamParser.encode(value, writer)
      const data = writer.getData()

      expect(data.filter(byte => byte >= 0xC1 && byte <= 0xCF)).toHaveLength(0)
      expect(DataStreamParser.decode(new DataStreamReader(data))).toEqual(value)
    })
  })
})

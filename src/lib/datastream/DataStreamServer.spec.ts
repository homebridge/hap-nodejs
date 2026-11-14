import type { Socket } from 'node:net'

import type { HAPConnection } from '../util/eventedhttp.js'
import type { DataStreamConnection, PreparedDataStreamSession } from './DataStreamServer.js'

import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as hapCrypto from '../util/hapCrypto.js'
import { DataStreamParser, DataStreamReader, DataStreamWriter } from './DataStreamParser.js'
import { DataStreamServer, HDSStatus } from './DataStreamServer.js'

class FakeSocket extends EventEmitter {
  remoteAddress = '192.0.2.1'
  setNoDelay = vi.fn()
  setKeepAlive = vi.fn()
  write = vi.fn()
  end = vi.fn()
  destroy = vi.fn()
}

interface TestSession {
  server: DataStreamServer
  socket: FakeSocket
  connection: DataStreamConnection
  prepared: PreparedDataStreamSession
  nonce: number
}

function setupSession(): TestSession {
  const server = new DataStreamServer()
  const hapConnection = new EventEmitter() as unknown as HAPConnection
  const prepared: PreparedDataStreamSession = {
    connection: hapConnection,
    accessoryToControllerEncryptionKey: crypto.randomBytes(32),
    controllerToAccessoryEncryptionKey: crypto.randomBytes(32),
    accessoryKeySalt: crypto.randomBytes(32),
  }
  server.preparedSessions.push(prepared)

  const socket = new FakeSocket()
  // @ts-expect-error: private method access
  server.onConnection(socket as unknown as Socket)
  // @ts-expect-error: private property access
  const connection: DataStreamConnection = server.connections[0]

  return {
    server,
    socket,
    connection,
    prepared,
    nonce: 0,
  }
}

// builds a frame encrypted with the controller-to-accessory key of the session
function encryptedFrame(session: TestSession, payload: Buffer): Buffer {
  const header = Buffer.from([0x01, 0, 0, 0])
  header.writeUIntBE(payload.length, 1, 3)

  const nonce = Buffer.alloc(8)
  hapCrypto.writeUInt64LE(session.nonce++, nonce)
  const encrypted = hapCrypto.chacha20_poly1305_encryptAndSeal(session.prepared.controllerToAccessoryEncryptionKey, nonce, header, payload)

  return Buffer.concat([header, encrypted.ciphertext, encrypted.authTag])
}

function messagePayload(header: Record<string, unknown>, message: unknown = {}): Buffer {
  const headerWriter = new DataStreamWriter()
  const messageWriter = new DataStreamWriter()
  DataStreamParser.encode(header, headerWriter)
  DataStreamParser.encode(message, messageWriter)

  return Buffer.concat([
    Buffer.from([
      headerWriter.length(),
    ]),
    headerWriter.getData(),
    messageWriter.getData(),
  ])
}

describe('dataStreamServer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('tcp server errors', () => {
    function hapConnection(): HAPConnection {
      return {
        sessionID: 'test-session',
        encryption: {
          sharedSecret: crypto.randomBytes(32),
        },
      } as unknown as HAPConnection
    }

    it('should answer the waiting sessions with the error when the server can not listen', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const server = new DataStreamServer()
        const first = vi.fn()
        const second = vi.fn()
        server.prepareSession(hapConnection(), crypto.randomBytes(32), first)
        server.prepareSession(hapConnection(), crypto.randomBytes(32), second)
        const tcpServer = (server as any).tcpServer

        const error = new Error('listen EMFILE: too many open files')
        expect(() => tcpServer.emit('error', error)).not.toThrow()

        expect(first).toHaveBeenCalledExactlyOnceWith(error)
        expect(second).toHaveBeenCalledExactlyOnceWith(error)
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('listen EMFILE'))
        expect((server as any).preparedSessions).toHaveLength(0)
        expect((server as any).tcpServer).toBeUndefined() // the next attempt starts a new server
        expect((server as any).state).toBe(0)
      } finally {
        warn.mockRestore()
      }
    })

    it('should keep running when the listening server reports an error', async () => {
      vi.useRealTimers()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const server = new DataStreamServer()
        const session = await new Promise<PreparedDataStreamSession | undefined>((resolve, reject) => {
          server.prepareSession(hapConnection(), crypto.randomBytes(32), (error, prepared) => error
            ? reject(error)
            : resolve(prepared))
        })
        const tcpServer = (server as any).tcpServer

        expect(session?.port).toBeGreaterThan(0)
        expect(() => tcpServer.emit('error', new Error('accept EMFILE'))).not.toThrow()
        expect((server as any).tcpServer).toBe(tcpServer)

        server.destroy()
        clearTimeout(session?.connectTimeout)
      } finally {
        warn.mockRestore()
      }
    })
  })

  describe('connection identification', () => {
    it('should close an unidentified connection without crashing on its undecryptable first frame', () => {
      const { socket } = setupSession()

      // someone without any keys: a frame header (type 1, length 0) followed by a junk 16-byte auth tag
      const junk = Buffer.concat([
        Buffer.from([0x01, 0, 0, 0]),
        Buffer.alloc(16),
      ])

      expect(() => socket.emit('data', junk)).not.toThrow()
      expect(socket.end).toHaveBeenCalled()
    })

    it('should accept a hello request from an identified connection', () => {
      const session = setupSession()

      session.socket.emit('data', encryptedFrame(session, messagePayload({ protocol: 'control', request: 'hello', id: 1 })))

      expect(session.socket.end).not.toHaveBeenCalled()
      expect(session.socket.write).toHaveBeenCalledTimes(1) // the hello response
    })
  })

  describe('malformed frames', () => {
    function identifiedSession(): TestSession {
      const session = setupSession()
      session.socket.emit('data', encryptedFrame(session, messagePayload({ protocol: 'control', request: 'hello', id: 1 })))
      return session
    }

    it.each([
      [
        'an empty payload',
        Buffer.alloc(0),
      ],
      [
        'a header length longer than the payload',
        Buffer.from([0x05, 0x04]),
      ],
      [
        'an undecodable header',
        Buffer.from([0x01, 0x00]),
      ],
      [
        'a header which is not a dictionary',
        Buffer.from([0x01, 0x04, 0xE0]),
      ],
    ])('should drop a first frame with %s and close the connection', (_, payload) => {
      const session = setupSession()

      expect(() => session.socket.emit('data', encryptedFrame(session, payload))).not.toThrow()
      expect(session.socket.end).toHaveBeenCalled()
    })

    it.each([
      [
        'an empty payload',
        Buffer.alloc(0),
      ],
      [
        'a header length longer than the payload',
        Buffer.from([0x05, 0x04]),
      ],
      [
        'a header which is not a dictionary',
        Buffer.from([0x01, 0x04, 0xE0]),
      ],
    ])('should drop a later frame with %s', (_, payload) => {
      const session = identifiedSession()

      expect(() => session.socket.emit('data', encryptedFrame(session, payload))).not.toThrow()
      expect(session.socket.end).not.toHaveBeenCalled()
    })
  })

  describe('closing', () => {
    it('should destroy a closed socket which the remote never closes', () => {
      const { socket, connection } = setupSession()

      connection.close()
      expect(socket.end).toHaveBeenCalledTimes(1)
      expect(socket.destroy).not.toHaveBeenCalled()

      vi.advanceTimersByTime(5000)
      expect(socket.destroy).toHaveBeenCalledTimes(1)
    })

    it('should not destroy a socket which the remote closed in time', () => {
      const { socket, connection } = setupSession()

      connection.close()
      socket.emit('close')

      vi.advanceTimersByTime(5000)
      expect(socket.destroy).not.toHaveBeenCalled()
    })
  })

  describe('unknown frame types', () => {
    it('should skip a frame of an unknown type without allocating a buffer for its payload', () => {
      const { socket } = setupSession()
      const payloadLength = 0x10000
      const header = Buffer.from([0x02, 0, 0, 0]) // payload type 2 is unknown
      header.writeUIntBE(payloadLength, 1, 3)

      const allocSpy = vi.spyOn(Buffer, 'alloc')
      try {
        expect(() => socket.emit('data', Buffer.concat([
          header,
          Buffer.alloc(payloadLength + 16),
        ]))).not.toThrow()
        expect(allocSpy.mock.calls.filter(call => call[0] === payloadLength)).toHaveLength(0)
      } finally {
        allocSpy.mockRestore()
      }
      expect(socket.end).not.toHaveBeenCalled()
    })
  })

  describe('requests sent by the accessory', () => {
    function identifiedSession(): TestSession {
      const session = setupSession()
      session.socket.emit('data', encryptedFrame(session, messagePayload({ protocol: 'control', request: 'hello', id: 1 })))
      return session
    }

    it('should answer a waiting request once, and at once, when the socket closes', () => {
      const session = identifiedSession()
      // @ts-expect-error: the session was set up without the tcp server, which is closed with its last connection
      session.server.tcpServer = {
        close: vi.fn(),
      }
      const callback = vi.fn()
      session.connection.sendRequest('dataSend', 'open', {}, callback)

      session.socket.emit('close')

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback.mock.calls[0][0]).toBeInstanceOf(Error)
      vi.advanceTimersByTime(11000)
      expect(callback).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('should stop waiting for the hello message when the socket closes', () => {
      const session = setupSession()
      expect(vi.getTimerCount()).toBeGreaterThan(0)

      session.socket.emit('close')

      expect(vi.getTimerCount()).toBe(0)
    })

    it('should only throw, and not time out later, for a request on a closing connection', () => {
      const session = identifiedSession()
      session.connection.close()
      const callback = vi.fn()

      expect(() => session.connection.sendRequest('dataSend', 'open', {}, callback)).toThrow('closing/closed socket')
      vi.advanceTimersByTime(11000)

      expect(callback).not.toHaveBeenCalled()
      // @ts-expect-error: private property access
      expect(Object.keys(session.connection.responseHandlers)).toHaveLength(0)
      // @ts-expect-error: private property access
      expect(Object.keys(session.connection.responseTimers)).toHaveLength(0)
    })

    it('should only throw, and not time out later, for a request which is too large to send', () => {
      const session = identifiedSession()
      const callback = vi.fn()

      expect(() => session.connection.sendRequest('dataSend', 'open', {
        data: Buffer.alloc(0x100000),
      }, callback))
        .toThrow('larger than the maximum')
      vi.advanceTimersByTime(11000)

      expect(callback).not.toHaveBeenCalled()
      expect(session.socket.end).not.toHaveBeenCalled() // the timeout would have closed the connection
    })
  })

  describe('messages of an unexpected shape', () => {
    function sessionWithHandlers() {
      const session = setupSession()
      session.socket.emit('data', encryptedFrame(session, messagePayload({ protocol: 'control', request: 'hello', id: 1 })))

      const eventHandler = vi.fn()
      const requestHandler = vi.fn()
      session.connection.addProtocolHandler('test', {
        eventHandler: { topic: eventHandler },
        requestHandler: { topic: requestHandler },
      })

      return { session, eventHandler, requestHandler }
    }

    it.each([
      ['null', null],
      ['a number', 5],
      ['a string', 'text'],
      [
        'a list',
        [1],
      ],
      [
        'data',
        Buffer.from([1]),
      ],
    ])('should drop a message whose body is %s and not a dictionary', (_, body) => {
      const { session, eventHandler, requestHandler } = sessionWithHandlers()

      expect(() => {
        session.socket.emit('data', encryptedFrame(session, messagePayload({ protocol: 'test', event: 'topic' }, body)))
        session.socket.emit('data', encryptedFrame(session, messagePayload({ protocol: 'test', request: 'topic', id: 2 }, body)))
      }).not.toThrow()

      expect(eventHandler).not.toHaveBeenCalled()
      expect(requestHandler).not.toHaveBeenCalled()
      expect(session.socket.write).toHaveBeenCalledTimes(1) // only the hello response
      expect(session.socket.end).not.toHaveBeenCalled()

      // the connection still works
      session.socket.emit('data', encryptedFrame(session, messagePayload({ protocol: 'test', event: 'topic' }, { value: 1 })))
      session.socket.emit('data', encryptedFrame(session, messagePayload({ protocol: 'test', request: 'topic', id: 3 }, { value: 2 })))
      expect(eventHandler).toHaveBeenCalledExactlyOnceWith({ value: 1 })
      expect(requestHandler).toHaveBeenCalledExactlyOnceWith(3, { value: 2 })
    })

    it.each([
      [
        'a protocol which is not a string',
        { protocol: 5, event: 'topic' },
      ],
      [
        'an event name which is not a string',
        { protocol: 'test', event: 5 },
      ],
      [
        'a request name which is not a string',
        { protocol: 'test', request: 5, id: 2 },
      ],
      [
        'a request id which is not a number',
        { protocol: 'test', request: 'topic', id: 'two' },
      ],
      [
        'a request without an id',
        { protocol: 'test', request: 'topic' },
      ],
    ])('should drop a message with %s', (_, header) => {
      const { session, eventHandler, requestHandler } = sessionWithHandlers()
      const globalHandler = vi.fn()
      session.connection.on('handle-message-globally', globalHandler)

      expect(() => session.socket.emit('data', encryptedFrame(session, messagePayload(header)))).not.toThrow()

      expect(eventHandler).not.toHaveBeenCalled()
      expect(requestHandler).not.toHaveBeenCalled()
      expect(globalHandler).not.toHaveBeenCalled()
      expect(session.socket.write).toHaveBeenCalledTimes(1) // only the hello response
      expect(session.socket.end).not.toHaveBeenCalled()
    })

    it('should keep waiting when a response has a status which is not a number', () => {
      const { session } = sessionWithHandlers()
      const callback = vi.fn()
      session.connection.sendRequest('test', 'topic', {}, callback)
      // @ts-expect-error: private property access
      const id = Number(Object.keys(session.connection.responseHandlers)[0])

      session.socket.emit('data', encryptedFrame(session, messagePayload({
        protocol: 'test',
        response: 'topic',
        id,
        status: 'zero',
      })))
      expect(callback).not.toHaveBeenCalled()

      session.socket.emit('data', encryptedFrame(session, messagePayload({
        protocol: 'test',
        response: 'topic',
        id,
        status: 0,
      }, { value: 1 })))
      expect(callback).toHaveBeenCalledExactlyOnceWith(undefined, 0, { value: 1 })
    })
  })

  describe('unhandled requests', () => {
    // decrypts the n-th frame the accessory wrote and returns its decoded header
    function sentHeader(session: TestSession, index: number): unknown {
      const frame: Buffer = session.socket.write.mock.calls[index][0]
      const header = frame.subarray(0, 4)
      const ciphertext = frame.subarray(4, frame.length - 16)
      const authTag = frame.subarray(frame.length - 16)

      const nonce = Buffer.alloc(8)
      hapCrypto.writeUInt64LE(index, nonce)
      const payload = hapCrypto.chacha20_poly1305_decryptAndVerify(session.prepared.accessoryToControllerEncryptionKey, nonce, header, ciphertext, authTag)

      return DataStreamParser.decode(new DataStreamReader(payload.subarray(1, 1 + payload.readUInt8(0))))
    }

    function identifiedSession(): TestSession {
      const session = setupSession()
      session.socket.emit('data', encryptedFrame(session, messagePayload({ protocol: 'control', request: 'hello', id: 1 })))
      return session
    }

    it.each([
      ['an unknown protocol', 'unknownProtocol'],
      ['a known protocol', 'control'],
    ])('should answer a request with an unknown topic on %s', (_, protocol) => {
      const session = identifiedSession()

      session.socket.emit('data', encryptedFrame(session, messagePayload({ protocol, request: 'unknownTopic', id: 7 })))

      expect(session.socket.write).toHaveBeenCalledTimes(2) // hello response + our answer
      expect(sentHeader(session, 1)).toEqual({
        protocol,
        response: 'unknownTopic',
        id: 7,
        status: HDSStatus.MISSING_PROTOCOL,
      })
    })

    it.each([
      ['control', 'toString'],
      ['control', 'constructor'],
      ['toString', 'hello'],
      ['__proto__', 'hello'],
    ])('should answer the request %s/%s, named like an inherited property, as unhandled', (protocol, topic) => {
      const session = identifiedSession()

      session.socket.emit('data', encryptedFrame(session, messagePayload({ protocol, request: topic, id: 7 })))

      expect(session.socket.write).toHaveBeenCalledTimes(2) // hello response + our answer
      expect(sentHeader(session, 1)).toMatchObject({
        response: topic,
        id: 7,
        status: HDSStatus.MISSING_PROTOCOL,
      })
    })

    it('should not answer an unhandled event or a request without an id', () => {
      const session = identifiedSession()

      expect(() => {
        session.socket.emit('data', encryptedFrame(session, messagePayload({ protocol: 'unknownProtocol', event: 'unknownTopic' })))
        session.socket.emit('data', encryptedFrame(session, messagePayload({ protocol: 'unknownProtocol', request: 'unknownTopic' })))
      }).not.toThrow()

      expect(session.socket.write).toHaveBeenCalledTimes(1) // only the hello response
    })
  })
})

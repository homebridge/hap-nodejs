import type { Socket } from 'node:dgram'

import { Buffer } from 'node:buffer'
import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RTPProxy from './RTPProxy.js'

describe('RTPProxy', () => {
  let proxy: RTPProxy | undefined

  afterEach(() => {
    proxy?.destroy()
    proxy = undefined
  })

  it('should close its sockets when it was destroyed while they were being bound', async () => {
    proxy = new RTPProxy({
      outgoingAddress: '127.0.0.1',
      outgoingPort: 5000,
      outgoingSSRC: 1,
      disabled: false,
    })
    const setup = proxy.setup()
    proxy.destroy() // e.g. the stream session ended in the meantime
    await setup

    for (const socket of [proxy.incomingRTPSocket, proxy.incomingRTCPSocket, proxy.outgoingSocket]) {
      expect(() => socket.address()).toThrow() // a closed socket has no address
    }
    expect(() => proxy!.destroy()).not.toThrow()
  })

  describe('binds which always fail', () => {
    const bindError = new Error('bind EACCES 0.0.0.0')
    let sockets: FailingSocket[]
    let gaveUp: Promise<string>
    let stopTest: (reason: string) => void

    // a socket which can never be bound, like when the system forbids it
    class FailingSocket extends EventEmitter {
      port?: number
      close = vi.fn()

      bind(port: number): void {
        this.port = port
        if (sockets.length > 200000) {
          stopTest('still trying after 200000 sockets') // the test must end, also when the binds are tried for ever
          return
        }
        queueMicrotask(() => this.emit('error', bindError))
      }
    }

    beforeEach(() => {
      sockets = []
      gaveUp = new Promise(resolve => stopTest = resolve)
      vi.spyOn(dgram, 'createSocket').mockImplementation(() => {
        const socket = new FailingSocket()
        sockets.push(socket)
        return socket as unknown as Socket
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    function failingProxy(): RTPProxy {
      return new RTPProxy({
        outgoingAddress: '127.0.0.1',
        outgoingPort: 5000,
        outgoingSSRC: 1,
        disabled: false,
      })
    }

    function outcome(promise: Promise<unknown>): Promise<unknown> {
      return Promise.race([
        promise.then(() => 'resolved', error => error),
        gaveUp,
      ])
    }

    it('should reject the single socket once every port was tried', async () => {
      const result = await outcome(failingProxy().createSocket('udp4'))

      expect(result).toBeInstanceOf(Error)
      expect((result as Error).message).toContain(bindError.message)
      expect(sockets).toHaveLength(65535 - 10000 + 1)
      expect(new Set(sockets.map(socket => socket.port)).size).toBe(sockets.length) // no port was tried twice
      expect(sockets.every(socket => socket.close.mock.calls.length === 1)).toBe(true)
    })

    it('should reject the socket pair once every pair of ports was tried', async () => {
      const result = await outcome(failingProxy().createSocketPair('udp4'))

      expect(result).toBeInstanceOf(Error)
      expect((result as Error).message).toContain(bindError.message)
      expect(sockets).toHaveLength(2 * (65535 - 10000))
      expect(Math.min(...sockets.map(socket => socket.port!))).toBe(10000)
      expect(Math.max(...sockets.map(socket => socket.port!))).toBe(65535)
      expect(sockets.every(socket => socket.close.mock.calls.length === 1)).toBe(true)
    })

    it('should reject the setup', async () => {
      const result = await outcome(failingProxy().setup())

      expect(result).toBeInstanceOf(Error)
      expect((result as Error).message).toContain(bindError.message)
    })
  })

  describe('packets', () => {
    function boundProxy(): { proxy: RTPProxy, send: ReturnType<typeof vi.fn> } {
      const instance = new RTPProxy({
        outgoingAddress: '127.0.0.1',
        outgoingPort: 5000,
        outgoingSSRC: 0x0A0B0C0D,
        disabled: false,
      })
      const send = vi.fn()
      instance.outgoingSocket = { send } as unknown as RTPProxy['outgoingSocket']
      return { proxy: instance, send }
    }

    it('should learn the SSRC of the server from the SSRC field of the first RTP packet', () => {
      const { proxy: instance, send } = boundProxy()
      const packet = Buffer.alloc(12)
      packet.writeUInt32BE(0x11111111, 4) // timestamp
      packet.writeUInt32BE(0x22222222, 8) // SSRC

      instance.rtpMessage(packet)

      expect(instance.incomingSSRC).toBe(0x22222222)
      expect(send).toHaveBeenCalledExactlyOnceWith(packet, 5000, '127.0.0.1')
      expect(packet.readUInt32BE(8)).toBe(0x0A0B0C0D)
    })

    it('should pass RTCP from the controller on to the server', () => {
      const { proxy: instance, send } = boundProxy()
      instance.setServerAddress('10.0.0.1')
      instance.setServerRTCPPort(6001)
      instance.incomingSSRC = 0x22222222

      // a receiver report (201) with one report block for the outgoing SSRC
      const report = Buffer.alloc(32)
      report.writeUInt8(0x81, 0)
      report.writeUInt8(201, 1)
      report.writeUInt16BE(7, 2)
      report.writeUInt32BE(0x0A0B0C0D, 8)

      instance.rtcpReply(report)

      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0].slice(1)).toEqual([6001, '10.0.0.1'])
      expect((send.mock.calls[0][0] as Buffer).readUInt32BE(8)).toBe(0x22222222)
    })
  })

  it('should keep its bound sockets open when they report runtime errors', async () => {
    proxy = new RTPProxy({
      outgoingAddress: '127.0.0.1',
      outgoingPort: 5000,
      outgoingSSRC: 1,
      disabled: false,
    })
    await proxy.setup()

    const sockets = [proxy.incomingRTPSocket, proxy.incomingRTCPSocket, proxy.outgoingSocket]
    for (const socket of sockets) {
      // e.g. a send to a controller which left the network. The second error would have no listener left.
      expect(() => socket.emit('error', new Error('EHOSTUNREACH'))).not.toThrow()
      expect(() => socket.emit('error', new Error('EHOSTUNREACH'))).not.toThrow()
      expect(() => socket.address()).not.toThrow() // throws if the socket was closed
    }

    expect(proxy.incomingRTPSocket).toBe(sockets[0])
    expect(proxy.incomingRTCPSocket).toBe(sockets[1])
    expect(proxy.outgoingSocket).toBe(sockets[2])
  })
})

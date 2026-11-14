import { Buffer } from 'node:buffer'

import { afterEach, describe, expect, it, vi } from 'vitest'

import RTPProxy from './RTPProxy.js'

describe('rTPProxy', () => {
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

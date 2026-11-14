import { afterEach, describe, expect, it } from 'vitest'

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

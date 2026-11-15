import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import { HAPStatus } from '../HAPServer.js'
import * as tlv from '../util/tlv.js'
import { DataStreamManagement } from './DataStreamManagement.js'

describe('DataStreamManagement', () => {
  it('should reject a setup write which is not a string as an invalid value', () => {
    const management = new DataStreamManagement()
    const callback = vi.fn()

    // @ts-expect-error: private access
    management.handleSetupDataStreamTransportWrite(5, callback, {})

    expect(callback).toHaveBeenCalledExactlyOnceWith(HAPStatus.INVALID_VALUE_IN_REQUEST)
    // @ts-expect-error: private access
    expect(management.dataStreamServer.preparedSessions).toHaveLength(0)

    management.destroy()
  })

  it.each([
    [
      'without a session command',
      tlv.encode(0x02, 0x00, 0x03, Buffer.alloc(32)),
    ],
    [
      'without a transport type',
      tlv.encode(0x01, 0x00, 0x03, Buffer.alloc(32)),
    ],
    [
      'without a controller key salt',
      tlv.encode(0x01, 0x00, 0x02, 0x00),
    ],
  ])('should reject a setup write %s as an invalid value', (_title, write) => {
    const management = new DataStreamManagement()
    const callback = vi.fn()

    // @ts-expect-error: private access
    management.handleSetupDataStreamTransportWrite(write.toString('base64'), callback, {})

    expect(callback).toHaveBeenCalledExactlyOnceWith(HAPStatus.INVALID_VALUE_IN_REQUEST)
    // @ts-expect-error: private access
    expect(management.dataStreamServer.preparedSessions).toHaveLength(0)

    management.destroy()
  })
})

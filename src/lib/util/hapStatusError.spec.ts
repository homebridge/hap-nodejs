import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HAPStatus } from '../HAPServer.js'
import { HapStatusError } from './hapStatusError.js'

describe('HapStatusError', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('sets the hap status code correctly', async () => {
    const error = new HapStatusError(HAPStatus.RESOURCE_BUSY)
    expect(error.hapStatus).toEqual(HAPStatus.RESOURCE_BUSY)
  })

  it('can be subclassed and is named after its class', () => {
    class DeviceOfflineError extends HapStatusError {
      constructor() {
        super(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      }
    }
    const error = new DeviceOfflineError()

    expect(error).toBeInstanceOf(DeviceOfflineError)
    expect(error).toBeInstanceOf(HapStatusError)
    expect(error).toBeInstanceOf(Error)
    expect(new HapStatusError(HAPStatus.RESOURCE_BUSY).name).toEqual('HapStatusError')
  })

  it('reverts to SERVICE_COMMUNICATION_FAILURE if an invalid code is passed in', async () => {
    const error = new HapStatusError(234523323423423 as HAPStatus)
    expect(error.hapStatus).toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
  })
})

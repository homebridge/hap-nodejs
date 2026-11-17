import { Buffer } from 'node:buffer'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Characteristic } from '../Characteristic.js'
import { Service } from '../Service.js'
import { AccessCodeManagement, AccessCodeManagementEvent, AccessCodeResponseStatus } from './AccessCodeManagement.js'

// The expected bytes are the worked examples of https://github.com/rednblkx/homekit-lock-access-code, which was
// reverse engineered against a real Home app.
function hex(text: string): string {
  return text.replace(/\s+/g, '')
}

async function write(management: AccessCodeManagement, request: string): Promise<string> {
  const response = await management.getService().getCharacteristic(Characteristic.AccessCodeControlPoint).handleSetRequest(Buffer.from(hex(request), 'hex').toString('base64'))
  return Buffer.from(response as string, 'base64').toString('hex')
}

function seeded(): AccessCodeManagement {
  return new AccessCodeManagement({
    accessCodes: [
      { identifier: 0, accessCode: '1234' },
      { identifier: 1, accessCode: '56789' },
      { identifier: 2, accessCode: '2468' },
    ],
  })
}

/** The status of the first result in a response. */
function status(response: string): number {
  return Number.parseInt(response.slice(-2), 16)
}

describe('AccessCodeManagement', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('the service', () => {
    it('should create its own service and publish the supported configuration', () => {
      const management = new AccessCodeManagement()
      const service = management.getService()

      expect(service.UUID).toBe(Service.AccessCode.UUID)
      const configuration = service.getCharacteristic(Characteristic.AccessCodeSupportedConfiguration).value as string
      // digits only, 4 to 8 long, 16 codes
      expect(Buffer.from(configuration, 'base64').toString('hex')).toBe('010101020104030108040110')
      expect(service.getCharacteristic(Characteristic.ConfigurationState).value).toBe(0)
    })

    it('should use the given service and limits', () => {
      const service = new Service.AccessCode('Keypad')
      const management = new AccessCodeManagement({
        service,
        minimumLength: 6,
        maximumLength: 6,
        maximumAccessCodes: 3,
      })

      expect(management.getService()).toBe(service)
      const configuration = service.getCharacteristic(Characteristic.AccessCodeSupportedConfiguration).value as string
      expect(Buffer.from(configuration, 'base64').toString('hex')).toBe('010101020106030106040103')
    })

    it('should stop answering after destroy', async () => {
      const management = seeded()
      management.destroy()

      // without the handler the write is stored as the value and nothing is answered
      await management.getService().getCharacteristic(Characteristic.AccessCodeControlPoint).handleSetRequest('AQEB')
      expect(management.getAccessCodes()).toHaveLength(3)
    })
  })

  describe('the control point', () => {
    it('should add a code and answer with its identifier', async () => {
      const management = new AccessCodeManagement({
        accessCodes: [
          { identifier: 0, accessCode: '0000' },
        ],
      })

      expect(await write(management, '010103 0206 020431323334')).toBe(hex('010103 030f 010101 020431323334 030100 040100'))
      expect(management.getAccessCodes()).toEqual([
        { identifier: 0, accessCode: '0000' },
        { identifier: 1, accessCode: '1234' },
      ])
      expect(management.hasAccessCode('1234')).toBe(true)
      expect(management.hasAccessCode('4321')).toBe(false)
    })

    it('should list every code in one answer, split by empty entries', async () => {
      expect(await write(seeded(), '010101')).toBe(hex(`010101
        030f 010100 020431323334 030100 040100  0000
        0310 010101 02053536373839 030100 040100  0000
        030f 010102 020432343638 030100 040100`))
    })

    it('should answer a list on an empty lock with only the operation', async () => {
      expect(await write(new AccessCodeManagement(), '010101')).toBe('010101')
    })

    it('should read several codes asked for in one request', async () => {
      expect(await write(seeded(), '010102 0203 010100 0000 0203 010101 0000 0203 010102')).toBe(hex(`010102
        030f 010100 020431323334 030100 040100  0000
        0310 010101 02053536373839 030100 040100  0000
        030f 010102 020432343638 030100 040100`))
    })

    it('should answer "does not exist" for an unknown identifier', async () => {
      expect(await write(seeded(), '010102 0203 010107')).toBe(hex('010102 0309 010107 030100 040109'))
    })

    it('should remove a code, answer with it, and reuse its identifier', async () => {
      const management = seeded()

      expect(await write(management, '010105 0203 010102')).toBe(hex('010105 030f 010102 020432343638 030100 040100'))
      expect(management.getAccessCodes()).toHaveLength(2)
      // the Home app changes a code by removing it and adding the new one
      expect(await write(management, '010103 0206 020439393939')).toBe(hex('010103 030f 010102 020439393939 030100 040100'))
    })

    it('should update a code in place', async () => {
      const management = seeded()

      expect(await write(management, '010104 0209 010101 020439393939')).toBe(hex('010104 030f 010101 020439393939 030100 040100'))
      expect(management.getAccessCodes()[1]).toEqual({ identifier: 1, accessCode: '9999' })
    })

    it('should refuse codes which cannot be stored, and store nothing', async () => {
      const management = new AccessCodeManagement({
        maximumAccessCodes: 2,
        accessCodes: [
          { identifier: 0, accessCode: '1234' },
        ],
      })
      const add = (code: string) => write(management, `010103 02${(code.length + 2).toString(16).padStart(2, '0')} 02${code.length.toString(16).padStart(2, '0')}${Buffer.from(code).toString('hex')}`)

      expect(status(await add('1234'))).toBe(AccessCodeResponseStatus.DUPLICATE)
      expect(status(await add('123'))).toBe(AccessCodeResponseStatus.SMALLER_THAN_MINIMUM_LENGTH)
      expect(status(await add('123456789'))).toBe(AccessCodeResponseStatus.LARGER_THAN_MAXIMUM_LENGTH)
      expect(status(await add('12a4'))).toBe(AccessCodeResponseStatus.INVALID_CHARACTER)
      expect(status(await add('5555'))).toBe(AccessCodeResponseStatus.SUCCESS)
      expect(status(await add('6666'))).toBe(AccessCodeResponseStatus.EXCEEDED_MAXIMUM_ALLOWED_ACCESS_CODES)
      expect(management.getAccessCodes().map(code => code.accessCode)).toEqual(['1234', '5555'])
    })

    it('should answer "invalid request" for an unknown operation or a broken value, and still echo the operation', async () => {
      const management = seeded()

      expect(await write(management, '010109')).toBe(hex('010109 0306 030100 040108'))
      expect(status(await write(management, '0105ff'))).toBe(AccessCodeResponseStatus.INVALID_REQUEST)
      expect(management.getAccessCodes()).toHaveLength(3)
    })
  })

  describe('changes', () => {
    it('should raise the configuration state and emit the codes after a change', async () => {
      const management = new AccessCodeManagement()
      const listener = vi.fn()
      management.on(AccessCodeManagementEvent.ACCESS_CODES_UPDATED, listener)

      await write(management, '010103 0206 020431323334')
      expect(management.getService().getCharacteristic(Characteristic.ConfigurationState).value).toBe(1)
      expect(listener).not.toHaveBeenCalled() // not in sync with the HAP request

      vi.runAllTimers()
      expect(listener).toHaveBeenCalledExactlyOnceWith([
        { identifier: 0, accessCode: '1234' },
      ])
    })

    it('should not count a list, a read or a refused write as a change', async () => {
      const management = seeded()
      const listener = vi.fn()
      management.on(AccessCodeManagementEvent.ACCESS_CODES_UPDATED, listener)

      await write(management, '010101')
      await write(management, '010102 0203 010100')
      await write(management, '010103 0206 020431323334') // a duplicate
      await write(management, '010105 0203 010109') // does not exist
      vi.runAllTimers()

      expect(management.getService().getCharacteristic(Characteristic.ConfigurationState).value).toBe(0)
      expect(listener).not.toHaveBeenCalled()
    })

    it('should emit the codes of each write, not the state when the timer fires', async () => {
      const management = new AccessCodeManagement()
      const listener = vi.fn()
      management.on(AccessCodeManagementEvent.ACCESS_CODES_UPDATED, listener)

      await write(management, '010103 0206 020431323334')
      await write(management, '010103 0206 020435353535')
      vi.runAllTimers()

      expect(listener).toHaveBeenNthCalledWith(1, [
        { identifier: 0, accessCode: '1234' },
      ])
      expect(listener).toHaveBeenNthCalledWith(2, [
        { identifier: 0, accessCode: '1234' },
        { identifier: 1, accessCode: '5555' },
      ])
    })
  })
})

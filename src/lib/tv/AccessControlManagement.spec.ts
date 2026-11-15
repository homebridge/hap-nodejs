import { Buffer } from 'node:buffer'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Characteristic } from '../Characteristic.js'
import { Service } from '../Service.js'
import * as tlv from '../util/tlv.js'
import { AccessControlEvent, AccessControlManagement, AccessLevel } from './AccessControlManagement.js'

function passwordSetting(password: string | undefined, required: boolean): string {
  const requiredTLV = tlv.encode(0x02, required ? 1 : 0)
  return (password === undefined
    ? requiredTLV
    : Buffer.concat([
        tlv.encode(0x01, password),
        requiredTLV,
      ])).toString('base64')
}

async function writeAccessLevel(management: AccessControlManagement, level: AccessLevel): Promise<void> {
  await management.getService().getCharacteristic(Characteristic.AccessControlLevel).handleSetRequest(level)
}

async function writePasswordSetting(management: AccessControlManagement, password: string | undefined, required: boolean): Promise<void> {
  await management.getService().getCharacteristic(Characteristic.PasswordSetting).handleSetRequest(passwordSetting(password, required))
}

describe('AccessControlManagement', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('the service', () => {
    it('should create its own service without the password characteristic', () => {
      const management = new AccessControlManagement()

      const service = management.getService()
      expect(service).toBeInstanceOf(Service.AccessControl)
      expect(service.getCharacteristic(Characteristic.AccessControlLevel).value).toBe(0)
      expect(service.testCharacteristic(Characteristic.PasswordSetting)).toBe(false)
      expect(management.getAccessLevel()).toBe(AccessLevel.ANYONE)
      expect(management.getPassword()).toBeUndefined()
    })

    it('should add the password characteristic when asked for it', () => {
      const management = new AccessControlManagement(true)

      const service = management.getService()
      expect(service.testCharacteristic(Characteristic.PasswordSetting)).toBe(true)
      expect(service.getCharacteristic(Characteristic.PasswordSetting).value).toBe('')
    })

    it('should use the service which was handed to it', async () => {
      const service = new Service.AccessControl()
      const management = new AccessControlManagement(false, service)

      expect(management.getService()).toBe(service)
      await writeAccessLevel(management, AccessLevel.HOME_MEMBERS_ONLY)
      expect(management.getAccessLevel()).toBe(AccessLevel.HOME_MEMBERS_ONLY)
    })
  })

  describe('the access level', () => {
    it('should store a written level at once and report it after the write was answered', async () => {
      const management = new AccessControlManagement()
      const listener = vi.fn()
      management.on(AccessControlEvent.ACCESS_LEVEL_UPDATED, listener)

      await writeAccessLevel(management, AccessLevel.HOME_MEMBERS_ONLY)

      expect(management.getAccessLevel()).toBe(AccessLevel.HOME_MEMBERS_ONLY)
      expect(listener).not.toHaveBeenCalled()

      vi.runAllTimers()
      expect(listener).toHaveBeenCalledExactlyOnceWith(AccessLevel.HOME_MEMBERS_ONLY)
    })

    it('should report every level in the order it was written when two writes arrive before the first event', async () => {
      const management = new AccessControlManagement()
      const listener = vi.fn()
      management.on(AccessControlEvent.ACCESS_LEVEL_UPDATED, listener)

      await writeAccessLevel(management, AccessLevel.HOME_MEMBERS_ONLY)
      await writeAccessLevel(management, AccessLevel.ANYONE)
      vi.runAllTimers()

      expect(listener.mock.calls).toEqual([
        [AccessLevel.HOME_MEMBERS_ONLY],
        [AccessLevel.ANYONE],
      ])
      expect(management.getAccessLevel()).toBe(AccessLevel.ANYONE)
    })

    it('should not keep the process alive with the timer of the event', async () => {
      const management = new AccessControlManagement()
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      try {
        await writeAccessLevel(management, AccessLevel.HOME_MEMBERS_ONLY)

        expect(setTimeoutSpy).toHaveBeenCalledOnce()
        expect(setTimeoutSpy.mock.results[0].value.hasRef()).toBe(false)
      } finally {
        setTimeoutSpy.mockRestore()
      }
    })
  })

  describe('the password setting', () => {
    it('should store a required password and report it after the write was answered', async () => {
      const management = new AccessControlManagement(true)
      const listener = vi.fn()
      management.on(AccessControlEvent.PASSWORD_SETTING_UPDATED, listener)

      await writePasswordSetting(management, 'secret', true)

      expect(management.getPassword()).toBe('secret')
      expect(listener).not.toHaveBeenCalled()

      vi.runAllTimers()
      expect(listener).toHaveBeenCalledExactlyOnceWith('secret', true)
    })

    it('should not return a password which is not required, but still report it', async () => {
      const management = new AccessControlManagement(true)
      const listener = vi.fn()
      management.on(AccessControlEvent.PASSWORD_SETTING_UPDATED, listener)

      await writePasswordSetting(management, 'secret', false)
      vi.runAllTimers()

      expect(management.getPassword()).toBeUndefined()
      expect(listener).toHaveBeenCalledExactlyOnceWith('secret', false)
    })

    it('should forget the password when a write holds none', async () => {
      const management = new AccessControlManagement(true)
      const listener = vi.fn()
      await writePasswordSetting(management, 'secret', true)
      vi.runAllTimers()
      management.on(AccessControlEvent.PASSWORD_SETTING_UPDATED, listener)

      await writePasswordSetting(management, undefined, false)
      vi.runAllTimers()

      expect(management.getPassword()).toBeUndefined()
      expect(listener).toHaveBeenCalledExactlyOnceWith(undefined, false)
    })

    it('should report every setting in the order it was written when two writes arrive before the first event', async () => {
      const management = new AccessControlManagement(true)
      const listener = vi.fn()
      management.on(AccessControlEvent.PASSWORD_SETTING_UPDATED, listener)

      await writePasswordSetting(management, 'first', true)
      await writePasswordSetting(management, undefined, false)
      vi.runAllTimers()

      expect(listener.mock.calls).toEqual([
        ['first', true],
        [undefined, false],
      ])
      expect(management.getPassword()).toBeUndefined()
    })

    it('should read a password with characters of more than one byte', async () => {
      const management = new AccessControlManagement(true)

      await writePasswordSetting(management, 'pässwörd', true)

      expect(management.getPassword()).toBe('pässwörd')
    })
  })

  describe('destroy', () => {
    it('should remove the listeners and stop following writes', async () => {
      const management = new AccessControlManagement(true)
      const levelListener = vi.fn()
      const passwordListener = vi.fn()
      management.on(AccessControlEvent.ACCESS_LEVEL_UPDATED, levelListener)
      management.on(AccessControlEvent.PASSWORD_SETTING_UPDATED, passwordListener)

      management.destroy()
      await writeAccessLevel(management, AccessLevel.HOME_MEMBERS_ONLY)
      await writePasswordSetting(management, 'secret', true)
      vi.runAllTimers()

      expect(management.getAccessLevel()).toBe(AccessLevel.ANYONE)
      expect(management.getPassword()).toBeUndefined()
      expect(levelListener).not.toHaveBeenCalled()
      expect(passwordListener).not.toHaveBeenCalled()
    })

    it('should not fail for a service without the password characteristic', () => {
      const management = new AccessControlManagement()

      expect(() => management.destroy()).not.toThrow()
      expect(management.getService().testCharacteristic(Characteristic.PasswordSetting)).toBe(false)
    })
  })
})

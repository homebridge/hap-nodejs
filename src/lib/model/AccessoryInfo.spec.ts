import type { AccessoryJsonObject, CharacteristicJsonObject } from '../../types.js'
import type { HAPConnection } from '../util/eventedhttp.js'

import { AssertionError } from 'node:assert'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { format } from 'node:util'

import createDebug from 'debug'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Categories } from '../Accessory.js'
import { Formats, Perms } from '../Characteristic.js'
import { EventedHTTPServer } from '../util/eventedhttp.js'
import { AccessoryInfo, PermissionTypes } from './AccessoryInfo.js'
import { HAPStorage } from './HAPStorage.js'

describe('AccessoryInfo', () => {
  it('should not read package.json again for every firmware version check', () => {
    const readFileSync = vi.spyOn(fs, 'readFileSync')
    syncBuiltinESMExports() // makes the spy visible to the named import in AccessoryInfo.ts
    try {
      const info = AccessoryInfo.create('AA:BB:CC:DD:EE:11')
      info.checkForCurrentConfigurationNumberIncrement([], true)
      info.checkForCurrentConfigurationNumberIncrement([], true)

      const reads = readFileSync.mock.calls.filter(([file]) => String(file).endsWith('package.json'))
      expect(reads.length).toBeLessThanOrEqual(1) // none when an earlier test already asked for the version
      // @ts-expect-error: private access
      expect(info.lastFirmwareVersion).toMatch(/^\d+\.\d+\.\d+/)
    } finally {
      readFileSync.mockRestore()
      syncBuiltinESMExports()
    }
  })

  it('should count an admin once when it is added twice, so removing it removes everybody', () => {
    const info = AccessoryInfo.create('AA:BB:CC:DD:EE:10')
    const key = Buffer.alloc(32, 1)

    info.addPairedClient('admin', key, PermissionTypes.ADMIN)
    info.addPairedClient('admin', key, PermissionTypes.ADMIN)
    info.addPairedClient('user', key, PermissionTypes.USER)
    expect(info.pairedAdminClients).toBe(1)

    const destroyConnections = vi.spyOn(EventedHTTPServer, 'destroyExistingConnectionsAfterUnpair').mockImplementation(() => undefined)
    try {
      info.removePairedClient({} as HAPConnection, 'admin')
    } finally {
      destroyConnections.mockRestore()
    }

    expect(info.listPairings()).toEqual([]) // the last admin left, which removes all users as well
  })

  describe('#load()', () => {
    it('should default category to Categories.OTHER when missing', () => {
      const username = '0E:AE:FC:45:7B:91'
      HAPStorage.storage().setItemSync(AccessoryInfo.persistKey(username), {
        displayName: 'Test',
        pincode: '123-45-678',
        signSk: 'aa'.repeat(64),
        signPk: 'bb'.repeat(32),
        pairedClients: {},
        // category intentionally omitted
      })

      const info = AccessoryInfo.load(username)
      expect(info).not.toBeNull()
      expect(info!.category).toBe(Categories.OTHER)
      expect(typeof info!.category).toBe('number')
    })
  })

  describe('#checkForCurrentConfigurationNumberIncrement()', () => {
    const characteristic = (iid: number, perms: Perms[], validValues?: number[]): CharacteristicJsonObject => ({
      'type': '25',
      iid,
      'value': null,
      perms,
      'description': 'Test',
      'format': Formats.UINT8,
      'unit': undefined,
      'minValue': undefined,
      'maxValue': undefined,
      'minStep': undefined,
      'maxLen': undefined,
      'maxDataLen': undefined,
      'valid-values': validValues,
      'valid-values-range': undefined,
    })

    const accessory = (aid: number, characteristics: CharacteristicJsonObject[]): AccessoryJsonObject => ({
      aid,
      services: [
        {
          type: '49',
          iid: 1,
          characteristics,
          hidden: undefined,
          primary: undefined,
        },
      ],
    })

    let info: AccessoryInfo

    beforeEach(() => {
      info = AccessoryInfo.create('0E:AE:FC:45:7B:92')
    })

    it('should increment the configuration number when the configuration changes', () => {
      expect(info.checkForCurrentConfigurationNumberIncrement([
        accessory(1, [
          characteristic(2, [Perms.PAIRED_READ]),
        ]),
      ])).toBe(true)
      const version = info.getConfigVersion()

      // same configuration again: no increment
      expect(info.checkForCurrentConfigurationNumberIncrement([
        accessory(1, [
          characteristic(2, [Perms.PAIRED_READ]),
        ]),
      ])).toBe(false)
      expect(info.getConfigVersion()).toBe(version)

      // a real change: increment
      expect(info.checkForCurrentConfigurationNumberIncrement([
        accessory(1, [
          characteristic(2, [Perms.PAIRED_READ, Perms.NOTIFY]),
        ]),
      ])).toBe(true)
      expect(info.getConfigVersion()).toBe(version + 1)
    })

    it('should not increment when only the order of order-independent arrays differs', () => {
      // two accessories, two characteristics, shuffled perms and valid-values: the same configuration,
      // presented in a different order - as plugins are free to do on any restart
      expect(info.checkForCurrentConfigurationNumberIncrement([
        accessory(1, [
          characteristic(2, [Perms.PAIRED_READ, Perms.NOTIFY], [0, 1, 2]),
          characteristic(3, [Perms.PAIRED_WRITE]),
        ]),
        accessory(2, [
          characteristic(2, [Perms.PAIRED_READ]),
        ]),
      ])).toBe(true)
      const version = info.getConfigVersion()

      expect(info.checkForCurrentConfigurationNumberIncrement([
        accessory(2, [
          characteristic(2, [Perms.PAIRED_READ]),
        ]),
        accessory(1, [
          characteristic(3, [Perms.PAIRED_WRITE]),
          characteristic(2, [Perms.NOTIFY, Perms.PAIRED_READ], [2, 0, 1]),
        ]),
      ])).toBe(false)
      expect(info.getConfigVersion()).toBe(version)
    })

    it('should emit a debug line when the configuration number increments', () => {
      const previousNamespaces = createDebug.disable()
      const originalLog = createDebug.log
      const messages: string[] = []

      createDebug.enable('HAP-NodeJS:AccessoryInfo')
      createDebug.log = (...args: unknown[]) => {
        messages.push(format(...args))
      }

      try {
        info.checkForCurrentConfigurationNumberIncrement([
          accessory(1, [
            characteristic(2, [Perms.PAIRED_READ]),
          ]),
        ])
      } finally {
        createDebug.log = originalLog
        createDebug.enable(previousNamespaces)
      }

      const version = info.getConfigVersion()
      expect(messages.some(message => message.includes(`Configuration number incremented to ${version}`))).toBe(true)
    })
  })

  describe('#assertValidUsername()', () => {
    it('should verify correct device id', () => {
      const VALUE = '0E:AE:FC:45:7B:91'
      expect(() => AccessoryInfo.assertValidUsername(VALUE)).not.toThrow(AssertionError)
    })

    it('should fail to verify too long device id', () => {
      const VALUE = '00:2c:44:f9:30:8f:d1:2e'
      expect(() => AccessoryInfo.assertValidUsername(VALUE)).toThrow(AssertionError)
    })

    it('should fail to verify too short device id', () => {
      const VALUE = '00:2c:d1:2e'
      expect(() => AccessoryInfo.assertValidUsername(VALUE)).toThrow(AssertionError)
    })

    it('should fail to verify device id containing invalid characters', () => {
      const VALUE = '0E:AG:FC:45:7B:91'
      expect(() => AccessoryInfo.assertValidUsername(VALUE)).toThrow(AssertionError)
    })

    it('should fail to verify undefined device id', () => {
      const VALUE = undefined
      // @ts-expect-error: deliberately test illegal value
      expect(() => AccessoryInfo.assertValidUsername(VALUE)).toThrow(AssertionError)
    })
  })
})

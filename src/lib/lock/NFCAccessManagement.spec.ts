import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Characteristic } from '../Characteristic.js'
import { Service } from '../Service.js'
import * as tlv from '../util/tlv.js'
import { encodeHardwareFinish, HomeKeyFinish, NFCAccessManagement, NFCAccessManagementEvent } from './NFCAccessManagement.js'

// The expected bytes for reader keys and device credential keys are the ones asserted by the tests of the plugin
// homebridge-fake-homekey, which gets a home key into Wallet with a real Home app.
const LIST = 1
const ADD = 2
const REMOVE = 3
const ISSUER_KEY_REQUEST = 2
const DEVICE_CREDENTIAL_KEY_REQUEST = 4
const READER_KEY_REQUEST = 6

function request(operation: number, type: number, ...fields: [number, Buffer | number][]): string {
  return Buffer.concat([
    tlv.encode(0x01, operation),
    tlv.encode(type, fields.length > 0
      ? Buffer.concat(fields.map(([fieldType, value]) => tlv.encode(fieldType, value)))
      : Buffer.alloc(0)),
  ]).toString('base64')
}

async function write(management: NFCAccessManagement, value: string): Promise<string> {
  const response = await management.getService().getCharacteristic(Characteristic.NFCAccessControlPoint).handleSetRequest(value)
  return Buffer.from(response as string, 'base64').toString('hex')
}

const privateKey = randomBytes(32)
const publicKey = randomBytes(64)
const issuer = Buffer.from('12ab34cd56ef0815', 'hex')
const readerIdentifier = Buffer.from('a1b2c3d4e5f6a7b8', 'hex')
const keyIdentifier = NFCAccessManagement.keyIdentifier(privateKey).toString('hex')
const credentialIdentifier = createHash('sha1').update(Buffer.concat([
  Buffer.from([0x04]),
  publicKey,
])).digest().subarray(0, 6)

const addReaderKey = () => request(ADD, READER_KEY_REQUEST, [1, 2], [2, privateKey], [3, readerIdentifier])
function addDeviceCredentialKey(key = publicKey, state = 1) {
  return request(ADD, DEVICE_CREDENTIAL_KEY_REQUEST, [1, 2], [2, key], [3, issuer], [4, state])
}

describe('NFCAccessManagement', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('the service', () => {
    it('should create its own service and publish the supported configuration', () => {
      const service = new NFCAccessManagement().getService()

      expect(service.UUID).toBe(Service.NFCAccess.UUID)
      const configuration = service.getCharacteristic(Characteristic.NFCAccessSupportedConfiguration).value as string
      expect(Buffer.from(configuration, 'base64').toString('hex')).toBe('010110020110')
      expect(service.getCharacteristic(Characteristic.ConfigurationState).value).toBe(0)
    })

    it('should use the given service', () => {
      const service = new Service.NFCAccess('Home Key')
      expect(new NFCAccessManagement({ service }).getService()).toBe(service)
    })

    it('should encode the four card colours the Home app accepts, low byte first', () => {
      const hex = (finish: HomeKeyFinish) => Buffer.from(encodeHardwareFinish(finish), 'base64').toString('hex')

      expect(hex(HomeKeyFinish.TAN)).toBe('0104ced5da00')
      expect(hex(HomeKeyFinish.GOLD)).toBe('0104aad6ec00')
      expect(hex(HomeKeyFinish.SILVER)).toBe('0104e3e3e300')
      expect(hex(HomeKeyFinish.BLACK)).toBe('010400000000')
    })

    it('should stop answering after destroy', async () => {
      const management = new NFCAccessManagement()
      management.destroy()

      await management.getService().getCharacteristic(Characteristic.NFCAccessControlPoint).handleSetRequest(addReaderKey())
      expect(management.getState().readerKey).toBeUndefined()
    })
  })

  describe('reader key', () => {
    it('should answer a list on a lock without a key with nothing', async () => {
      expect(await write(new NFCAccessManagement(), request(LIST, READER_KEY_REQUEST))).toBe('')
    })

    it('should store a key, refuse it a second time, list it and remove it', async () => {
      const management = new NFCAccessManagement()

      expect(await write(management, addReaderKey())).toBe('0703020100')
      expect(management.getState().readerKey).toEqual({
        identifier: keyIdentifier,
        privateKey: privateKey.toString('hex'),
        readerIdentifier: 'a1b2c3d4e5f6a7b8',
      })
      expect(await write(management, addReaderKey())).toBe('0703020102') // duplicate
      expect(await write(management, request(LIST, READER_KEY_REQUEST))).toBe(`070a0108${keyIdentifier}`)

      const remove = request(REMOVE, READER_KEY_REQUEST, [
        4,
        Buffer.from(keyIdentifier, 'hex'),
      ])
      expect(await write(management, remove)).toBe('0703020100')
      expect(management.getState().readerKey).toBeUndefined()
      expect(await write(management, remove)).toBe('0703020103') // does not exist
    })

    it('should refuse a key of the wrong type or length', async () => {
      const management = new NFCAccessManagement()

      expect(await write(management, request(ADD, READER_KEY_REQUEST, [1, 1], [2, privateKey]))).toBe('0703020104')
      expect(await write(management, request(ADD, READER_KEY_REQUEST, [1, 2], [
        2,
        privateKey.subarray(0, 16),
      ]))).toBe('0703020104')
      expect(management.getState().readerKey).toBeUndefined()
    })

    it('should drop the device credential keys with the reader key', async () => {
      const management = new NFCAccessManagement()
      await write(management, addReaderKey())
      await write(management, addDeviceCredentialKey())

      await write(management, request(REMOVE, READER_KEY_REQUEST, [
        4,
        Buffer.from(keyIdentifier, 'hex'),
      ]))
      expect(management.getState().deviceCredentialKeys).toEqual([])
    })
  })

  describe('device credential key', () => {
    it('should store a key and answer with the issuer key identifier', async () => {
      const management = new NFCAccessManagement()

      expect(await write(management, addDeviceCredentialKey())).toBe(`050d0208${issuer.toString('hex')}030100`)
      expect(management.getState().deviceCredentialKeys).toEqual([
        {
          identifier: credentialIdentifier.toString('hex'),
          publicKey: publicKey.toString('hex'),
          issuerKeyIdentifier: issuer.toString('hex'),
          active: true,
        },
      ])
      expect(await write(management, addDeviceCredentialKey())).toBe(`050d0208${issuer.toString('hex')}030102`) // duplicate
    })

    it('should refuse a key when the lock is full, and a suspended key when the suspended ones are full', async () => {
      const full = new NFCAccessManagement({ maximumDeviceCredentialKeys: 1 })
      expect((await write(full, addDeviceCredentialKey())).endsWith('030100')).toBe(true)
      expect((await write(full, addDeviceCredentialKey(randomBytes(64)))).endsWith('030101')).toBe(true)

      const suspended = new NFCAccessManagement({ maximumSuspendedDeviceCredentialKeys: 1 })
      expect((await write(suspended, addDeviceCredentialKey(randomBytes(64), 0))).endsWith('030100')).toBe(true)
      expect((await write(suspended, addDeviceCredentialKey(randomBytes(64), 0))).endsWith('030101')).toBe(true)
      expect((await write(suspended, addDeviceCredentialKey(randomBytes(64), 1))).endsWith('030100')).toBe(true)
      expect(suspended.getState().deviceCredentialKeys.map(key => key.active)).toEqual([false, true])
    })

    it('should answer each of several keys in one write, in the same order', async () => {
      const management = new NFCAccessManagement()
      const second = randomBytes(64)
      const fields = (key: Buffer) => Buffer.concat([
        tlv.encode(1, 2),
        tlv.encode(2, key),
        tlv.encode(3, issuer),
        tlv.encode(4, 1),
      ])
      const value = Buffer.concat([
        tlv.encode(0x01, ADD),
        tlv.encode(DEVICE_CREDENTIAL_KEY_REQUEST, [
          fields(publicKey),
          fields(second),
          fields(publicKey), // the first one again: a duplicate
        ]),
      ]).toString('base64')

      const answer = `050d0208${issuer.toString('hex')}0301`
      expect(await write(management, value)).toBe(`${answer}00` + '0000' + `${answer}00` + '0000' + `${answer}02`)
      expect(management.getState().deviceCredentialKeys.map(key => key.publicKey)).toEqual([
        publicKey.toString('hex'),
        second.toString('hex'),
      ])
    })

    it('should remove a key by its identifier or by its public key', async () => {
      const management = new NFCAccessManagement()
      const other = randomBytes(64)
      await write(management, addDeviceCredentialKey())
      await write(management, addDeviceCredentialKey(other))

      const remove = request(REMOVE, DEVICE_CREDENTIAL_KEY_REQUEST, [5, credentialIdentifier])
      expect(await write(management, remove)).toBe('0503030100')
      expect(await write(management, remove)).toBe('0503030103') // does not exist
      expect(await write(management, request(REMOVE, DEVICE_CREDENTIAL_KEY_REQUEST, [5, other]))).toBe('0503030100')
      expect(management.getState().deviceCredentialKeys).toEqual([])
    })

    it('should list the stored keys, split by empty entries', async () => {
      const management = new NFCAccessManagement()
      expect(await write(management, request(LIST, DEVICE_CREDENTIAL_KEY_REQUEST))).toBe('')

      await write(management, addDeviceCredentialKey())
      const entry = `0515 0106${credentialIdentifier.toString('hex')} 0208${issuer.toString('hex')} 030100`.replace(/\s/g, '')
      expect(await write(management, request(LIST, DEVICE_CREDENTIAL_KEY_REQUEST))).toBe(entry)
    })
  })

  describe('issuer key', () => {
    it('should store a key, refuse it a second time, list it and remove it', async () => {
      const management = new NFCAccessManagement()
      const key = randomBytes(32)
      const identifier = NFCAccessManagement.keyIdentifier(key).toString('hex')
      const add = request(ADD, ISSUER_KEY_REQUEST, [1, 1], [2, key])

      expect(await write(management, add)).toBe(`030d0108${identifier}020100`)
      expect(await write(management, add)).toBe(`030d0108${identifier}020102`)
      expect(await write(management, request(LIST, ISSUER_KEY_REQUEST))).toBe(`030d0108${identifier}020100`)
      expect(await write(management, request(REMOVE, ISSUER_KEY_REQUEST, [
        3,
        Buffer.from(identifier, 'hex'),
      ]))).toBe(`030d0108${identifier}020100`)
      expect(management.getState().issuerKeys).toEqual([])
    })

    it('should refuse a key of the wrong type', async () => {
      expect(await write(new NFCAccessManagement(), request(ADD, ISSUER_KEY_REQUEST, [1, 2], [
        2,
        randomBytes(32),
      ]))).toBe('0303020104')
    })
  })

  describe('state', () => {
    it('should emit the new state after a change, and not for a list or a refused write', async () => {
      const management = new NFCAccessManagement()
      const listener = vi.fn()
      management.on(NFCAccessManagementEvent.STATE_UPDATED, listener)

      await write(management, request(LIST, READER_KEY_REQUEST))
      await write(management, request(ADD, READER_KEY_REQUEST, [1, 1], [2, privateKey])) // refused
      vi.runAllTimers()
      expect(listener).not.toHaveBeenCalled()

      await write(management, addReaderKey())
      expect(listener).not.toHaveBeenCalled() // not in sync with the HAP request
      vi.runAllTimers()
      expect(listener).toHaveBeenCalledExactlyOnceWith(management.getState())
    })

    it('should start from a saved state, and never hand out its own copy', async () => {
      const saved = new NFCAccessManagement()
      await write(saved, addReaderKey())
      await write(saved, addDeviceCredentialKey())
      const state = JSON.parse(JSON.stringify(saved.getState()))

      const restored = new NFCAccessManagement({ state })
      expect(await write(restored, request(LIST, READER_KEY_REQUEST))).toBe(`070a0108${keyIdentifier}`)
      expect(restored.getState()).toEqual(state)

      restored.getState().deviceCredentialKeys.length = 0
      state.deviceCredentialKeys.length = 0
      expect(restored.getState().deviceCredentialKeys).toHaveLength(1)
    })

    it('should answer a value it cannot read, or a request it does not know, with nothing', async () => {
      const management = new NFCAccessManagement()

      expect(await write(management, Buffer.from('0105ff', 'hex').toString('base64'))).toBe('')
      expect(await write(management, Buffer.from('010101', 'hex').toString('base64'))).toBe('')
      expect(await write(management, request(9, READER_KEY_REQUEST))).toBe('')
    })
  })
})

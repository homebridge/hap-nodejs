import crypto from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { HAPStorage } from './HAPStorage.js'
import { IdentifierCache } from './IdentifierCache.js'

function createIdentifierCache(username = 'username') {
  return new IdentifierCache(username)
}

describe('identifierCache', () => {
  describe('#startTrackingUsage()', () => {
    it ('creates a cache to track usage and expiring keys', () => {
      const identifierCache = createIdentifierCache()

      expect(identifierCache._usedCache).toBeNull()
      identifierCache.startTrackingUsage()
      expect(identifierCache._usedCache).toEqual({})
    })
  })

  describe('#stopTrackingUsageAndExpireUnused()', () => {
    it ('creates a cache to track usage and expiring keys', () => {
      const identifierCache = createIdentifierCache()

      expect(identifierCache._usedCache).toBeNull()
      identifierCache.startTrackingUsage()
      expect(identifierCache._usedCache).toEqual({})
      identifierCache.stopTrackingUsageAndExpireUnused()
      expect(identifierCache._usedCache).toBeNull()
    })
  })

  describe('accessory ids', () => {
    it('should not hand out the id of a removed accessory again after a pass without accessories', () => {
      const identifierCache = createIdentifierCache()

      identifierCache.startTrackingUsage()
      expect(identifierCache.getAID('first')).toBe(2)
      expect(identifierCache.getAID('second')).toBe(3)
      identifierCache.stopTrackingUsageAndExpireUnused()

      // both accessories were removed from the bridge
      identifierCache.startTrackingUsage()
      identifierCache.stopTrackingUsageAndExpireUnused()

      identifierCache.startTrackingUsage()
      expect(identifierCache.getAID('third')).toBe(4)
      identifierCache.stopTrackingUsageAndExpireUnused()
    })
  })

  describe('#getCache()', () => {
    it ('retrieves an item from the cache', () => {
      const identifierCache = createIdentifierCache()

      const VALUE = 1
      identifierCache.setCache('foo', VALUE)

      expect(identifierCache.getCache('foo')).toEqual(VALUE)
    })

    it ('returns undefined if an item is not found in the cache', () => {
      const identifierCache = createIdentifierCache()

      expect(identifierCache.getCache('foo')).toBeUndefined()
    })
  })

  describe('#setCache()', () => {
    it ('overwrites an existing item in the cache', () => {
      const identifierCache = createIdentifierCache()

      const VALUE = 2
      identifierCache.setCache('foo', 1)
      identifierCache.setCache('foo', VALUE)

      expect(identifierCache.getCache('foo')).toEqual(VALUE)
    })
  })

  describe('#getAID()', () => {
    it('creates an entry in the cache if the key is not found', () => {
      const identifierCache = createIdentifierCache()

      const result = identifierCache.getAID('00')
      expect(result).toEqual(2)
    })
  })

  describe('#getIID()', () => {
    it('creates an entry in the cache if the key is not found', () => {
      const identifierCache = createIdentifierCache()

      const result = identifierCache.getIID('00', '11', 'subtype', '99')
      expect(result).toEqual(2)
    })

    it('creates an entry in the cache if the key is not found, without a characteristic UUID', () => {
      const identifierCache = createIdentifierCache()

      const result = identifierCache.getIID('00', '11', 'subtype')
      expect(result).toEqual(2)
    })

    it('creates an entry in the cache if the key is not found, without a service subtype or characteristic UUID', () => {
      const identifierCache = createIdentifierCache()

      const result = identifierCache.getIID('00', '11')
      expect(result).toEqual(2)
    })
  })

  describe('#save()', () => {
    it('persists the cache to file storage', () => {
      const identifierCache = createIdentifierCache()
      identifierCache.setCache('foo', 1)
      identifierCache.save()

      const saved = HAPStorage.storage().getItem(IdentifierCache.persistKey(identifierCache.username))
      expect(saved).toEqual({
        cache: { foo: 1 },
      })
    })
  })

  describe('#save() without a change', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    function spyOnSaveWork() {
      return {
        setItemSync: vi.spyOn(HAPStorage.storage(), 'setItemSync'),
        stringify: vi.spyOn(JSON, 'stringify'),
        createHash: vi.spyOn(crypto, 'createHash'),
      }
    }

    it('does not look at the whole cache again when nothing changed', () => {
      const identifierCache = createIdentifierCache('unchanged')
      identifierCache.getAID('accessory')
      identifierCache.save()

      const spies = spyOnSaveWork()
      // a pass which hands out the ids it handed out before
      identifierCache.startTrackingUsage()
      identifierCache.getAID('accessory')
      identifierCache.setCache('accessory', identifierCache.getCache('accessory'))
      identifierCache.stopTrackingUsageAndExpireUnused()
      identifierCache.save()

      expect(spies.setItemSync).not.toHaveBeenCalled()
      expect(spies.stringify).not.toHaveBeenCalled()
      expect(spies.createHash).not.toHaveBeenCalled()
    })

    it('does not write a cache again which was just loaded', () => {
      const identifierCache = createIdentifierCache('loaded')
      identifierCache.getAID('accessory')
      identifierCache.save()
      const loaded = IdentifierCache.load('loaded')!

      const spies = spyOnSaveWork()
      loaded.save()

      expect(spies.setItemSync).not.toHaveBeenCalled()
      expect(spies.stringify).not.toHaveBeenCalled()
    })

    it('still saves after a new id was handed out', () => {
      const identifierCache = createIdentifierCache('changed')
      identifierCache.getAID('accessory')
      identifierCache.save()

      const spies = spyOnSaveWork()
      identifierCache.getAID('other accessory')
      identifierCache.save()

      expect(spies.setItemSync).toHaveBeenCalledTimes(1)
      expect(IdentifierCache.load('changed')!._cache).toEqual({ 'accessory': 2, 'other accessory': 3, '|nextAID': 4 })
    })

    it('still saves after an unused id expired', () => {
      const identifierCache = createIdentifierCache('expired')
      identifierCache.getAID('accessory')
      identifierCache.getAID('other accessory')
      identifierCache.save()

      const spies = spyOnSaveWork()
      identifierCache.startTrackingUsage()
      identifierCache.getAID('accessory')
      identifierCache.stopTrackingUsageAndExpireUnused()
      identifierCache.save()

      expect(spies.setItemSync).toHaveBeenCalledTimes(1)
      expect(IdentifierCache.load('expired')!._cache).toEqual({ 'accessory': 2, '|nextAID': 4 })
    })
  })

  describe('#remove()', () => {
    it('removes the cache from file storage', () => {
      const identifierCache = createIdentifierCache()
      identifierCache.save()
      expect(HAPStorage.storage().getItem(IdentifierCache.persistKey(identifierCache.username))).toBeDefined()

      IdentifierCache.remove(identifierCache.username)

      expect(HAPStorage.storage().getItem(IdentifierCache.persistKey(identifierCache.username))).toBeUndefined()
    })
  })

  describe('persistKey()', () => {
    it('returns a correctly formatted key for persistence', () => {
      const key = IdentifierCache.persistKey('username')
      expect(key).toEqual('IdentifierCache.USERNAME.json')
    })
  })
})

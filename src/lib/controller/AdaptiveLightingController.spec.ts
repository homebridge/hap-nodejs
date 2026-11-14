import { Buffer } from 'node:buffer'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Characteristic } from '../Characteristic.js'
import { HAPStatus } from '../HAPServer.js'
import { Service } from '../Service.js'
import * as tlv from '../util/tlv.js'
import { AdaptiveLightingController, AdaptiveLightingControllerEvents, AdaptiveLightingControllerMode } from './AdaptiveLightingController.js'

const EPOCH_MILLIS_2001_01_01 = Date.UTC(2001, 0, 1)
const HOUR = 3600000

interface CurveEntry {
  temperature: number
  adjustmentFactor: number
  transitionOffset: number
  duration?: number
}

function createController(mode = AdaptiveLightingControllerMode.AUTOMATIC) {
  const lightbulb = new Service.Lightbulb('Light')
  lightbulb.addCharacteristic(Characteristic.ColorTemperature)
  lightbulb.getCharacteristic(Characteristic.Brightness).value = 50

  const controller = new AdaptiveLightingController(lightbulb, { controllerMode: mode })
  controller.configureServices()

  let iid = 1
  for (const characteristic of lightbulb.characteristics) {
    characteristic.iid = iid++
  }

  return { lightbulb, controller }
}

function curve(length: number, temperature = 200): CurveEntry[] {
  return Array.from({ length }, (_, index) => ({
    temperature: temperature + index * 10,
    adjustmentFactor: -0.5,
    transitionOffset: index === 0
      ? 0
      : HOUR,
    duration: 0,
  }))
}

function buildUpdateTransition(lightbulb: Service, startMillis: number, entries: CurveEntry[], updateInterval = 60000): string {
  const startTime = Buffer.alloc(8)
  startTime.writeBigUInt64LE(BigInt(startMillis - EPOCH_MILLIS_2001_01_01))
  const parameters = tlv.encode(0x01, Buffer.alloc(16, 0xAB), 0x02, startTime)

  const transitionEntries = entries.map((entry) => {
    let buffer = tlv.encode(
      0x01, tlv.writeFloat32LE(entry.adjustmentFactor),
      0x02, tlv.writeFloat32LE(entry.temperature),
      0x03, tlv.writeVariableUIntLE(entry.transitionOffset),
    )
    if (entry.duration !== undefined) {
      buffer = Buffer.concat([
        buffer,
        tlv.encode(0x04, tlv.writeVariableUIntLE(entry.duration)),
      ])
    }
    return buffer
  })
  const transitionCurve = tlv.encode(
    0x01, transitionEntries,
    0x02, tlv.writeVariableUIntLE(lightbulb.getCharacteristic(Characteristic.Brightness).iid!),
    0x03, tlv.encode(0x01, tlv.writeUInt32(10), 0x02, tlv.writeUInt32(100)),
  )

  const updateIntervalBuffer = Buffer.alloc(2)
  updateIntervalBuffer.writeUInt16LE(updateInterval)
  const notifyIntervalThreshold = Buffer.alloc(4)
  notifyIntervalThreshold.writeUInt32LE(600000)

  const configuration = tlv.encode(
    0x01, tlv.writeVariableUIntLE(lightbulb.getCharacteristic(Characteristic.ColorTemperature).iid!),
    0x02, parameters,
    0x03, 1,
    0x05, transitionCurve,
    0x06, updateIntervalBuffer,
    0x08, notifyIntervalThreshold,
  )

  return tlv.encode(0x02, tlv.encode(0x01, configuration)).toString('base64')
}

async function writeTransitionControl(lightbulb: Service, value: string): Promise<unknown> {
  return lightbulb.getCharacteristic(Characteristic.CharacteristicValueTransitionControl).handleSetRequest(value)
}

describe('adaptiveLightingController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should stay active when the curve is renewed with a shorter curve', async () => {
    const { lightbulb, controller } = createController()
    const start = Date.now()

    await writeTransitionControl(lightbulb, buildUpdateTransition(lightbulb, start, curve(10)))
    vi.setSystemTime(start + 8.5 * HOUR)
    expect(controller.getCurrentAdaptiveLightingTransitionPoint()).toBeDefined()

    // the home hub renews the schedule with a curve which starts now
    await writeTransitionControl(lightbulb, buildUpdateTransition(lightbulb, Date.now(), curve(5, 300)))

    expect(controller.isAdaptiveLightingActive()).toBeTruthy()
    expect(controller.getCurrentAdaptiveLightingTransitionPoint()?.lowerBound.temperature).toBe(300)
    controller.disableAdaptiveLighting()
  })

  it('should not keep the process alive with the timer for the next update', async () => {
    const { lightbulb, controller } = createController()
    await writeTransitionControl(lightbulb, buildUpdateTransition(lightbulb, Date.now(), curve(5)))

    // @ts-expect-error: private access
    expect(controller.updateTimeout.hasRef()).toBe(false)
    vi.advanceTimersByTime(60000)
    // @ts-expect-error: private access
    expect(controller.updateTimeout.hasRef()).toBe(false)
    controller.disableAdaptiveLighting()
  })

  it.each(['my-plugin', 42, true])('should turn off after a manual color write with the context %j', async (context) => {
    const { lightbulb, controller } = createController()
    await writeTransitionControl(lightbulb, buildUpdateTransition(lightbulb, Date.now(), curve(5)))
    expect(controller.isAdaptiveLightingActive()).toBeTruthy()

    // what characteristic.setValue(300, context) does
    await expect(lightbulb.getCharacteristic(Characteristic.ColorTemperature).handleSetRequest(300, undefined, context))
      .resolves
      .toBeUndefined()

    expect(controller.isAdaptiveLightingActive()).toBeFalsy()
  })

  it('should emit disable in manual mode when a malformed request turns adaptive lighting off', async () => {
    const { lightbulb, controller } = createController(AdaptiveLightingControllerMode.MANUAL)
    const update = vi.fn()
    const disable = vi.fn()
    controller.on(AdaptiveLightingControllerEvents.UPDATE, update)
    controller.on(AdaptiveLightingControllerEvents.DISABLED, disable)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await writeTransitionControl(lightbulb, buildUpdateTransition(lightbulb, Date.now(), curve(5)))
      expect(update).toHaveBeenCalledTimes(1)

      // an update request which is missing everything but the characteristic iid and the transition flag
      const iid = lightbulb.getCharacteristic(Characteristic.ColorTemperature).iid!
      const value = tlv.encode(0x02, tlv.encode(0x01, tlv.encode(0x01, tlv.writeVariableUIntLE(iid), 0x03, 1))).toString('base64')
      await expect(writeTransitionControl(lightbulb, value)).rejects.toBe(HAPStatus.SERVICE_COMMUNICATION_FAILURE)

      expect(controller.isAdaptiveLightingActive()).toBeFalsy()
      expect(disable).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('should keep the listeners of the plugin when the controller is removed', () => {
    const { controller } = createController(AdaptiveLightingControllerMode.MANUAL)
    const update = vi.fn()
    const disable = vi.fn()
    controller.on(AdaptiveLightingControllerEvents.UPDATE, update)
    controller.on(AdaptiveLightingControllerEvents.DISABLED, disable)

    // what Accessory.removeController() does
    controller.handleFactoryReset()
    controller.handleControllerRemoved()

    expect(controller.listenerCount(AdaptiveLightingControllerEvents.UPDATE)).toBe(1)
    expect(controller.listenerCount(AdaptiveLightingControllerEvents.DISABLED)).toBe(1)
  })

  it('should accept a curve of a single entry', async () => {
    const { lightbulb, controller } = createController()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(writeTransitionControl(lightbulb, buildUpdateTransition(lightbulb, Date.now(), curve(1))))
        .resolves
        .toEqual(expect.any(String))
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      controller.disableAdaptiveLighting()
    }
  })

  describe('a time before the first point of the curve', () => {
    it('should stay active and readable when the clock is set back', async () => {
      const { lightbulb, controller } = createController()
      const start = Date.now()
      await writeTransitionControl(lightbulb, buildUpdateTransition(lightbulb, start, curve(5)))

      vi.setSystemTime(start - 10 * 60000)
      await vi.advanceTimersByTimeAsync(61000) // the next scheduled update

      expect(controller.isAdaptiveLightingActive()).toBeTruthy()
      expect(controller.getCurrentAdaptiveLightingTransitionPoint()?.lowerBound.temperature).toBe(200)
      await expect(lightbulb.getCharacteristic(Characteristic.CharacteristicValueTransitionControl).handleGetRequest())
        .resolves
        .toEqual(expect.any(String))
      controller.disableAdaptiveLighting()
    })

    it('should stay active when the first point of the curve lies in the future', async () => {
      const { lightbulb, controller } = createController()
      const entries = curve(5)
      entries[0].transitionOffset = 60000

      await writeTransitionControl(lightbulb, buildUpdateTransition(lightbulb, Date.now(), entries))

      expect(controller.isAdaptiveLightingActive()).toBeTruthy()
      controller.disableAdaptiveLighting()
    })
  })

  describe('control point errors', () => {
    it('should reject a read for another characteristic without disabling adaptive lighting', async () => {
      const { lightbulb, controller } = createController()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        await writeTransitionControl(lightbulb, buildUpdateTransition(lightbulb, Date.now(), curve(5)))

        const brightnessIID = lightbulb.getCharacteristic(Characteristic.Brightness).iid!
        const read = tlv.encode(0x01, tlv.encode(0x01, tlv.writeVariableUIntLE(brightnessIID))).toString('base64')

        await expect(writeTransitionControl(lightbulb, read)).rejects.toBe(HAPStatus.INVALID_VALUE_IN_REQUEST)
        expect(controller.isAdaptiveLightingActive()).toBeTruthy()
      } finally {
        warn.mockRestore()
        controller.disableAdaptiveLighting()
      }
    })

    it('should name the light in the warning and keep the raw value out of it', async () => {
      const { lightbulb } = createController()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        // an update request which is missing everything but the characteristic iid and the transition flag
        const iid = lightbulb.getCharacteristic(Characteristic.ColorTemperature).iid!
        const value = tlv.encode(0x02, tlv.encode(0x01, tlv.encode(0x01, tlv.writeVariableUIntLE(iid), 0x03, 1))).toString('base64')

        await expect(writeTransitionControl(lightbulb, value)).rejects.toBe(HAPStatus.SERVICE_COMMUNICATION_FAILURE)

        const messages = warn.mock.calls.map(call => String(call[0]))
        expect(messages.length).toBeGreaterThan(0)
        for (const message of messages) {
          expect(message.startsWith('[Light]')).toBeTruthy()
          expect(message).not.toContain(value)
        }
      } finally {
        warn.mockRestore()
      }
    })
  })

  describe('number edge cases', () => {
    it('should handle a curve segment with a transition time of zero', async () => {
      const { lightbulb, controller } = createController()
      const entries: CurveEntry[] = [
        {
          temperature: 200,
          adjustmentFactor: -0.5,
          transitionOffset: 0,
          duration: 0,
        },
        {
          temperature: 300,
          adjustmentFactor: -0.5,
          transitionOffset: 0,
          duration: 0,
        },
        { temperature: 400, adjustmentFactor: -0.5, transitionOffset: HOUR },
      ]

      await writeTransitionControl(lightbulb, buildUpdateTransition(lightbulb, Date.now(), entries))

      expect(controller.isAdaptiveLightingActive()).toBeTruthy()
      // 300 mired at the upper bound, adjusted by -0.5 * 50% brightness
      expect(lightbulb.getCharacteristic(Characteristic.ColorTemperature).value).toBe(275)
      controller.disableAdaptiveLighting()
    })

    it('should skip an update when the temperature is not a number instead of throwing in the timer', async () => {
      const { lightbulb, controller } = createController()
      await writeTransitionControl(lightbulb, buildUpdateTransition(lightbulb, Date.now(), curve(5)))

      lightbulb.getCharacteristic(Characteristic.Brightness).value = Number.NaN
      expect(() => vi.advanceTimersByTime(60000)).not.toThrow()
      expect(controller.isAdaptiveLightingActive()).toBeTruthy()
      // @ts-expect-error: private access
      expect(controller.updateTimeout.hasRef()).toBe(false)

      // the update loop keeps running once the brightness is a number again
      lightbulb.getCharacteristic(Characteristic.Brightness).value = 100
      vi.advanceTimersByTime(60000)
      expect(lightbulb.getCharacteristic(Characteristic.ColorTemperature).value).toBe(150)
      controller.disableAdaptiveLighting()
    })

    it('should not schedule updates more often than once per second', async () => {
      const { lightbulb, controller } = createController()
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      try {
        await writeTransitionControl(lightbulb, buildUpdateTransition(lightbulb, Date.now(), curve(5), 0))

        const delays = setTimeoutSpy.mock.calls.map(call => call[1])
        expect(delays.length).toBeGreaterThan(0)
        for (const delay of delays) {
          expect(delay).toBeGreaterThanOrEqual(1000)
        }
      } finally {
        setTimeoutSpy.mockRestore()
        controller.disableAdaptiveLighting()
      }
    })
  })
})

import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import { Accessory } from '../Accessory.js'
import { EventTriggerOption } from '../camera/index.js'
import { Characteristic } from '../Characteristic.js'
import { Service } from '../Service.js'
import * as uuid from '../util/uuid.js'
import { createCameraControllerOptions } from './CameraController.spec.js'
import { DoorbellController, DoorbellOperatingState, DoorbellOperatingStateAbnormalReason, encodeOperatingStateResponse } from './DoorbellController.js'

import '../definitions/index.js'

describe('DoorbellController', () => {
  it('event trigger options', () => {
    const controller = new DoorbellController(createCameraControllerOptions())

    // @ts-expect-error: protected access
    const options = controller.retrieveEventTriggerOptions()
    expect([...options].sort()).toEqual([EventTriggerOption.MOTION, EventTriggerOption.DOORBELL])

    controller.constructServices()
    controller.configureServices()

    expect(controller.recordingManagement).toBeTruthy()
    // @ts-expect-error: private access
    expect(controller.recordingManagement.eventTriggerOptions).toEqual(3)
  })

  describe('ringDoorbell while the controller is not added to an accessory', () => {
    it('should warn instead of throwing before configureController', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const doorbell = new DoorbellController(createCameraControllerOptions())
        expect(() => doorbell.ringDoorbell()).not.toThrow()
        expect(warn).toHaveBeenCalledTimes(1)
      } finally {
        warn.mockRestore()
      }
    })

    it('should warn instead of throwing after the controller was removed', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const accessory = new Accessory('Bell', uuid.generate('ring-after-removal'))
        const doorbell = new DoorbellController(createCameraControllerOptions())
        accessory.configureController(doorbell)
        accessory.removeController(doorbell)
        expect(() => doorbell.ringDoorbell()).not.toThrow()
        expect(warn).toHaveBeenCalledTimes(1)
      } finally {
        warn.mockRestore()
      }
    })
  })

  describe('setOperatingState', () => {
    function configured(name: string) {
      const accessory = new Accessory('Bell', uuid.generate(name))
      const doorbell = new DoorbellController(createCameraControllerOptions())
      accessory.configureController(doorbell)
      const state = () => Buffer.from(
        accessory.getService(Service.Doorbell)!.getCharacteristic(Characteristic.OperatingStateResponse).value as string,
        'base64',
      ).toString('hex')
      return { accessory, doorbell, state }
    }

    it('should not add the characteristic until it is called', () => {
      const { accessory } = configured('operating-state-unused')
      expect(accessory.getService(Service.Doorbell)!.testCharacteristic(Characteristic.OperatingStateResponse)).toBe(false)
    })

    it('should set a normal state without reasons', () => {
      const { doorbell, state } = configured('operating-state-normal')

      doorbell.setOperatingState(DoorbellOperatingState.NORMAL)
      expect(state()).toBe('010100')
    })

    it('should add the reasons together as flags', () => {
      const { doorbell, state } = configured('operating-state-reasons')

      doorbell.setOperatingState(DoorbellOperatingState.LIMITED_FUNCTIONALITY, [DoorbellOperatingStateAbnormalReason.HIGH_TEMPERATURE])
      expect(state()).toBe('010101' + '020104')

      doorbell.setOperatingState(DoorbellOperatingState.SHUTDOWN_IMMINENT, [
        DoorbellOperatingStateAbnormalReason.OTHER,
        DoorbellOperatingStateAbnormalReason.LOW_TEMPERATURE,
      ])
      expect(state()).toBe('010102' + '020103')
    })

    it('should build the same value for a doorbell service which was not made with the controller', () => {
      const hex = (value: string) => Buffer.from(value, 'base64').toString('hex')

      expect(hex(encodeOperatingStateResponse(DoorbellOperatingState.NORMAL))).toBe('010100')
      expect(hex(encodeOperatingStateResponse(DoorbellOperatingState.LIMITED_FUNCTIONALITY, [
        DoorbellOperatingStateAbnormalReason.LOW_TEMPERATURE,
        DoorbellOperatingStateAbnormalReason.HIGH_TEMPERATURE,
      ]))).toBe('010101' + '020106')
    })

    it('should warn instead of throwing while the controller is not added to an accessory', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const doorbell = new DoorbellController(createCameraControllerOptions())
        expect(() => doorbell.setOperatingState(DoorbellOperatingState.NORMAL)).not.toThrow()
        expect(warn).toHaveBeenCalledTimes(1)
      } finally {
        warn.mockRestore()
      }
    })
  })
})

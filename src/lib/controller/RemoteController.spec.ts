import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { Characteristic } from '../Characteristic.js'
import { HAPStatus } from '../HAPServer.js'
import { HAPConnectionEvent } from '../util/eventedhttp.js'
import * as tlv from '../util/tlv.js'
import { ButtonType, RemoteController, RemoteControllerEvents, SiriAudioSession, TargetUpdates } from './RemoteController.js'

const Operation = {
  LIST: 0x01,
  ADD: 0x02,
  REMOVE: 0x03,
  UPDATE: 0x05,
}

function buttonTLV(buttonId: number, buttonType: number, buttonName?: string): Buffer {
  const buffer = tlv.encode(0x01, buttonId, 0x02, tlv.writeUInt16(buttonType))
  return buttonName
    ? Buffer.concat([
        buffer,
        tlv.encode(0x03, buttonName),
      ])
    : buffer
}

function targetTLV(identifier: number, name?: string, buttons?: Buffer[]): Buffer {
  const buffers = [
    tlv.encode(0x01, tlv.writeUInt32(identifier)),
  ]
  if (name) {
    buffers.push(tlv.encode(0x02, name), tlv.encode(0x03, tlv.writeUInt16(0x18)))
  }
  if (buttons) {
    buffers.push(tlv.encode(0x04, Buffer.concat(buttons)))
  }
  return Buffer.concat(buffers)
}

function createController(): RemoteController {
  const controller = new RemoteController()
  controller.constructServices()
  controller.configureServices()
  return controller
}

async function writeTargetControl(controller: RemoteController, operation: number, target?: Buffer): Promise<string> {
  const data = target
    ? tlv.encode(0x01, operation, 0x02, target)
    : tlv.encode(0x01, operation)
  // @ts-expect-error: private access
  const characteristic = controller.targetControlManagementService!.getCharacteristic(Characteristic.TargetControlList)
  return await characteristic.handleSetRequest(data.toString('base64')) as string
}

function nextTick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function decodeTargetIdentifiers(response: string): number[] {
  const targets = tlv.decodeWithLists(Buffer.from(response, 'base64'))[0x02] ?? []
  return [targets].flat().map(target => tlv.readUInt32(tlv.decode(target)[0x01]))
}

describe('remoteController', () => {
  describe('target configurations', () => {
    it('should return the configured targets in the write response', async () => {
      const controller = createController()

      await writeTargetControl(controller, Operation.ADD, targetTLV(1, 'Living Room', [
        buttonTLV(101, 1),
      ]))
      const response = await writeTargetControl(controller, Operation.ADD, targetTLV(2, 'Bedroom', [
        buttonTLV(101, 1, 'Menu'),
      ]))

      expect(decodeTargetIdentifiers(response)).toEqual([1, 2])
      expect(decodeTargetIdentifiers(await writeTargetControl(controller, Operation.LIST))).toEqual([1, 2])
    })

    it('should refuse a new target without a name and keep working afterwards', async () => {
      const controller = createController()
      const stateChange = vi.fn()
      controller.setupStateChangeDelegate(stateChange)

      await writeTargetControl(controller, Operation.ADD, targetTLV(1, 'Living Room', [
        buttonTLV(101, 1),
      ]))
      await expect(writeTargetControl(controller, Operation.ADD, targetTLV(2, undefined, [
        buttonTLV(101, 1),
      ])))
        .rejects
        .toBe(HAPStatus.INVALID_VALUE_IN_REQUEST)
      expect(controller.isConfigured(2)).toBe(false)

      const response = await writeTargetControl(controller, Operation.ADD, targetTLV(3, 'Bedroom', [
        buttonTLV(101, 1),
      ]))

      expect(decodeTargetIdentifiers(response)).toEqual([1, 3])
      expect(stateChange).toHaveBeenCalledTimes(2)
    })

    it('should find a target by its name', async () => {
      const controller = createController()

      await writeTargetControl(controller, Operation.ADD, targetTLV(1, 'Living Room', [
        buttonTLV(101, 1),
      ]))
      await writeTargetControl(controller, Operation.ADD, targetTLV(2, 'Bedroom', [
        buttonTLV(101, 1),
      ]))

      expect(controller.getTargetIdentifierByName('Bedroom')).toBe(2)
      expect(controller.getTargetIdentifierByName('Kitchen')).toBeUndefined()
    })

    it('should serialize targets even when no target is active', async () => {
      const controller = createController()

      await writeTargetControl(controller, Operation.ADD, targetTLV(1, 'Living Room', [
        buttonTLV(101, 1),
      ]))
      controller.setActiveIdentifier(0)

      expect(controller.serialize()?.targetConfigurations[1]?.targetName).toBe('Living Room')
    })
  })

  describe('writes which are not a string', () => {
    it('should reject a target control write as an invalid value', () => {
      const controller = createController()
      const callback = vi.fn()

      // @ts-expect-error: private access
      controller.handleTargetControlWrite(5, callback)

      expect(callback).toHaveBeenCalledExactlyOnceWith(HAPStatus.INVALID_VALUE_IN_REQUEST)
    })

    it('should reject a selected audio configuration write as an invalid value', () => {
      const controller = createController()
      const callback = vi.fn()
      // @ts-expect-error: private access
      const before = controller.selectedAudioConfigurationString

      // @ts-expect-error: private access
      controller.handleSelectedAudioConfigurationWrite(5, callback)

      expect(callback).toHaveBeenCalledExactlyOnceWith(HAPStatus.INVALID_VALUE_IN_REQUEST)
      // @ts-expect-error: private access
      expect(controller.selectedAudioConfigurationString).toBe(before)
    })
  })

  describe('target removal and updates', () => {
    async function createControllerWithTargets(): Promise<RemoteController> {
      const controller = createController()
      await writeTargetControl(controller, Operation.ADD, targetTLV(1, 'Living Room', [
        buttonTLV(101, 1),
        buttonTLV(102, 2),
      ]))
      await writeTargetControl(controller, Operation.ADD, targetTLV(2, 'Bedroom', [
        buttonTLV(101, 1),
      ]))
      return controller
    }

    it('should remove a whole target when no buttons are listed', async () => {
      const controller = await createControllerWithTargets()
      const removed: number[] = []
      controller.on(RemoteControllerEvents.TARGET_REMOVED, identifier => removed.push(identifier))

      const response = await writeTargetControl(controller, Operation.REMOVE, targetTLV(2))
      await nextTick()

      expect(controller.isConfigured(2)).toBeFalsy()
      expect(decodeTargetIdentifiers(response)).toEqual([1])
      expect(removed).toEqual([2])
    })

    it('should keep the active target when another target is removed', async () => {
      const controller = await createControllerWithTargets()
      expect(controller.activeIdentifier).toBe(1)

      await writeTargetControl(controller, Operation.REMOVE, targetTLV(2))

      expect(controller.activeIdentifier).toBe(1)
    })

    it('should switch to the next target when the active target is removed', async () => {
      const controller = await createControllerWithTargets()

      await writeTargetControl(controller, Operation.REMOVE, targetTLV(1))

      expect(controller.activeIdentifier).toBe(2)
    })

    it('should only remove the listed buttons', async () => {
      const controller = await createControllerWithTargets()

      await writeTargetControl(controller, Operation.REMOVE, targetTLV(1, undefined, [
        buttonTLV(102, 2),
      ]))

      expect(controller.isConfigured(1)).toBeTruthy()
      expect(Object.keys(controller.targetConfigurations.get(1)!.buttonConfiguration)).toEqual(['101'])
    })

    it('should not report button updates when only the name was updated', async () => {
      const controller = await createControllerWithTargets()
      let updates: TargetUpdates[] = []
      controller.on(RemoteControllerEvents.TARGET_UPDATED, (_, targetUpdates) => updates = targetUpdates)

      await writeTargetControl(controller, Operation.UPDATE, targetTLV(1, 'Lounge'))
      await nextTick()

      expect(controller.targetConfigurations.get(1)!.targetName).toBe('Lounge')
      expect(updates).not.toContain(TargetUpdates.UPDATED_BUTTONS)
    })

    it('should ignore updates for unknown buttons', async () => {
      const controller = await createControllerWithTargets()

      await writeTargetControl(controller, Operation.UPDATE, targetTLV(2, undefined, [
        buttonTLV(101, 1, 'Back'),
        buttonTLV(105, 5, 'Up'),
      ]))

      const buttons = controller.targetConfigurations.get(2)!.buttonConfiguration
      expect(buttons[101].buttonName).toBe('Back')
      expect(buttons[105]).toBeUndefined()
    })
  })

  describe('buttons', () => {
    it('should not throw from the release timer when the remote was set inactive in the meantime', async () => {
      vi.useFakeTimers()
      try {
        const controller = createController()
        await writeTargetControl(controller, Operation.ADD, targetTLV(1, 'Living Room', [
          buttonTLV(101, 1),
        ]))
        const connection = new EventEmitter()
        // @ts-expect-error: private access
        controller.handleActiveWrite(true, () => {}, connection)
        expect(controller.isActive()).toBeTruthy()

        controller.pushAndReleaseButton(ButtonType.MENU, 200)
        connection.emit(HAPConnectionEvent.CLOSED)
        expect(controller.isActive()).toBeFalsy()

        expect(() => vi.advanceTimersByTime(200)).not.toThrow()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('an active target which is not configured', () => {
    it('should not mark the remote as active when the write is refused', () => {
      const controller = createController()
      controller.activeIdentifier = 5 // no target with this identifier exists
      const connection = new EventEmitter()
      const callback = vi.fn()

      // @ts-expect-error: private access
      controller.handleActiveWrite(true, callback, connection)

      expect(callback).toHaveBeenCalledExactlyOnceWith(HAPStatus.INVALID_VALUE_IN_REQUEST)
      expect(controller.isActive()).toBe(false)
      expect(connection.listenerCount(HAPConnectionEvent.CLOSED)).toBe(0)
    })

    it('should not restore an active target which is not among the saved targets', () => {
      const controller = createController()

      controller.deserialize({ activeIdentifier: 5, targetConfigurations: {} })

      expect(controller.activeIdentifier).toBe(0)
    })
  })

  describe('restoring the services', () => {
    class Producer {
      startAudioProduction = vi.fn()
      stopAudioProduction = vi.fn()
    }

    it('should create the siri services when siri was enabled for a saved remote', () => {
      const savedServices = new RemoteController().constructServices()
      expect(savedServices.siri).toBeUndefined()

      const controller = new RemoteController(Producer)
      const updated = controller.initWithServices(savedServices)

      expect(updated?.siri).toBeDefined()
      expect(updated?.audioStreamManagement).toBeDefined()
      expect(updated?.dataStreamTransportManagement).toBeDefined()
      expect(updated!.siri!.linkedServices).toEqual([updated!.dataStreamTransportManagement, updated!.audioStreamManagement])
      expect(() => controller.configureServices()).not.toThrow()
    })

    it('should remove the siri services when siri is no longer enabled', () => {
      const savedServices = new RemoteController(Producer).constructServices()
      expect(savedServices.siri).toBeDefined()

      const controller = new RemoteController()
      const updated = controller.initWithServices(savedServices)

      expect(updated).toBeDefined()
      expect(updated?.siri).toBeUndefined()
      expect(updated?.audioStreamManagement).toBeUndefined()
      expect(updated?.dataStreamTransportManagement).toBeUndefined()
      // @ts-expect-error: private access
      expect(controller.dataStreamManagement).toBeUndefined()
      expect(() => controller.configureServices()).not.toThrow()
    })

    it('should leave the saved services of a remote without siri alone', () => {
      const controller = new RemoteController()

      expect(controller.initWithServices(new RemoteController().constructServices())).toBeUndefined()
      // @ts-expect-error: private access
      expect(controller.dataStreamManagement).toBeUndefined() // no data stream server for a remote without siri
    })
  })

  describe('siri audio session', () => {
    const configuration = {
      codecType: 3,
      parameters: {
        channels: 1,
        bitrate: 0,
        samplerate: 1,
      },
    }

    // a session whose dataSend open request is answered by the test, and whose producer is fed by the test
    function createSession() {
      let frameHandler: (frame: { data: Buffer, rms: number }) => void = () => undefined
      const stopAudioProduction = vi.fn()
      class Producer {
        constructor(handler: (frame: { data: Buffer, rms: number }) => void) {
          frameHandler = handler
        }

        startAudioProduction = vi.fn()
        stopAudioProduction = stopAudioProduction
      }

      let answerOpen: (error?: Error, status?: number, message?: Record<string, unknown>) => void = () => undefined
      const connection = Object.assign(new EventEmitter(), {
        sendRequest: vi.fn((_protocol, _topic, _message, callback) => answerOpen = callback),
        sendEvent: vi.fn(),
      })

      // @ts-expect-error: the connection and the producer are minimal fakes
      const session = new SiriAudioSession(connection, configuration, Producer)
      session.start()

      return {
        session,
        connection,
        stopAudioProduction,
        produce: (count: number) => {
          for (let i = 0; i < count; i++) {
            frameHandler({
              data: Buffer.from([i]),
              rms: 0.5,
            })
          }
        },
        open: () => answerOpen(undefined, 0, { streamId: 1 }),
        dataEvents: () => connection.sendEvent.mock.calls
          .filter(call => call[1] === 'data')
          .map(call => ({ frames: call[2].packets.length as number, endOfStream: call[2].endOfStream as boolean })),
      }
    }

    it('should send every queued frame when the stream ends, with endOfStream on the last packet only', () => {
      const { session, produce, open, dataEvents } = createSession()

      produce(12) // while the stream is still being opened
      open()
      expect(dataEvents()).toEqual([
        { frames: 5, endOfStream: false },
        { frames: 5, endOfStream: false },
      ])

      produce(9)
      session.stop()

      expect(dataEvents()).toEqual([
        { frames: 5, endOfStream: false },
        { frames: 5, endOfStream: false },
        { frames: 5, endOfStream: false },
        { frames: 5, endOfStream: false },
        { frames: 1, endOfStream: true },
      ])
    })

    it('should not take a message without a stream id for a session which is still starting', () => {
      const { session, open } = createSession()
      const closed = vi.fn()
      session.on('close', closed)
      const controller = createController()
      // @ts-expect-error: private access
      controller.activeAudioSession = session

      // @ts-expect-error: private access
      expect(() => controller.handleDataSendAckEvent({ endOfStream: true })).not.toThrow()
      // @ts-expect-error: private access
      controller.handleDataSendCloseEvent({ reason: 0 })
      expect(closed).not.toHaveBeenCalled()

      // an acknowledgment which does not report the end of the stream is ignored as well
      open()
      // @ts-expect-error: private access
      expect(() => controller.handleDataSendAckEvent({ streamId: 1, endOfStream: false })).not.toThrow()
      expect(closed).not.toHaveBeenCalled()

      // @ts-expect-error: private access
      controller.handleDataSendAckEvent({ streamId: 1, endOfStream: true })
      expect(closed).toHaveBeenCalledTimes(1)
    })

    it('should stop sending and stay closed after a packet could not be sent', () => {
      const { session, connection, stopAudioProduction, produce, open } = createSession()
      const closed = vi.fn()
      session.on('close', closed)
      connection.sendEvent.mockImplementation(() => {
        throw new Error('could not encode the message')
      })

      produce(24) // while the stream is still being opened
      open()

      expect(connection.sendEvent).toHaveBeenCalledTimes(1)
      expect(stopAudioProduction).toHaveBeenCalledTimes(1)
      expect(closed).toHaveBeenCalledTimes(1)
      expect(session.isClosing()).toBe(true)
    })

    it('should stay closed when the last packet could not be sent on stop', () => {
      const { session, connection, stopAudioProduction, produce, open } = createSession()
      open()
      produce(2)
      connection.sendEvent.mockImplementation(() => {
        throw new Error('could not encode the message')
      })

      session.stop()

      expect(stopAudioProduction).toHaveBeenCalledTimes(1)
      expect(session.state).toBe(3) // SiriAudioSessionState.CLOSED, and not back to CLOSING
    })

    it('should stop the audio producer when the controller refuses the stream', async () => {
      const startAudioProduction = vi.fn()
      const stopAudioProduction = vi.fn()
      class Producer {
        startAudioProduction = startAudioProduction
        stopAudioProduction = stopAudioProduction
      }

      const connection = Object.assign(new EventEmitter(), {
        // the controller answers the dataSend open request with a non-zero status
        sendRequest: vi.fn((_protocol, _topic, _message, callback) => setTimeout(callback, 0, undefined, 1, {})),
        sendEvent: vi.fn(),
      })
      const configuration = {
        codecType: 3,
        parameters: {
          channels: 1,
          bitrate: 0,
          samplerate: 1,
        },
      }

      // @ts-expect-error: the connection is a minimal fake
      const session = new SiriAudioSession(connection, configuration, Producer)
      const closed = new Promise<void>(resolve => session.on('close', resolve))
      session.start()
      await closed

      expect(startAudioProduction).toHaveBeenCalledTimes(1)
      expect(stopAudioProduction).toHaveBeenCalledTimes(1)
    })
  })
})

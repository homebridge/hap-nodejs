import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import process from 'node:process'

import { describe, expect, it, vi } from 'vitest'

import { Characteristic } from '../Characteristic.js'
import { MockDelegate, mockRecordingOptions } from '../controller/CameraController.spec.js'
import {
  AudioRecordingCodecType,
  AudioRecordingSamplerate,
  CameraRecordingConfiguration,
  EventTriggerOption,
  MediaContainerType,
  RecordingManagement,
  RecordingPacket,
} from './RecordingManagement.js'
import { AudioBitrate, H264Level, H264Profile, VideoCodecType } from './RTPStreamManagement.js'

describe('recordingManagement', () => {
  it('handleSelectedCameraRecordingConfiguration', () => {
    const base64Input = 'AR0BBKAPAAACCAEAAAAAAAAAAwsBAQACBgEEoA8AAAIkAQEAAhIBAQECAQIDBNAHAAAEBKAPAAADCwECsAQCAkAGAwEYAxQBAQACDwEBAQIBAAMBAwQEQAAAAA=='

    const management = new RecordingManagement(
      mockRecordingOptions,
      new MockDelegate(),
      new Set([EventTriggerOption.MOTION, EventTriggerOption.DOORBELL]),
    )

    // @ts-expect-error: private access
    management.handleSelectedCameraRecordingConfigurationWrite(base64Input)

    // @ts-expect-error: private access
    expect(management.handleSelectedCameraRecordingConfigurationRead())
      .toEqual(base64Input)

    // @ts-expect-error: private access
    const configuration = management.selectedConfiguration
    expect(configuration).toBeDefined()
    expect(configuration!.base64).toEqual(base64Input)

    const expected: CameraRecordingConfiguration = {
      prebufferLength: 4000,
      eventTriggerTypes: [EventTriggerOption.MOTION],
      mediaContainerConfiguration: { type: MediaContainerType.FRAGMENTED_MP4, fragmentLength: 4000 },
      videoCodec: {
        type: VideoCodecType.H264,
        parameters: {
          profile: H264Profile.MAIN,
          level: H264Level.LEVEL4_0,
          bitRate: 2000,
          iFrameInterval: 4000,
        },
        resolution: [1200, 1600, 24],
      },
      audioCodec: {
        type: AudioRecordingCodecType.AAC_LC,
        audioChannels: 1,
        samplerate: AudioRecordingSamplerate.KHZ_32,
        bitrateMode: AudioBitrate.VARIABLE,
        bitrate: 64,
      },
    }
    expect(configuration!.parsed).toEqual(expected)
  })

  it('should tell the delegate when recording is turned on again after a factory reset', async () => {
    const delegate = new MockDelegate()
    const updateRecordingActive = vi.spyOn(delegate, 'updateRecordingActive')
    const management = new RecordingManagement(
      mockRecordingOptions,
      delegate,
      new Set([EventTriggerOption.MOTION, EventTriggerOption.DOORBELL]),
    )
    const active = management.recordingManagementService.getCharacteristic(Characteristic.Active)

    await active.handleSetRequest(1)
    management.handleFactoryReset()
    expect(management.serialize()?.recordingActive).toBeFalsy()

    updateRecordingActive.mockClear()
    await active.handleSetRequest(1)

    expect(updateRecordingActive).toHaveBeenCalledExactlyOnceWith(true)
  })

  describe('dataSend open', () => {
    function managementReadyToRecord(delegate = new MockDelegate()): RecordingManagement {
      const management = new RecordingManagement(
        mockRecordingOptions,
        delegate,
        new Set([EventTriggerOption.MOTION, EventTriggerOption.DOORBELL]),
      )
      const internals = management as any
      internals.recordingActive = true
      internals.selectedConfiguration = {}
      internals.operatingModeService.getCharacteristic(Characteristic.HomeKitCameraActive).value = true
      return management
    }

    function fakeConnection(sendResponse: () => void) {
      return Object.assign(new EventEmitter(), {
        remoteAddress: '127.0.0.1',
        sendResponse: vi.fn(sendResponse),
        sendEvent: vi.fn(),
        addProtocolHandler: vi.fn(() => true),
        removeProtocolHandler: vi.fn(),
        isConsideredClosed: () => false,
      })
    }

    it('should free the stream instead of rejecting when the open response can not be sent', async () => {
      const unhandled: unknown[] = []
      const onUnhandled = (reason: unknown) => unhandled.push(reason)
      process.on('unhandledRejection', onUnhandled)
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        const management = managementReadyToRecord()
        const connection = fakeConnection(() => {
          throw new Error('Cannot send message on closing/closed socket!')
        })

        ;(management as any).handleDataSendOpen(connection, 1, {
          streamId: 5,
          type: 'ipcamera.recording',
          target: 'controller',
          reason: 'record',
        })
        await new Promise(resolve => setTimeout(resolve, 10))

        expect(connection.sendResponse).toHaveBeenCalledTimes(1)
        expect(unhandled).toEqual([])
        expect((management as any).recordingStream).toBeUndefined() // the next open is not answered with "busy"
      } finally {
        process.off('unhandledRejection', onUnhandled)
        error.mockRestore()
      }
    })

    it('should signal the end of the stream when the last packet has no data', async () => {
      class EmptyLastPacketDelegate extends MockDelegate {
        async* handleRecordingStreamRequest(): AsyncGenerator<RecordingPacket> {
          yield {
            data: Buffer.alloc(100, 1),
            isLast: false,
          }
          yield {
            data: Buffer.alloc(0),
            isLast: false,
          } // skipped, without using up a sequence number
          yield {
            data: Buffer.alloc(50, 2),
            isLast: false,
          }
          yield {
            data: Buffer.alloc(0),
            isLast: true,
          }
        }
      }
      const management = managementReadyToRecord(new EmptyLastPacketDelegate())
      const connection = fakeConnection(() => undefined)

      ;(management as any).handleDataSendOpen(connection, 1, {
        streamId: 5,
        type: 'ipcamera.recording',
        target: 'controller',
        reason: 'record',
      })
      await new Promise(resolve => setTimeout(resolve, 10))

      const events = connection.sendEvent.mock.calls.map(call => ({
        length: call[2].packets[0].data.length,
        sequenceNumber: call[2].packets[0].metadata.dataSequenceNumber,
        endOfStream: call[2].endOfStream,
      }))
      expect(events).toEqual([
        { length: 100, sequenceNumber: 1, endOfStream: false },
        { length: 50, sequenceNumber: 2, endOfStream: false },
        { length: 0, sequenceNumber: 3, endOfStream: true },
      ])
      ;(management as any).recordingStream?.close(0)
    })

    it('should ignore an acknowledgment for another stream', async () => {
      class WaitingDelegate extends MockDelegate {
        acknowledgeStream = vi.fn()

        async* handleRecordingStreamRequest(): AsyncGenerator<RecordingPacket> {
          yield {
            data: Buffer.alloc(10, 1),
            isLast: false,
          }
          await new Promise(resolve => setTimeout(resolve, 1000)) // still recording
        }
      }
      const delegate = new WaitingDelegate()
      const management = managementReadyToRecord(delegate)
      const connection = fakeConnection(() => undefined)

      ;(management as any).handleDataSendOpen(connection, 1, {
        streamId: 5,
        type: 'ipcamera.recording',
        target: 'controller',
        reason: 'record',
      })
      await new Promise(resolve => setTimeout(resolve, 10))
      const stream = (management as any).recordingStream

      stream.handleDataSendAck({ streamId: 999, endOfStream: true })
      expect(delegate.acknowledgeStream).not.toHaveBeenCalled()
      expect((management as any).recordingStream).toBe(stream)

      stream.handleDataSendAck({ streamId: 5, endOfStream: true })
      expect(delegate.acknowledgeStream).toHaveBeenCalledExactlyOnceWith(5)
      expect((management as any).recordingStream).toBeUndefined()
    })

    it('should reject an open without a numeric stream id', () => {
      const management = managementReadyToRecord()
      const connection = fakeConnection(() => undefined)

      ;(management as any).handleDataSendOpen(connection, 1, {
        streamId: 'five',
        type: 'ipcamera.recording',
        target: 'controller',
      })

      expect(connection.sendResponse).toHaveBeenCalledExactlyOnceWith('dataSend', 'open', 1, 6, {
        status: 5,
      })
      expect((management as any).recordingStream).toBeUndefined()
    })
  })

  it('supported configuration', () => {
    const management = new RecordingManagement(
      {
        prebufferLength: 8000,
        mediaContainerConfiguration: {
          type: MediaContainerType.FRAGMENTED_MP4,
          fragmentLength: 4000,
        },
        video: {
          type: VideoCodecType.H264,
          parameters: {
            profiles: [H264Profile.MAIN],
            levels: [H264Level.LEVEL3_1, H264Level.LEVEL4_0],
          },
          resolutions: [
            [1600, 1200, 24],
            [1440, 1080, 24],
            [1280, 960, 24],
            [1024, 768, 24],
            [1600, 1200, 15],
            [1440, 1080, 15],
            [1280, 960, 15],
            [1024, 768, 15],
            [1200, 1600, 24],
            [1080, 1440, 24],
            [960, 1280, 24],
            [768, 1024, 24],
            [1200, 1600, 15],
            [1080, 1440, 15],
            [960, 1280, 15],
            [768, 1024, 15],
          ],
        },
        audio: {
          codecs: [
            {
              type: AudioRecordingCodecType.AAC_LC,
              audioChannels: 1,
              bitrateMode: AudioBitrate.VARIABLE,
              samplerate: AudioRecordingSamplerate.KHZ_32,
            },
          ],
        },
      },
      new MockDelegate(),
      new Set([EventTriggerOption.MOTION, EventTriggerOption.DOORBELL]),
    )

    const supportedRecording = management.recordingManagementService
      .getCharacteristic(Characteristic.SupportedCameraRecordingConfiguration)
      .value
    const supportedVideo = management.recordingManagementService
      .getCharacteristic(Characteristic.SupportedVideoRecordingConfiguration)
      .value
    const supportedAudio = management.recordingManagementService
      .getCharacteristic(Characteristic.SupportedAudioRecordingConfiguration)
      .value

    expect(supportedRecording).toEqual('AQRAHwAAAggDAAAAAAAAAAMLAQEAAgYBBKAPAAA=')
    expect(supportedVideo).toEqual('Af4BAQACCwEBAQIBAAAAAgECAwsBAkAGAgKwBAMBGAAAAwsBAqAFAgI4BAMBGAAAAwsBAgAFAgLAAwMBGAAAAwsBAgAEAgIAAwMBGAAAAwsBAk'
      + 'AGAgKwBAMBDwAAAwsBAqAFAgI4BAMBDwAAAwsBAgAFAgLAAwMBDwAAAwsBAgAEAgIAAwMBDwAAAwsBArAEAgJABgMBGAAAAwsBAjgEAgKgBQMBGAAAAwsBAsADAgIABQMBGAAAAwsBAgADAgIABA'
      + 'MBGAAAAwsBArAEAgJABgMBDwAAAwsBAjgEAgKgBQMBDwAAAwsBAsADAgIABQMBDwAAAwsBAgADAgIABAMBDw==')
    expect(supportedAudio).toEqual('AQ4BAQACCQEBAQIBAAMBAw==')
  })
})

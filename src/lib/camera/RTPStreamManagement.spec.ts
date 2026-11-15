import type { MockInstance } from 'vitest'

import type {
  CameraRecordingOptions,
  RecordingPacket,
} from '../camera/index.js'
import type {
  CameraControllerOptions,
  CameraRecordingDelegate,
  CameraStreamingDelegate,
  PrepareStreamCallback,
} from '../controller/index.js'
import type { HAPConnection } from '../util/eventedhttp.js'
import type {
  CameraStreamingOptions,
  RTPStreamManagement,
} from './RTPStreamManagement.js'

import { Buffer } from 'node:buffer'
import util from 'node:util'

import createDebug from 'debug'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AudioBitrate,
  AudioRecordingCodecType,
  AudioRecordingSamplerate,
  AudioStreamingCodecType,
  AudioStreamingSamplerate,
  H264Level,
  H264Profile,
  MediaContainerType,
  VideoCodecType,
} from '../camera/index.js'
import { Characteristic } from '../Characteristic.js'
import {
  CameraController,
} from '../controller/index.js'
import { HAPStatus } from '../HAPServer.js'
import * as tlv from '../util/tlv.js'
import * as uuid from '../util/uuid.js'
import RTPProxy from './RTPProxy.js'
import {
  SRTPCryptoSuites,
} from './RTPStreamManagement.js'

import '../definitions/index.js'

class MockDelegate implements CameraStreamingDelegate, CameraRecordingDelegate {
  handleSnapshotRequest(): void {
    throw new Error('Unsupported!')
  }

  handleStreamRequest(): void {
    throw new Error('Unsupported!')
  }

  prepareStream(): void {
    throw new Error('Unsupported!')
  }

  async* handleRecordingStreamRequest(): AsyncGenerator<RecordingPacket> {
    yield {
      data: Buffer.alloc(64, 0),
      isLast: true,
    }
  }

  closeRecordingStream(): void {}

  updateRecordingActive(): void {}

  updateRecordingConfiguration(): void {}
}

const baseStreamingOptions: CameraStreamingOptions = {
  supportedCryptoSuites: [SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
  video: {
    codec: {
      profiles: [H264Profile.BASELINE, H264Profile.MAIN, H264Profile.HIGH],
      levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
    },
    resolutions: [
      [1920, 1080, 30],
      [1280, 720, 30],
      [320, 240, 15],
    ],
  },
  audio: {
    twoWayAudio: true,
    codecs: [
      {
        type: AudioStreamingCodecType.AAC_ELD,
        samplerate: AudioStreamingSamplerate.KHZ_24,
      },
    ],
  },
}

const baseRecordingOptions: CameraRecordingOptions = {
  prebufferLength: 4000,
  mediaContainerConfiguration: [
    {
      type: MediaContainerType.FRAGMENTED_MP4,
      fragmentLength: 8000,
    },
  ],
  video: {
    type: VideoCodecType.H264,
    parameters: baseStreamingOptions.video.codec,
    resolutions: baseStreamingOptions.video.resolutions,
  },
  audio: {
    codecs: [
      {
        type: AudioRecordingCodecType.AAC_ELD,
        audioChannels: 1,
        bitrateMode: AudioBitrate.VARIABLE,
        samplerate: AudioRecordingSamplerate.KHZ_48,
      },
    ],
  },
}

function buildControllerOptions(streamingOptions: CameraStreamingOptions): CameraControllerOptions {
  const delegate = new MockDelegate()
  return {
    cameraStreamCount: 2,
    delegate,
    streamingOptions,
    recording: {
      options: baseRecordingOptions,
      delegate,
    },
    sensors: { motion: true, occupancy: true },
  }
}

// matches the private enums in RTPStreamManagement.ts
const SetupEndpointsTypes = {
  SESSION_ID: 0x01,
  CONTROLLER_ADDRESS: 0x03,
  VIDEO_SRTP_PARAMETERS: 0x04,
  AUDIO_SRTP_PARAMETERS: 0x05,
} as const
const AddressTypes = {
  ADDRESS_VERSION: 0x01,
  ADDRESS: 0x02,
  VIDEO_RTP_PORT: 0x03,
  AUDIO_RTP_PORT: 0x04,
} as const
const SRTPParametersTypes = {
  SRTP_CRYPTO_SUITE: 0x01,
  MASTER_KEY: 0x02,
  MASTER_SALT: 0x03,
} as const

function buildSetupEndpointsTlv(withPorts = true, sessionId = '11111111-1111-1111-1111-111111111111'): string {
  const addressTlv = withPorts
    ? tlv.encode(
        AddressTypes.ADDRESS_VERSION, 0x00, // IPV4
        AddressTypes.ADDRESS, '127.0.0.1',
        AddressTypes.VIDEO_RTP_PORT, tlv.writeUInt16(5000),
        AddressTypes.AUDIO_RTP_PORT, tlv.writeUInt16(5001),
      )
    : tlv.encode(
        AddressTypes.ADDRESS_VERSION, 0x00, // IPV4
        AddressTypes.ADDRESS, '127.0.0.1',
      )
  const srtpTlv = tlv.encode(
    SRTPParametersTypes.SRTP_CRYPTO_SUITE, SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80,
    SRTPParametersTypes.MASTER_KEY, Buffer.alloc(16),
    SRTPParametersTypes.MASTER_SALT, Buffer.alloc(14),
  )
  const payload = tlv.encode(
    SetupEndpointsTypes.SESSION_ID, uuid.write(sessionId),
    SetupEndpointsTypes.CONTROLLER_ADDRESS, addressTlv,
    SetupEndpointsTypes.VIDEO_SRTP_PARAMETERS, srtpTlv,
    SetupEndpointsTypes.AUDIO_SRTP_PARAMETERS, srtpTlv,
  )
  return payload.toString('base64')
}

function buildMockConnection(): HAPConnection {
  return {
    localAddress: '127.0.0.1',
    getLocalAddress: vi.fn().mockReturnValue('127.0.0.1'),
    setMaxListeners: vi.fn(),
    getMaxListeners: vi.fn().mockReturnValue(10),
    on: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as HAPConnection
}

describe('RTPStreamManagement', () => {
  describe('streaming options shared by all streams', () => {
    it('should leave the lists of the plugin alone', () => {
      const options: CameraStreamingOptions = {
        ...baseStreamingOptions,
        supportedCryptoSuites: [],
        audio: {
          codecs: [],
        },
      }

      const controller = new CameraController(buildControllerOptions(options))
      controller.constructServices()

      expect(options.audio?.codecs).toEqual([])
      expect(options.supportedCryptoSuites).toEqual([])
      // without a codec there is no audio, and that holds for every stream, not only for the first
      expect(controller.streamManagements.map(management => management.videoOnly)).toEqual([true, true])
      controller.handleFactoryReset()
    })

    it('should not merge legacy codec entries inside the options of the plugin', () => {
      const codecs = [
        { type: AudioStreamingCodecType.OPUS, samplerate: AudioStreamingSamplerate.KHZ_16 },
        { type: AudioStreamingCodecType.OPUS, samplerate: AudioStreamingSamplerate.KHZ_24 },
      ]
      const options: CameraStreamingOptions = {
        ...baseStreamingOptions,
        audio: { codecs },
      }

      const controller = new CameraController(buildControllerOptions(options))
      controller.constructServices()

      expect(codecs).toEqual([
        { type: AudioStreamingCodecType.OPUS, samplerate: AudioStreamingSamplerate.KHZ_16 },
        { type: AudioStreamingCodecType.OPUS, samplerate: AudioStreamingSamplerate.KHZ_24 },
      ])
      controller.handleFactoryReset()
    })
  })

  describe('_handleStartStream malformed TLV', () => {
    let controller: CameraController

    beforeEach(() => {
      controller = new CameraController(buildControllerOptions(baseStreamingOptions))
      controller.constructServices()
      controller.configureServices()
    })

    afterEach(() => {
      controller.handleFactoryReset()
    })

    it('empty video configuration should call callback with INVALID_VALUE_IN_REQUEST', () => {
      const rtp = controller.streamManagements[0] as RTPStreamManagement
      const callback = vi.fn();

      // empty video/audio config — every indexed buffer access (e.g.
      // `videoParameters[VideoCodecParametersTypes.PROFILE_ID][0]`) would
      // throw without the try/catch from 34056583.

      (rtp as any)._handleStartStream({}, {}, callback)

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback.mock.calls[0][0]).toBe(HAPStatus.INVALID_VALUE_IN_REQUEST)
    })

    it('video configuration missing CODEC_PARAMETERS should not throw', () => {
      const rtp = controller.streamManagements[0] as RTPStreamManagement
      const callback = vi.fn()

      // SelectedVideoParametersTypes.CODEC_TYPE = 0x01 — provide that but
      // omit CODEC_PARAMETERS / ATTRIBUTES / RTP_PARAMETERS so the inner
      // `tlv.decode(undefined)` would have crashed without the guard.
      const videoConfig = {
        0x01: Buffer.from([0x00]),
      }

      expect(() => {
        (rtp as any)._handleStartStream(videoConfig, {}, callback)
      }).not.toThrow()

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback.mock.calls[0][0]).toBe(HAPStatus.INVALID_VALUE_IN_REQUEST)
    })
  })

  describe('debug output', () => {
    it('should not contain the SRTP keys of a stream', () => {
      const controller = new CameraController(buildControllerOptions(baseStreamingOptions))
      controller.constructServices()
      controller.configureServices()
      const rtp = controller.streamManagements[0] as RTPStreamManagement
      vi.spyOn(MockDelegate.prototype, 'prepareStream').mockImplementation(() => undefined)

      const namespaces = createDebug.disable()
      createDebug.enable('HAP-NodeJS:Camera:RTPStreamManagement')
      const lines: string[] = []
      const log = vi.spyOn(createDebug, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(util.format(...args))
      })
      try {
        // @ts-expect-error: private method access
        rtp.handleSetupEndpoints(buildSetupEndpointsTlv(), vi.fn(), buildMockConnection())

        const output = lines.join('\n')
        expect(output).toContain('11111111-1111-1111-1111-111111111111') // the line with the session was written
        expect(output).not.toContain('Master')
        expect(output).not.toContain('<Buffer')
      } finally {
        log.mockRestore()
        createDebug.enable(namespaces)
        vi.restoreAllMocks()
        controller.handleFactoryReset()
      }
    })
  })

  describe('a failed reconfigure', () => {
    it('should tell the delegate to stop the stream of the session it gives up', () => {
      const controller = new CameraController(buildControllerOptions(baseStreamingOptions))
      controller.constructServices()
      controller.configureServices()
      const rtp = controller.streamManagements[0] as RTPStreamManagement
      const sessionId = '11111111-1111-1111-1111-111111111111'
      rtp.sessionIdentifier = sessionId // a stream is running

      const requests: string[] = []
      const handleStreamRequest = (request: { type: string }, callback: (error?: Error) => void) => {
        requests.push(request.type)
        callback(request.type === 'reconfigure'
          ? new Error('could not change the resolution')
          : undefined)
      }
      vi.spyOn(MockDelegate.prototype, 'handleStreamRequest').mockImplementation(handleStreamRequest as () => void)

      const maxBitRate = Buffer.alloc(2)
      maxBitRate.writeUInt16LE(300)
      const reconfigure = tlv.encode(
        0x01, tlv.encode(0x01, uuid.write(sessionId), 0x02, 0x04), // session control: RECONFIGURE_SESSION
        0x02, tlv.encode(
          0x03, tlv.encode(0x01, tlv.writeUInt16(1280), 0x02, tlv.writeUInt16(720), 0x03, 30), // attributes
          0x04, tlv.encode(0x03, maxBitRate, 0x04, tlv.writeFloat32LE(0.5)), // rtp parameters
        ),
      ).toString('base64')
      const callback = vi.fn()

      try {
        // @ts-expect-error: private method access
        rtp._handleSelectedStreamConfigurationWrite(reconfigure, callback)

        expect(callback).toHaveBeenCalledTimes(1)
        expect(callback.mock.calls[0][0]).toBeInstanceOf(Error)
        expect(requests).toEqual(['reconfigure', 'stop'])
        expect(rtp.sessionIdentifier).toBeUndefined()
      } finally {
        vi.restoreAllMocks()
        controller.handleFactoryReset()
      }
    })
  })

  describe('handleSetupEndpoints proxy rejection', () => {
    let controller: CameraController
    let setupSpy: MockInstance

    beforeEach(() => {
      const proxyOptions: CameraStreamingOptions = {
        ...baseStreamingOptions,
        proxy: true,
      }
      controller = new CameraController(buildControllerOptions(proxyOptions))
      controller.constructServices()
      controller.configureServices()
    })

    afterEach(() => {
      setupSpy?.mockRestore()
      controller.handleFactoryReset()
    })

    it('should free the stream and answer when the local address can not be found', () => {
      const rtp = controller.streamManagements[0] as RTPStreamManagement
      const connection = buildMockConnection()
      vi.mocked(connection.getLocalAddress).mockImplementation(() => {
        throw new Error('Could not find ipv4 address for interface en0')
      })
      const callback = vi.fn()

      expect(() => {
        // @ts-expect-error: private method access
        rtp.handleSetupEndpoints(buildSetupEndpointsTlv(), callback, connection)
      }).not.toThrow()

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback.mock.calls[0][0]).toBeInstanceOf(Error)
      expect(rtp.streamStatus).toBe(0) // StreamingStatus.AVAILABLE
      expect(rtp.sessionIdentifier).toBeUndefined()
    })

    it('should fail gracefully when RTPProxy.setup rejects', async () => {
      setupSpy = vi.spyOn(RTPProxy.prototype, 'setup')
        .mockImplementation(() => Promise.reject(new Error('socket creation failed')))

      const rtp = controller.streamManagements[0] as RTPStreamManagement
      const error = await new Promise<Error | undefined>((resolve) => {
        // @ts-expect-error: private method access
        rtp.handleSetupEndpoints(buildSetupEndpointsTlv(), (err) => {
          resolve(err as Error | undefined)
        }, buildMockConnection())
      })

      expect(error).toBeInstanceOf(Error)
      expect(error!.message).toBe('socket creation failed')
    })

    it('should set setupEndpointsResponse to ERROR status when proxy setup rejects', async () => {
      setupSpy = vi.spyOn(RTPProxy.prototype, 'setup')
        .mockImplementation(() => Promise.reject(new Error('bind failed')))

      const rtp = controller.streamManagements[0] as RTPStreamManagement
      await new Promise<void>((resolve) => {
        // @ts-expect-error: private method access
        rtp.handleSetupEndpoints(buildSetupEndpointsTlv(), () => resolve(), buildMockConnection())
      })

      const response = (rtp as any).setupEndpointsResponse as string
      const decoded = tlv.decode(Buffer.from(response, 'base64'))
      // SetupEndpointsResponseTypes.STATUS = 0x02; SetupEndpointsStatus.ERROR = 0x02
      expect(decoded[0x02].readUInt8(0)).toBe(0x02)
    })
  })

  describe('handleSetupEndpoints with a session which ends while the proxy sockets are bound', () => {
    let controller: CameraController

    beforeEach(() => {
      controller = new CameraController(buildControllerOptions({
        ...baseStreamingOptions,
        proxy: true,
      }))
      controller.constructServices()
      controller.configureServices()
    })

    afterEach(() => {
      vi.restoreAllMocks()
      controller.handleFactoryReset()
    })

    it('should not ask the delegate to prepare the ended session, also when the next session started', async () => {
      const bound: (() => void)[] = []
      vi.spyOn(RTPProxy.prototype, 'setup').mockImplementation(() => new Promise<void>(resolve => bound.push(resolve)))
      vi.spyOn(RTPProxy.prototype, 'incomingRTPPort').mockReturnValue(10000)
      vi.spyOn(RTPProxy.prototype, 'incomingRTCPPort').mockReturnValue(10001)
      const prepareStream = vi.spyOn(MockDelegate.prototype, 'prepareStream').mockImplementation(() => undefined)

      const rtp = controller.streamManagements[0] as RTPStreamManagement
      const first = vi.fn()
      const second = vi.fn()

      // @ts-expect-error: private method access
      rtp.handleSetupEndpoints(buildSetupEndpointsTlv(), first, buildMockConnection())
      // @ts-expect-error: private method access
      rtp.handleSessionClosed() // e.g. the connection closed
      // @ts-expect-error: private method access
      rtp.handleSetupEndpoints(buildSetupEndpointsTlv(true, '22222222-2222-2222-2222-222222222222'), second, buildMockConnection())

      expect(bound).toHaveLength(4) // video and audio of both sessions
      bound.reverse().forEach(resolve => resolve()) // the sockets of the ended session are ready last
      await new Promise(resolve => setImmediate(resolve))

      expect(first).toHaveBeenCalledExactlyOnceWith(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      expect(prepareStream).toHaveBeenCalledTimes(1)
      expect((prepareStream.mock.calls[0] as unknown[])[0]).toMatchObject({
        sessionID: '22222222-2222-2222-2222-222222222222',
        video: { proxy_rtp: 10000, proxy_rtcp: 10001 },
        audio: { proxy_rtp: 10000, proxy_rtcp: 10001 },
      })
      expect(second).not.toHaveBeenCalled() // still waits for the delegate
    })
  })

  describe('handleSetupEndpoints malformed TLV', () => {
    let controller: CameraController

    beforeEach(() => {
      controller = new CameraController(buildControllerOptions(baseStreamingOptions))
      controller.constructServices()
      controller.configureServices()
    })

    afterEach(() => {
      controller.handleFactoryReset()
    })

    it('should reject a request without ports and not keep the stream busy', async () => {
      const rtp = controller.streamManagements[0] as RTPStreamManagement
      const callback = vi.fn()

      expect(() => {
        // @ts-expect-error: private method access
        rtp.handleSetupEndpoints(buildSetupEndpointsTlv(false), callback, buildMockConnection())
      }).not.toThrow()

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback.mock.calls[0][0]).toBe(HAPStatus.INVALID_VALUE_IN_REQUEST)
      expect(rtp.streamStatus).toBe(0) // StreamingStatus.AVAILABLE
      expect(rtp.sessionIdentifier).toBeUndefined()

      // the next valid request must not be answered with BUSY
      await new Promise<void>((resolve) => {
        // @ts-expect-error: private method access
        rtp.handleSetupEndpoints(buildSetupEndpointsTlv(), () => resolve(), buildMockConnection())
      })
      const decoded = tlv.decode(Buffer.from((rtp as any).setupEndpointsResponse as string, 'base64'))
      // SetupEndpointsResponseTypes.STATUS = 0x02; SetupEndpointsStatus.BUSY = 0x01
      expect(decoded[0x02].readUInt8(0)).not.toBe(0x01)
    })
  })

  describe('handleSetupEndpoints while another session holds the stream', () => {
    let controller: CameraController

    beforeEach(() => {
      controller = new CameraController(buildControllerOptions(baseStreamingOptions))
      controller.constructServices()
      controller.configureServices()
    })

    afterEach(() => {
      vi.restoreAllMocks()
      controller.handleFactoryReset()
    })

    it('should answer busy to the connection which asked and keep the response of the active session', async () => {
      const rtp = controller.streamManagements[0] as RTPStreamManagement
      vi.spyOn(MockDelegate.prototype, 'prepareStream').mockImplementation(((_request: unknown, callback: PrepareStreamCallback) => callback(undefined, {
        video: {
          port: 5000,
          ssrc: 1,
          srtp_key: Buffer.alloc(16),
          srtp_salt: Buffer.alloc(14),
        },
        audio: {
          port: 5001,
          ssrc: 2,
          srtp_key: Buffer.alloc(16),
          srtp_salt: Buffer.alloc(14),
        },
      })) as () => void)
      const characteristic = rtp.getService().getCharacteristic(Characteristic.SetupEndpoints)
      const read = async (connection: HAPConnection) => tlv.decode(Buffer.from(await characteristic.handleGetRequest(connection) as string, 'base64'))
      const sessionA = '11111111-1111-1111-1111-111111111111'
      const sessionB = '22222222-2222-2222-2222-222222222222'
      const connectionA = buildMockConnection()
      const connectionB = buildMockConnection()

      await new Promise<void>((resolve) => {
        // @ts-expect-error: private method access
        rtp.handleSetupEndpoints(buildSetupEndpointsTlv(true, sessionA), () => resolve(), connectionA)
      })
      const responseA = await read(connectionA)
      // SetupEndpointsResponseTypes: SESSION_ID = 0x01, STATUS = 0x02; SetupEndpointsStatus: SUCCESS = 0x00, BUSY = 0x01
      expect(uuid.unparse(responseA[0x01])).toBe(sessionA)
      expect(responseA[0x02].readUInt8(0)).toBe(0x00)

      const callbackB = vi.fn()
      // @ts-expect-error: private method access
      rtp.handleSetupEndpoints(buildSetupEndpointsTlv(true, sessionB), callbackB, connectionB)
      expect(callbackB).toHaveBeenCalledExactlyOnceWith()

      // the controller which asked reads the answer for its own request, like before
      const responseB = await read(connectionB)
      expect(uuid.unparse(responseB[0x01])).toBe(sessionB)
      expect(responseB[0x02].readUInt8(0)).toBe(0x01)
      expect(Object.keys(responseB)).toEqual(['1', '2'])

      // the session which holds the stream still has its response
      expect(await read(connectionA)).toEqual(responseA)
      expect(tlv.decode(Buffer.from(rtp.setupEndpointsResponse, 'base64'))).toEqual(responseA)
      expect(await read(connectionB)).toEqual(responseB)

      // once the stream is free again, everybody reads the default response, like before
      // @ts-expect-error: private method access
      rtp.handleSessionClosed()
      const idle = tlv.decode(Buffer.from(rtp.setupEndpointsResponse, 'base64'))
      expect(await read(connectionB)).toEqual(idle)
      expect(await read(connectionA)).toEqual(idle)
    })
  })

  describe('handleSetupEndpoints invalid PrepareStreamResponse', () => {
    let controller: CameraController

    beforeEach(() => {
      controller = new CameraController(buildControllerOptions(baseStreamingOptions))
      controller.constructServices()
      controller.configureServices()
    })

    afterEach(() => {
      vi.restoreAllMocks()
      controller.handleFactoryReset()
    })

    it.each([
      [
        'an error',
        (callback: PrepareStreamCallback) => callback(new Error('camera offline')),
      ],
      [
        'a response',
        (callback: PrepareStreamCallback) => callback(undefined, {
          video: {
            port: 5000,
            ssrc: 1,
            srtp_key: Buffer.alloc(16),
            srtp_salt: Buffer.alloc(14),
          },
          audio: {
            port: 5001,
            ssrc: 2,
            srtp_key: Buffer.alloc(16),
            srtp_salt: Buffer.alloc(14),
          },
        }),
      ],
    ])('should ignore %s for a session which ended while it was prepared', async (_name, answer) => {
      const rtp = controller.streamManagements[0] as RTPStreamManagement
      const prepareCallbacks: PrepareStreamCallback[] = []
      const prepareStream = (_request: unknown, callback: PrepareStreamCallback) => {
        prepareCallbacks.push(callback)
      }
      vi.spyOn(MockDelegate.prototype, 'prepareStream').mockImplementation(prepareStream as () => void)
      const sessionA = '11111111-1111-1111-1111-111111111111'
      const sessionB = '22222222-2222-2222-2222-222222222222'
      const callbackA = vi.fn()
      const callbackB = vi.fn()

      // @ts-expect-error: private method access
      rtp.handleSetupEndpoints(buildSetupEndpointsTlv(true, sessionA), callbackA, buildMockConnection())
      await vi.waitFor(() => expect(prepareCallbacks).toHaveLength(1))
      // @ts-expect-error: private method access
      rtp.handleSessionClosed() // e.g. the HAP connection closed while the delegate is still preparing
      // @ts-expect-error: private method access
      rtp.handleSetupEndpoints(buildSetupEndpointsTlv(true, sessionB), callbackB, buildMockConnection())
      await vi.waitFor(() => expect(prepareCallbacks).toHaveLength(2))
      const responseBefore = (rtp as any).setupEndpointsResponse

      answer(prepareCallbacks[0]) // the late answer for the first session

      expect(callbackA).toHaveBeenCalledExactlyOnceWith(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      expect(callbackB).not.toHaveBeenCalled()
      expect(rtp.sessionIdentifier).toEqual(sessionB)
      expect(rtp.streamStatus).toBe(1) // StreamingStatus.IN_USE
      expect((rtp as any).setupEndpointsResponse).toBe(responseBefore)
    })

    it('should answer with an error when a delayed response is missing the audio info', async () => {
      const rtp = controller.streamManagements[0] as RTPStreamManagement
      const prepareStream = (_request: unknown, callback: PrepareStreamCallback) => {
        // like most plugins, call back after some asynchronous work
        setTimeout(() => callback(undefined, {
          video: {
            port: 5000,
            ssrc: 1,
            srtp_key: Buffer.alloc(16),
            srtp_salt: Buffer.alloc(14),
          },
        }), 1)
      }
      vi.spyOn(MockDelegate.prototype, 'prepareStream').mockImplementation(prepareStream as () => void)

      const errors: Error[] = []
      const onUncaught = (error: Error) => errors.push(error)
      process.on('uncaughtException', onUncaught)

      try {
        const error = await new Promise<Error | undefined>((resolve, reject) => {
          setTimeout(() => reject(new Error('SetupEndpoints callback was never called')), 500)
          // @ts-expect-error: private method access
          rtp.handleSetupEndpoints(buildSetupEndpointsTlv(), err => resolve(err as Error | undefined), buildMockConnection())
        })

        expect(error).toBeInstanceOf(Error)
      } finally {
        process.off('uncaughtException', onUncaught)
      }

      expect(errors).toEqual([])
      expect(rtp.streamStatus).toBe(0) // StreamingStatus.AVAILABLE
      const decoded = tlv.decode(Buffer.from((rtp as any).setupEndpointsResponse as string, 'base64'))
      // SetupEndpointsResponseTypes.STATUS = 0x02; SetupEndpointsStatus.ERROR = 0x02
      expect(decoded[0x02].readUInt8(0)).toBe(0x02)
    })
  })
})

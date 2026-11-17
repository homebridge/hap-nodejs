import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { Characteristic } from '../Characteristic.js'
import { Service } from '../Service.js'
import { decodeErrorStatus, encodeErrorStatus, ErrorStatusCode } from './error-status.js'

const hex = (value: string) => Buffer.from(value, 'base64').toString('hex')

describe('error-status', () => {
  it('should encode no faults as an empty value', () => {
    expect(encodeErrorStatus([])).toBe('')
    expect(decodeErrorStatus('')).toEqual([])
  })

  it('should encode one fault', () => {
    expect(hex(encodeErrorStatus([
      { code: ErrorStatusCode.JAMMED },
    ]))).toBe('0103010108')
    expect(encodeErrorStatus([
      { code: ErrorStatusCode.JAMMED },
    ])).toBe('AQMBAQg=')
  })

  it('should split several faults by an empty entry, and put the manufacturer text in the second field', () => {
    const faults = [
      { code: ErrorStatusCode.DEVICE_OVERHEATING, manufacturerErrorInfo: 'E42' },
      { code: ErrorStatusCode.FREEZE_RISK },
    ]

    const value = encodeErrorStatus(faults)
    expect(hex(value)).toBe('0108010109' + '0203453432' + '0000' + '010301010c')
    expect(decodeErrorStatus(value)).toEqual(faults)
  })

  it('should number the 15 faults 0 to 14, in the order of Apple\'s own list', () => {
    const codes = Object.values(ErrorStatusCode).filter(value => typeof value === 'number')

    expect(codes).toEqual([
      ...Array.from({ length: 15 }).keys(),
    ])
    expect(ErrorStatusCode[8]).toBe('JAMMED')
    expect(ErrorStatusCode[12]).toBe('FREEZE_RISK')
  })

  it('should refuse an entry without an error code', () => {
    expect(() => decodeErrorStatus(Buffer.from('010302014f', 'hex').toString('base64'))).toThrow('without an error code')
  })

  it('should be accepted as the value of the characteristic on any service', () => {
    const characteristic = new Service.LockMechanism('Lock').addCharacteristic(Characteristic.ErrorStatus)
    const value = encodeErrorStatus([
      { code: ErrorStatusCode.JAMMED },
    ])

    characteristic.updateValue(value)
    expect(characteristic.value).toBe(value)
    expect(decodeErrorStatus(characteristic.value as string)).toEqual([
      { code: ErrorStatusCode.JAMMED },
    ])
  })
})

import { describe, expect, it } from 'vitest'

import { errorMessage, errorStack } from './errors.js'

describe('#errorMessage()', () => {
  it('should return the message of an Error', () => {
    expect(errorMessage(new Error('something failed'))).toBe('something failed')
    expect(errorMessage(new TypeError('wrong type'))).toBe('wrong type')
  })

  it('should keep an empty Error message empty', () => {
    const error = new Error('placeholder')
    error.message = ''

    expect(errorMessage(error)).toBe('')
  })

  it('should return the message of an object with a string message', () => {
    expect(errorMessage({ message: 'from an object' })).toBe('from an object')
  })

  it('should fall back to the string form when the message is not a string', () => {
    expect(errorMessage({ message: 42 })).toBe('[object Object]')
  })

  it('should return a thrown string as it is', () => {
    expect(errorMessage('just a string')).toBe('just a string')
  })

  it('should return the string form of undefined, null and a number', () => {
    expect(errorMessage(undefined)).toBe('undefined')
    expect(errorMessage(null)).toBe('null')
    expect(errorMessage(-70402)).toBe('-70402')
  })
})

describe('#errorStack()', () => {
  it('should return the stack of an Error', () => {
    const error = new Error('something failed')

    expect(errorStack(error)).toBe(error.stack)
    expect(errorStack(error)).toContain('something failed')
  })

  it('should return the stack of an object with a string stack', () => {
    expect(errorStack({ stack: 'a stack' })).toBe('a stack')
  })

  it('should return undefined when there is no string stack', () => {
    const error = new Error('no stack')
    delete error.stack

    expect(errorStack(error)).toBeUndefined()
    expect(errorStack({ message: 'only a message' })).toBeUndefined()
    expect(errorStack({ stack: 42 })).toBeUndefined()
    expect(errorStack('just a string')).toBeUndefined()
    expect(errorStack(undefined)).toBeUndefined()
    expect(errorStack(null)).toBeUndefined()
    expect(errorStack(-70402)).toBeUndefined()
  })
})

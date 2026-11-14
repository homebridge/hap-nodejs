import { vi } from 'vitest'

// like the real library, stop() and destroy() report back through their callback

class Advertisement {
  updateTxt = vi.fn()
  stop = vi.fn((callback?: () => void) => {
    setImmediate(() => callback?.())
  })

  destroy = vi.fn()
}

class BonjourService {
  publish = vi.fn(() => {
    return new Advertisement()
  })

  destroy = vi.fn((callback?: () => void) => {
    setImmediate(() => callback?.())
  })
}

export default (): BonjourService => {
  return new BonjourService()
}

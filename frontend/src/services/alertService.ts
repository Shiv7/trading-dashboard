// Audio Alert Service using Web Audio API
// Generates tones programmatically - no external audio files needed

class AlertService {
  private audioContext: AudioContext | null = null
  private enabled: boolean = true
  private volume: number = 0.5

  constructor() {
    // Load settings from localStorage
    this.enabled = localStorage.getItem('alertSound') !== 'false'
    const savedVolume = localStorage.getItem('alertVolume')
    if (savedVolume) this.volume = parseFloat(savedVolume)
  }

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)()
    }
    return this.audioContext
  }

  private playTone(frequency: number, duration: number, type: OscillatorType = 'sine') {
    if (!this.enabled) return

    try {
      const ctx = this.getAudioContext()
      const oscillator = ctx.createOscillator()
      const gainNode = ctx.createGain()

      oscillator.type = type
      oscillator.frequency.setValueAtTime(frequency, ctx.currentTime)

      // Envelope for smooth sound
      gainNode.gain.setValueAtTime(0, ctx.currentTime)
      gainNode.gain.linearRampToValueAtTime(this.volume, ctx.currentTime + 0.02)
      gainNode.gain.linearRampToValueAtTime(this.volume * 0.7, ctx.currentTime + duration * 0.5)
      gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + duration)

      oscillator.connect(gainNode)
      gainNode.connect(ctx.destination)

      oscillator.start(ctx.currentTime)
      oscillator.stop(ctx.currentTime + duration)
    } catch (err) {
      console.warn('Audio alert failed:', err)
    }
  }

  private playChord(frequencies: number[], duration: number) {
    frequencies.forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, duration * 0.8), i * 50)
    })
  }

  // Different alert sounds for different signal types
  playSignalAlert(type: 'bullish' | 'bearish' | 'neutral' | 'critical') {
    switch (type) {
      case 'bullish':
        // Ascending major chord - uplifting
        this.playChord([523.25, 659.25, 783.99], 0.3) // C5, E5, G5
        break
      case 'bearish':
        // Descending minor - warning
        this.playChord([493.88, 587.33, 659.25], 0.3) // B4, D5, E5
        break
      case 'critical':
        // Double beep - urgent
        this.playTone(880, 0.15, 'square')
        setTimeout(() => this.playTone(880, 0.15, 'square'), 200)
        break
      case 'neutral':
      default:
        // Simple notification ping
        this.playTone(659.25, 0.15) // E5
        break
    }
  }

  playTradeAlert(type: 'entry' | 'exit' | 'sl_hit' | 'tp_hit') {
    switch (type) {
      case 'entry':
        // Quick double beep
        this.playTone(784, 0.1)
        setTimeout(() => this.playTone(1047, 0.15), 120)
        break
      case 'tp_hit':
        // Victory fanfare (ascending)
        this.playChord([523, 659, 784, 1047], 0.4)
        break
      case 'sl_hit':
        // Low warning tone
        this.playTone(220, 0.4, 'triangle')
        break
      case 'exit':
        // Neutral close sound
        this.playTone(440, 0.2)
        break
    }
  }

  playXFactor() {
    // Special X-Factor sound - attention grabbing
    this.playTone(440, 0.1)
    setTimeout(() => this.playTone(554.37, 0.1), 100)
    setTimeout(() => this.playTone(659.25, 0.1), 200)
    setTimeout(() => this.playTone(880, 0.3), 300)
  }

  // Settings
  setEnabled(enabled: boolean) {
    this.enabled = enabled
    localStorage.setItem('alertSound', enabled.toString())
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume))
    localStorage.setItem('alertVolume', this.volume.toString())
  }

  getVolume(): number {
    return this.volume
  }

  // Test sound
  playTest() {
    this.playSignalAlert('bullish')
  }
}

export const alertService = new AlertService()

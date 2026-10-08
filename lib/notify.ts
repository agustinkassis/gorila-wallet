"use client"

// Browsers only allow audio after a user gesture: create/resume the AudioContext on the first one.
let audio: AudioContext | undefined
if (typeof window !== "undefined") {
  const unlock = () => {
    audio ??= new AudioContext()
    void audio.resume()
  }
  window.addEventListener("pointerdown", unlock, { once: true })
  window.addEventListener("keydown", unlock, { once: true })
}

/** Short two-note "coin" chime, synthesized (no asset to ship). Silent until the page has had a user gesture. */
export function playChime() {
  if (!audio || audio.state !== "running") return
  const t = audio.currentTime
  ;[988, 1319].forEach((freq, i) => {
    const start = t + i * 0.11
    const osc = audio!.createOscillator()
    const gain = audio!.createGain()
    osc.type = "triangle"
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.7)
    osc.connect(gain).connect(audio!.destination)
    osc.start(start)
    osc.stop(start + 0.75)
  })
}

export const canNotify = () => typeof window !== "undefined" && "Notification" in window

export function requestNotifications() {
  if (canNotify() && Notification.permission === "default") void Notification.requestPermission()
}

/** OS notification, only when the tab is in the background (otherwise the toast is enough). */
export function systemNotify(title: string, body: string) {
  if (!canNotify() || Notification.permission !== "granted" || !document.hidden) return
  const n = new Notification(title, { body, icon: "/icon.svg", tag: title + body })
  n.onclick = () => {
    window.focus()
    n.close()
  }
}

window.__ModuleLoader__.load({
  id: 'dsh-plugin-read-aloud',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    const NS = 'readAloud'
    const ENDPOINT = '/read-aloud'
    const RATE_KEY = 'read-aloud.rate'
    const VOICE_KEY = 'read-aloud.voice'
    const RATES = [0.75, 1, 1.25, 1.5]
    const EDGE_RATE = { '0.75': '-25%', '1': '+0%', '1.25': '+25%', '1.5': '+50%' }
    const VOICES = [
      { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓' },
      { id: 'zh-CN-XiaoyiNeural', label: '晓伊' },
      { id: 'zh-CN-YunxiNeural', label: '云希' },
      { id: 'zh-CN-YunjianNeural', label: '云健' },
      { id: 'zh-CN-YunyangNeural', label: '云扬' },
      { id: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北' },
    ]
    const MAX_CHUNK = 600
    const SOURCE = '[data-text-interaction-source]'

    const zh = {
      'readAloud.selection': '朗读选中',
      'readAloud.whole': '朗读整条',
      'readAloud.stop': '停止朗读',
      'readAloud.rate': '语速',
      'readAloud.voice': '音色',
      'readAloud.builtin': '内置语音',
    }

    const en = {
      'readAloud.selection': 'Read selection',
      'readAloud.whole': 'Read entire reply',
      'readAloud.stop': 'Stop reading',
      'readAloud.rate': 'Speed',
      'readAloud.voice': 'Voice',
      'readAloud.builtin': 'Built-in voice',
    }

    const listeners = new Set()
    let speaking = false
    let engine = 'unknown'
    let lastSource = null
    let run = null
    let healthUntil = 0
    let healthResult = false

    function synthesis() {
      return typeof window === 'undefined' ? undefined : window.speechSynthesis
    }

    function publish(next) {
      if (next && typeof next.speaking === 'boolean') speaking = next.speaking
      if (next && typeof next.engine === 'string') engine = next.engine
      const state = { speaking, engine }
      for (const listener of listeners) listener(state)
    }

    function chunk(text, size) {
      const parts = []
      for (const line of String(text).split(/\r?\n/)) {
        let rest = line.trim()
        while (rest.length > size) {
          let cut = 0
          for (const mark of ['。', '！', '？', '；', '. ', '! ', '? ', '; ']) {
            const at = rest.lastIndexOf(mark, size)
            if (at >= 0 && at + mark.length > cut) cut = at + mark.length
          }
          if (cut === 0) cut = size
          parts.push(rest.slice(0, cut))
          rest = rest.slice(cut)
        }
        if (rest !== '') parts.push(rest)
      }
      return parts
    }

    async function serverReady() {
      const now = Date.now()
      if (now < healthUntil) return healthResult
      try {
        const response = await fetch(ENDPOINT + '/health', { cache: 'no-store' })
        healthResult = response.ok
      } catch {
        healthResult = false
      }
      healthUntil = now + (healthResult ? 30000 : 5000)
      return healthResult
    }

    function stop() {
      if (run !== null) {
        run.cancelled = true
        if (run.audio !== null) {
          try {
            run.audio.pause()
          } catch {
            /* already detached */
          }
        }
        if (typeof run.cancel === 'function') run.cancel()
        run = null
      }
      const synth = synthesis()
      if (synth) synth.cancel()
      publish({ speaking: false })
    }

    function speakBrowser(text, rate) {
      const synth = synthesis()
      if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') return
      const parts = chunk(text, 180)
      let index = 0
      const next = () => {
        if (index >= parts.length) {
          publish({ speaking: false })
          return
        }
        const utterance = new window.SpeechSynthesisUtterance(parts[index++])
        utterance.lang = 'zh-CN'
        utterance.rate = rate
        utterance.onend = next
        utterance.onerror = () => publish({ speaking: false })
        synth.speak(utterance)
      }
      next()
    }

    function audioUrl(part, options) {
      const rate = EDGE_RATE[String(options.rate)] || '+0%'
      return ENDPOINT + '/tts?voice=' + encodeURIComponent(options.voice)
        + '&rate=' + encodeURIComponent(rate)
        + '&text=' + encodeURIComponent(part)
    }

    function partsForStreaming(text) {
      const parts = chunk(text, MAX_CHUNK)
      if (parts.length > 0 && parts[0].length > 120) {
        // Speak a short first piece so sound starts before the long one is ready.
        const head = parts[0]
        let cut = 0
        for (const mark of ['。', '！', '？', '；', '. ', '! ', '? ', '; ', '，', ', ']) {
          const at = head.lastIndexOf(mark, 120)
          if (at >= 0 && at + mark.length > cut) cut = at + mark.length
        }
        if (cut > 0) parts.splice(0, 1, head.slice(0, cut), head.slice(cut))
      }
      return parts.filter(part => part.trim() !== '')
    }

    async function speakServer(text, options, current) {
      const parts = partsForStreaming(text)
      const make = part => {
        const audio = new Audio(audioUrl(part, options))
        audio.preload = 'auto'
        return audio
      }
      let pending = make(parts[0])
      pending.load()
      for (let index = 0; index < parts.length; index += 1) {
        if (current.cancelled) return
        const audio = pending
        const following = index + 1 < parts.length ? make(parts[index + 1]) : null
        if (following !== null) following.load()
        pending = following
        current.audio = audio
        const finished = await new Promise((resolve, reject) => {
          current.cancel = () => resolve(false)
          audio.onended = () => resolve(true)
          audio.onerror = () => reject(new Error('audio playback failed'))
          audio.play().catch(reject)
        })
        if (!finished) return
        current.audio = null
        current.cancel = null
      }
    }

    async function speak(text, options) {
      stop()
      if (text === null || text === undefined || String(text).trim() === '') return
      const current = { cancelled: false, audio: null, cancel: null }
      run = current
      publish({ speaking: true })
      try {
        if (await serverReady()) {
          publish({ engine: 'server' })
          await speakServer(String(text), options, current)
        } else {
          console.warn('[read-aloud] 本地语音服务不可用，改用浏览器内置语音')
          publish({ engine: 'browser' })
          speakBrowser(String(text), options.rate)
        }
      } catch (error) {
        if (!current.cancelled) {
          console.warn('[read-aloud] 神经网络语音失败，改用浏览器内置语音', error)
          publish({ engine: 'browser' })
          speakBrowser(String(text), options.rate)
        }
      } finally {
        if (run === current) {
          run = null
          if (!current.cancelled) publish({ speaking: false })
        }
      }
    }

    function stored(key, fallback, allowed) {
      try {
        const value = window.localStorage.getItem(key)
        if (value !== null && allowed.includes(value)) return value
      } catch {
        /* storage may be unavailable in a private window */
      }
      return fallback
    }

    function remember(key, value) {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        /* storage may be unavailable in a private window */
      }
    }

    function sourceElement() {
      if (lastSource && lastSource.isConnected) return lastSource
      const selection = typeof document === 'undefined' ? null : document.getSelection()
      const anchor = selection && selection.anchorNode ? selection.anchorNode : null
      const element = anchor instanceof Element ? anchor : (anchor ? anchor.parentElement : null)
      return element ? element.closest(SOURCE) : null
    }

    function wholeReplyText() {
      const element = sourceElement()
      if (element === null) return null
      const text = (element.innerText || element.textContent || '').trim()
      return text === '' ? null : text
    }

    const pill = {
      padding: '5px 10px',
      border: 'none',
      borderRadius: '999px',
      background: 'var(--dsw-alias-button-floating-fill, rgba(127,127,127,0.12))',
      boxShadow: 'var(--dsw-elevation-panel, 0 2px 8px rgba(0,0,0,0.18))',
      color: 'var(--dsw-alias-label-primary, inherit)',
      font: 'inherit',
      fontSize: '13px',
      lineHeight: '1.3',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }

    function ReadAloudAction({ dismiss, readText, t }) {
      const [state, setState] = useState({ speaking, engine })
      const [rate, setRate] = useState(() => Number(stored(RATE_KEY, '1', RATES.map(String))))
      const [voice, setVoice] = useState(() => stored(VOICE_KEY, VOICES[0].id, VOICES.map(v => v.id)))

      useEffect(() => {
        const listener = value => setState(value)
        listeners.add(listener)
        setState({ speaking, engine })
        void serverReady().then(ok => publish({ engine: ok ? 'server' : 'browser' }))
        return () => {
          listeners.delete(listener)
        }
      }, [])

      const options = () => ({ rate, voice })
      const active = state.speaking

      const toggle = event => {
        event.preventDefault()
        event.stopPropagation()
        if (active) {
          stop()
          return
        }
        speak(readText(), options())
      }

      const whole = event => {
        event.preventDefault()
        event.stopPropagation()
        if (active) {
          stop()
          return
        }
        speak(wholeReplyText(), options())
      }

      const speed = event => {
        event.preventDefault()
        event.stopPropagation()
        const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]
        setRate(next)
        remember(RATE_KEY, String(next))
      }

      const switchVoice = event => {
        event.preventDefault()
        event.stopPropagation()
        const index = VOICES.findIndex(item => item.id === voice)
        const next = VOICES[(index + 1) % VOICES.length].id
        setVoice(next)
        remember(VOICE_KEY, next)
      }

      const label = active ? t('readAloud.stop') : t('readAloud.selection')
      const chosen = (VOICES.find(item => item.id === voice) || VOICES[0]).label
      const voiceLabel = state.engine === 'browser' ? t('readAloud.builtin') : chosen
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
        h('button', {
          type: 'button',
          style: pill,
          title: label,
          'aria-label': label,
          onPointerDown: event => event.preventDefault(),
          onClick: toggle,
        }, (active ? '⏹ ' : '🔊 ') + label),
        h('button', {
          type: 'button',
          style: pill,
          title: t('readAloud.whole'),
          'aria-label': t('readAloud.whole'),
          onPointerDown: event => event.preventDefault(),
          onClick: whole,
        }, '📄 ' + t('readAloud.whole')),
        h('button', {
          type: 'button',
          style: pill,
          title: t('readAloud.voice'),
          'aria-label': t('readAloud.voice'),
          onPointerDown: event => event.preventDefault(),
          onClick: switchVoice,
        }, '🗣 ' + voiceLabel),
        h('button', {
          type: 'button',
          style: pill,
          title: t('readAloud.rate'),
          'aria-label': t('readAloud.rate'),
          onPointerDown: event => event.preventDefault(),
          onClick: speed,
        }, rate + '×'),
      )
    }

    return {
      inject: ['slots', 'locale', 'uiConversation'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'read-aloud: dictionaries')
        ctx.effect(() => {
          const track = event => {
            const element = event.target instanceof Element ? event.target : null
            lastSource = element === null ? null : element.closest(SOURCE)
          }
          document.addEventListener('contextmenu', track, true)
          return () => {
            document.removeEventListener('contextmenu', track, true)
            lastSource = null
            stop()
          }
        }, 'read-aloud: reply source tracking')
        ctx.effect(() => ctx.uiConversation.interactions.register({
          id: 'read-aloud',
          onInteraction(request) {
            if (request.trigger === 'selection') {
              if (request.readText() === null) return
              request.open()
              return
            }
            request.open()
          },
        }), 'read-aloud: text interaction')
        ctx.slots.inject('conversation.chat.text-interaction', () => ctx.slots.register({
          name: 'conversation.chat.text-interaction', key: 'read-aloud', locale: NS,
        }, ReadAloudAction))
      },
    }
  },
})

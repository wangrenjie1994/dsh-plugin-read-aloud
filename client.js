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
      'readAloud.fromHere': '从当前读',
      'readAloud.whole': '朗读整条',
      'readAloud.stop': '停止朗读',
      'readAloud.rate': '语速',
      'readAloud.voice': '音色',
      'readAloud.builtin': '内置语音',
      'readAloud.copy': '复制',
    }

    const en = {
      'readAloud.selection': 'Read selection',
      'readAloud.fromHere': 'Read from here',
      'readAloud.whole': 'Read entire reply',
      'readAloud.stop': 'Stop reading',
      'readAloud.rate': 'Speed',
      'readAloud.voice': 'Voice',
      'readAloud.builtin': 'Built-in voice',
      'readAloud.copy': 'Copy',
    }

    const listeners = new Set()
    let speaking = false
    let engine = 'unknown'
    let lastSource = null
    let run = null
    let healthUntil = 0
    let healthResult = false
    let panelRequested = false

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

    // Only letters, digits, whitespace and ordinary punctuation can be spoken.
    // Box drawing, arrows, emoji, symbols and control characters cannot, so they
    // are replaced before anything reaches a speech engine.
    const UNSPEAKABLE = /[^\p{L}\p{N}\s.,!?;:'"()[\]{}\/\-_+=%&@#$*<>~|^，。！？；：、（）《》「」『』【】…—～·“”‘’]/gu
    const SPEAKABLE = /[\p{L}\p{N}]/u

    function speakable(text) {
      return SPEAKABLE.test(String(text))
    }

    /** Drop every character a speech engine cannot voice and every line left empty. */
    function sanitize(text) {
      return String(text)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/g, '')
        .replace(UNSPEAKABLE, ' ')
        .split(/\r?\n/)
        .map(line => line.replace(/[ \t]+/g, ' ').trim())
        .filter(line => speakable(line))
        .join('\n')
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
      const parts = chunk(sanitize(text), 180)
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
        utterance.onerror = next
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
      const parts = chunk(sanitize(text), MAX_CHUNK)
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
      return parts.filter(part => speakable(part))
    }

    let player = null

    /** One media element for every piece: a reused element keeps playback allowed
     *  after the gesture, and it can never sit in a half-preloaded state. */
    function playerElement() {
      if (player === null || !player.isConnected) {
        player = new Audio()
        player.preload = 'auto'
        player.style.display = 'none'
        if (typeof document !== 'undefined' && document.body !== null) document.body.appendChild(player)
      }
      return player
    }

    async function fetchPiece(url) {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) throw new Error('speech service returned ' + response.status)
      const blob = await response.blob()
      if (blob.size === 0) throw new Error('empty audio')
      return URL.createObjectURL(blob)
    }

    function playBlob(objectUrl, current) {
      const audio = playerElement()
      current.audio = audio
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          audio.onended = null
          audio.onerror = null
          current.cancel = null
        }
        current.cancel = () => {
          try {
            audio.pause()
          } catch {
            /* already detached */
          }
          cleanup()
          resolve(false)
        }
        audio.onended = () => {
          cleanup()
          resolve(true)
        }
        audio.onerror = () => {
          cleanup()
          reject(new Error('audio playback failed'))
        }
        audio.src = objectUrl
        audio.play().catch(error => {
          cleanup()
          reject(error)
        })
      })
    }

    async function speakServer(text, options, current) {
      const parts = partsForStreaming(text)
      if (parts.length === 0) return
      let skipped = 0
      let next = fetchPiece(audioUrl(parts[0], options))
      for (let index = 0; index < parts.length; index += 1) {
        if (current.cancelled) {
          next.catch(() => {})
          return
        }
        let job = next
        next = index + 1 < parts.length ? fetchPiece(audioUrl(parts[index + 1], options)) : null
        if (next !== null) next.catch(() => {})
        let played = false
        for (let attempt = 0; attempt < 2 && !played; attempt += 1) {
          let objectUrl = null
          try {
            objectUrl = await job
            if (current.cancelled) return
            played = await playBlob(objectUrl, current)
          } catch (error) {
            console.warn(`[read-aloud] 第 ${index + 1}/${parts.length} 段播放失败`, error)
            job = fetchPiece(audioUrl(parts[index], options))
          } finally {
            if (objectUrl !== null) URL.revokeObjectURL(objectUrl)
          }
        }
        if (!played) {
          skipped += 1
          console.warn(`[read-aloud] 跳过第 ${index + 1} 段`)
          continue
        }
        current.spoken = true
        current.audio = null
      }
      if (skipped > 0) console.warn(`[read-aloud] 共跳过 ${skipped} 段读不出来的内容`)
    }

    async function speak(text, options) {
      stop()
      const clean = sanitize(text)
      if (clean.trim() === '') return
      const current = { cancelled: false, audio: null, cancel: null, spoken: false }
      run = current
      publish({ speaking: true })
      try {
        if (await serverReady()) {
          publish({ engine: 'server' })
          await speakServer(clean, options, current)
        } else {
          console.warn('[read-aloud] 本地语音服务不可用，改用浏览器内置语音')
          publish({ engine: 'browser' })
          speakBrowser(clean, options.rate)
          current.spoken = true
        }
      } catch (error) {
        // Never restart a message that already started: only an untouched message
        // may still fall back, and it falls back once for the whole text.
        if (current.cancelled) return
        if (!current.spoken) {
          console.warn('[read-aloud] 神经网络语音不可用，改用浏览器内置语音', error)
          publish({ engine: 'browser' })
          speakBrowser(clean, options.rate)
        } else {
          console.warn('[read-aloud] 朗读中断，已读内容不会重读', error)
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

    /** Everything from the start of the selection to the end of the reply. */
    function textFromSelection() {
      const selection = typeof document === 'undefined' ? null : document.getSelection()
      if (selection === null || selection.rangeCount === 0) return wholeReplyText()
      const range = selection.getRangeAt(0)
      const source = sourceElement()
      if (source === null || !source.contains(range.startContainer)) return range.toString()
      try {
        const tail = document.createRange()
        tail.selectNodeContents(source)
        tail.setStart(range.startContainer, range.startOffset)
        return tail.toString()
      } catch {
        return range.toString()
      }
    }

    const panel = {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: '4px',
      padding: '6px',
      borderRadius: '12px',
      background: 'var(--dsw-alias-button-floating-fill, rgba(127,127,127,0.12))',
      boxShadow: 'var(--dsw-elevation-panel, 0 2px 8px rgba(0,0,0,0.18))',
      color: 'var(--dsw-alias-label-primary, inherit)',
      fontSize: '12px',
      lineHeight: '1.2',
      maxWidth: '264px',
    }

    const cell = {
      border: 'none',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      padding: '5px 6px',
      borderRadius: '8px',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      textAlign: 'center',
    }

    function ReadAloudAction({ readText, t }) {
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
      const selected = readText()

      const start = getText => event => {
        event.preventDefault()
        event.stopPropagation()
        if (active) {
          stop()
          return
        }
        speak(getText(), options())
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

      const copy = event => {
        event.preventDefault()
        event.stopPropagation()
        const text = selected === null ? (wholeReplyText() ?? '') : selected
        if (text !== '' && typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(text).catch(() => {})
        }
      }

      const chosen = (VOICES.find(item => item.id === voice) || VOICES[0]).label
      const voiceLabel = state.engine === 'browser' ? t('readAloud.builtin') : chosen
      const button = (text, title, onClick, extra) => h('button', {
        type: 'button',
        style: extra === undefined ? cell : { ...cell, ...extra },
        title,
        'aria-label': title,
        onPointerDown: event => event.preventDefault(),
        onClick,
      }, text)

      return h('div', { style: panel },
        button(active ? '⏹ ' + t('readAloud.stop') : '🔊 ' + t('readAloud.selection'),
          active ? t('readAloud.stop') : t('readAloud.selection'),
          start(() => selected),
          active ? { background: 'var(--dsw-alias-button-floating-hover, rgba(127,127,127,0.22))' } : undefined),
        button('▶ ' + t('readAloud.fromHere'), t('readAloud.fromHere'), start(textFromSelection)),
        button('📄 ' + t('readAloud.whole'), t('readAloud.whole'), start(wholeReplyText)),
        button('🗣 ' + voiceLabel, t('readAloud.voice'), switchVoice),
        button(rate + '×', t('readAloud.rate'), speed),
        button('⧉ ' + t('readAloud.copy'), t('readAloud.copy'), copy),
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
            // Plain right-click keeps the browser menu. Shift adds the reading
            // gesture, and only then is that menu replaced by the action panel.
            panelRequested = event.shiftKey === true
            if (panelRequested) event.preventDefault()
          }
          document.addEventListener('contextmenu', track, true)
          return () => {
            document.removeEventListener('contextmenu', track, true)
            lastSource = null
            panelRequested = false
            stop()
            if (player !== null) {
              player.remove()
              player = null
            }
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
            if (!panelRequested) return
            request.preventDefault()
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

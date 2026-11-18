/** Host half of the read-aloud bundle: runs the local service and proxies it on the DSH origin. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const PORT = 17865
const LOCAL = `http://127.0.0.1:${PORT}`
const ROUTE = '/read-aloud'

/** The browser reaches the speech service same-origin through this route. */
export const inject = ['webServer']

/** Locate a Python that has edge-tts installed. */
function pythonCandidates() {
  const candidates = []
  if (process.env.DSH_PYTHON) candidates.push(process.env.DSH_PYTHON)
  candidates.push(path.join(homedir(), '.dsh', 'dsh-runtimes', 'dsh-primary-runtime',
    'dependencies', 'python', 'python.exe'))
  candidates.push('python', 'python3', 'py')
  return candidates
}

async function healthy(attempts, delay) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`${LOCAL}/health`)
      if (response.ok) return true
    } catch {
      /* not listening yet */
    }
    await new Promise(resolve => setTimeout(resolve, delay))
  }
  return false
}

/** Forward one browser request to the local service, streaming audio back. */
async function proxy(request, response) {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const rest = url.pathname.startsWith(ROUTE) ? url.pathname.slice(ROUTE.length) : url.pathname
  const target = `${LOCAL}${rest === '' ? '/health' : rest}${url.search}`
  try {
    const upstream = await fetch(target)
    const headers = {
      'content-type': upstream.headers.get('content-type') ?? 'audio/mpeg',
      'cache-control': 'no-store',
    }
    response.writeHead(upstream.status, headers)
    if (upstream.body === null) {
      response.end()
      return
    }
    // Pipe piece by piece so playback starts before synthesis finishes.
    Readable.fromWeb(upstream.body).pipe(response)
  } catch (error) {
    console.warn(`[read-aloud] proxy failed: ${error instanceof Error ? error.message : String(error)}`)
    response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('speech service unavailable')
  }
}

/**
 * Start the local speech service and publish it on the DSH origin.
 * @param ctx - Host context owning both registrations.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: (request, response) => { void proxy(request, response) },
  }), 'read-aloud: http route')

  ctx.effect(() => {
    const script = path.join(here, 'server', 'tts_server.py')
    let child = null
    let disposed = false

    const stopChild = () => {
      if (child !== null) {
        child.kill()
        child = null
      }
    }

    const start = async () => {
      if (!existsSync(script)) {
        console.warn(`[read-aloud] service script missing: ${script}`)
        return
      }
      // Another instance (or a previous run) may already serve the port.
      if (await healthy(2, 150)) return
      for (const python of pythonCandidates()) {
        if (disposed) return
        try {
          child = spawn(python, [script, '--port', String(PORT)], {
            cwd: here, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
          })
          child.once('error', () => {})
          child.stderr?.on('data', chunk => {
            const text = String(chunk).trim()
            if (text !== '') console.warn(text)
          })
          if (await healthy(24, 250)) return
          stopChild()
        } catch {
          stopChild()
        }
      }
      console.warn('[read-aloud] no Python with edge-tts found; browser speech stays in use')
    }

    void start()
    return () => {
      disposed = true
      stopChild()
    }
  }, 'read-aloud: local speech service')
}

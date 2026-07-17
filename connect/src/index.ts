import { DurableObject } from 'cloudflare:workers'

interface Env {
  SIGNALING_ROOMS: DurableObjectNamespace<SignalingRoom>
}

type SocketRole = 'host' | 'client'

interface SocketAttachment {
  role: SocketRole
}

const responseHeaders = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
} as const

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: responseHeaders })

const ROOM_PATTERN = /^[A-Za-z0-9_-]{22,64}$/
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/
const FORWARDED_TYPES = new Set(['offer', 'answer', 'candidate'])

const timingSafeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export class SignalingRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'upgrade_required' }, 426)
    }

    const url = new URL(request.url)
    const role = url.searchParams.get('role')
    if (role !== 'host' && role !== 'client') return json({ error: 'invalid_role' }, 400)

    const authorization = request.headers.get('authorization') ?? ''
    const secret = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (!SECRET_PATTERN.test(secret)) return json({ error: 'unauthorized' }, 401)

    const suppliedHash = await sha256(secret)
    const storedHash = await this.ctx.storage.get<string>('secretHash')
    if (storedHash === undefined) {
      if (role !== 'host') return json({ error: 'host_not_ready' }, 409)
      await this.ctx.storage.put('secretHash', suppliedHash)
    } else if (!timingSafeEqual(storedHash, suppliedHash)) {
      return json({ error: 'unauthorized' }, 401)
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // A room intentionally supports one Windows host and one Android client.
    // Reconnecting replaces a stale socket with the same role.
    for (const existing of this.ctx.getWebSockets(role)) {
      existing.close(4001, 'replaced')
    }
    this.ctx.acceptWebSocket(server, [role])
    server.serializeAttachment({ role } satisfies SocketAttachment)

    const counterpart: SocketRole = role === 'host' ? 'client' : 'host'
    const peers = this.ctx.getWebSockets(counterpart)
    if (peers.length > 0) {
      server.send(JSON.stringify({ type: 'peer_ready' }))
      for (const peer of peers) peer.send(JSON.stringify({ type: 'peer_ready' }))
    }

    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string' || message.length > 128 * 1024) {
      socket.close(1009, 'invalid_message')
      return
    }

    let type: unknown
    try {
      type = (JSON.parse(message) as { type?: unknown }).type
    } catch {
      socket.close(1007, 'invalid_json')
      return
    }
    if (typeof type !== 'string' || !FORWARDED_TYPES.has(type)) {
      socket.close(1008, 'invalid_signal')
      return
    }

    const attachment = socket.deserializeAttachment() as SocketAttachment | null
    if (attachment?.role !== 'host' && attachment?.role !== 'client') {
      socket.close(1011, 'missing_role')
      return
    }
    const counterpart = attachment.role === 'host' ? 'client' : 'host'
    for (const peer of this.ctx.getWebSockets(counterpart)) peer.send(message)
  }

  async webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null
    socket.close(code, reason || (wasClean ? 'closed' : 'disconnected'))
    if (attachment?.role === 'host' || attachment?.role === 'client') {
      const hasReplacement = this.ctx
        .getWebSockets(attachment.role)
        .some((peer) => peer !== socket && peer.readyState < WebSocket.CLOSING)
      if (!hasReplacement) {
        const counterpart = attachment.role === 'host' ? 'client' : 'host'
        for (const peer of this.ctx.getWebSockets(counterpart)) {
          if (peer.readyState < WebSocket.CLOSING) peer.send(JSON.stringify({ type: 'peer_left' }))
        }
      }
    }
    const hasActivePeer = this.ctx
      .getWebSockets()
      .some((peer) => peer.readyState < WebSocket.CLOSING)
    if (!hasActivePeer) await this.ctx.storage.delete('secretHash')
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({ service: 'yuraive-connect', status: 'ok' })
    }

    const match = /^\/v1\/rooms\/([^/]+)$/.exec(url.pathname)
    if (request.method === 'GET' && match !== null) {
      const room = match[1]
      if (!ROOM_PATTERN.test(room)) return json({ error: 'invalid_room' }, 400)
      const id = env.SIGNALING_ROOMS.idFromName(room)
      return env.SIGNALING_ROOMS.get(id).fetch(request)
    }

    return json({ error: 'not_found' }, 404)
  },
} satisfies ExportedHandler<Env>

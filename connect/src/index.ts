const responseHeaders = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
} as const

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: responseHeaders })

export default {
  async fetch(request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({
        service: 'yuraive-connect',
        status: 'ok',
      })
    }

    return json({ error: 'not_found' }, 404)
  },
} satisfies ExportedHandler

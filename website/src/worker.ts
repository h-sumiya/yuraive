interface Env {
  ASSETS: Fetcher
}

const securityHeaders = {
  'content-security-policy': "default-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
} as const

const secure = (response: Response): Response => {
  const headers = new Headers(response.headers)
  Object.entries(securityHeaders).forEach(([name, value]) => headers.set(name, value))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

const redirect = (request: Request, pathname: string): Response => {
  const location = new URL(pathname, request.url)
  return secure(new Response(null, {
    status: 308,
    headers: {
      'cache-control': 'public, max-age=86400',
      location: location.toString(),
    },
  }))
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url
    if (pathname === '/privacy' || pathname === '/privacy-policy' || pathname === '/privacy-policy/') {
      return redirect(request, '/privacy/')
    }
    if (pathname === '/index.html') return redirect(request, '/')
    if (pathname === '/privacy/index.html') return redirect(request, '/privacy/')

    if (pathname === '/') url.pathname = '/index.html'
    if (pathname === '/privacy/') url.pathname = '/privacy/index.html'

    return secure(await env.ASSETS.fetch(new Request(url, request)))
  },
} satisfies ExportedHandler<Env>

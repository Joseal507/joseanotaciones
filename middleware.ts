import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const isMaintenanceMode = process.env.MAINTENANCE_MODE === 'true'
  const { pathname } = request.nextUrl

  if (
    isMaintenanceMode &&
    pathname !== '/maintenance' &&
    !pathname.startsWith('/_next') &&
    !pathname.startsWith('/api') &&
    !pathname.startsWith('/favicon') &&
    !pathname.startsWith('/icon') &&
    !pathname.startsWith('/apple-icon')
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/maintenance'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

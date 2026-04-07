import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_ROUTES = ['/']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get('mte_token')?.value

  const isPublic = PUBLIC_ROUTES.some((r) => pathname === r)
  const isDashboard = pathname.startsWith('/dashboard')

  if (isDashboard && !token) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  if (isPublic && token) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/dashboard/:path*'],
}

import { NextRequest, NextResponse } from 'next/server'
import { logHoneypotEvent, maybeSendHoneypotAlert, getClientIp } from '@/lib/honeypot'
import { blockIp } from '@/lib/ip-blocklist'
import { memoryBlockIp } from '@/lib/blocked-ips-memory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getTargetPath(request: NextRequest): string {
  const url = new URL(request.url)
  return url.searchParams.get('target') ?? url.pathname
}

function getDecoyResponse(targetPath: string) {
  const lowerPath = targetPath.toLowerCase()

  if (lowerPath.includes('wp-login') || lowerPath.includes('admin')) {
    return {
      status: 401,
      contentType: 'text/html; charset=utf-8',
      body: '<html><body><h1>401 Unauthorized</h1><p>Invalid administrative credentials.</p></body></html>',
    }
  }

  if (lowerPath.includes('.env') || lowerPath.includes('.git')) {
    return {
      status: 403,
      contentType: 'text/plain; charset=utf-8',
      body: '403 Forbidden',
    }
  }

  if (lowerPath.includes('phpmyadmin') || lowerPath.includes('debug')) {
    return {
      status: 401,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ error: 'access_denied' }),
    }
  }

  return {
    status: 404,
    contentType: 'text/plain; charset=utf-8',
    body: 'Not Found',
  }
}

async function handleTrapRequest(request: NextRequest): Promise<NextResponse> {
  const targetPath = getTargetPath(request)

  let bodySample = ''
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const contentType = request.headers.get('content-type') ?? ''

    try {
      if (
        contentType.includes('application/json') ||
        contentType.includes('application/x-www-form-urlencoded') ||
        contentType.includes('text/plain')
      ) {
        bodySample = await request.text()
      } else if (contentType) {
        bodySample = `[non-text payload: ${contentType}]`
      }
    } catch {
      bodySample = '[body-read-error]'
    }
  }

  const event = await logHoneypotEvent(request, {
    targetPath,
    bodySample,
  })
  await maybeSendHoneypotAlert(event)

  // Auto-block IPs with risk score >= 80 (configurable via env)
  const autoBlockThreshold = Number(process.env.HONEYPOT_AUTO_BLOCK_THRESHOLD ?? '80')
  if (event.riskScore >= autoBlockThreshold && event.ip !== 'unknown') {
    const reason = `Auto-blocked: risk ${event.riskScore}, indicators: ${event.indicators.join(', ')}`
    await blockIp(event.ip, reason, 'auto')
    memoryBlockIp(event.ip)
    console.log(`[FIREWALL] AUTO-BLOCKED ${event.ip} — risk ${event.riskScore}`)
  }

  const decoy = getDecoyResponse(targetPath)

  return new NextResponse(decoy.body, {
    status: decoy.status,
    headers: {
      'content-type': decoy.contentType,
      'cache-control': 'no-store, no-cache, must-revalidate',
      'x-robots-tag': 'noindex, nofollow',
    },
  })
}

export async function GET(request: NextRequest) {
  return handleTrapRequest(request)
}

export async function POST(request: NextRequest) {
  return handleTrapRequest(request)
}

export async function PUT(request: NextRequest) {
  return handleTrapRequest(request)
}

export async function PATCH(request: NextRequest) {
  return handleTrapRequest(request)
}

export async function DELETE(request: NextRequest) {
  return handleTrapRequest(request)
}

export async function HEAD(request: NextRequest) {
  return handleTrapRequest(request)
}

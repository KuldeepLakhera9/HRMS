import { getSessionByToken } from '@hrms/core';
import { Redis } from 'ioredis';
import { getEnv } from '@hrms/config';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // 1. Extract session token
  const cookieHeader = req.headers.get('cookie');
  let token: string | undefined;

  if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map((c) => {
        const [k, ...v] = c.trim().split('=');
        return [k, v.join('=')];
      }),
    );
    token = cookies['hrms_session'] || cookies['__Host-hrms_session'];
  }

  if (!token) {
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Validate session
  const session = await getSessionByToken(token);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const companyId = session.companyId;
  const channel = `attendance:live:${companyId}`;

  // 3. Create Redis subscriber
  const env = getEnv();
  const subscriber = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });

  let isClosed = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (text: string) => {
        if (!isClosed) {
          controller.enqueue(encoder.encode(text));
        }
      };

      // Initial connection ping
      send(': connected\n\n');

      // Heartbeat every 15s to keep connection alive through PgBouncer/proxies
      heartbeatTimer = setInterval(() => {
        send(': ping\n\n');
      }, 15000);

      // Subscribe to Redis channel
      await subscriber.subscribe(channel);

      subscriber.on('message', (_ch, message) => {
        send(`event: live_punch\ndata: ${message}\n\n`);
      });

      subscriber.on('error', (err) => {
        console.error('SSE Live Attendance Redis error:', err);
      });
    },
    cancel() {
      isClosed = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      subscriber.unsubscribe(channel).catch(() => {});
      subscriber.quit().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

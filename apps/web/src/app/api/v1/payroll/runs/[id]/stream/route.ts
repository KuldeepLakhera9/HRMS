import { getRedisClient, getSessionByToken } from '@hrms/core';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;

  // 1. Session authentication
  const cookieHeader = req.headers.get('cookie');
  let token: string | undefined;

  if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map(c => {
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

  const session = await getSessionByToken(token);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Setup Redis subscriber for payroll calculation progress
  const subscriber = getRedisClient().duplicate();
  const channel = `payroll:run:${runId}:progress`;

  let isClosed = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (text: string) => {
        if (!isClosed) {
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            // Stream closed
          }
        }
      };

      // Initial connection event
      send(`event: connected\ndata: ${JSON.stringify({ runId, status: 'listening' })}\n\n`);

      // Heartbeat every 15s to keep SSE connection alive
      heartbeatTimer = setInterval(() => {
        send(': heartbeat\n\n');
      }, 15000);

      try {
        await subscriber.subscribe(channel);
        subscriber.on('message', (_chan, message) => {
          send(`data: ${message}\n\n`);
        });
      } catch (err) {
        console.error('[SSE] Failed to subscribe to payroll progress channel', err);
      }
    },
    cancel() {
      isClosed = true;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
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

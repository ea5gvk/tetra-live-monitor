
import { z } from 'zod';

// API is minimal since most data is over WebSockets
export const api = {
  system: {
    status: {
      method: 'GET' as const,
      path: '/api/status' as const,
      responses: {
        200: z.object({
          status: z.string(),
          uptime: z.number(),
          activeConnections: z.number()
        }),
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

export interface MockApiServer {
  url: string;
  requests: CapturedRequest[];
  /** Trames renvoyées aux requêtes suivantes, dans l'ordre. */
  respondWith(frames: string[], status?: number): void;
  /** Renvoie un corps d'erreur JSON avec le statut donné. */
  respondWithError(status: number, body: unknown): void;
  close(): Promise<void>;
}

/**
 * Petit serveur HTTP local vers lequel on fait pointer les SDK via leur URL de
 * base. Il permet de vérifier ce que chaque adaptateur ENVOIE réellement et ce
 * qu'il fait des trames qu'il REÇOIT — la seule façon de couvrir ce code sans
 * clé API ni appel facturé.
 */
export async function startMockApiServer(): Promise<MockApiServer> {
  let frames: string[] = [];
  let status = 200;
  let errorBody: unknown = null;

  const requests: CapturedRequest[] = [];

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: Record<string, unknown> = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = { __raw: raw };
      }
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });

      if (errorBody !== null) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(errorBody));
        return;
      }

      res.writeHead(status, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      for (const frame of frames) res.write(frame);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    respondWith(next, nextStatus = 200) {
      frames = next;
      status = nextStatus;
      errorBody = null;
    },
    respondWithError(nextStatus, body) {
      status = nextStatus;
      errorBody = body;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

// -----------------------------------------------------------------------------
// Constructeurs de trames, au format propre à chaque fournisseur
// -----------------------------------------------------------------------------

export function anthropicStream(textParts: string[]): string[] {
  const frame = (event: string, data: unknown) =>
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  return [
    frame('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'modele-test',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 11, output_tokens: 0 },
      },
    }),
    frame('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }),
    ...textParts.map((text) =>
      frame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text },
      })
    ),
    frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
    frame('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 7 },
    }),
    frame('message_stop', { type: 'message_stop' }),
  ];
}

export function openaiStream(textParts: string[]): string[] {
  const chunk = (payload: Record<string, unknown>) => `data: ${JSON.stringify(payload)}\n\n`;
  const base = { id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'm' };

  return [
    ...textParts.map((content) =>
      chunk({ ...base, choices: [{ index: 0, delta: { content }, finish_reason: null }] })
    ),
    chunk({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    }),
    'data: [DONE]\n\n',
  ];
}

export function googleStream(textParts: string[]): string[] {
  return textParts.map((text, i) => {
    const payload: Record<string, unknown> = {
      candidates: [{ content: { role: 'model', parts: [{ text }] }, index: 0 }],
    };
    if (i === textParts.length - 1) {
      payload.usageMetadata = {
        promptTokenCount: 11,
        candidatesTokenCount: 7,
        totalTokenCount: 18,
      };
    }
    return `data: ${JSON.stringify(payload)}\r\n\r\n`;
  });
}

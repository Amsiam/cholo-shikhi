// Minimal types for the parts of `ws` this app uses (the package ships no types, and @types/ws is
// not an approved dependency).
declare module 'ws' {
  import type { EventEmitter } from 'node:events';
  import type { IncomingMessage } from 'node:http';
  import type { Duplex } from 'node:stream';

  export class WebSocket extends EventEmitter {
    static readonly OPEN: 1;
    readonly readyState: 0 | 1 | 2 | 3;
    constructor(address: string, options?: { headers?: Record<string, string> });
    send(data: string): void;
    close(code?: number, reason?: string): void;
    ping(): void;
    terminate(): void;
    on(event: 'message', listener: (data: Buffer) => void): this;
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
    on(event: 'open' | 'pong', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(
      event: 'unexpected-response',
      listener: (request: unknown, response: IncomingMessage) => void,
    ): this;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options: { noServer: true; maxPayload?: number });
    readonly clients: Set<WebSocket>;
    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (ws: WebSocket) => void,
    ): void;
    close(callback?: () => void): void;
  }
}

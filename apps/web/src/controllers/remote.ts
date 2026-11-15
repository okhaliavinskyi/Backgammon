import type { ClientMsg, ServerMsg, Step } from '@nardy/core';
import { Controller, initialGameStore, pushEmoji, useGame } from './store';
import { pop } from '../lib/sound';

const tokenKey = (id: string) => `nardy.token.${id}`;

export function getToken(roomId: string): string | undefined {
  try {
    return localStorage.getItem(tokenKey(roomId)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Live game over WebSocket with the room Durable Object. */
export class RemoteController implements Controller {
  private ws: WebSocket | null = null;
  private retry = 0;
  private disposed = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private roomId: string,
    private name: string,
    private password: string | undefined,
    private onFatal: (code: string) => void,
  ) {
    useGame.setState({ ...initialGameStore, mode: 'online', controls: [false, false], conn: 'connecting', controller: this });
    this.connect();
  }

  private connect(): void {
    if (this.disposed) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/api/rooms/${this.roomId}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.send({ t: 'hello', name: this.name, token: getToken(this.roomId), password: this.password });
      this.pingTimer = setInterval(() => this.send({ t: 'ping' }), 25000);
    };
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data as string) as ServerMsg);
    ws.onclose = (e) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.disposed) return;
      if (e.code === 4401 || e.code === 4403 || e.code === 4404) {
        useGame.setState({ conn: 'closed' });
        this.onFatal(e.reason || 'closed');
        return;
      }
      useGame.setState({ conn: 'reconnecting' });
      const delay = Math.min(10000, 500 * 2 ** this.retry++);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }

  private onMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome':
        try {
          localStorage.setItem(tokenKey(this.roomId), msg.token);
        } catch {
          /* private mode */
        }
        useGame.setState({
          viewer: msg.you,
          controls: [msg.you === 0, msg.you === 1],
          conn: 'open',
        });
        break;
      case 'state': {
        const patch: Partial<ReturnType<typeof useGame.getState>> = {
          room: msg.room,
          match: msg.match,
          clocks: msg.clocks,
          offset: msg.serverNow - Date.now(),
          players: [
            msg.room.players[0] && { ...msg.room.players[0] },
            msg.room.players[1] && { ...msg.room.players[1] },
          ],
          conn: 'open',
          error: null,
        };
        if (msg.chat) patch.chat = msg.chat;
        useGame.setState(patch);
        break;
      }
      case 'chat':
        useGame.setState((s) => ({ chat: [...s.chat.slice(-49), msg.line] }));
        if (msg.line.from !== useGame.getState().viewer) pop();
        break;
      case 'emoji':
        pushEmoji(msg.from, msg.e);
        break;
      case 'error':
        if (msg.code === 'bad_password' || msg.code === 'room_full') {
          this.onFatal(msg.code);
        } else useGame.setState({ error: msg.code });
        break;
      case 'pong':
        useGame.setState({ offset: msg.serverNow - Date.now() });
        break;
    }
  }

  private send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  roll() { this.send({ t: 'roll' }); }
  move(steps: Step[]) { this.send({ t: 'move', steps: steps.map((s) => ({ from: s.from, die: s.die })) }); }
  double() { this.send({ t: 'double' }); }
  take() { this.send({ t: 'take' }); }
  drop() { this.send({ t: 'drop' }); }
  resign() { this.send({ t: 'resign' }); }
  next() {}
  rematch() { this.send({ t: 'rematch' }); }
  claim() { this.send({ t: 'claim' }); }
  chat(text: string) { this.send({ t: 'chat', text }); }
  emoji(e: string) { this.send({ t: 'emoji', e }); }
  dispose() {
    this.disposed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
  }
}

/** Wire contracts shared by browser and server. Runtime validation stays on the server. */
import type { GameKind, GameViews, QueryResults } from './views.js';
import type { DrawOp } from './scribble.js';

/** Nét vẽ chuyển tiếp liên tục trong một lượt (`game:stream`). */
export interface DrawStream { turn: number; ops: DrawOp[] }

export interface Identity { id: string; name: string }
export interface OnlineUser extends Identity { room: { id: string; name: string; game: string; playing: boolean } | null }
export interface ServerInfo { id: string; name: string | null; gated: boolean }
export interface VoiceStatus { enabled: boolean; reason?: string | null; hidden?: boolean; maxPerRoom: number; relay?: boolean }
export interface IceServer { urls: string | string[]; username?: string; credential?: string }
export type VoiceSignal = { description: { type: 'offer' | 'answer' | 'rollback'; sdp: string }; candidate?: never }
  | { candidate: { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null } | null; description?: never };
export interface IncomingSignal { from: string; data: VoiceSignal }
export type GameAction =
  | { type: 'raceSync'; tick: number; inputs: import('./race.js').RaceInput[]; offset?: number; gameNo?: number }
  | { type: 'tetrisInput'; input: import('./tetris.js').TetrisInput; round: string }
  | { type: 'sync'; tick: number; inputs: import('./snake.js').SnakeInput[] }
  | { type: 'ready' | 'start' | 'rematch' | 'resign' | 'offerDraw' | 'requestUndo' | 'cancelRequest' | 'resetScore' | 'draw' | 'eat' | 'autoLay' | 'u' | 'next' | 'stop' | 'object' | 'giveup' | 'pause' | 'rabbit' | 'show' | 'rebuy' | 'sitout' | 'hint' | 'shuffle' | 'pass' }
  | { type: 'move'; from: number; to: number; promotion?: string }
  | { type: 'move'; cell: number }
  | { type: 'respond'; accept: boolean }
  | { type: 'addBot'; level?: string; seat?: string }
  | { type: 'removeBot'; id?: string }
  | { type: 'discard'; card: string }
  | { type: 'lay' | 'play'; cards: string[] }
  | { type: 'send'; card: string; target: number; meldIdx: number }
  | { type: 'text'; text: string; done: boolean }
  | { type: 'done'; done: boolean }
  | { type: 'word' | 'guess'; text: string }
  | { type: 'choose'; index: number }
  | { type: 'setBlinds'; smallBlind: number; bigBlind: number }
  | { type: 'act'; action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin'; amount?: number }
  | { type: 'setMode'; mode?: 'coop' | 'race'; daily?: boolean }
  | { type: 'loadQuiz'; text: string }
  | { type: 'useBuiltin'; category?: string; questions?: number; seconds?: number }
  | { type: 'setSeconds'; seconds: number }
  | { type: 'answer'; choice: number }
  | { type: 'match'; a: [number, number]; b: [number, number] }
  | { type: 'sam'; yes: boolean };
export type GameQuery = { type: 'canvas' } | { type: 'drawing'; id: string } | { type: 'handLog' };
export interface RoomSummary {
  id: string; name: string; game: string; gameName: string; ownerId: string; ownerName: string;
  players: number; playerNames: string[]; maxPlayers: number; spectators: number; playing: boolean;
  options: Record<string, unknown>; createdAt: number;
}
export interface RoomStateBase {
  id: string; name: string; ownerId: string;
  members: (Identity & { role: string; online: boolean })[];
  chat: { id: string; ts: number; text: string; from?: string; name?: string; system?: boolean }[];
  voice: { id: string; muted: boolean }[];
  serverTime: number;
}
/** Trạng thái phòng; `state` là view của trò `game` (xem `views.ts`), thu hẹp bằng `switch (room.game)`. */
export type RoomState = { [G in GameKind]: RoomStateBase & { game: G; state: GameViews[G] } }[GameKind];
export interface Requests {
  hello: { token?: string; tokens?: Record<string, string>; name?: string };
  'user:rename': { name: string };
  'lobby:list': Record<string, never>;
  'room:create': { name?: string; game: string; options?: Record<string, unknown> };
  'room:join': { roomId: string; mode?: 'play' | 'watch' };
  'room:leave': Record<string, never>;
  'room:delete': { roomId?: string };
  'room:rename': { name: string };
  'room:sit': { seat?: string | number };
  'room:stand': Record<string, never>;
  'room:kick': { userId: string };
  'room:chat': { text: string };
  'game:action': GameAction;
  'game:query': GameQuery;
  'game:stream': { turn: number; ops: unknown[] };
  'voice:join': { muted: boolean };
  'voice:leave': Record<string, never>;
  'voice:mute': { muted: boolean };
  'voice:signal': { to: string; data: VoiceSignal };
}
export interface Responses {
  hello: { user: Identity; token: string; roomId: string | null; rooms: RoomSummary[]; online: OnlineUser[]; server: ServerInfo; voice: VoiceStatus; session: string | null };
  'user:rename': { user: Identity };
  'lobby:list': { rooms: RoomSummary[]; online: OnlineUser[] };
  'room:create': { roomId: string; warning?: string | null };
  'room:join': { roomId: string; warning?: string | null };
  'game:action': { race?: import('./race.js').RaceSyncAck };
  'game:query': { data: QueryResults[GameQuery['type']] };
  'voice:join': { iceServers: IceServer[]; peers: string[] };
}
export type RequestEvent = keyof Requests;
export type Response<E extends RequestEvent> = (E extends keyof Responses ? Responses[E] : object) & { warning?: string | null };
export interface RouteRedirect { redirect: {nodeId: string} }
export type Ack<E extends RequestEvent> = ({ ok: true; redirect?: never } & Response<E>) | ({ok: true} & RouteRedirect) | { ok: false; error: string };
export type ClientToServerEvents = { [E in Exclude<RequestEvent, 'game:stream'>]: (payload: Requests[E], ack: (response: Ack<E>) => void) => void } & { 'game:stream': (payload: Requests['game:stream'], ack?: (response: Ack<'game:stream'>) => void) => void };
export interface ServerToClientEvents {
  'app:version': (payload: { version: string | null }) => void;
  'voice:status': (payload: VoiceStatus) => void;
  'voice:signal': (payload: IncomingSignal) => void;
  'lobby:rooms': (payload: RoomSummary[]) => void;
  'lobby:online': (payload: OnlineUser[]) => void;
  'room:state': (payload: RoomState) => void;
  'room:closed': (payload: { roomId: string; reason: string }) => void;
  'room:left': (payload: { roomId: string }) => void;
  'game:stream': (payload: DrawStream) => void;
}

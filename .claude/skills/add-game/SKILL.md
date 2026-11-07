---
name: add-game
description: Thêm một trò chơi mới vào Sảnh Trò Chơi (engine shared, handler server, view/contract, snapshot/recovery, UI client, tests, docs). Dùng khi người dùng muốn thêm game, tạo trò chơi mới, port một luật chơi mới vào lobby, hoặc hỏi cần sửa những file nào để có một game mới.
argument-hint: "[tên game] [mô tả luật ngắn]"
---

# Thêm trò chơi mới

Skill này dẫn từng bước để thêm một game vào monorepo (`shared` → `server` → `client`). Nó cụ thể hóa
mục "Ví dụ: thêm một game" trong `docs/feature-development.md`; quy tắc trong `AGENTS.md` luôn được ưu tiên.

Mẫu tham chiếu tốt nhất là **Tetris** (commit `e9f6469`, game được thêm gần nhất, chạm đủ mọi điểm nối):
`git show --stat e9f6469` rồi đọc từng file trước khi viết. Với game theo lượt 2 người, xem thêm `caro`;
game bài nhiều người xem `tala`/`samloc` (`cardTable.ts`); game client tự mô phỏng xem `snake`.

## 0. Chốt thiết kế trước khi code

Hỏi người dùng (hoặc tự suy ra từ yêu cầu) và ghi lại ngắn gọn:

- **id** (chữ thường, không dấu, ví dụ `tetris`) và **tên hiển thị** tiếng Việt.
- Số người tối thiểu/tối đa, có bot không, có khán giả không.
- Kiểu chơi: theo lượt / realtime / client mô phỏng + server replay / đoán chữ-đáp án ẩn.
- Tùy chọn phòng (option) kèm min/max/default.
- Trạng thái **bí mật** (bài tẩy, đáp án, bộ bài, seed) — tuyệt đối không vào view công khai hay log.
- Timer nào cần khôi phục sau restart (deadline tuyệt đối).
- Điều kiện kết thúc ván, xử lý khi người chơi rời bàn/mất kết nối.

Không làm bản sao của một game thương mại cụ thể (tên, nhân vật, art, level); thể loại/cơ chế chung thì được.

Kiểm tra `git status` và branch hiện tại trước khi sửa.

## 1. Engine thuần — `shared/src/<id>.ts`

- Chỉ TypeScript thuần: không Express/React/Redis/DOM/env.
- Export type `XOptions`, `XView` (dữ liệu người xem được phép thấy), kiểu input/action, hằng số giới hạn
  option (ví dụ `LINE_TARGET = { min, max, default }`) để client và server dùng chung.
- Nếu cần ngẫu nhiên tái lập được (replay/recovery) dùng PRNG có seed/state lưu trong object, không dùng
  `Math.random` trong luật. Engine là class thì nhớ bước 5 (snapshot).
- Thêm export vào `shared/package.json` theo đúng mẫu:
  ```json
  "./<id>": { "types": "./dist/<id>.d.ts", "import": "./dist/<id>.js" }
  ```
- Unit test `shared/test/<id>.test.ts`: luật đúng, input sai bị từ chối, kết thúc ván, determinism với cùng seed.

## 2. Contract và view — `shared/src/contracts.ts`, `shared/src/views.ts`

- Action mới: thêm nhánh có discriminator `type` vào union `GameAction` (ví dụ
  `{ type: 'tetrisInput'; input: TetrisInput; round: string }`). Nếu chỉ cần `ready`/`start`/`rematch`…
  thì dùng lại nhánh có sẵn. Không dùng index signature hay `any`.
- Cần dữ liệu lớn theo yêu cầu → thêm vào `GameQuery` + `QueryResults`; chỉ làm khi thật sự cần.
- `views.ts`: import `XView` và thêm `<id>: XView;` vào `interface GameViews`.
- Socket event hoàn toàn mới (ngoài `game:action`/`game:query`/`game:stream`) phải có contract ở
  `contracts.ts`, handler qua wrapper `on(...)` trong `server/src/connection.ts`, validation/rate limit và test.

## 3. Handler server — `server/src/games/<id>.ts`

Implement `GameHandler` (`server/src/games/types.ts`):
`room`, `options`, `maxPlayers`, `playerIds()`, `isPlaying()`, `sit()`, `stand()`, `onLeave()`, `rename()`,
`action()`, `view(viewerId)`, `dispose()`; `botName`/`query`/`stream`/`censorChat` chỉ khi cần.

- **Constructor** nhận `options: Record<string, unknown>` do client gửi: validate/chuẩn hóa (dùng
  `clampInt`/`bool` trong `options.ts` hoặc ném lỗi tiếng Việt rõ ràng như Tetris). Không tin giá trị thô.
- `action()`: kiểm tra `action.type` và từng field ở runtime (TypeScript không thay validation), kiểm tra
  người gửi có ghế, đúng lượt, đúng `round`, tần suất input; ném `Error` với thông điệp tiếng Việt.
- Server là nguồn quyết định luật/điểm/thắng thua. Game client mô phỏng: server replay input thay vì tin score.
- `view(viewerId)`: chỉ trả phần người xem được biết (bài của chính mình, không phải của người khác).
- Tái sử dụng `ReadyGate` (`ready.ts`), `duel.ts`, `cardTable.ts`, `scoreboard.ts`, `fairness.ts` nếu cùng
  invariant; không copy luật engine vào handler.
- Timer: lưu **deadline tuyệt đối** trên handler; `dispose()` phải clear mọi timer.
- Gọi `this.room.changed()` sau mutation do timer; các mutation từ `game:action` đã được connection gọi.

Đăng ký trong `server/src/games/index.ts`: import handler và thêm `<id>: { name: '<Tên>', Handler: XHandler }`
vào `GAMES` (từ đó sinh `GameId`/`isGame`).

## 4. Snapshot & recovery — `server/src/snapshot.ts`, `server/src/resumeRoom.ts`

- Engine là class → import và thêm vào danh sách prototype trong `snapshot.ts` (handler tự có qua `GAMES`).
- `resumeRoom.ts`: thêm nhánh `else if (h instanceof XHandler && h.isPlaying()) { ... }` để **arm lại timer
  từ deadline đã lưu**. Không gọi constructor/start/redeal; không reset ván. Rebuild runtime handle và
  back-reference, không serialize chúng.
- Không đụng ownership/CAS/lease fencing hay worker revision guard.

## 5. Client — `client/src/games/` và `client/src/components/`

- `client/src/games/<Ten>Game.tsx`: `export default function XGame({ room, state }: { room: ClientRoom; state: XView })`.
  Gửi action qua socket hiện có; prediction chỉ để mượt, không chấm điểm. Canvas/skin riêng để ở
  `client/src/games/<id>Render.ts`. Tái sử dụng StartBar, GameInfo, GameOverDialog, hotkeys, voice shell.
- `components/RoomView.tsx`: import game, thêm `case '<id>': return <XGame room={room} state={room.state} />;`
  trong `GameScreen`; thêm hotkey vào bảng phím tắt nếu có.
- `components/Lobby.tsx`: metadata `{ name, Icon, desc }`, thêm id vào một nhóm trong `GAME_GROUPS` (`cards`/`board`/`words`/`party`/`arcade`),
  và dòng tóm tắt option trong hàm mô tả phòng nếu có option.
- `components/CreateRoomDialog.tsx`: default option và field (dùng hằng min/max/default từ shared).
- `components/Turn.tsx` nếu game có chỉ báo lượt.
- Style trong `client/src/styles.css`, theo token/class sẵn có; kiểm tra mobile và bàn phím.

## 6. Tests

- `shared/test/<id>.test.ts` (bước 1).
- `server/test/<id>.test.ts`: option sai bị từ chối, action sai/không có ghế/sai lượt, view không lộ private
  state, kết thúc ván, rời bàn giữa ván, `dispose()` dọn timer.
- `server/test/recovery.test.ts`: game được chạy qua `started()` cho mọi `GameId`; thêm nhánh `pair(XHandler, …)`
  so sánh state/RNG trước-sau snapshot và assert timer được arm lại sau `resumeRoom`. Nếu game cần điều kiện
  đặc biệt để start (như Tetris cần socket online) thêm vào `started()`.
- `server/test/e2e.ts`: flow tạo phòng → vào → ready/start → action → kết thúc/xem → rời, kết thúc bằng
  `console.log('✔ <Tên> OK')`.

## 7. Docs

- `README.md`: thêm tên vào tiêu đề và một mục mô tả luật (số người, cách thắng).
- `docs/architecture.md`: thêm vào danh sách game; cập nhật nếu thiết kế mới khác các game hiện có.

## 8. Kiểm tra trước khi bàn giao

Chạy và báo kết quả thật (không báo qua nếu chưa chạy):

```bash
npm run check
```

```bash
npm test
```

```bash
npm run build
```

```bash
npm run test:integration
```

Sau đó `git diff --check`, rà diff: không `any`/`as any`/`@ts-ignore`, không file `.js` viết tay, không commit
`dist/`, `.agents/`, `captures/`, log. Nếu có thể, chạy app (`npm run dev`) và chơi thử một ván trong trình duyệt.
Báo rõ checks nào đã chạy, Redis/Compose/browser checks nào bị skip.

## Checklist nhanh

- [ ] `shared/src/<id>.ts` + export trong `shared/package.json` + `shared/test/<id>.test.ts`
- [ ] `GameAction` (nếu có action mới) trong `contracts.ts`; `GameViews` trong `views.ts`
- [ ] `server/src/games/<id>.ts` + đăng ký `GAMES` trong `index.ts`
- [ ] `snapshot.ts` (class engine) + nhánh timer trong `resumeRoom.ts`
- [ ] `client/src/games/<Ten>Game.tsx` + `RoomView.tsx` + `Lobby.tsx` + `CreateRoomDialog.tsx` (+ `Turn.tsx`, `styles.css`)
- [ ] `server/test/<id>.test.ts`, `recovery.test.ts`, `e2e.ts`
- [ ] `README.md`, `docs/architecture.md`
- [ ] `npm run check`, `npm test`, `npm run build`, `npm run test:integration`, `git diff --check`

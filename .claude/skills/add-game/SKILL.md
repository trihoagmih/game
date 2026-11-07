---
name: add-game
description: Thêm một trò chơi mới vào Sảnh Trò Chơi (engine shared, handler server, view/contract, snapshot/recovery, UI client thiết kế qua skill UI và kiểm tra responsive, tests, docs). Dùng khi người dùng muốn thêm game, tạo trò chơi mới, port một luật chơi mới vào lobby, hoặc hỏi cần sửa những file nào để có một game mới.
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
- Style đặt cạnh TSX: `client/src/games/<Ten>Game.css` bọc trong `@layer games` và được import ở chính file đó (xem mục CSS trong `docs/conventions.md`); dùng token trong `client/src/styles/tokens.css`. Bắt buộc làm theo mục 5a và 5b.
- Trò kiểu "client chơi, server phát lại" (đua song song): dùng lại `RaceHandler` (`server/src/games/race.ts`), `replayRace` (`shared/src/race.ts`) và hook `useRaceLoop` như Bay qua khe/Đào vàng; giao diện thì tự thiết kế cho trò mới (tham khảo nhiều game khác, không sao chép khung của một game).

### 5a. Thiết kế UI bắt buộc qua skill UI

Không tự viết UI game “theo cảm tính”. Trước khi viết JSX/CSS cho màn hình game (và mỗi lần đổi layout lớn):

1. **Gọi skill UI**: dùng skill `impeccable` nếu đã được cài trong phiên; nếu không có, dùng `ui-ux-pro-max`
   (bố cục, responsive, accessibility, touch target) và `ui-styling` khi cần canvas/style chi tiết. Nếu không
   skill nào khả dụng, nói rõ với người dùng thay vì bỏ qua bước này.
2. **Đọc design system của repo**: `design-system/sanh-tro-choi/MASTER.md` (màu, typography, spacing,
   component, anti-pattern). Nếu có `design-system/pages/<id>.md` thì file đó ghi đè MASTER.
3. Đưa cho skill UI bối cảnh thật của khung phòng (bên dưới) và yêu cầu nó tối ưu không gian cho người chơi;
   áp kết quả bằng token/class sẵn có, không thêm framework CSS mới.

### 5b. Layout: không vỡ, responsive, tối ưu không gian

Khung phòng đã cố định chiều cao (`.app.in-room` = `100dvh`, không cuộn trang). Game render bên trong
`.game-area` (có `container-type: size`) → `.game-fit`. Vì vậy:

- **Co theo vùng chơi, không theo viewport**: kích thước bàn/board tính bằng `cqw`/`cqh` của `.game-area`,
  trừ đi chiều cao header/thanh hành động của chính game, giữ tỉ lệ khung. Mẫu có sẵn:
  `.bg-col.caro-main { width: min(100cqw, 900px, max(250px, calc(100cqh - 156px))); }`,
  `.tetris-boards { width: min(100%, clamp(270px, calc(100cqh - 194px), 460px)); }`.
  Không hardcode `px` cho board, không dùng `100vh`/`100vw` trong game.
- **Ưu tiên diện tích cho bàn chơi**: board là phần lớn nhất; thông tin phụ (điểm, lịch sử, log) gọn,
  đặt cạnh board trên màn rộng và xếp dưới/thu gọn trên mobile. Không thêm header/khung trùng với
  room header, StartBar, GameInfo đã có. Không để khoảng trống chết lớn quanh board trên desktop.
- **Không vỡ layout**: mọi flex/grid child chứa text dùng `min-width: 0` + ellipsis cho tên người chơi dài;
  không có cuộn ngang trang; nút/thanh hành động luôn thấy được mà không phải cuộn khi chơi.
- **Breakpoint của repo**: `max-width: 640px` (điện thoại), `641px–1100px` (tablet), `min-width: 1100px`
  (desktop), và `(max-height: 500px) and (orientation: landscape)` (điện thoại xoay ngang). Thêm rule
  cho game mới ở đúng các breakpoint này khi cần.
- **Cảm ứng**: target ≥ 44px với `(pointer: coarse)`; game cần phím mũi tên phải có nút điều khiển trên
  màn cảm ứng; chặn cuộn/zoom ngoài ý muốn trong vùng thao tác (`touch-action`), nhưng không chặn cuộn trang ở chỗ khác.
- Tôn trọng `prefers-reduced-motion`; màu không là kênh thông tin duy nhất (thêm icon/chữ).

**Kiểm chứng bằng ảnh chụp thật** (Playwright/Chromium có sẵn): chạy `npm run dev`, tạo phòng game mới,
vào trạng thái đang chơi, rồi chụp và đo ở ít nhất các kích thước:
360×740, 390×844, 844×390 (ngang), 768×1024, 1366×768, 1920×1080. Với mỗi kích thước kiểm tra:

```ts
const report = await page.evaluate(() => {
  const area = document.querySelector('.game-area');
  return {
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    areaScrolls: area ? area.scrollHeight > area.clientHeight + 1 : null,
  };
});
```

`pageOverflowX` phải là `false`; `areaScrolls` nên `false` từ 390×844 trở lên (màn quá thấp được phép cuộn
trong vùng chơi). Xem ảnh chụp: board không bị cắt, không chồng lên nút, nút hành động thấy được, chữ không
tràn. Lưu ảnh ở scratchpad (không commit `captures/`) và báo kích thước nào đã kiểm tra. Nếu không chạy
được trình duyệt, nói rõ là chưa kiểm chứng layout.

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
- [ ] UI thiết kế qua skill `impeccable`/`ui-ux-pro-max` + `design-system/sanh-tro-choi/MASTER.md`
- [ ] Layout co theo `cqw`/`cqh`, không cuộn ngang, đã chụp kiểm tra 6 kích thước màn hình
- [ ] `client/src/games/<Ten>Game.tsx` + `RoomView.tsx` + `Lobby.tsx` + `CreateRoomDialog.tsx` (+ `Turn.tsx`, `<Ten>Game.css`)
- [ ] `server/test/<id>.test.ts`, `recovery.test.ts`, `e2e.ts`
- [ ] `README.md`, `docs/architecture.md`
- [ ] `npm run check`, `npm test`, `npm run build`, `npm run test:integration`, `git diff --check`

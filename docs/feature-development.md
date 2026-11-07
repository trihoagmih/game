# Làm một feature trong repo này

## Luồng chung

1. Đọc `AGENTS.md`, `architecture.md`, handler/engine/UI gần feature; xác định request → mutation → view → render. Kiểm tra trạng thái branch và commit mới để không ghi đè thay đổi chat khác.
2. Viết ra behavior, input không hợp lệ và invariant cần giữ. Chọn nơi chứa theo bảng dưới; sửa module đang có trước khi tạo abstraction mới.
3. Định nghĩa type/contract ở boundary. Implement lát cắt nhỏ hoàn chỉnh cùng regression test; server validation phải đi trước mutation. Giữ các public/private view và response backward-compatible nếu không có yêu cầu đổi protocol.
4. Cập nhật UI, keyboard/mobile/cleanup nếu liên quan; dùng component/hook có sẵn. Không thêm implementation detail vào UI người chơi.
5. Chạy checks đúng phạm vi, rồi `npm run check`, `npm test`, build/integration khi đổi runtime. Đọc diff và báo rõ Redis/browser checks được chạy hay skip.

| Feature | Điểm bắt đầu |
| --- | --- |
| Sửa luật, tính điểm, pathfinding | `shared/src/<game>.ts`, unit test `shared/test/` |
| Seats, ready, thời gian, ownership trong phòng | `server/src/games/<game>.ts`, `ready.ts`, `duel.ts` hoặc `cardTable.ts` nếu thật sự cùng invariant |
| Event/payload/ack mới | `shared/src/contracts.ts` → `server/src/connection.ts` → `client/src/socket.ts`/consumer |
| Danh sách phòng, presence, membership | `server/src/lobby.ts`; không phát toàn lobby mỗi action nếu summary không đổi |
| State UI, toast, reconnect | `client/src/store.tsx`; transport/routing ở `socket.ts` |
| Component dùng cho nhiều game | `client/src/components/`; giữ prop API nhỏ, có kiểu |
| Canvas/skin chỉ cho một game | `client/src/games/<game>Render.ts`; không đổi engine để đổi skin |
| CPU-bound bot | `botPool.ts`/`botWorker.ts`; giữ bounded queue, timeout và stale-result guard |
| Shard/routing/Redis | `cluster.ts`, tests cluster và Compose qua `deploy/nginx.conf` |
| Checkpoint/khôi phục | `snapshot.ts`, `recovery.ts`, `resumeRoom.ts`; test round-trip private state và deadline |
| Từ điển/bank câu hỏi | `server/src/data/`, ghi nguồn/license; đọc được LF/CRLF |
| Build/policy/deploy | `scripts/`, config TS, Docker/Compose, `.github/workflows/`; không trộn vào game engine |

## Ví dụ: thêm một game

Checklist chi tiết từng file (dùng được như skill `/add-game` trong Claude Code): [`.claude/skills/add-game/SKILL.md`](../.claude/skills/add-game/SKILL.md).

1. Thêm engine TS trong `shared/src/`, type options/state/action rõ ràng, PRNG có seed/state khi cần replay hoặc recovery. Unit test luật, input sai, kết thúc ván và determinism; thêm export ESM `types`/`import` vào `shared/package.json`.
2. Thêm game action/query contract dùng chung trong `contracts.ts` và kiểu view trong `shared/src/views.ts` (thêm vào `GameViews`). Tên action phân biệt bằng `type`, không mở rộng bằng index signature `any`.
3. Thêm handler trong `server/src/games/` theo interface `GameHandler` (`server/src/games/types.ts`): `options`, `maxPlayers`, `playerIds`, `isPlaying`, `sit`, `stand`, `onLeave`, `rename`, `action`, `view(): XView`, `dispose`; query/stream chỉ nếu cần. Kiểm tra quyền/người chơi/tần suất ở boundary và quyền từng action trong handler.
4. Đăng ký `GAMES` trong `server/src/games/index.ts`. View chỉ chứa dữ liệu người xem được phép biết; score do server xác minh. Với client simulation như Rắn, server replay inputs thay vì tin điểm client.
5. Đăng ký prototype engine vào `snapshot.ts` nếu dùng class; handler registry được lấy từ `GAMES`. Thêm khôi phục timer trong `resumeRoom.ts` bằng absolute deadline (nhánh `instanceof` của handler mới). Không gọi constructor/start để khôi phục vì sẽ chia lại bài/đổi đáp án. Runtime handles và back-reference được rebuild.
6. Thêm UI trong `client/src/games/` với props `{ room: ClientRoom; state: XView }`; đăng ký ở `GameScreen` trong `RoomView.tsx`, `Lobby.tsx` (metadata/group), `CreateRoomDialog.tsx` (options) và `Turn.tsx` nếu cần chỉ báo lượt. Tái sử dụng StartBar, GameInfo, GameOverDialog, hotkeys và voice shell.
7. Thêm integration test flow tạo/vào/ready/start/action/watch/leave; snapshot recovery test cho game mới. Nếu thêm worker hoặc shard flow, chạy tests tương ứng. Cập nhật README/architecture khi thiết kế đổi.

## Phân biệt các lớp kiểm thử

- `shared/test/*.test.ts`: engine thuần; `*.types.ts`: type contract, chỉ chạy bởi compiler.
- `server/test/*.test.ts`: handler, auth, limits, worker, snapshot; tests Redis thật cần `TEST_REDIS_URL` và có thể skip khi local thiếu Redis.
- `npm run test:integration`: server `dist` trên cổng riêng, full socket/game flows; không dùng instance người dùng đang chơi.
- CI Compose: Redis + hai shard + Nginx, routing/transfer/gameplay qua proxy. Không thay bằng mock rồi coi là đã kiểm chứng cluster.
- `voice-browser.ts`, `ice-check.ts`: probe tùy chọn cần browser/network; không báo đã qua nếu chỉ typecheck chúng.

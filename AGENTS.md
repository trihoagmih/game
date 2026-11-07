# Hướng dẫn cho AI và người đóng góp

Đọc [kiến trúc](docs/architecture.md), [convention](docs/conventions.md) và [quy trình thêm feature](docs/feature-development.md) trước khi sửa code. Đây là monorepo npm workspaces, TypeScript strict, ESM; giữ stack hiện tại.

## Quy tắc bắt buộc

- Code viết tay mới phải là `.ts`; React có JSX dùng `.tsx`. Config/tooling cũng dùng TS nếu công cụ hỗ trợ. Không thêm JS/JSX/MJS/CJS, không sửa `dist` hoặc commit build output.
- Không thêm `any`, `as any`, `@ts-ignore`, `@ts-nocheck`, tắt strict hoặc đổi baseline chỉ để qua CI. Dùng `unknown` + narrowing ở boundary, interface/type cụ thể, union có discriminator và generic khi cần. Nợ `any` cũ được giới hạn theo file tại `config/typescript-debt.json`; khi chạm vào phần đó, ưu tiên giảm nợ.
- Tuân theo tên và cấu trúc hiện có. Dùng 2 spaces, single quotes, semicolon, `const` mặc định, `import type` cho type-only import. Không đổi format cả repo trong một feature.
- Giữ function/component một trách nhiệm. Đặt tên theo ý nghĩa nghiệp vụ; dùng guard clause và helper nhỏ thay cho nested condition khó đọc. Tái sử dụng logic cùng ý nghĩa; không tạo abstraction/framework tổng quát cho một trường hợp duy nhất.
- Server là nguồn quyết định luật, điểm, quyền truy cập. Không tin score, membership, owner hoặc input do client gửi. Không đưa private state, đáp án, bài tẩy, credentials hoặc snapshot key vào public view/log.
- Mọi Socket.IO request mới cần contract trong `shared/src/contracts.ts`, handler qua wrapper trong `server/src/connection.ts`, validation/auth/rate limit và test tương ứng. TypeScript không thay runtime validation.
- Không thay đổi ownership/CAS/lease fencing, timer phục hồi hoặc worker revision guard nếu không hiểu luồng và bổ sung regression test. Không redeal/reset game trong recovery.
- Lint exception chỉ trên dòng cần thiết, ghi lý do cụ thể; không disable cả file để che lỗi. Không bỏ test/check đang lỗi hoặc báo check đã qua khi chưa chạy.
- Nếu nhiều chat/agent dùng repo, làm trong worktree/branch riêng và không sửa checkout của chat khác. Không commit `.agents/`, `.worktrees/`, `captures/`, secrets hoặc log tạm.

## Bản đồ code

| Nơi | Trách nhiệm | Không đặt tại đây |
| --- | --- | --- |
| `shared/src/` | Engine/thuật toán dùng chung, kiểu wire và dữ liệu luật thuần | Express, React, Redis, DOM, env secrets |
| `shared/test/` | Unit tests luật/thuật toán; `*.types.ts` kiểm tra contract khi compile | Test cần dịch vụ thật |
| `server/src/games/` | Adapter mỗi game: seats, readiness, action, timer, private/public view | JSX, rendering, luật engine bị copy từ shared |
| `server/src/` | HTTP/auth, connection, lobby, cluster, recovery, worker, metrics | UI, client prediction |
| `server/src/data/` | Từ điển/bank câu hỏi cùng nguồn và giấy phép | Runtime state, snapshot, secret |
| `server/test/` | Server unit, boundary, integration, Redis/Compose và browser probes | Code production dùng để tránh viết test |
| `client/src/styles/` | CSS nền: thứ tự `@layer`, tokens, base, khối UI dùng chung, khung app | Style riêng của một component/game |
| `client/src/components/` | UI dùng chung và shell lobby/phòng; CSS cạnh TSX trong `@layer components` | Luật authoritative, kết nối Redis |
| `client/src/games/` | Màn hình/canvas, thao tác và prediction từng game; CSS cạnh TSX trong `@layer games` | Logic chấm điểm được tin cậy thay server |
| `client/src/socket.ts`, `store.tsx`, `voice*.ts` | Transport, app state và WebRTC lifecycle | Luật game cụ thể hoặc private server state |
| `scripts/` | Build helpers, policy checks, runner có cleanup | Logic nghiệp vụ |
| `config/` | Baseline nợ kiểu được ghi nhận | File phát sinh hoặc secret |
| `deploy/`, `compose.yaml`, `Dockerfile` | Proxy và đóng gói/deploy | Dependency vào source TS trong production runtime |
| `docs/` | Thiết kế, quy ước và vận hành; cập nhật khi behavior thay đổi | Hứa hẹn capacity chưa benchmark |

## Trước khi bàn giao

1. Kiểm tra `git status`, scope và các hướng dẫn áp dụng; đọc code liên quan trước khi thêm abstraction/dependency.
2. Thêm regression test cho hành vi đổi hoặc boundary mới; dùng fixture tối thiểu có kiểu. Không thêm test chỉ lặp lại implementation.
3. Chạy `npm run check` và `npm test`; nếu đổi runtime/network/game action/recovery, chạy `npm run build` và `npm run test:integration`.
4. Đổi cluster/recovery phải xác nhận Redis/Compose checks trên CI; local skip phải báo rõ. Browser probes cần trình duyệt thật và môi trường phù hợp.
5. Kiểm tra `git diff --check`, bỏ file tạm; mô tả kết quả thực tế, rủi ro và checks chưa chạy. Không tự merge PR/deploy nếu task không yêu cầu.

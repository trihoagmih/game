# Convention cơ bản

Quy ước này ưu tiên code dễ đọc và khớp repo hiện tại, không áp một style guide lớn gây đổi hàng loạt code cũ.

## TypeScript và ESM

- `.ts` cho engine/server/script; `.tsx` cho React có JSX. Export package dùng ESM và declarations. Import tương đối viết `.js` (TypeScript/tsx/Vite phân giải source `.ts/.tsx`); không import `dist` vào source, ngoại trừ worker entry được build riêng có giải thích.
- `strict` bật đầy đủ. Boundary HTTP/socket/storage/Redis dùng kiểu input rõ ràng, xem dữ liệu không đáng tin là `unknown`, kiểm tra trước khi sử dụng. Tránh type assertion; nếu phải assert tại serialization/test double, chỉ assert ở boundary và ghi lý do.
- Dùng `interface` cho shape dữ liệu, `type` cho union/alias; dùng union có `type` discriminator cho action. Không dùng `any` mới hoặc empty catch để nuốt lỗi nghiệp vụ. Catch cố ý best-effort (storage cleanup, âm thanh tùy chọn) cần comment giải thích.
- Khai báo kiểu cho exported API, props và state phức tạp. Để compiler suy luận local variable/callback đơn giản. `readonly` cho input không được mutate; engine có mutation phải thể hiện rõ API và test.
- `null` biểu diễn trạng thái nghiệp vụ vắng mặt (chưa có ván/kết quả), `undefined` cho option chưa truyền. Đừng đổi wire format chỉ để đẹp kiểu.

## Naming và trình bày

- Class, interface, type và React component: `PascalCase`; function/variable/method: `camelCase`; hằng cố định có ý nghĩa toàn module: `UPPER_SNAKE_CASE`.
- React component file: `SnakeGame.tsx`, `Modal.tsx`; module/helper file: `snakeRender.ts`, `botPool.ts`; test: `name.test.ts`; compile-time test: `name.types.ts`.
- Boolean có ý nghĩa rõ (`isPlaying`, `enabled`, `hasOnlineMember`). Function dùng động từ (`createRoom`, `resumeRoom`), tránh `data2`, `handleStuff`, `utils` chứa mọi thứ.
- 2 spaces, single quotes, semicolon, trailing comma hợp lý; khớp block xung quanh. Group imports: Node, package, nội bộ; dùng `import type`. Comment giải thích lý do/invariant thay vì diễn giải lại code.
- Giữ tiếng Việt ở UI và lỗi cho người chơi; tên API/identifier tiếng Anh. Error log vận hành không chứa token, password, private cards hoặc đáp án.

## Clean code và tái sử dụng

- Một function/component chịu một trách nhiệm; tách phần chuyển đổi dữ liệu, side effect và render khi chúng đã khác nhiệm vụ. Dùng guard clause; tránh nested ternary hoặc state flag trùng lặp khi union trạng thái rõ hơn.
- Engine không truy cập network/DOM/React. Adapter điều phối engine; UI gọi contract. Không copy luật giữa client/server. Shared UI vào `components/`, renderer riêng game giữ trong `games/`.
- Khi hai nơi có logic cùng ý nghĩa và cùng invariant, trích helper có tên cụ thể. Không gom code chỉ vì trông giống nhau nếu lifecycle/luật khác nhau; không thêm generic registry, base class hoặc dependency trước khi có nhu cầu thật.
- Timer, listener, worker, socket và resource phải có cleanup; request bất đồng bộ cần xét stale result/disconnect/dispose. React hook ở top level, dependency phản ánh giá trị đọc; dùng ref có chủ đích cho callback/lifecycle dài.
- Giữ public view tách private engine state; tối ưu bằng đo đạc, không bỏ validation/fencing/rate limits để benchmark đẹp hơn.

## CSS

Không dùng thư viện CSS; CSS thuần + [cascade layers](https://developer.mozilla.org/en-US/docs/Web/CSS/@layer), Vite gộp thành một bundle.

- `client/src/styles/index.css` được import đầu tiên trong `main.tsx` và khai báo thứ tự `@layer tokens, base, ui, layout, components, games;`. Layer sau luôn thắng layer trước, bất kể specificity hay thứ tự import.
- `styles/tokens.css` (biến `:root`), `base.css` (reset, thẻ HTML, tiện ích như `.muted`, `.row`, `.hide-sm`), `ui.css` (`.btn`, `.panel`, `.badge`, `.tabs`, `.search`…), `layout.css` (khung app). Chỉ thêm vào đây khi class thật sự dùng ở nhiều nơi.
- CSS riêng đặt cạnh file TSX cùng tên và được import ở chính file đó: `components/Lobby.tsx` → `import './Lobby.css';` (layer `components`), `games/PokerGame.tsx` → `PokerGame.css` (layer `games`). Mỗi file bọc toàn bộ nội dung trong đúng một `@layer`, kể cả `@media`, `@container`, `@keyframes`. CSS dùng chung cho vài game (vd. `games/BoardColumn.css`) do mỗi game dùng nó tự import.
- Mỗi game/khu vực giữ prefix class riêng (`pk-`, `xq-`, `tl-`, `sl-`, `wc-`, `qz-`…); state dùng modifier ngắn (`.on`, `.me`, `.active`). Màu, bo góc, bóng lấy từ `var(--…)` của tokens.
- Trong cùng layer, đừng dựa vào thứ tự giữa hai file: nếu hai file cùng nhắm một phần tử, rule ghi đè phải có specificity cao hơn, hoặc đặt cả hai vào file sở hữu phần tử đó. Rule của component cha chỉnh nội dung một game (vd. `.game-fit > .pk > *`) đặt trong file của game.
- `!important` chỉ dành cho tiện ích phải thắng mọi layer (`.hide-sm`, đảm bảo ô nhập ≥16px/44px trên màn cảm ứng); ghi lý do cạnh dòng đó. Inline `style` chỉ cho giá trị động, ưu tiên truyền qua biến CSS.
- `npm run check:source` từ chối file CSS không nằm trong layer đã khai báo, sai layer theo thư mục, hoặc không được import.

## Checks

`npm run check` = policy TS-only/nợ kiểu + ESLint + strict typecheck. ESLint dùng [flat config](https://eslint.org/docs/latest/use/configure/configuration-files) và [recommended TypeScript rules](https://typescript-eslint.io/getting-started/), thêm Rules of Hooks. Typecheck bắt cú pháp/kiểu, lint bắt lỗi cấu trúc/unused/dead assignment, tests xác nhận hành vi.

Baseline `config/typescript-debt.json` hiện rỗng: không file nào được có `any` tường minh. Không thêm mục vào baseline để chữa check đỏ; CI cũng chặn tăng budget so với base commit.

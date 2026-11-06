# Voice chat trong phòng chơi

> **Trạng thái:** đã làm theo hướng A (WebRTC mesh) — `server/src/voice.js`, `client/src/voice.js`, nút thoại ở đầu phòng + khối "Kênh thoại" trong tab Người chơi.

## Kiểm tra lỗi nghe / nói trong phòng đông người

- Client giữ tín hiệu đến sớm trong lúc chờ vào kênh, xử lý SDP/ICE tuần tự và giữ ICE đến trước SDP. Mỗi cặp dùng perfect negotiation để xử lý offer đồng thời.
- Mất kết nối Socket.IO thì dọn phiên voice; kết quả vào kênh của phiên cũ không được tạo lại kết nối. WebRTC bị gián đoạn 5 giây thì thử ICE restart.
- Khi quyền micro bị từ chối hoặc micro đã ngắt, bấm **Thử lại micro** trong kênh thoại sau khi cho phép quyền micro trên trình duyệt.
- Test hồi quy: `node --test server/test/voice-client.test.js server/test/voice.test.js`. Test phía client mô phỏng thời điểm tín hiệu và phòng 5 người; không thay thế kiểm tra âm thanh trên thiết bị thật.
- Kiểm tra thực tế bằng 5 thiết bị: mỗi người lần lượt nói, 4 người còn lại xác nhận nghe; thử vào cùng lúc, rời/vào lại, từ chối rồi cấp quyền micro, Wi-Fi và mạng di động. Nếu chỉ một số cặp mạng không kết nối, kiểm tra TURN đã cấp credential thành công trên server.

## Cấu hình TURN Cloudflare & tự tắt khi hết hạn mức miễn phí
> TURN **bật** khi có `CF_TURN_KEY_ID` + `CF_TURN_KEY_API_TOKEN` (không có TURN, người dùng 4G / NAT chặt sẽ kẹt ở "đang kết nối…"). Muốn tạm tắt: `VOICE_TURN_ENABLED=0`.

1. Cloudflare dashboard → **Realtime → TURN Server → Create** → lấy **Turn Token ID** và **API Token** → đặt `CF_TURN_KEY_ID`, `CF_TURN_KEY_API_TOKEN` trên Render.
2. (Để tự tắt khi gần hết miễn phí) Tạo API token quyền **Account → Account Analytics → Read** → `CF_ANALYTICS_TOKEN`; Account ID ở trang tổng quan → `CF_ACCOUNT_ID`.
3. Server đọc dung lượng TURN (egress) từ đầu tháng mỗi 10 phút qua GraphQL Analytics (`callsTurnUsageAdaptiveGroups`). Chạm `VOICE_TURN_QUOTA_GB` (mặc định 900 GB, chừa 100 GB vì số liệu lấy mẫu và trễ vài phút):
   - `VOICE_QUOTA_ACTION=disable` (mặc định): tắt voice chat, đưa mọi người ra khỏi kênh, **thu hồi mọi credential TURN đã cấp** (ngừng phát sinh dung lượng ngay), nút thoại ẩn đi; đầu tháng sau tự bật lại.
   - `VOICE_QUOTA_ACTION=stun`: vẫn cho nói chuyện nhưng không cấp TURN nữa (miễn phí hoàn toàn; ~10–20% mạng như 4G/NAT chặt sẽ không kết nối được).
4. Không đặt biến nào của Cloudflare → chỉ dùng STUN (miễn phí, không giới hạn), không có gì phải theo dõi.

Lưu ý: chốt chặn trên là phía app. Nên đặt thêm **cảnh báo chi tiêu (billing notification)** trong Cloudflare làm lớp bảo vệ thứ hai. Ước lượng: âm thanh Opus ~40 kbps/luồng ≈ 18 MB/giờ/luồng — chỉ những kết nối phải đi qua TURN mới tính; 1.000 GB ≈ hơn 50.000 giờ-luồng/tháng, rất khó dùng hết với nhóm bạn bè.


## Nghiên cứu ban đầu

### Mục tiêu
- Người trong cùng một phòng nói chuyện bằng giọng nói khi chơi (2–8 người, chủ yếu 2–6).
- Bật/tắt mic một chạm, thấy ai đang nói, không làm chậm game.
- Chi phí ≈ 0 với quy mô bạn bè; chạy được trên Render (gói hiện tại) + điện thoại.

## Các hướng làm

| Hướng | Cách hoạt động | Ưu | Nhược | Chi phí |
|---|---|---|---|---|
| **A. WebRTC mesh** (khuyến nghị) | Trình duyệt gửi âm thanh trực tiếp cho nhau; server Socket.IO hiện có chỉ chuyển "tín hiệu" (offer/answer/ICE) | Không cần server media, độ trễ thấp nhất, server gần như không tốn thêm tài nguyên | Mỗi người gửi N−1 luồng → ổn tới ~6 người (âm thanh Opus ~32 kbps/luồng); cần TURN cho mạng khó (4G/NAT đối xứng ~10–20% trường hợp) | Free; TURN: Cloudflare Realtime TURN free 1.000 GB/tháng, sau đó $0,05/GB |
| B. SFU tự host (mediasoup / LiveKit OSS) | Mỗi người gửi 1 luồng lên server, server chia lại | Mở rộng tới hàng chục người | Cần UDP & nhiều CPU — Render web service không mở cổng UDP → phải thuê VPS riêng | VPS ~5 $/tháng + công vận hành |
| C. Dịch vụ có sẵn (LiveKit Cloud, Cloudflare Realtime SFU, Daily, Agora) | SDK + token do server mình ký | Ổn định, ít code | Phụ thuộc bên thứ ba, cần API key/secret, giới hạn gói free | Gói free đủ cho bạn bè; vượt thì tính theo phút/GB |

**Đề xuất:** làm **A (mesh)** trước — hợp với phòng 2–6 người, tận dụng Socket.IO sẵn có, không thêm hạ tầng.
Thêm **TURN của Cloudflare** để chắc chắn kết nối được qua 4G. Nếu sau này cần phòng đông (>6 người nói cùng lúc) thì chuyển sang C (LiveKit Cloud / Cloudflare SFU) mà không đổi giao diện.

## Thiết kế (hướng A)

### Server (`server/src/connection.js`)
- Sự kiện mới (đi qua rate limit hiện có, chỉ trong cùng phòng, kiểm tra người gửi là thành viên phòng):
  - `voice:join` / `voice:leave` → server giữ `room.voice = Set<userId>` và phát danh sách cho cả phòng.
  - `voice:signal { to, data }` → chuyển nguyên `data` (SDP/ICE) tới `to` nếu cả hai đều trong `room.voice`. Giới hạn kích thước (vd. 16 KB) và tần suất.
  - `voice:state { muted, speaking }` → hiển thị biểu tượng mic/đang nói.
- `GET /api/turn` (chỉ khi đã qua auth gate): gọi API Cloudflare tạo credential TURN ngắn hạn (TTL ~1 giờ) từ biến môi trường `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN`. Không có biến → chỉ trả STUN công cộng.
- Rời phòng / mất kết nối → tự `voice:leave`.

### Client
- Hook `useVoice(room)`:
  - `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })` — chỉ xin quyền mic khi người dùng bấm "Bật mic" (không tự xin).
  - Mỗi cặp người: một `RTCPeerConnection`; dùng mẫu **"perfect negotiation"** (người có id nhỏ hơn là `polite`) để tránh va chạm offer.
  - Phát âm thanh người khác bằng `<audio autoplay playsinline>`; iOS cần một lần chạm của người dùng trước khi phát → nút "Vào kênh thoại" chính là lần chạm đó.
  - Phát hiện đang nói: `AudioContext` + `AnalyserNode` (ngưỡng âm lượng) → viền xanh quanh tên.
  - Nhấn‑để‑nói tùy chọn (giữ phím `V` / giữ nút trên điện thoại).
- Giao diện:
  - Nút mic ở đầu phòng (cạnh Thông tin / Trò chuyện): Tắt → Bật → Tắt tiếng; huy hiệu số người đang trong kênh thoại.
  - Tab "Người chơi" hiển thị ai đang trong kênh, mic bật/tắt, đang nói; chỉnh âm lượng từng người.
- CSP: WebRTC không bị `connect-src` chặn; chỉ cần thêm `connect-src` cho `/api/turn` (cùng origin, đã có `'self'`).

### Bảo mật & riêng tư
- Chỉ người đã vào phòng mới nhận/gửi tín hiệu; server không ghi âm, âm thanh mã hóa DTLS‑SRTP đầu‑cuối giữa các trình duyệt.
- Credential TURN ngắn hạn, không lộ API token ra client.
- Người xem (spectator) chỉ nghe hay được nói? → cấu hình theo phòng (mặc định: được nghe, chủ phòng cho phép nói).

## Các bước & ước lượng
1. Signaling trên server + test e2e hai trình duyệt (Playwright có `--use-fake-device-for-media-stream`) — ~0,5 ngày
2. Hook `useVoice` + nút mic + chỉ báo đang nói — ~1 ngày
3. TURN Cloudflare + `/api/turn` + hướng dẫn thêm biến môi trường trên Render — ~0,5 ngày
4. Kiểm thử trên iOS Safari / Android Chrome / 4G, chỉnh echo & tự phát âm thanh — ~0,5–1 ngày

Nguồn: [Cloudflare Realtime — pricing](https://developers.cloudflare.com/realtime/pricing/), [TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/).

## Rủi ro
- iOS Safari: phải chạm để phát âm thanh, chuyển loa ngoài/tai nghe đôi khi lạ → test kỹ.
- Mạng công ty/trường chặn UDP → cần TURN qua TCP/TLS 443 (Cloudflare hỗ trợ).
- Mesh > 6 người nói cùng lúc: tốn băng thông upload trên điện thoại → giới hạn số người trong kênh thoại (vd. 6) cho tới khi chuyển SFU.

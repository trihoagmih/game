# Chạy cụm game bằng Docker Compose

Production hiện chạy trên một mini PC tại nhà, người chơi vào qua Cloudflare Tunnel (xem [ten-mien.md](ten-mien.md)). Cách làm giống hệt trên VPS; chỉ khác phần đưa app ra Internet.

## Những việc bạn cần làm

1. Chuẩn bị máy Linux có Docker Engine và Docker Compose plugin. Khởi điểm để thử nghiệm: 2 nhân, 4 GB RAM nếu build tại chỗ (ít hơn nếu dùng image GHCR); đây không phải cam kết sức chứa. Hai game node, Redis và PostgreSQL trên một máy vẫn có chung điểm lỗi là máy đó.
2. Chọn cách đưa app ra Internet, không mở 3001/5432/6379 ra ngoài:
   - Máy ở nhà hoặc sau CGNAT: Cloudflare Tunnel, trỏ hostname tới `http://localhost:3001`; không mở port trên router.
   - VPS có IP công khai: trỏ domain về IP, cài Caddy trên host để cấp HTTPS, chỉ mở 80/443 và SSH.
3. Clone repo, checkout branch/release đã review và kiểm thử. Copy `.env.example` thành `.env`.
4. Tạo bốn secret độc lập bằng `openssl rand -hex 32`. Điền `APP_PASSWORD`, `REDIS_PASSWORD`, `POSTGRES_PASSWORD`, `SNAPSHOT_KEY`; giữ password Redis/PostgreSQL ở dạng hex để URL không cần escape. Đặt quyền `.env` là `chmod 600 .env`. Không commit file này.
5. Nhiều workspace: thêm `APP_SERVERS='{"Tên A":"mật khẩu A","Tên B":"mật khẩu B"}'` (giữ nháy đơn). Khi có `APP_SERVERS`, `APP_PASSWORD` bị bỏ qua nhưng Compose vẫn yêu cầu có giá trị. Voice chat: thêm `VOICE_SERVERS` và khóa TURN Cloudflare (`CF_TURN_KEY_ID`, `CF_TURN_KEY_API_TOKEN`, tùy chọn `CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN`); thiếu khóa thì chỉ dùng STUN.
6. Chạy `docker compose config --quiet`, rồi `docker compose up -d --build`. Máy yếu: đặt `GAME_IMAGE=ghcr.io/<owner>/<repo>:latest` trong `.env` và chạy `docker compose pull && docker compose up -d --no-build` để dùng image CI đã build (package GHCR private thì `docker login ghcr.io` bằng token `read:packages`).
7. Kiểm tra `docker compose ps`, `docker compose logs --tail=100 node-a node-b redis postgres`, và dòng `Auth gate` / `Voice chat` trong log node khớp cấu hình.
8. Mở domain, tạo vài phòng và vào cùng phòng từ hai trình duyệt. Kiểm tra reconnect và restart node trên môi trường thử nghiệm trước khi chuyển người chơi.
9. Thiết lập backup Redis và PostgreSQL, cất `SNAPSHOT_KEY` (hoặc cả `.env`) ở nơi riêng. Thiếu key cũ thì không đọc được các ván đã lưu.

Ví dụ `/etc/caddy/Caddyfile` khi dùng VPS:

```caddy
game.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

Proxy Compose chỉ bind localhost. Chạy `cloudflared` hoặc Caddy trên host; nếu đặt trong container, nối vào cùng network và trỏ đến `proxy:80` thay vì localhost.
Nginx nhận IP từ proxy trên host qua gateway `172.30.0.1` bằng cấu hình trusted proxy; đừng đổi sang tin mọi địa chỉ gửi header.

## Dữ liệu và giới hạn phục hồi

- Redis bật AOF `everysec`, volume `redis-data`, chính sách `noeviction`, giới hạn dữ liệu 256 MB. Redis không có host port.
- Mỗi shard checkpoint tối đa 32 MB (trước mã hóa) mỗi 2 giây. Khi Redis đầy hoặc mất lease, node dừng để tránh hai owner cùng sửa một phòng.
- Snapshot gồm state bí mật và token danh tính; được mã hóa AES-256-GCM bằng `SNAPSHOT_KEY`. Redis metadata vẫn có tên phòng/tên người dùng và token identity: bảo vệ Redis/network/backup.
- Restart cùng `NODE_ID` sẽ phục hồi phòng và đặt lại timer theo deadline tuyệt đối. Thời gian downtime vẫn bị trừ. Voice cần tham gia lại.
- Khi node bị kill, checkpoint có thể chậm hơn state gần nhất ít nhất một chu kỳ checkpoint; AOF còn có cửa sổ mất dữ liệu riêng. Đây không phải ghi bền từng hành động đã ack.
- Graceful shutdown ngừng nhận hành động, dừng timer, lưu checkpoint cuối rồi đóng kết nối. Nó vẫn ngắt socket trong lúc restart; không phải chuyển phòng nóng không gián đoạn.
- Thay schema state phải cập nhật codec/schema và kiểm thử tương thích. Không triển khai code không tương thích rồi dùng snapshot cũ.
- Phải giữ `NODE_ID` ổn định. Lease hết hạn sau 15 giây; nếu container mới báo owner còn tồn tại thì chờ lease hết hạn rồi restart lại. Không chạy hai owner cùng ID.
- Các tab của cùng danh tính phải ở cùng shard. Chuyển sang phòng ở shard khác cần đóng các tab game còn lại; client sẽ tải lại và tiếp tục thao tác tạo/vào phòng.

## Kiểm tra và triển khai

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 node-a node-b
curl -f http://127.0.0.1:3001/ready
```

Kiểm thử Redis riêng (chỉ trên máy test, không mở Redis production ra Internet):

```sh
TEST_REDIS_URL=redis://127.0.0.1:6379 npx tsx --test server/test/cluster.test.ts
```

Cập nhật bằng image GHCR: `git pull && docker compose pull && docker compose up -d --no-build`.
Để cập nhật lần lượt: build hoặc pull image trước, sau đó `docker compose up -d --no-deps node-b`, kiểm tra log/readiness và reconnect rồi làm tương tự với `node-a`.
Vẫn có thời gian ngắt ở shard đang restart. Không dùng `docker compose down -v` vì nó xóa dữ liệu Redis và PostgreSQL.

## Backup và rollback

Tạo bản sao RDB nhất quán từ Redis đang chạy; tạo thư mục backup riêng và đặt quyền truy cập hạn chế:

```sh
mkdir -p backups
chmod 700 backups
docker compose exec -T redis sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --rdb /data/backup.rdb'
docker compose cp redis:/data/backup.rdb ./backups/game.rdb
```

Backup kỷ lục PostgreSQL:

```sh
docker compose exec -T postgres pg_dump -U game game > backups/records-$(date +%F).sql
```

Copy bản backup ra máy khác, mã hóa nơi lưu và giữ các secret ở nơi riêng. Thử restore trên một volume test trước.
RDB chứa cả dữ liệu snapshot đã mã hóa và metadata chưa mã hóa.

Rollback code chỉ an toàn nếu version cũ đọc được schema snapshot hiện tại. Nếu không, cần phục hồi code + Redis backup + secret tương ứng; các thao tác sau backup sẽ mất.
Khi phục hồi RDB vào volume mới, dừng các game node trước, dùng Redis với RDB đó và bật lại AOF theo hướng dẫn Redis. Không chép RDB đè lên một Redis đang chạy hoặc để AOF cũ ghi đè dữ liệu restore.

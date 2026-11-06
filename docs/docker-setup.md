# Chạy cụm game trên VPS bằng Docker Compose

## Những việc bạn cần làm

1. Chuẩn bị VPS Linux có Docker Engine và Docker Compose plugin. Khởi điểm để thử nghiệm: 2 vCPU, 2 GB RAM; đây không phải cam kết sức chứa. Hai game node và Redis trên một VPS vẫn có chung điểm lỗi là VPS đó.
2. Trỏ domain về IP VPS, cài Caddy trên host để cấp HTTPS. Chỉ mở cổng 80/443 và SSH cần thiết; không mở 3001/6379 ra Internet.
3. Clone repo, checkout branch/release đã review và kiểm thử. Copy `.env.example` thành `.env`.
4. Tạo ba secret độc lập bằng `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Điền `APP_PASSWORD`, `REDIS_PASSWORD`, `SNAPSHOT_KEY`; giữ Redis password ở dạng hex để URL không cần escape. Đặt quyền `.env` là `chmod 600 .env`. Không commit file này.
5. Chạy `docker compose config --quiet`, rồi `docker compose up -d --build`. Kiểm tra `docker compose ps` và `docker compose logs --tail=100 node-a node-b redis`.
6. Mở `https://game.example.com`, tạo vài phòng và vào cùng phòng từ hai trình duyệt. Kiểm tra reconnect và restart node trên môi trường thử nghiệm trước khi đổi DNS production.
7. Thiết lập backup Redis và cất `SNAPSHOT_KEY` riêng. Thiếu key cũ thì không đọc được các ván đã lưu.

Ví dụ `/etc/caddy/Caddyfile`:

```caddy
game.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

Proxy Compose chỉ bind localhost. Nếu Caddy nằm trong container, nối vào cùng network và trỏ đến `proxy:80` thay vì localhost.
Nginx nhận IP từ Caddy bằng cấu hình trusted proxy bên dưới; đừng đổi sang tin mọi địa chỉ gửi header.

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
TEST_REDIS_URL=redis://127.0.0.1:6379 node --test server/test/cluster.test.js
```

Để cập nhật lần lượt: build image trước, sau đó `docker compose up -d --no-deps node-b`, kiểm tra log/readiness và reconnect rồi làm tương tự với `node-a`.
Vẫn có thời gian ngắt ở shard đang restart. Không dùng `docker compose down -v` vì nó xóa dữ liệu Redis.

## Backup và rollback

Tạo bản sao RDB nhất quán từ Redis đang chạy; tạo thư mục backup riêng và đặt quyền truy cập hạn chế:

```sh
mkdir -p backups
chmod 700 backups
docker compose exec -T redis sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --rdb /data/backup.rdb'
docker compose cp redis:/data/backup.rdb ./backups/game.rdb
```

Copy bản backup ra máy khác, mã hóa nơi lưu và giữ các secret ở nơi riêng. Thử restore trên một volume test trước.
RDB chứa cả dữ liệu snapshot đã mã hóa và metadata chưa mã hóa.

Rollback code chỉ an toàn nếu version cũ đọc được schema snapshot hiện tại. Nếu không, cần phục hồi code + Redis backup + secret tương ứng; các thao tác sau backup sẽ mất.
Khi phục hồi RDB vào volume mới, dừng các game node trước, dùng Redis với RDB đó và bật lại AOF theo hướng dẫn Redis. Không chép RDB đè lên một Redis đang chạy hoặc để AOF cũ ghi đè dữ liệu restore.

## Nếu tiếp tục dùng Render

`render.yaml` hiện tại không thay đổi: một instance, không Redis, không tự tạo dịch vụ trả phí.
Để chạy cluster trên Render cần các service có route ổn định tương đương `/nodes/a`, `/nodes/b`, Redis-compatible Key Value lưu bền, cùng `APP_PASSWORD`, `SNAPSHOT_KEY`, `CLUSTER_NODES` và namespace trên mọi node.
Không chỉ tăng `numInstances` cho service hiện tại: mỗi shard cần ID và route riêng. File Compose dành cho VPS/local, không phải cấu hình deploy trực tiếp trên Render.
Giá host/Redis phụ thuộc gói nhà cung cấp; repo không tạo đăng ký hay đổi gói của bạn.

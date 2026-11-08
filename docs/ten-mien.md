# Tên miền riêng cho Sảnh Trò Chơi

App đang chạy ở `https://game-lobby.manh.pics`, trên một mini PC tại nhà chạy [Docker Compose](docker-setup.md). Người chơi vào qua **Cloudflare Tunnel**: không mở port trên router, chạy được cả khi nhà mạng dùng CGNAT/IP động, HTTPS do Cloudflare cấp.

```
Trình duyệt ──HTTPS 443──▶ Cloudflare ──tunnel──▶ cloudflared (host) ──▶ 127.0.0.1:3001 (Nginx của Compose)
```

DNS không trỏ được vào một cổng; ô *Service URL* của tunnel là nơi nối hostname với cổng 3001.

## Gắn tên miền bằng Cloudflare Tunnel

1. Thêm tên miền vào Cloudflare (gói Free), đổi nameserver ở nơi mua tên miền sang 2 nameserver Cloudflare đưa. Tắt DNSSEC ở nơi mua trước khi đổi. Giữ nguyên bản ghi MX/TXT của email; xóa bản ghi A/AAAA/CNAME trùng với hostname sẽ dùng cho app.
2. **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**, chọn Debian 64-bit và chạy các lệnh cài trên máy chủ. Lệnh cuối là `sudo cloudflared service install <token>`; token là secret, không commit hay chụp màn hình.
3. Trong tunnel, thêm **Public hostname**: hostname mong muốn, Service type `HTTP`, URL `localhost:3001`. Cloudflare tự tạo bản ghi CNAME và chứng chỉ.
4. Kiểm tra từ mạng di động. Trên máy chủ: `systemctl status cloudflared` phải `active (running)`; log node phải in IP thật của người chơi, không phải `172.30.x.x`.

Chạy `cloudflared` trên host, không trong container: Nginx của Compose chỉ tin `X-Forwarded-For` từ gateway `172.30.0.1`, nên IP người chơi (dùng cho giới hạn theo IP) chỉ đúng khi tunnel đi vào qua cổng 3001 trên host.

| Lỗi | Nguyên nhân thường gặp |
|---|---|
| 502 Bad Gateway | App chưa chạy: `docker compose ps`, `curl -f http://127.0.0.1:3001/ready` |
| 1033 | `cloudflared` không chạy: `sudo systemctl restart cloudflared` |
| Không lưu được hostname | Còn bản ghi DNS trùng tên |

## Ảnh hưởng tới app

- Không cần đổi code: CSP dùng `'self'`, cookie/phiên theo origin hiện tại, Socket.IO kết nối cùng origin.
- Mỗi hostname là một origin riêng: người chơi đăng nhập lại khi đổi hostname. Muốn dùng cả `www` thì chuyển hướng `www` về một hostname chính bằng Cloudflare Redirect Rules thay vì phục vụ app ở cả hai.
- Voice chat dùng TURN của Cloudflare Realtime theo khóa tài khoản (`CF_TURN_KEY_ID`, `CF_TURN_KEY_API_TOKEN`), không phụ thuộc tên miền hay tài khoản Cloudflare đang giữ DNS. Âm thanh không đi qua tunnel.

## Chọn tên miền

| Loại | Chi phí (tham khảo, 11/2026) | Ghi chú |
|---|---|---|
| `.com` qua Cloudflare Registrar | ~11 USD/năm, gia hạn cùng giá | DNS Cloudflare miễn phí |
| `.vn` / `.com.vn` (Mắt Bão, P.A Việt Nam, Tenten…) | vài trăm nghìn – ~1 triệu đ/năm | Cần CCCD |
| `.id.vn` / `.io.vn` | rẻ; kiểm tra ưu đãi hiện hành trên tenmien.vn | Hợp dự án cá nhân |
| Không có tên miền: Tailscale Funnel | 0 đ | Địa chỉ `*.ts.net` cố định; cần tự kiểm tra IP người chơi trong log |

Nguồn: [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), [CostGoat — giá .com Cloudflare](https://costgoat.com/pricing/cloudflare-domains), [Tailscale Funnel](https://tailscale.com/kb/1223/funnel).

# 🎲 Sảnh Trò Chơi — Cờ vua · Tá lả · Sâm lốc · Poker · Cờ tướng · Cờ caro · Nối từ · Vẽ đoán · Tam sao thất bản · Líu lưỡi · Nối thú · Rắn săn mồi · Tetris · Bay qua khe · Đào vàng · Đố vui · Đoán chữ

Ứng dụng sảnh game nhiều người chơi thời gian thực.

**Tài liệu cho phát triển và AI:** [AGENTS.md](AGENTS.md) · [Kiến trúc hệ thống](docs/architecture.md) · [Convention](docs/conventions.md) · [Thêm feature](docs/feature-development.md).

- **Frontend:** React 18 + Vite + TypeScript/TSX
- **Backend:** Node.js 22+ + Express + Socket.IO + TypeScript (server giữ toàn bộ luật chơi, client không gian lận được)
- **Logic game dùng chung:** `shared/` (TypeScript, có unit test)

## Tính năng

**Sảnh / phòng**
- Đặt tên người chơi (lưu trên trình duyệt, tự kết nối lại khi F5 / rớt mạng, giữ ghế 60 giây)
- Tạo / vào / rời / xóa phòng, đặt và đổi tên phòng, lọc và tìm phòng theo trò chơi
- Vào chơi hoặc chỉ **xem**, ngồi / đứng dậy, chủ phòng mời người ra, chat trong phòng, chia sẻ link phòng
- **Không tự bắt đầu ván:** người ngồi bàn bấm **Sẵn sàng**, khi mọi người đã sẵn sàng thì **chủ phòng bấm Bắt đầu** (chủ phòng không cần bấm sẵn sàng; áp dụng cho mọi trò, kể cả chơi lại). Poker: chủ phòng bắt đầu một lần rồi các ván nối tiếp nhau, có nút **Tạm dừng**
- **Bàn bài (Tá lả, Sâm lốc, Poker):** người xem được **ngồi chờ ngay cả khi ván đang diễn ra**, vào chơi từ ván sau
- Chủ phòng rời thì quyền chủ phòng tự chuyển cho người khác đang kết nối; người cuối cùng rời phòng thì phòng tự xóa ngay (người mất kết nối được giữ chỗ 60 giây để vào lại)
- **Báo bản deploy mới:** khi server được deploy bản mới, người đang mở app thấy thông báo "Đã có phiên bản mới" kèm nút **Tải lại** (tải lại vẫn giữ chỗ trong phòng). Phiên bản hiện tại xem ở `/health`

**Cờ tướng**
- Đủ luật: cản chân mã, cản mắt tượng, pháo cần ngòi, tốt qua sông, cấm lộ mặt tướng, cấm tự để bị chiếu, chiếu bí / hết nước là thua
- Đồng hồ **8 phút mỗi bên** (đổi được khi tạo bàn), hết giờ là thua
- **Xin thua**, **cầu hòa**, **xin đi lại** (đối thủ phải đồng ý), **chơi lại** (tự đổi màu)
- **Chế độ người xem**, biên bản nước đi theo ký hiệu Việt Nam (P2-5, M8.7…), lật bàn cờ

**Cờ caro**
- Bàn 15×15 (đổi được 10–20 khi tạo bàn), X đi trước, 5 quân liên tiếp (ngang / dọc / chéo) là thắng
- Luật **chặn hai đầu** (bật / tắt khi tạo bàn): dãy bị quân đối thủ chặn cả hai đầu thì không tính; kín bàn là hòa
- Đồng hồ **10 phút mỗi bên**, xin thua, cầu hòa, xin đi lại, chơi lại (đổi lượt đi trước), chế độ người xem
- Tô sáng nước vừa đi và dãy thắng, biên bản nước đi theo tọa độ (H8, J7…)
- **Bảng điểm** cộng dồn qua các ván (xem bên dưới)
- **Phím tắt:** `←↑→↓` di chuyển con trỏ · `Enter`/`Space` đánh · `Esc` ẩn con trỏ
- **Chơi với máy** (Dễ / Vừa / Khó): chọn khi tạo bàn (bạn cầm X đi trước) hoặc bấm **Chơi với máy** ở ghế trống. Máy luôn sẵn sàng, đồng ý chơi lại và cho đi lại, chỉ đồng ý hòa khi bàn gần kín. Máy Khó tìm trước vài nước (alpha-beta), chỉ nghĩ dưới 0,5 giây mỗi nước (`shared/src/caroBot.ts`)

**Nối từ** (2–8 người)
- Mỗi từ gồm **2 chữ**, chữ đầu phải trùng chữ cuối của từ trước: *con mèo → mèo con → con đường*; không lặp từ trong ván
- Kiểm tra mỗi chữ có trong **từ điển âm tiết tiếng Việt** (6.609 âm tiết, tắt được khi tạo bàn); bỏ dấu kiểu cũ hay mới đều được (*hòa* = *hoà*)
- **Từ mở đầu không được quá khó:** chữ cuối phải có ít nhất 10 từ nối tiếp trong từ điển (vd. không mở bằng *ao chuôm*)
- **Nối từ cụt là thắng luôn:** nối một từ (có trong từ điển) mà từ điển không còn từ nào chưa dùng bắt đầu bằng chữ cuối → thắng ngay
- Từ vô nghĩa? Bạn bè bấm **❌ phản đối** — quá nửa số người còn lại phản đối thì từ bị gỡ, người đó nối lại
- Mỗi lượt 10–60 giây, hết giờ mất 1 mạng (1–3 mạng), hết mạng bị loại; người cuối cùng còn lại thắng. Có bảng thắng qua các ván
- Khi tới lượt, ô nhập tự điền sẵn chữ đầu — chỉ cần gõ chữ thứ hai rồi `Enter`
- **Chơi với máy** (tối đa 3 máy mỗi bàn): chọn khi tạo bàn hoặc bấm **Chơi với máy / Thêm máy**. Máy chỉ dùng từ có trong từ điển. Máy Dễ hay bí, máy Vừa nối ngẫu nhiên, máy Khó chọn từ có chữ cuối khó nối tiếp nhất. Máy không bỏ phiếu phản đối và không được tính vào số phiếu cần để gỡ từ. Bàn đầy thì người mới vào được nhường ghế của một máy (`shared/src/wordchainBot.ts`)

**Đố vui** (kiểu Kahoot, 1–30 người, chơi một mình cũng được)
- Câu hỏi trắc nghiệm 2–4 đáp án (▲ ◆ ● ■), mỗi câu 5–60 giây. Đúng được tới 1.000 điểm, trả lời càng nhanh càng nhiều điểm (`1000 × (1 − thời gian/2)`, trong 0,5 giây được trọn điểm). Đúng liên tiếp được thưởng chuỗi +100 … +500
- **Bộ câu hỏi có sẵn** (`server/src/data/quiz-vi.json`, 423 câu, 17 chủ đề): lấy ngẫu nhiên, ít lặp lại trong phòng, chọn được chủ đề và số câu
- **Tự soạn bộ câu hỏi** bằng văn bản đơn giản (`? câu hỏi`, `* đáp án đúng`, `- đáp án sai`, `# tên bộ`), kiểm tra ngay khi gõ, lưu nhiều bộ trên trình duyệt, bấm "Dùng bộ này" để cả phòng chơi
- Sau mỗi câu: đáp án đúng, số người chọn từng đáp án, bảng xếp hạng; cuối ván có bục trao giải. Server giữ đáp án và tự đo thời gian, client không biết đáp án trước
- **Phím tắt:** `1`–`4` chọn đáp án · `Enter`/`→` câu tiếp

**Đoán chữ** (kiểu Wordle tiếng Việt, 1–10 người)
- Đoán từ **2 chữ** trong 6 lượt. Mỗi chữ chấm theo **âm đầu · vần · thanh**: 🟩 đúng chỗ, 🟨 có ở chữ kia, ⬛ không có. Có bảng tổng hợp các âm đầu / vần / thanh đã thử
- **Đua:** cùng một từ, ai đoán ra ít lượt nhất (rồi nhanh nhất) thắng; trong lúc chơi chỉ thấy màu ô của người khác. **Cùng đoán:** cả phòng chung 6 lượt. **Từ của ngày:** mọi người cùng một từ mỗi ngày
- Đáp án lấy từ `server/src/data/vi-words-doanchu.txt` (639 từ thông dụng), từ đoán kiểm tra bằng từ điển của Nối từ

**Vẽ đoán** (2–12 người)
- Mỗi vòng ai cũng được vẽ một lần (1–6 vòng). Người vẽ chọn 1 trong 3 từ (~400 từ tiếng Việt dễ vẽ, chủ phòng có thể thêm từ riêng hoặc chỉ dùng từ riêng), vẽ trong 30–180 giây
- Người khác gõ đoán — **không cần gõ dấu**; sai 1 chữ cái được báo "gần đúng" (chỉ mình thấy). Đoán càng sớm càng nhiều điểm, người vẽ được 60 điểm cho mỗi người đoán đúng; ai cũng đoán đúng thì sang lượt sớm
- Gợi ý: ô chữ hiện số chữ cái, quá nửa thời gian thì lộ dần vài chữ (tắt được khi tạo bàn)
- Bút 16 màu, 5 cỡ nét, tẩy, đổ màu, hoàn tác, xóa. Nét vẽ truyền trực tiếp tới mọi người; vào xem / tải lại giữa lượt vẫn thấy cả bức vẽ
- Chat của phòng chặn tin nhắn lộ đáp án; người vào giữa ván được đoán ngay và tới lượt thì vẽ; chủ phòng có thể dừng ván. Có bảng thắng qua các ván
- **Phím tắt (khi vẽ):** `B` bút · `E` tẩy · `F` đổ màu · `Z` hoàn tác · `1–5` cỡ nét

**Tam sao thất bản (vẽ)** (3–12 người)
- Khi tạo phòng, chọn **Cổ điển** hoặc **Chuyền hình**. Chuyền hình: người đầu nhận từ khóa ngẫu nhiên và vẽ; từng người sau chỉ xem hình ngay trước để vẽ lại; người cuối đoán bằng lời. Mỗi ván xáo trộn thứ tự người chơi, cuối ván lật từ khóa và toàn bộ chuỗi hình.
- Mọi người làm **cùng lúc**: mỗi người viết một câu → người sau **vẽ** lại câu đó → người sau nữa nhìn tranh **đoán bằng lời** → lại vẽ… Mỗi câu chuyện đi qua đủ mọi người đúng một lần (thứ tự ngẫu nhiên, đề bài không lộ tên người trước)
- Thời gian viết 15–120 giây, vẽ 30–240 giây; bấm **Xong** để nộp sớm (bấm lại để sửa), hết giờ thì phần đang làm dở vẫn được tính. Bước đầu có nút lấy gợi ý nếu bí ý tưởng
- Cuối ván chủ phòng bấm **Tiếp** (`→` / `Space`) để lật từng phần của từng câu chuyện cho cả bàn cùng xem; xong ván ai cũng xem lại được mọi câu chuyện
- Tranh chỉ lộ đúng lúc: khi đang chơi mỗi người chỉ xem được tranh mình được giao. Người rời giữa ván thì phần của họ để trống, câu chuyện vẫn đi tiếp; người xem có thể ngồi chờ ván sau

**Nối thú** (1–8 người, kiểu trò "Pikachu" / Onet)
- Bàn 9×16 ô (đổi được 4–10 hàng × 4–18 cột) gồm 36 hình thú. Chọn hai ô **cùng hình** nối được bằng đường gấp khúc **tối đa 3 đoạn** (≤ 2 lần rẽ), chỉ đi qua ô trống, được vòng ra **ngoài viền** bàn — nối được thì hai ô biến mất, đường nối hiện lên chốc lát
- **Đua cùng một bàn:** mọi người nhận cùng một bàn (cùng hạt giống), mỗi người tự nối trên bản của mình; thanh tiến độ của từng người hiện trên đầu. Ai dọn sạch trước thắng, hết giờ (mặc định 8 phút) thì xếp theo điểm. Một người cũng chơi được
- Mỗi cặp 10 điểm, nối liên tiếp trong 3 giây được **combo** +2/bậc; dọn sạch được thưởng 1 điểm cho mỗi giây còn lại
- **Gợi ý** và **đổi hình** (xáo bàn) có giới hạn lượt; hết nước đi thì bàn **tự xáo** miễn phí. Tùy chọn **trọng lực**: nối xong các hình phía trên rơi xuống
- Server kiểm tra mọi nước nối; người xem bấm tên người chơi để xem bàn của họ. Điện thoại dọc: bàn tự xoay dọc cho ô to hơn
- **Phím tắt:** `H` gợi ý · `S` đổi hình · `Esc` bỏ chọn
- **Kiểu hình:** mặc định là 36 quái thú **pixel 16×16** tự vẽ theo phong cách game cầm tay cổ điển (`client/src/games/onetSprites.ts`); chuyển lại emoji ở khung Thông tin, lựa chọn lưu theo máy

**Rắn săn mồi** (1–8 người, kiểu rắn trên điện thoại đen trắng đời đầu)
- Màn hình LCD xanh 24×14 ô vẽ bằng từng điểm ảnh, điểm 4 chữ số, tiếng bíp sóng vuông khi ăn mồi. 9 cấp tốc độ, mỗi mồi được điểm bằng cấp; cứ 5 mồi hiện một **con thưởng** trong 40 bước, ăn càng sớm càng nhiều điểm
- Mê cung: Không tường (đi xuyên mép) · Hộp kín · Đường hầm · Bốn phòng · Đường ray. Tùy chọn giới hạn thời gian
- Mọi người cùng hạt giống, ai nhiều điểm nhất thắng. Client tự chạy rắn và gửi lượt rẽ `[bước, hướng]`; server **phát lại** để tự tính điểm (`shared/src/snake.ts`), không tin điểm client gửi. Nhiều người thì không được dừng — ai im lặng quá 4 giây, server cho rắn bò tiếp
- **Phím:** mũi tên / `W A S D` / `2 4 6 8` · `P`/`Space` tạm dừng (chơi một mình) · điện thoại: vuốt hoặc bàn phím ảo

**Líu lưỡi** (2–12 người, chia 2 đội)

- Ngồi vào bàn sẽ tự vào đội ít người hơn (**Đội Lúa Nếp** / **Đội Bưởi Chua**); trước ván có thể bấm đổi đội. Mỗi đội cần ít nhất 1 người.
- Hai đội thay phiên, mỗi lượt một người **đọc to** câu líu lưỡi hiện trên màn hình (bật mic hoặc ngồi cạnh nhau), trong 10–45 giây; câu có nhãn ×2/×3 phải đọc liền chừng ấy lần. Đọc xong bấm **Đọc xong** (Enter), không đọc nổi thì **Bỏ qua**.
- Mọi người còn lại (cả hai đội) chấm **Chuẩn** (1) hoặc **Vấp** (2), chấm được ngay khi đang nghe. Chuẩn ≥ Vấp là đọc chuẩn, đội được điểm theo độ khó (Khởi động 1 · Khó 2 · Siêu khó 3). Server giữ phiếu và tự chấm; phiếu người khác chỉ lộ số đếm khi có kết quả.
- Bộ ~130 câu soạn sẵn (có 13 câu tiếng Anh, gắn nhãn "Tiếng Anh") ở `server/src/data/twisters-vi.json` (l/n, s/x, tr/ch, r/d/gi, ươu, n/ng…), chọn độ khó Tăng dần / Nhẹ nhàng / Hiểm hóc. Hết lượt, đội nhiều điểm hơn thắng; một đội rời hết thì đội kia thắng.

**Tetris** (2 người, đua xóa hàng)

- Chủ phòng chọn mục tiêu từ 1 đến 100 hàng. Hai bàn dùng cùng thứ tự khối.
- Ai đạt mục tiêu trước thắng. Đầy bàn hoặc rời trận tính thua.
- Dùng phím mũi tên để di chuyển hoặc xoay, Z để xoay trái, Space để thả ngay. Điện thoại có nút điều khiển.

**Bay qua khe** (1–8 người, chạm để nảy)
- Chim lơ lửng ở màn **Chuẩn bị!** tới lần chạm đầu (tối đa 5 giây). Chạm màn hình / `Space` / `↑` để nảy, luồn qua khe giữa các cột đá; chạm cột hoặc đất là dừng. 3 độ khó (Dễ, Vừa, Cổ điển)
- Huy chương Đồng 10 · Bạc 20 · Vàng 30 · Bạch kim 40 khe, thẻ kết quả có kỷ lục trong phòng
- Đích N khe (ai qua đủ sớm nhất thắng, tính cả lúc chờ) hoặc **sinh tồn** (mục tiêu 0). Mọi người cùng dãy cột; người khác hiện thành chấm mờ ở đúng khoảng cách đang dẫn/bị bỏ lại; "Bảng đua" có thanh tiến độ từng người

**Đào vàng** (1–8 người, móc câu)
- Móc lắc như con lắc; chạm / `Space` / `↓` để phóng, `↑` hoặc `B` ném thuốc nổ phá món đang kéo. Vàng 4 cỡ, đá, kim cương, chuột chạy qua lại (có con ôm kim cương), thùng **TNT** nổ phá mọi thứ quanh nó, túi `?` (tiền, thuốc nổ hoặc nước tăng lực)
- 1–10 màn, mỗi màn 60 giây, mục tiêu cộng dồn 650$, 1.195$, 2.010$, 3.095$…; không đạt là dừng. Qua màn thì vào **cửa hàng** (thuốc nổ, nước tăng lực, cỏ may mắn, sách sưu tầm đá, nước đánh bóng kim cương; phím 1–5 mua, Enter sang màn)
- Mọi người cùng bản đồ, nhiều tiền nhất thắng; "Bảng tiền" hiện tiến độ tới mục tiêu của từng người

Hai trò này giống Rắn: client tự chạy engine và gửi lệnh `[bước, lệnh]` (`raceSync`), server **phát lại** để tự tính điểm (`shared/src/race.ts`, `skyhop.ts`, `goldmine.ts`). Vật lý dùng số nguyên, góc móc lấy từ bảng sin/cos hằng số để trình duyệt nào cũng ra cùng kết quả với server

**Bảng điểm (Cờ vua, Cờ tướng và Cờ caro)**
- Thắng **+1**, hòa **+½**, thua **0**. Điểm tính theo người chơi nên chơi lại đổi màu vẫn cộng đúng người
- Bảng tỉ số (số ván / thắng / hòa / thua / điểm) và lịch sử 30 ván gần nhất (ai cầm quân gì, lý do thắng, số nước)
- Sau mỗi ván, phòng chat báo tỉ số hiện tại; chủ phòng có thể **đặt lại bảng điểm** khi không có ván đang chơi
- Bảng điểm gắn với phòng, xóa phòng hoặc khởi động lại server là mất

**Sâm lốc** (2–5 người)
- Mỗi người 10 lá; 3 < … < K < A < 2 (heo), **không xét chất**. Rác, đôi, sám, tứ quý, sảnh (A-2-3… hoặc …Q-K-A, không vòng K-A-2)
- Chặn bằng bộ cùng loại, cùng số lá, cao hơn; **tứ quý chặt heo**; đã bỏ lượt thì nghỉ hết vòng
- **Báo Sâm** đầu ván (10 giây), **báo 1** (người sau còn 1 lá thì đánh rác phải đánh lá lớn nhất — tự kiểm tra), **tới trắng** (tứ quý heo, sảnh rồng, 5 đôi, 3 sám, đồng màu)
- Tính tiền: 1/lá còn lại, cóng 20, thối heo +5/con, chặt heo 10, Sâm / tới trắng 20 mỗi nhà — chỉnh trong `SAM_RULES` ở [shared/src/samloc.ts](shared/src/samloc.ts)
- Chọn bài là biết ngay bộ gì và có chặn được không; máy đánh hộ khi hết giờ / rời bàn; cộng dồn điểm qua các ván
- **Phím tắt:** `←/→` di chuyển · `Space`/`↑` chọn · `Enter` đánh · `P` bỏ lượt · `Esc` bỏ chọn · `Y`/`K` báo Sâm / không · `N` ván mới

**Poker (Texas Hold'em No-Limit)**
- Dealer / SB / BB xoay vòng, luật heads-up, side pot, chia pot hòa, all-in không đủ mức raise không mở lại quyền raise (luật TDA)
- Đếm giờ mỗi lượt (hết giờ tự check / bỏ), nạp thêm chip, nghỉ ván
- **Rabbit hunt:** ván kết thúc sớm vì mọi người bỏ bài thì người trong ván bấm ô 🐇 (hoặc phím `T`) để lật các lá bài chung *lẽ ra* sẽ ra — đúng thứ tự chia thật (có đốt bài), hiện mờ, không ảnh hưởng kết quả, cả bàn cùng thấy và được ghi vào Hands log. Bật/tắt khi tạo bàn
- **Blind tùy chỉnh:** đặt riêng small blind và big blind khi tạo bàn; chủ phòng đổi blind ngay tại bàn (nút ✎ cạnh mức blind, có nút nhanh ×1,5 / ×2 / giảm ½). Đổi giữa ván thì áp dụng từ ván sau
- **Hands log:** 50 ván gần nhất của bàn — stack đầu ván, D/SB/BB, từng hành động theo vòng (preflop / flop / turn / river), showdown, các pot và lời/lỗ của từng người; chuyển ván bằng `←/→`, sao chép ván dạng text. Chỉ thấy bài tẩy của mình và bài đã lật ở showdown, bài bỏ không bao giờ bị lộ
- **Phím tắt:** `F` bỏ bài · `C` theo/check · `K` check · `B` cược · `R` tố · `A` all-in · `↑/↓` ±1 BB (`Shift` ±10 BB) · `1–4` mức ⅓, ½, ¾ pot, pot · `Enter` xác nhận · `H` mở Hands log

**Tá lả (Phỏm)**
- Bốc / ăn / đánh, ăn phải tạo phỏm, lá đã ăn bị khóa, hai lá ăn không chung phỏm
- Lượt cuối: hạ phỏm (chọn tay hoặc tự động tối ưu), gửi bài, đánh lá cuối
- Ù (kể cả Ù đền), Móm, tính Nhất / Nhì / Ba / Bét, phạt bị ăn và bị ăn chốt, cộng dồn điểm qua các ván
- Gợi ý lá có thể tạo phỏm, máy đánh hộ khi hết giờ hoặc người chơi rời bàn
- **Phím tắt:** `D`/`Space` bốc · `E` ăn · `←/→` di chuyển · `↑`/`Space` chọn lá · `Enter` đánh · `H` hạ · `X` hạ tự động · `G` gửi · `U` Ù · `S` xếp bài · `N` ván mới

Bấm `?` trong phòng để xem bảng phím tắt.

### Luật tham khảo
- Cờ tướng: luật của Liên đoàn Cờ tướng châu Á (AXF). Chưa xử lý luật cấm chiếu dai / đuổi dai; người chơi có thể cầu hòa.
- Poker: Robert's Rules of Poker và luật của Poker TDA.
- Tá lả: luật miền Bắc phổ biến. Mức trả: Nhì 1, Ba 2, Bét 3, Móm 4, bị ăn 1, bị ăn chốt 4, Ù 5 mỗi nhà. Luật Tá lả khác nhau theo vùng, có thể chỉnh trong `TALA_RULES` ở [shared/src/tala.ts](shared/src/tala.ts).

## Chạy trên máy

```bash
npm install
npm run dev        # server :3001 + Vite :5173 (proxy socket sang server)
```
Mở http://localhost:5173 ở vài tab (hoặc tab ẩn danh) để thử nhiều người chơi.

```bash
npm run typecheck            # strict: shared, server, client, scripts, tests và wire contracts
npm test                     # unit test luật chơi và server qua tsx
npm run build                # shared/dist (ESM + .d.ts), server/dist + data, client/dist
npm start                    # server phục vụ luôn client đã build tại :3001
npm run test:e2e -- http://localhost:3001   # kiểm thử tích hợp (server phải đang chạy)
npm run test:integration      # tự chạy server dist trên cổng 3191, kiểm thử, rồi dừng
```

## Deploy bằng GitHub Actions

Mỗi lần push lên `main`, workflow [deploy.yml](.github/workflows/deploy.yml) sẽ: chạy test → build Docker image → đẩy lên `ghcr.io/<owner>/<repo>` → deploy theo các secret bạn đã thêm. Nhánh khác và pull request chỉ chạy [ci.yml](.github/workflows/ci.yml).

Chọn **một** trong các cách sau:

### A. Máy chủ riêng chạy Docker Compose (đang dùng)
App production chạy trên một mini PC bằng [compose.yaml](compose.yaml): hai game node, Redis, PostgreSQL và Nginx; người chơi vào qua Cloudflare Tunnel, không mở port trên router.
1. Làm theo [docs/docker-setup.md](docs/docker-setup.md) để tạo `.env` và chạy Compose.
2. Máy yếu thì đặt `GAME_IMAGE=ghcr.io/<owner>/<repo>:latest` trong `.env` để dùng image CI đã build thay vì build tại chỗ.
3. Cập nhật sau mỗi lần merge vào `main`: `git pull && docker compose pull && docker compose up -d --no-build`.
4. Gắn tên miền và HTTPS: [docs/ten-mien.md](docs/ten-mien.md).

### B. VPS chạy một container qua SSH
Cách cũ, không có Redis/PostgreSQL đi kèm. Thêm các secret: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (private key), tùy chọn `VPS_PORT` (mặc định 22), `APP_PORT` (mặc định 80).
Workflow sẽ SSH vào máy, `docker pull` image mới rồi chạy lại container `game-lobby`.
> Nếu package GHCR để private, máy VPS cần đăng nhập được GHCR; cách đơn giản nhất là đổi package sang public.

> **Nên chạy sau HTTPS.** Container chỉ nói HTTP; nếu để lộ thẳng cổng 80 thì mật khẩu và tin nhắn đi qua mạng dạng chữ thường.
> Cách nhanh: đặt `APP_PORT=3001` (chỉ mở nội bộ) và chạy [Caddy](https://caddyserver.com) phía trước — tự xin chứng chỉ Let's Encrypt:
> ```
> # /etc/caddy/Caddyfile
> game.ten-mien-cua-ban.com {
>   reverse_proxy localhost:3001
> }
> ```
> rồi đặt variable `TRUST_PROXY=1`. Trang web cũng chỉ kiểm chứng được xáo bài (cần Web Crypto) khi chạy qua HTTPS.

### C. Client trên GitHub Pages, server ở nơi khác
1. Chạy server bằng cách A hoặc B, đặt biến môi trường `CORS_ORIGIN=https://<user>.github.io` cho server.
2. **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables**: thêm `VITE_SERVER_URL=https://server-cua-ban`.
4. Workflow [pages.yml](.github/workflows/pages.yml) sẽ tự build và đăng client.

### Chạy bằng Docker
```bash
docker build -t game-lobby .
docker run -p 3001:3001 game-lobby
```

### Biến môi trường của server
| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3001` | Cổng HTTP |
| `CORS_ORIGIN` | _(trống)_ | Origin khác được phép kết nối, cách nhau dấu phẩy (vd `https://user.github.io`). Trống = chỉ trang cùng domain với server |
| `CLIENT_DIST` | `client/dist` | Thư mục client đã build |
| `APP_PASSWORD` | _(trống)_ | Mật khẩu để vào app (auth gate). Để trống = ai cũng vào được |
| `APP_SERVERS` | _(trống)_ | Chia app thành nhiều server, mỗi server một mật khẩu (JSON). Có biến này thì `APP_PASSWORD` bị bỏ qua |
| `TRUST_PROXY` | _(trống)_ | Số reverse proxy đứng trước server (thường là `1`). IP thật = phần tử thứ N tính từ **cuối** `X-Forwarded-For` — phần đầu do client tự điền nên không tin được. Để trống khi không có proxy |
| `DEBUG_IP` | _(trống)_ | Đặt `1` để in IP và `X-Forwarded-For` của mỗi kết nối ra log — dùng để kiểm tra `TRUST_PROXY` đúng chưa |
| `VOICE_ENABLED` | `1` | Đặt `0` để tắt hẳn voice chat |
| `VOICE_SERVERS` | `B4` | Chỉ bật voice chat cho các server (tên trong `APP_SERVERS`, cách nhau dấu phẩy, không phân biệt hoa thường). `*` = mọi server. Chạy một server không đặt tên thì không bị giới hạn |
| `VOICE_MAX_PER_ROOM` | `6` | Số người tối đa trong kênh thoại mỗi phòng |
| `VOICE_TURN_ENABLED` | `1` | Đặt `0` để tắt TURN Cloudflare dù đã có key (chỉ dùng STUN miễn phí — mạng 4G/NAT chặt sẽ không kết nối được) |
| `CF_TURN_KEY_ID`, `CF_TURN_KEY_API_TOKEN` | _(trống)_ | TURN của Cloudflare cho voice chat (giúp kết nối qua 4G). Trống = chỉ dùng STUN miễn phí |
| `CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN` | _(trống)_ | Để server tự theo dõi dung lượng TURN đã dùng trong tháng (token quyền *Account Analytics: Read*) |
| `VOICE_TURN_QUOTA_GB` | `900` | Ngưỡng GB/tháng (gói miễn phí 1.000 GB) |
| `VOICE_QUOTA_ACTION` | `disable` | Chạm ngưỡng thì `disable` (tắt voice chat tới đầu tháng sau) hoặc `stun` (vẫn chạy, bỏ TURN) |

### Voice chat
Bấm nút 🎧 **Thoại** ở đầu phòng để vào kênh thoại của phòng (trình duyệt hỏi quyền micro; không có micro thì vẫn nghe được). Âm thanh đi thẳng giữa các trình duyệt bằng WebRTC (mã hóa đầu-cuối), server chỉ chuyển tín hiệu kết nối, không ghi âm. Chi tiết thiết kế: [docs/voice-chat-plan.md](docs/voice-chat-plan.md).

### Auth gate (mật khẩu vào app)
Khi đặt `APP_PASSWORD`, mọi kết nối Socket.IO phải gửi đúng mật khẩu, nếu không sẽ bị từ chối. Người dùng thấy màn hình nhập mật khẩu; nhập đúng thì server cấp một **phiên đăng nhập** (ký HMAC, hạn 30 ngày, tự gia hạn khi vào) để trình duyệt nhớ — bản thân mật khẩu **không** được lưu trên máy người chơi. Nút **⇄ Đổi server** xóa phiên (đăng xuất).

Chống đoán mật khẩu:
- Mỗi IP nhập sai quá 10 lần bị khóa 10 phút (cần đặt `TRUST_PROXY` đúng khi chạy sau proxy, xem bảng trên).
- Toàn server quá 60 lần sai trong 1 phút thì tạm ngừng nhận đăng nhập bằng mật khẩu trong phút đó (chặn đoán từ nhiều IP). Người đã có phiên vẫn vào bình thường.
- Nên dùng mật khẩu dài, ngẫu nhiên (≥ 16 ký tự).

Kiểm tra `TRUST_PROXY` khi chạy sau proxy: bật `DEBUG_IP=1`, mở app, xem log — IP in ra phải là IP của bạn; gửi thử một request kèm header `X-Forwarded-For: 1.2.3.4` thì IP in ra vẫn phải là IP thật, không phải `1.2.3.4`. Xong thì tắt `DEBUG_IP`.
- **Chạy local:** `APP_PASSWORD=bimat npm run dev`
- **Docker:** `docker run -p 3001:3001 -e APP_PASSWORD=bimat game-lobby`
- **Docker Compose:** đặt `APP_PASSWORD` (hoặc `APP_SERVERS`) trong `.env`, rồi `docker compose up -d`
- **VPS (GitHub Actions):** thêm secret `APP_PASSWORD` (và tùy chọn variable `TRUST_PROXY=1` nếu có Nginx phía trước)

Đổi mật khẩu thì khởi động lại server; mọi phiên đăng nhập cũ hết hiệu lực, người đang dùng sẽ phải nhập mật khẩu mới khi kết nối lại.

### Bảo mật
- **Header HTTP:** CSP chặt (chỉ chạy script của chính app, không cho nhúng iframe), `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS khi chạy qua HTTPS. Font Inter tự host, không tải gì từ bên thứ ba.
- **Origin:** chỉ trang cùng domain (hoặc khai báo trong `CORS_ORIGIN`) mới mở được kết nối — trang web lạ không thể dùng trình duyệt của người chơi để vào app.
- **Giới hạn tài nguyên:** giới hạn tần suất mỗi kết nối (chat ~1 tin/giây), tối đa 30 kết nối và 30 danh tính mới/giờ mỗi IP, 200 phòng mỗi server, gói tin ≤ 16 KB; danh tính không hoạt động 24 giờ được dọn khỏi bộ nhớ.
- **Xáo bài kiểm chứng được:** Fisher–Yates + bộ sinh số ngẫu nhiên an toàn mật mã (Web Crypto, loại bỏ modulo bias). Mỗi ván Poker / Tá lả / Sâm lốc, server công bố **mã cam kết SHA-256** của bộ bài (từng lá có muối riêng) trước khi chia; hết ván công bố các lá để trình duyệt tự kiểm tra bộ bài không bị đổi giữa chừng — huy hiệu 🛡 dưới bàn chơi. Poker chỉ công bố các lá người xem được phép thấy, bài bỏ của người khác vẫn kín.
- **CI/CD:** GitHub Actions gắn theo commit SHA, `npm audit` trong CI, Dependabot cập nhật thư viện hằng tuần, container chạy user thường + `--read-only --cap-drop ALL`.
- Nên bật trong **Settings** của repo: *Code security → Secret scanning / Push protection*, và *Branches → Branch protection* cho `main` (bắt buộc CI xanh trước khi merge).

### Nhiều server (mỗi server một mật khẩu)
Đặt `APP_SERVERS` là JSON dạng `{"tên server": "mật khẩu"}`, ví dụ:
```
APP_SERVERS={"Bên A":"mat-khau-A","Bên B":"mat-khau-B"}
```
- Nhập mật khẩu nào thì vào server đó. Mỗi server có **sảnh, phòng chơi, người chơi riêng**: bên A không thấy và không vào được phòng của bên B.
- Tên server hiện ở góc trên; nút **⇄ Đổi server** để nhập mật khẩu của server khác. Trình duyệt nhớ danh tính riêng cho từng server.
- Danh sách server không hiện cho người chưa nhập mật khẩu. Tên và mật khẩu không được trùng nhau; cấu hình sai thì server báo lỗi và không khởi động (tránh vô tình mở app không mật khẩu).
- Thêm / bớt server: sửa biến rồi deploy lại. Đổi tên server sẽ tạo server mới (người chơi phải đặt lại tên).

## Cấu trúc

```
shared/src/       Luật chơi TypeScript (dùng cho cả server và client)
  xiangqi.ts      Sinh nước đi, chiếu, chiếu bí, ký hiệu nước đi
  caro.ts         Đặt quân, kiểm tra 5 liên tiếp, luật chặn hai đầu
  wordchain.ts    Nối từ: chuẩn hóa âm tiết, lượt, mạng, phản đối
  poker.ts        Chấm bài, ván cược, side pot
  samloc.ts       Sâm lốc: phân loại bộ, chặn, báo Sâm, báo 1, tới trắng, tính tiền
  tala.ts         Phỏm, xếp phỏm tối ưu, ăn / hạ / gửi / Ù, tính điểm
shared/test/      Unit test (node --test)
server/src/       Express + Socket.IO
  index.ts        Khởi động: ghép các phần bên dưới
  config.ts       Đọc biến môi trường, giới hạn tài nguyên
  http.ts         Header bảo mật, /health, phục vụ client đã build
  auth.ts         Mật khẩu, phiên đăng nhập, khóa IP đoán mật khẩu
  rateLimit.ts    Token bucket, bộ đếm theo IP
  lobby.ts        Người dùng, phòng: vào / ra / xóa phòng
  connection.ts   Các sự kiện socket của một kết nối
  voice.ts        Voice chat: STUN/TURN, hạn mức, lọc tín hiệu
server/src/games/ Lớp điều phối từng game (ghế, hẹn giờ, quyền thao tác)
  duel.ts         Khung chung cờ 2 người có đồng hồ (Cờ tướng, Cờ caro)
  cardTable.ts    Khung chung bài đánh theo lượt (Tá lả, Sâm lốc)
server/src/data/  Từ điển và bộ câu hỏi (giấy phép riêng, xem README trong thư mục)
client/src/       React UI: sảnh, phòng, bàn cờ, bàn bài, phím tắt
```

> Dữ liệu (người dùng, phòng, điểm) chỉ lưu trong bộ nhớ server, khởi động lại server là mất. Muốn lưu lâu dài thì cần thêm cơ sở dữ liệu (Redis / Postgres).

Chi tiết build, exports và phạm vi kiểu dữ liệu: [docs/typescript.md](docs/typescript.md).

## Giấy phép

Mã nguồn phát hành theo [giấy phép MIT](LICENSE). Riêng dữ liệu bên thứ ba trong `server/src/data/` giữ giấy phép gốc
(xem [README](server/src/data/README.md)): `vi-words.txt` theo GNU GPL phiên bản 2, không thuộc phạm vi giấy phép MIT.

### Kỷ lục workspace cho Đào vàng và Bay qua khe

Kỷ lục dùng chung giữa các phòng trong cùng workspace (ví dụ b4), tách riêng theo game. Flappy Bird lưu số cột vượt qua. Đào vàng lưu hai mốc độc lập: số tiền cao nhất từng có (mua đồ không hạ kỷ lục) và màn cao nhất từng tới, mỗi mốc kèm người đạt trước. Server cập nhật khi lượt chơi kết thúc, từ điểm đã xác nhận.

**PostgreSQL là nơi lưu chính:** đặt DATABASE_URL trong biến môi trường/secret của host; dùng WORKSPACE_RECORDS_NAMESPACE nếu nhiều môi trường chung database (mặc định game:v1). Server tự tạo bảng workspace_game_records, cần quyền CREATE TABLE ở lần khởi động đầu và SELECT/INSERT/UPDATE khi chạy. UPSERT giữ max nguyên tử giữa nhiều shard; bằng điểm giữ người đạt trước. Mọi shard cần dùng cùng database và namespace. Kết nối tuân theo TLS của nhà cung cấp; không tắt xác thực certificate.

Compose đã có PostgreSQL 17 với volume postgres-data; thêm POSTGRES_PASSWORD riêng vào .env. Redeploy node ứng dụng hoặc restart database không xoá kỷ lục nếu volume còn. Không chạy docker compose down -v nếu muốn giữ dữ liệu. Cần backup database ra nơi khác và kiểm tra khôi phục; volume không thay thế backup. Với database được quản lý, bật backup/PITR theo gói dịch vụ.

Docker Compose: DATABASE_URL đã trỏ sẵn tới container postgres, không cần đặt. VPS qua Actions: thêm secret DATABASE_URL và repository variable WORKSPACE_RECORDS_NAMESPACE (ví dụ b4). Không có URL thì server cảnh báo và dùng file local WORKSPACE_RECORDS_FILE (mặc định ./data/workspace-records.json), chỉ dành cho một process với disk có quyền ghi và bền vững; chế độ này không đồng bộ nhiều shard.

Xoá phòng, đổi thiết bị hoặc xoá dữ liệu trình duyệt không xoá kỷ lục database. Kỷ lục phòng và kỷ lục workspace là hai phạm vi riêng.

Bay qua khe: từ cột thứ 11, khe dao động lên xuống theo chu kỳ 4,8 giây. Biên độ tăng mỗi 10 cột, tối đa 24px. Vị trí khe phụ thuộc chỉ số cột và tick của lượt bay; client, người xem và server tính cùng công thức.

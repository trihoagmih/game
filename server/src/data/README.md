# Dữ liệu từ điển

`vi-syllables.txt`: danh sách âm tiết tiếng Việt (chữ thường), mỗi dòng một âm tiết.
Dùng để kiểm tra từ trong trò **Nối từ**.

Trích từ gói [`@cspell/dict-vi-vn`](https://github.com/streetsidesoftware/cspell-dicts) v3.0.7 — giấy phép MIT:

> The MIT License (MIT)
>
> Copyright (c) 2017-2025 Street Side Software <support@streetsidesoftware.nl>
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
> documentation files (the "Software"), to deal in the Software without restriction, including without limitation
> the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
> to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions
> of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
> THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
> CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
> IN THE SOFTWARE.

---

# Từ điển từ ghép

`vi-words.txt`: 48.465 từ tiếng Việt gồm đúng 2 chữ (chữ thường, Unicode NFC), mỗi dòng một từ.
Dùng cho chế độ **chặt** của trò **Nối từ**: từ phải có trong danh sách này (so khớp không phụ thuộc vị trí bỏ dấu).
Danh sách chỉ được đọc trên server, không gửi xuống trình duyệt.

Lọc từ `Viet74K.txt` của dự án [duyet/vietnamese-wordlist](https://github.com/duyet/vietnamese-wordlist)
(commit `688b0953c8cdb21ee090ce80b83cefdb052fe2cd`): chỉ giữ các mục gồm đúng 2 chữ cái, bỏ mục có số/ký hiệu.

**Giấy phép: GNU GPL phiên bản 2** — toàn văn ở [`LICENSE-vi-words.txt`](LICENSE-vi-words.txt).
Tệp này giữ nguyên giấy phép GPL-2.0 khi phân phối lại.

Danh sách này là mục từ của từ điển nên thiếu nhiều cụm ghép tự do thông dụng (vd: "con mèo", "đạp xe",
"hành lá"), vì vậy server gộp thêm 2 tệp dưới đây. Một từ được coi là "có trong từ điển" nếu có trong **bất kỳ** tệp nào.

## `vi-words-noitu.txt` — từ điển trò nối từ (13.859 từ)

Các từ 2 chữ lấy từ `src/assets/wordPairs.json` và `src/assets/customWords.json` của dự án
[minhqnd/Noi-Tu-Discord](https://github.com/minhqnd/Noi-Tu-Discord) (nhánh `main`, tải ngày 2026-11-06),
chỉ giữ từ có đủ 2 chữ hợp lệ theo `vi-syllables.txt` và **chưa có** trong `vi-words.txt`.

**Giấy phép: MIT** — Copyright (c) 2023 Quang Minh. Toàn văn giấy phép MIT như ở phần `vi-syllables.txt` phía trên.

## `vi-words-common.txt` — từ bổ sung tự soạn

Danh sách soạn tay cho trò chơi này: loại từ + danh từ thông dụng (con bò, con trâu, cái chổi, trái xoài, cây dừa…)
mà hai nguồn trên còn thiếu. Thêm từ mới vào tệp này (mỗi dòng một từ, chữ thường) khi người chơi báo thiếu.

Khi nạp, server bỏ các mục có chữ không nằm trong `vi-syllables.txt` (vd *acid amin*, *ad hoc* — không bao giờ nối được)
và lập chỉ mục theo chữ đầu để đếm số từ còn nối tiếp: dùng cho luật "từ mở đầu không quá khó" và "nối từ cụt thì thắng luôn".

Khi cần, chủ phòng vẫn có thể tắt chế độ chặt để chuyển sang chế độ thoáng
(chỉ kiểm tra từng chữ, từ lạ bị gắn cờ ⚠ để người chơi phản đối).

---

# Trò Đố vui và Đoán chữ (tự soạn cho dự án này)

## `quiz-vi.json` — bộ câu hỏi Đố vui có sẵn (423 câu)

Soạn tay cho trò chơi này, 17 chủ đề (xem `QUIZ_CATEGORIES` trong `shared/src/quiz.js`).
Mỗi mục: `{ "c": chủ đề, "q": câu hỏi, "a": đáp án đúng, "w": [đáp án sai] }`; câu Đúng/Sai có `a`/`w` là "Đúng"/"Sai".
Tránh các dữ kiện dễ đổi (ví dụ tên tỉnh sau đợt sáp nhập năm 2025). Thấy câu sai thì sửa thẳng trong tệp.
Tham khảo các chủ đề đố vui phổ biến trên mạng để chọn chủ đề, nhưng câu hỏi đều tự viết, không chép nguyên văn từ bộ câu hỏi của nơi khác.
Mặt sau các tờ tiền Việt Nam, tuổi lái xe, số khẩn cấp… là thông tin hiện hành năm 2026 — cần rà lại khi có thay đổi.

## `vi-words-doanchu.txt` — đáp án của trò Đoán chữ (639 từ)

Từ 2 chữ thông dụng, soạn tay theo chủ đề (gia đình, đồ vật, món ăn, con vật, thiên nhiên…).
Mọi từ đều phải có trong từ điển ở trên (từ nào thiếu thì thêm vào `vi-words-common.txt`).

---

# Từ cho trò Vẽ đoán

`scribble-words.txt`: ~400 từ / cụm từ tiếng Việt dễ vẽ (con vật, đồ vật, món ăn, phương tiện, nghề nghiệp, hành động…),
soạn tay cho trò chơi này. Mỗi dòng một từ, chữ thường. Thêm từ mới vào tệp này khi cần.
Danh sách chỉ được đọc trên server; người đoán không bao giờ nhận được từ đang vẽ.

## `twisters-vi.json` — câu líu lưỡi cho trò Líu lưỡi

Soạn tay cho trò chơi này, gồm vài câu líu lưỡi/ca dao dân gian quen thuộc (vd: "Nồi đồng nấu ốc, nồi đất nấu ếch",
"Lúa nếp là lúa nếp làng…", "Hôm qua qua nói qua qua…") và các câu tự viết theo cặp âm dễ nói ngọng:
l/n, s/x, tr/ch, r/d/gi, vần ươu, âm cuối n/ng, c/t.
Mỗi mục: `{ "l": độ khó 1–3, "t": câu, "x": số lần đọc liền (không bắt buộc, 1–5) }`. Server kiểm tra định dạng lúc khởi động
(`parseBank` trong `shared/src/twister.ts`). Thấy câu sai chính tả thì sửa thẳng trong tệp.

# Hướng dẫn cài đặt gửi mail HOÀN TOÀN TỰ ĐỘNG (1 lần, ~5 phút)

Báo cáo nay ở định dạng **HTML** (bỏ docx/PDF). Hệ thống gồm 2 phần nối qua Google Drive:
1. **Tác vụ Claude** (đã lập lịch T2–T6): mỗi sáng tạo báo cáo **.html** và **tự đẩy** lên Google Drive (folder **Carbon Daily Reports**).
2. **Google Apps Script** (cài 1 lần): tự lấy HTML của ngày hôm đó, dùng làm **thân email** (kèm file .html) và **gửi** tới xoan.vu@stavianmetal.com — không cần bấm tay.

## Cài Apps Script
1. Mở https://script.google.com → **New project** (đăng nhập đúng **phuc189@gmail.com**).
2. Xoá code mẫu, **dán toàn bộ** nội dung file `CarbonAutoSend.gs` (trong thư mục ESG này) vào → **Save**.
3. Trên thanh hàm chọn **setupTriggers** → **Run**.
   - Lần đầu Google hỏi quyền: **Review permissions** → chọn tài khoản → *Advanced* → *Go to project (unsafe)* → **Allow**. (Script của chính bạn, an toàn.)
   - Xong: lịch tự gửi T2–T6 lúc 9h, 11h, 14h đã được cài.
4. (Tuỳ chọn) Gửi thử: chọn **testSendNow** → **Run** (cần đã có HTML của hôm nay trên Drive).

> Lưu ý: bản HTML hiển thị trực tiếp trong thân email nên **không cần** bật Advanced Drive Service.

## Có báo cáo hôm nay & gửi thử
- App Claude → mục **Scheduled** → tác vụ **carbon-daily-news** → **Run now** (tạo + đẩy HTML lên Drive). Sau đó chạy **testSendNow** trong Apps Script.
- *(Báo cáo HTML hôm nay 10/06 đã được đẩy sẵn lên Drive — có thể chạy testSendNow ngay sau khi cài.)*

## Tuỳ chỉnh
- Thêm CC (vd GĐ CLPT): sửa dòng `const CC = '';` → Save.
- Đổi giờ gửi: sửa `[9, 11, 14]` → chạy lại **setupTriggers**.
- Người gửi luôn là tài khoản chạy script (phuc189@gmail.com).

## Lưu ý
- Tác vụ Claude chỉ chạy khi app Claude đang mở; nếu app đóng lúc 8h30 thì chạy khi mở app lần kế. Vì vậy script đặt 3 mốc giờ (9/11/14) để bắt cả khi HTML lên Drive trễ. Đã gửi rồi thì file chuyển sang "_Da gui" nên không gửi trùng.
- Quy trình duyệt (README): nếu cần GĐ CLPT duyệt trước, thêm email GĐ vào CC, hoặc tạm dừng tác vụ và gửi thủ công.

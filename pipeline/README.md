# Carbon Market Intelligence Pipeline

Pipeline tự động hóa quy trình thu thập dữ liệu, phân tích AI (Claude), và gửi báo cáo thị trường Carbon hàng ngày cho Stavian Industrial Metal.

## Cấu trúc

```
pipeline/
├── index.js       # Entry point + scheduler cron
├── collector.js   # Thu thập giá (Yahoo Finance) + tin tức (RSS feeds)
├── analyzer.js    # Gọi Claude API → tạo dự thảo báo cáo HTML
├── delivery.js    # Gửi Email (Gmail) + Telegram
├── config.js      # Cấu hình tập trung (đọc từ .env)
├── logger.js      # Logging có timestamp → logs/pipeline-YYYY-MM-DD.log
└── .env.example   # Template biến môi trường
```

## Cài đặt

```bash
cd pipeline
npm install
cp .env.example .env
# Điền các giá trị trong .env
```

## Cấu hình `.env`

| Biến | Bắt buộc | Mô tả |
|------|----------|-------|
| `ANTHROPIC_API_KEY` | ✅ | API key Claude (anthropic.com) |
| `GMAIL_USER` | ✅ | Email gửi (phuc189@gmail.com) |
| `GMAIL_APP_PASSWORD` | ✅ | Gmail App Password (không dùng mật khẩu thường) |
| `REPORT_TO` | ✅ | Email người nhận chính |
| `REPORT_CC` | ❌ | CC (có thể để trống) |
| `TELEGRAM_BOT_TOKEN` | ❌ | Bot token (nếu dùng Telegram) |
| `TELEGRAM_CHAT_ID` | ❌ | Chat ID kênh Telegram |

### Lấy Gmail App Password
1. Vào https://myaccount.google.com/apppasswords
2. Tạo App Password cho "Mail" → "Windows Computer"
3. Dán 16 ký tự vào `GMAIL_APP_PASSWORD`

## Chạy

```bash
# Chế độ scheduler (T2-T6 7h30 tự động)
npm start

# Chạy ngay 1 lần (có gửi email)
npm run run-now

# Chạy ngay KHÔNG gửi email (kiểm tra)
npm run test-deliver

# Chỉ thu thập giá + tin, không gọi Claude
npm run collect
```

## Dữ liệu thu thập

### Giá (10 hợp đồng)
| Hợp đồng | Nguồn | Ghi chú |
|----------|-------|---------|
| WTI, Brent, NG, TTF | Yahoo Finance | Chính xác |
| Gold, Silver, Copper, Aluminum | Yahoo Finance | Chính xác |
| EUA (carbon) | KRBN ETF proxy | ⚠ Proxy, cần nhập thủ công giá ICE thực |
| Iron Ore | BHP stock proxy | ⚠ Proxy, cần API SGX cho giá chính xác |

> **Lưu ý về EUA**: Yahoo Finance không cung cấp EUA ICE futures trực tiếp. Pipeline dùng KRBN ETF (carbon ETF, EUA ~75% trọng số) làm proxy — nhưng **giá tuyệt đối của proxy (~34 USD) KHÔNG phải giá EUA thật (~75 €/tCO₂)**. Vì vậy khi không có giá nhập tay, pipeline **ẩn giá tuyệt đối EUA (hiển thị N/A)** và chỉ giữ **hướng biến động (Δ%)** để tránh in số sai.
>
> **Nhập giá EUA thật (khuyến nghị mỗi sáng)**: đặt `EUA_PRICE_OVERRIDE=76.55` (và tuỳ chọn `EUA_PREVCLOSE_OVERRIDE=76.96` để tính Δ ngày) trong `.env`. Giá lấy từ ICE/Trading Economics/Refinitiv/Bloomberg.

### Tin tức (RSS)
- **Quốc tế**: Carbon Pulse, Reuters, EIA, ESG Today, CarbonCredits.com
- **Việt Nam**: VnExpress, Báo Chính phủ

## Log

Log lưu tại `pipeline/logs/pipeline-YYYY-MM-DD.log`. Mỗi bước pipeline đều có timestamp.

## Kết quả

File HTML báo cáo được lưu tại `../Reports/Tin tức thị trường Carbon DD-MM-YYYY.html`

## Lịch tự động

| Thời điểm | Hành động |
|-----------|-----------|
| 7h30 T2-T6 | Thu thập giá + tin → Phân tích Claude → Gửi báo cáo |
| 17h00 T2-F6 | Gửi tóm tắt hoạt động hàng ngày |

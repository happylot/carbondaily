'use strict';
/**
 * analyzer.js — Gọi AI API (OpenAI hoặc Amazon Bedrock) để tạo dự thảo báo cáo
 *
 * Provider được chọn qua config.aiProvider ('openai' | 'bedrock')
 * Exports:
 *   analyzAndBuild(prices, newsItems)  → Promise<{ html, markdown, date }>
 */
const OpenAI = require('openai');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { log, logError } = require('./logger');

// ─── Client khởi tạo lazy (chỉ tạo khi dùng) ────────────────────────────────
let _openaiClient = null;
let _bedrockClient = null;

function getOpenAIClient() {
  if (!_openaiClient) {
    _openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return _openaiClient;
}

function getBedrockClient() {
  if (!_bedrockClient) {
    const cfg = config.bedrock;
    const clientConfig = { region: cfg.region };

    // Chỉ truyền credentials tường minh nếu có — không có thì SDK tự fallback về
    // IAM role, instance profile, AWS CLI profile, hoặc environment variables chuẩn
    if (cfg.accessKeyId && cfg.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        ...(cfg.sessionToken ? { sessionToken: cfg.sessionToken } : {}),
      };
    }

    _bedrockClient = new BedrockRuntimeClient(clientConfig);
  }
  return _bedrockClient;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPct(val) {
  if (val === null || val === undefined) return '—';
  const sign = val > 0 ? '▲ +' : val < 0 ? '▼ ' : '↔ ';
  return `${sign}${val.toFixed(2)}%`;
}

function formatPrice(val, unit) {
  if (val === null || val === undefined) return 'N/A';
  return `${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unit}`;
}

function viDateString(date) {
  const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${days[date.getDay()]}, ngày ${d} tháng ${m} năm ${y}`;
}

function ddmmyyyy(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}-${m}-${date.getFullYear()}`;
}

// ─── Build price table text for Claude ───────────────────────────────────────

function buildPriceContext(prices) {
  const lines = ['## DỮ LIỆU GIÁ ĐÃ THU THẬP\n'];
  const groups = { energy: '### Năng lượng', carbon: '### Tín chỉ Carbon', metals: '### Kim loại' };

  for (const [grp, header] of Object.entries(groups)) {
    lines.push(header);
    const contracts = Object.values(prices).filter(p => p.group === grp);
    for (const c of contracts) {
      if (c.status === 'error') {
        lines.push(`- ${c.name}: **KHÔNG CÓ DỮ LIỆU** (${c.error})`);
      } else {
        const flag = c.status === 'fallback' ? ' [nguồn dự phòng]' : '';
        const alert = c.priceAlert ? ' ⚠ BIẾN ĐỘNG MẠNH' : '';
        lines.push(`- ${c.name}: ${formatPrice(c.price, c.unit)} | Δ ngày: ${formatPct(c.changePct)}${flag}${alert} | Nguồn: ${c.source} | ${c.timestamp}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ─── Build news context text for Claude ──────────────────────────────────────

function buildNewsContext(newsItems) {
  const lines = ['## TIN TỨC ĐÃ THU THẬP (24H QUA)\n'];

  const intl = newsItems.filter(n => n.group === 'intl');
  const vn   = newsItems.filter(n => n.group === 'vn');

  lines.push('### Tin quốc tế');
  if (intl.length === 0) {
    lines.push('_Không có tin tức quốc tế trong 24h_\n');
  } else {
    intl.slice(0, 30).forEach((n, i) => {
      const breaking = n.isBreaking ? ' 🚨 BREAKING' : '';
      const tierLabel = `[Hạng ${n.tier}]`;
      lines.push(`${i + 1}. **${n.title}**${breaking} ${tierLabel}`);
      lines.push(`   Nguồn: ${n.source} | Ngày: ${n.publishedAt} | Chủ đề: ${n.commodity}`);
      lines.push(`   Tóm tắt: ${n.summary}`);
      lines.push(`   URL: ${n.url}`);
      lines.push('');
    });
  }

  lines.push('### Tin Việt Nam');
  if (vn.length === 0) {
    lines.push('_Không có tin tức Việt Nam trong 24h_\n');
  } else {
    vn.slice(0, 20).forEach((n, i) => {
      const breaking = n.isBreaking ? ' 🚨 BREAKING' : '';
      const tierLabel = `[Hạng ${n.tier}]`;
      lines.push(`${i + 1}. **${n.title}**${breaking} ${tierLabel}`);
      lines.push(`   Nguồn: ${n.source} | Ngày: ${n.publishedAt}`);
      lines.push(`   Tóm tắt: ${n.summary}`);
      lines.push(`   URL: ${n.url}`);
      lines.push('');
    });
  }

  return lines.join('\n');
}

// ─── Load system prompt ───────────────────────────────────────────────────────

function loadSystemPrompt() {
  const spPath = path.join(__dirname, '..', 'system-prompt-commodity-analyst.md');
  if (fs.existsSync(spPath)) {
    return fs.readFileSync(spPath, 'utf-8');
  }
  // Fallback system prompt tối thiểu
  return `Bạn là Senior Commodity Derivatives Analyst. Tổng hợp dữ liệu thành báo cáo 9 mục theo template đã được định nghĩa, viết bằng tiếng Việt, ngắn gọn và mật độ thông tin cao.`;
}

// ─── Build user prompt (theo mẫu báo cáo 3 phần Stavian) ────────────────────

function buildUserPrompt(prices, newsItems, reportDate) {
  const priceCtx = buildPriceContext(prices);
  const newsCtx  = buildNewsContext(newsItems);
  const dateStr  = viDateString(reportDate);
  const ddmm     = `${String(reportDate.getDate()).padStart(2,'0')}/${String(reportDate.getMonth()+1).padStart(2,'0')}/${reportDate.getFullYear()}`;

  return `
# YÊU CẦU TẠO BÁO CÁO — Commodity Derivatives Intelligence

Ngày báo cáo: **${dateStr}** (${ddmm})
Người báo cáo: Team KD Tín chỉ carbon, Phòng CLPT — Stavian Industrial Metal

---

## PHẠM VI TÀI SẢN (BẮT BUỘC đưa vào báo cáo)

### Nhóm 1 — Năng lượng
WTI (NYMEX CL), Brent (ICE B), Henry Hub NG, TTF châu Âu
Driver: OPEC+, tồn kho EIA/API (thứ Tư), rig count Baker Hughes (thứ Sáu), địa chính trị Trung Đông/Nga, nhu cầu Trung Quốc–Ấn Độ

### Nhóm 2 — Tín chỉ Carbon
EU ETS (EUA/ICE), UK ETS, California Cap-and-Trade, VCM (nature-based/tech-based)
Chính sách: CBAM (tác động trực tiếp đến xuất khẩu thép/nhôm/xi măng/phân bón VN), thị trường carbon VN, Article 6
⚠ Tin chính sách quan trọng hơn tin giá — ưu tiên CBAM/ETS trước biến động giá

### Nhóm 3 — Kim loại
Vàng (COMEX GC), Bạc (SI), Đồng (COMEX HG/LME), Nhôm (LME), Quặng sắt (SGX/DCE)
Driver: Fed/lãi suất thực/DXY, dòng tiền ETF vàng/bạc, kinh tế Trung Quốc, tồn kho LME/SHFE, nhu cầu EV và lưới điện (đồng)

### Liên kết chéo (BẮT BUỘC phân tích)
Quét các mối liên hệ: khí TTF↑ → chi phí sản xuất nhôm↑, EUA↑ → fuel switching, CBAM → thương mại thép/nhôm, USD/lãi suất → vàng + dầu + kim loại cùng chiều

---

## CẤU TRÚC BÁO CÁO (TUÂN THỦ NGHIÊM NGẶT — ĐIỂM NHẤN + 3 PHẦN)

### ĐIỂM NHẤN (khối mở đầu, đặt TRƯỚC Phần 1)

Mở đầu đúng dạng sau để template render được khối hero:

## ĐIỂM NHẤN — [TIÊU ĐỀ IN HOA, 1 CÂU, CÓ SỐ CỤ THỂ]
[Đoạn 4–8 câu: chuyện quan trọng nhất hôm nay — số đã xác minh, cơ chế nhân quả, và điều
gì đã đổi so với báo cáo hôm qua. Nếu nhận định cũ sai thì nói thẳng ở đây.]
*(Nguồn: [Tên](URL); [Tên](URL))*

### PHẦN 1 — TIN TỨC CHÍNH / NỔI BẬT TRONG NGÀY

**1a. Bảng giá (tiêu đề cột: Sản phẩm | Giá | Thay đổi | Ghi chú)**
Điền ĐẦY ĐỦ các dòng sau theo đúng thứ tự, dùng ĐÚNG số liệu từ dữ liệu giá bên dưới:

NHÓM NĂNG LƯỢNG:
- WTI Crude Oil: giá USD/bbl, % thay đổi, ghi chú driver chính (OPEC/EIA/địa chính trị)
- Brent Crude Oil: giá USD/bbl, % thay đổi, chênh lệch spread WTI-Brent nếu đáng chú ý
- Henry Hub NG: giá USD/MMBtu, % thay đổi, ghi chú tồn kho/thời tiết
- TTF Gas: giá EUR/MWh, % thay đổi, ghi chú tác động fuel-switching đến EUA

NHÓM TÍN CHỈ CARBON:
- EUA (EU ETS): giá €/tấn, % thay đổi, ghi chú xu hướng + mốc kỹ thuật đáng chú ý
- Vùng dao động EUA: dải giá, trạng thái (vượt/test/đi ngang), kháng cự/hỗ trợ gần nhất
- Dự báo EUA: giá cuối quý và 12 tháng (kèm nguồn analyst/tổ chức)
- CBAM cert (Q1/26): giá €/tấn CO₂, mốc công bố tiếp theo

NHÓM KIM LOẠI:
- Vàng (COMEX GC): giá USD/oz, % thay đổi, ghi chú DXY/Fed/ETF flow
- Bạc (COMEX SI): giá USD/oz, % thay đổi
- Đồng (LME/COMEX): giá USD/lb hoặc USD/tonne, % thay đổi, ghi chú tồn kho LME/nhu cầu EV
- Nhôm (LME): giá USD/tonne, % thay đổi, ghi chú chi phí năng lượng/smelter
- Quặng sắt (SGX): giá USD/tonne, % thay đổi, ghi chú nhu cầu Trung Quốc

Nếu giá không có dữ liệu → ghi "N/A — xem ghi chú" và thêm ⚠ cảnh báo dữ liệu phía trên bảng.
Cuối bảng: 1 dòng bắt đầu bằng "Nguồn giá:" ghi nguồn + thời điểm lấy giá, nêu rõ đâu là NGUỒN CHÍNH.
Ngay sau đó: 1 dòng bắt đầu bằng "Lưu ý dữ liệu:" (2–5 câu) — số nào lấy từ đâu, phiên nào,
kiểm chứng bằng cách nào, độ lệch giữa nguồn chính và nguồn đối chiếu, số nào là proxy hoặc
chưa xác minh được.

**1b. Tin tức QUỐC TẾ** (bullet list, mỗi item: **Tiêu đề**: mô tả 1–2 câu. *([Nguồn](URL), DD/MM)*)
Chọn tối đa 8 tin quan trọng nhất theo mức độ tác động, bao gồm TẤT CẢ 3 nhóm tài sản:
- Ưu tiên cao nhất: quyết định chính sách OPEC+, ETS/CBAM, Fed/NHTW lớn
- Tin năng lượng: tồn kho EIA/API, rig count, sự cố nguồn cung, địa chính trị
- Tin carbon: EUA/ETS, CBAM, MSR, thị trường VCM, carbon VN
- Tin kim loại: LME inventory, dữ liệu kinh tế TQ, nhu cầu EV, dữ liệu tồn kho
Mỗi tin: tiêu đề in đậm + nội dung cô đọng + trích nguồn PHẢI có hyperlink markdown dạng *([Tên nguồn](URL gốc bài viết), DD/MM)* — dùng URL từ dữ liệu đầu vào.

**1c. Tin tức VIỆT NAM** (cùng format — tối đa 5 tin, nguồn PHẢI có hyperlink)
Ưu tiên: CBAM ảnh hưởng thép/nhôm/xi măng VN, sàn carbon VN, tín chỉ carbon rừng, chính sách năng lượng, giá vàng trong nước.

---

### PHẦN 2 — NHẬN ĐỊNH & KHUYẾN NGHỊ GIAO DỊCH
(Phần này tập trung vào EUA/Carbon là tài sản chính giao dịch của Stavian, nhưng có tích hợp tín hiệu liên thị trường từ năng lượng và kim loại)

**2a. Banner tín hiệu EUA**:
TÍN HIỆU: [BUY/HOLD/SELL] — [lý do ngắn gọn 1 câu]
Dòng phụ: [3–4 điểm chốt: giá EUA hiện tại · tín hiệu liên thị trường nổi bật · xu hướng · stop-loss]

**2b. Bảng tín hiệu nhanh EUA** (2 cột: Chỉ số | Giá trị):
- Xu hướng NGẮN HẠN | Xu hướng TRUNG HẠN
- KHUYẾN NGHỊ VỊ THẾ | Vùng MUA (entry)
- Hỗ trợ / Kháng cự | CẮT LỖ (stop-loss)
- Mục tiêu trung hạn | Độ tin cậy tín hiệu

**2c. Bảng động lực EUA** (2 cột: ▲ TĂNG | ▼ GIẢM)
Mỗi cột 4–5 bullet — có thể tích hợp tín hiệu từ TTF/năng lượng hoặc kim loại nếu có liên kết rõ ràng.

**2d. Bảng kịch bản & hành động** — 3 cột: Kịch bản | Xác suất | Hành động.
Nêu 4 kịch bản A–D, mỗi kịch bản gắn mức giá cụ thể; xác suất ghi Cao / Trung bình / Thấp.
BẮT BUỘC có ít nhất một kịch bản xấu (giá thủng hỗ trợ hoặc mất dữ liệu).

**2e. Chiến thuật giao dịch** (➤ Lệnh MỚI | ➤ Lệnh ĐANG NẮM GIỮ | ➤ Điểm CẮT LỖ tuyệt đối | ➤ Quản trị rủi ro | ➤ Kỳ mua bán tiếp theo)

**2f. Tín hiệu liên thị trường** — BẮT BUỘC: phân tích liên kết giữa 3 nhóm hàng hôm nay.
Nếu không có liên kết đáng chú ý → ghi "Không có tín hiệu liên thị trường mới" (không bịa).
Ví dụ cần kiểm tra: TTF↑ → nhôm/EUA, EUA↑ → fuel switching NG, USD/DXY → vàng + dầu, TQ data → đồng + quặng sắt

**2g. Lịch tin cần theo dõi** — ghi rõ ngày/sự kiện cho cả 3 nhóm:
(EIA inventory thứ Tư, rig count thứ Sáu, họp ECB/Fed, mốc CBAM/ETS, LME warrant expiry...)

**2h. Gợi ý kinh doanh / giải pháp** — tối đa 3 items gắn với CBAM/sàn VN/hedge năng lượng

Kết thúc: "Lưu ý: Nhận định dựa trên các nguồn dẫn trong báo cáo, KHÔNG phải khuyến nghị đầu tư. Quyết định giao dịch thuộc về người sử dụng."

---

### PHẦN 3 — CHI TIẾT CÁC TIN TỨC CHÍNH

**I. TIN TỨC QUỐC TẾ** — chi tiết 2–4 câu mỗi tin từ Phần 1b, kèm số liệu cụ thể. Cuối mỗi đoạn gắn: *Nguồn: [Tên nguồn](URL)*
**II. TIN TỨC VIỆT NAM** — tương tự, mỗi đoạn kết thúc bằng *Nguồn: [Tên nguồn](URL)*
**DANH MỤC NGUỒN THAM KHẢO** — numbered list đầy đủ, mỗi item dạng: [Tên nguồn — mô tả](URL)

---

## NGUYÊN TẮC BẮT BUỘC

1. Mọi số liệu, nhận định, dự báo PHẢI có nguồn cụ thể (tên + ngày). Không có nguồn → không đưa vào.
2. FACT / OPINION / FORECAST phân biệt rõ — không trình bày opinion như fact.
3. Nếu dữ liệu giá không đầy đủ hoặc cũ hơn 2 ngày → thêm ⚠ cảnh báo ở đầu bảng giá.
4. Ngôn ngữ: tiếng Việt, giữ thuật ngữ Anh chuyên môn (EUA, contango, MSR, CBAM, spread, backwardation...).
5. Không đưa khuyến nghị mua/bán trực tiếp — trình bày dưới dạng kịch bản có điều kiện.
6. **HYPERLINK BẮT BUỘC**: Mọi trích dẫn nguồn trong báo cáo PHẢI dùng markdown hyperlink \`[Tên nguồn](URL)\`. URL lấy từ dữ liệu đầu vào (cột URL). Nếu không có URL → chỉ ghi tên nguồn không link. Format trích dẫn inline: *([Tên nguồn](URL), DD/MM)* — in nghiêng, trong ngoặc đơn.
7. Output: **MARKDOWN THUẦN**, không dùng HTML.

---

## DỮ LIỆU ĐẦU VÀO

${priceCtx}

---

${newsCtx}

---

Bắt đầu báo cáo ngay từ "## PHẦN 1", không cần lời dẫn.
`.trim();
}

// ─── Call OpenAI API with retry ──────────────────────────────────────────────

async function callOpenAI(systemPrompt, userPrompt) {
  const { retries, retryDelay, maxTokens, model, timeout, temperature } = config.openai;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      log('analyzer', `Gọi OpenAI API model=${model} maxTokens=${maxTokens} temp=${temperature} (lần ${attempt}/${retries})...`);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      let response;
      try {
        response = await getOpenAIClient().chat.completions.create({
          model,
          max_tokens: maxTokens,
          temperature,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt },
          ],
        }, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }

      const text = response?.choices?.[0]?.message?.content;
      if (!text || text.trim().length < 100) {
        throw new Error('OpenAI trả về nội dung rỗng hoặc quá ngắn');
      }

      log('analyzer', `✓ OpenAI phản hồi thành công (${text.length} ký tự, finish_reason: ${response.choices[0].finish_reason})`);
      return text;

    } catch (err) {
      if (err.name === 'AbortError') {
        logError('analyzer', `Timeout sau ${timeout}ms (lần ${attempt})`);
      } else {
        logError('analyzer', `Lỗi OpenAI API (lần ${attempt}): ${err.message}`);
      }

      if (attempt === retries) {
        throw new Error(`OpenAI API thất bại sau ${retries} lần: ${err.message}`);
      }

      log('analyzer', `Chờ ${retryDelay / 1000}s trước khi thử lại...`);
      await new Promise(r => setTimeout(r, retryDelay));
    }
  }
}

// ─── Call Amazon Bedrock API with retry ──────────────────────────────────────

async function callBedrock(systemPrompt, userPrompt) {
  const { retries, retryDelay, maxTokens, modelId, timeout } = config.bedrock;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      log('analyzer', `Gọi Bedrock modelId=${modelId} (lần ${attempt}/${retries})...`);

      // Bedrock dùng Anthropic Messages API format (cho Claude models)
      // Tham khảo: https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages.html
      const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      };

      const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload),
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      let response;
      try {
        response = await getBedrockClient().send(command, { abortSignal: controller.signal });
      } finally {
        clearTimeout(timer);
      }

      // Parse response body (Uint8Array → string → JSON)
      const bodyText = Buffer.from(response.body).toString('utf-8');
      const parsed = JSON.parse(bodyText);

      const text = parsed?.content?.[0]?.text;
      if (!text || text.trim().length < 100) {
        throw new Error('Bedrock trả về nội dung rỗng hoặc quá ngắn');
      }

      log('analyzer', `✓ Bedrock phản hồi thành công (${text.length} ký tự, stop_reason: ${parsed.stop_reason})`);
      return text;

    } catch (err) {
      if (err.name === 'AbortError' || err.name === 'TimeoutError') {
        logError('analyzer', `Bedrock timeout sau ${timeout}ms (lần ${attempt})`);
      } else {
        logError('analyzer', `Lỗi Bedrock (lần ${attempt}): ${err.name} — ${err.message}`);
      }

      if (attempt === retries) {
        throw new Error(`Bedrock API thất bại sau ${retries} lần: ${err.message}`);
      }

      log('analyzer', `Chờ ${retryDelay / 1000}s trước khi thử lại...`);
      await new Promise(r => setTimeout(r, retryDelay));
    }
  }
}

// ─── Router: gọi đúng provider ────────────────────────────────────────────────

async function callAI(systemPrompt, userPrompt) {
  const provider = config.aiProvider;
  log('analyzer', `AI provider: ${provider.toUpperCase()}`);

  if (provider === 'bedrock') {
    return callBedrock(systemPrompt, userPrompt);
  }
  return callOpenAI(systemPrompt, userPrompt);
}

// ─── Convert markdown → HTML theo đúng cấu trúc mẫu báo cáo Stavian ─────────
//
// AI trả về markdown 3 phần. Hàm này parse và render thành HTML có visual
// giống file mẫu: banner tín hiệu màu, bảng 2 cột động lực, section headers xanh.

function buildHtmlReport(markdown, reportDate, author) {
  const viDate  = viDateString(reportDate);
  const dispDate = `${String(reportDate.getDate()).padStart(2,'0')}/${String(reportDate.getMonth()+1).padStart(2,'0')}/${reportDate.getFullYear()}`;
  const autoTime = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  // ── Detect signal từ markdown ──────────────────────────────────────────────
  let signalStyle = 'background:#1E7A46;color:#fff;'; // HOLD mặc định
  let signalLabel = 'NẮM GIỮ (HOLD)';
  // Chỉ dò trong Phần 2 để khối ĐIỂM NHẤN ở đầu báo cáo không cướp mất khớp đầu tiên
  const signalScope = markdown.split(/#{1,3}\s*PHẦN 2/i)[1] || markdown;
  const sigMatch = signalScope.match(/TÍN HIỆU[^:]*:\s*(BUY|MUA|SELL|BÁN|HOLD|NẮM GIỮ)/i);
  if (sigMatch) {
    const sig = sigMatch[1].toUpperCase();
    if (sig === 'BUY' || sig === 'MUA') {
      signalStyle = 'background:#0369a1;color:#fff;';
      signalLabel = 'MUA (BUY)';
    } else if (sig === 'SELL' || sig === 'BÁN') {
      signalStyle = 'background:#C0392B;color:#fff;';
      signalLabel = 'BÁN (SELL)';
    }
  }

  // ── Chuyển markdown cơ bản → HTML inline (dùng cho body từng phần) ─────────
  function md(text) {
    if (!text) return '';
    return text
      // links trước bold để tránh conflict
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:#1E7A46;">$1</a>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:12px;">$1</code>');
  }

  // ── Section header (xanh đậm với border) ───────────────────────────────────
  function sectionH2(title) {
    return `<h2 style="font-size:17px;color:#1E7A46;border-bottom:3px solid #1E7A46;padding-bottom:5px;margin:24px 0 12px;">${title}</h2>`;
  }

  function subHeader(title) {
    return `<div style="background:#EAF1FB;font-weight:bold;color:#14532D;padding:5px 10px;margin:14px 0 8px;font-size:14px;">${title}</div>`;
  }

  function regionBadge(label) {
    return `<div style="background:#E6F2EA;font-weight:bold;color:#14532D;padding:5px 10px;margin:14px 0 8px;font-size:14px;">${label}</div>`;
  }

  // ── Parse markdown thành các dòng/đoạn dễ xử lý ───────────────────────────
  const lines = markdown.split('\n');

  // Tách 3 phần chính
  function extractSection(marker) {
    const startRe = new RegExp(`^#{1,3}\\s*PHẦN ${marker}`, 'i');
    const nextRe  = /^#{1,3}\s*PHẦN /i;
    let inSection = false;
    const result = [];
    for (const line of lines) {
      if (startRe.test(line)) { inSection = true; continue; }
      if (inSection && nextRe.test(line) && !startRe.test(line)) break;
      if (inSection) result.push(line);
    }
    return result.join('\n');
  }

  const part1Text = extractSection('1');
  const part2Text = extractSection('2');
  const part3Text = extractSection('3');

  // ── ĐIỂM NHẤN: khối hero đặt trước Phần 1 (theo mẫu 31/07) ────────────────
  // Cú pháp markdown:
  //   ## ĐIỂM NHẤN — <tiêu đề in hoa>
  //   <đoạn phân tích>
  //   *(Nguồn: ...)*
  function extractHighlight() {
    const startRe = new RegExp('^#{1,3}\\s*(?:🚨\\s*)?ĐIỂM NHẤN\\b', 'i');
    const stopRe  = /^#{1,3}\s*(?:PHẦN |ĐIỂM NHẤN)/i;
    let inBlock = false;
    let title = '';
    const body = [];
    for (const line of lines) {
      if (!inBlock && startRe.test(line)) {
        inBlock = true;
        title = line.replace(/^#{1,3}\s*(?:🚨\s*)?ĐIỂM NHẤN\s*[—–-]*\s*/i, '').trim();
        continue;
      }
      if (inBlock && stopRe.test(line)) break;
      if (inBlock) body.push(line);
    }
    if (!inBlock || !title) return '';

    const paragraphs = body.join('\n').trim().split(/\n\s*\n/)
      .map(p => p.trim()).filter(Boolean)
      .map(p => `<div style="font-size:13px;line-height:1.6;margin-top:6px;text-align:justify;">${md(p.replace(/\n/g, ' '))}</div>`)
      .join('');

    return `
    <div style="background:#FDF6E3;border:2px solid #C9A227;border-left:6px solid #C9A227;padding:12px 16px;margin:14px 0 4px;">
      <div style="font-size:14px;font-weight:bold;color:#7A5C00;line-height:1.45;">🚨 ĐIỂM NHẤN — ${md(title)}</div>
      ${paragraphs}
    </div>`;
  }
  const highlightHtml = extractHighlight();

  // ── Render bảng markdown (|col|col|) → HTML table ─────────────────────────
  function renderTable(text, headerBg = '#1E7A46') {
    const tableLines = text.split('\n').filter(l => l.trim().startsWith('|'));
    if (tableLines.length === 0) return '';

    let html = `<table style="border-collapse:collapse;width:100%;font-size:13px;margin:8px 0;">`;
    let firstDataRow = true;
    for (const line of tableLines) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) continue; // separator row
      if (firstDataRow) {
        html += `<tr style="background:${headerBg};color:#fff;">`;
        cells.forEach(c => { html += `<th style="border:1px solid #ccc;padding:6px 8px;text-align:left;">${md(c)}</th>`; });
        html += '</tr>';
        firstDataRow = false;
      } else {
        const isAlt = tableLines.indexOf(line) % 2 === 0;
        html += `<tr${isAlt ? ' style="background:#f7f9f8;"' : ''}>`;
        cells.forEach((c, i) => {
          // Stop-loss row: màu đỏ
          const isStop = c.toLowerCase().includes('< ') || c.toLowerCase().includes('cắt lỗ') || c.toLowerCase().includes('stop');
          const cellStyle = isStop
            ? 'border:1px solid #ccc;padding:6px 8px;background:#FDECEA;color:#C0392B;font-weight:bold;'
            : 'border:1px solid #ccc;padding:6px 8px;';
          html += `<td style="${cellStyle}">${md(c)}</td>`;
        });
        html += '</tr>';
      }
    }
    html += '</table>';
    return html;
  }

  // ── Render bullet list → HTML ul/li ───────────────────────────────────────
  function renderList(text, indent = '20px') {
    const items = text.split('\n')
      .filter(l => /^[-*•➤]\s/.test(l.trim()) || /^\d+\.\s/.test(l.trim()))
      .map(l => l.replace(/^[-*•➤\d.]+\s*/, '').trim());
    if (items.length === 0) return '';
    const lis = items.map(item => {
      const isArrow = item.startsWith('➤') || item.startsWith('Lệnh') || item.startsWith('Mở') || item.startsWith('Quản') || item.startsWith('Tin');
      return `<li style="margin-bottom:${isArrow ? '7' : '5'}px;">${md(item)}</li>`;
    }).join('\n');
    return `<ul style="margin:0 0 10px;padding-left:${indent};font-size:13.5px;line-height:1.55;">${lis}</ul>`;
  }

  // ── Render paragraphs (non-table, non-list) ────────────────────────────────
  function renderParagraphs(text) {
    return text.split('\n\n')
      .map(block => {
        const trimmed = block.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('|')) return renderTable(trimmed);
        if (/^[-*•➤\d]/.test(trimmed)) return renderList(trimmed);
        if (/^#{1,4}\s/.test(trimmed)) {
          const lvl = (trimmed.match(/^(#+)/) || ['', ''])[1].length;
          const title = trimmed.replace(/^#+\s*/, '');
          if (lvl <= 2) return subHeader(title);
          return `<p style="font-size:14px;font-weight:bold;color:#14532D;margin:10px 0 4px;">${md(title)}</p>`;
        }
        return `<p style="font-size:13.5px;line-height:1.55;margin:0 0 10px;text-align:justify;">${md(trimmed)}</p>`;
      })
      .filter(Boolean)
      .join('\n');
  }

  // ── Render phần cảnh báo dữ liệu (nếu AI thêm) ────────────────────────────
  function renderDataWarning(text) {
    const warnMatch = text.match(/⚠[^<\n]+/);
    if (!warnMatch) return '';
    return `<div style="background:#FFF8E1;border-left:4px solid #F59E0B;padding:8px 14px;margin:10px 0;font-size:12.5px;color:#78350F;">${warnMatch[0]}</div>`;
  }

  // ── Banner tín hiệu ────────────────────────────────────────────────────────
  const signalSublineMatch = signalScope.match(/TÍN HIỆU[^\n]*\n([^\n]+)/i);
  const signalSubline = signalSublineMatch ? signalSublineMatch[1].trim() : '';

  const signalBanner = `
  <div style="${signalStyle}text-align:center;padding:12px;border-radius:4px;margin-bottom:14px;">
    <div style="font-size:20px;font-weight:bold;letter-spacing:.5px;">TÍN HIỆU HÔM NAY: ${signalLabel}</div>
    ${signalSubline ? `<div style="font-size:13px;opacity:.9;margin-top:3px;">${md(signalSubline)}</div>` : ''}
  </div>`;

  // ── Bảng động lực 2 cột (▲ tăng | ▼ giảm) ────────────────────────────────
  function renderDriversTable(text) {
    const upMatch   = text.match(/▲[^▼]*/s);
    const downMatch = text.match(/▼[\s\S]*/s);
    if (!upMatch || !downMatch) return renderParagraphs(text);

    const upItems   = upMatch[0].split('\n').filter(l => /^[•\-*]/.test(l.trim())).map(l => `<li style="margin-bottom:5px;">${md(l.replace(/^[•\-*]\s*/, ''))}</li>`).join('');
    const downItems = downMatch[0].split('\n').filter(l => /^[•\-*]/.test(l.trim())).map(l => `<li style="margin-bottom:5px;">${md(l.replace(/^[•\-*]\s*/, ''))}</li>`).join('');

    return `<table style="border-collapse:collapse;width:100%;font-size:13px;margin:8px 0;">
  <tr>
    <th style="border:1px solid #ccc;padding:6px 8px;background:#1E7A46;color:#fff;width:50%;text-align:left;">▲ ĐỘNG LỰC TĂNG GIÁ</th>
    <th style="border:1px solid #ccc;padding:6px 8px;background:#C0392B;color:#fff;width:50%;text-align:left;">▼ ÁP LỰC GIẢM GIÁ</th>
  </tr>
  <tr>
    <td style="border:1px solid #ccc;padding:8px;background:#E8F5EC;vertical-align:top;"><ul style="margin:0;padding-left:16px;">${upItems}</ul></td>
    <td style="border:1px solid #ccc;padding:8px;background:#FDECEA;vertical-align:top;"><ul style="margin:0;padding-left:16px;">${downItems}</ul></td>
  </tr>
</table>`;
  }

  // ── Bảng kịch bản với màu hàng ────────────────────────────────────────────
  function renderScenariosTable(text) {
    const tableLines = text.split('\n').filter(l => l.trim().startsWith('|'));
    if (tableLines.length < 2) return renderParagraphs(text);

    let html = `<table style="border-collapse:collapse;width:100%;font-size:13px;margin:8px 0;">`;
    // Header
    const headerCells = tableLines[0].split('|').slice(1, -1).map(c => c.trim());
    html += `<tr>${headerCells.map(c => `<th style="border:1px solid #ccc;padding:6px 8px;background:#14532D;color:#fff;text-align:left;">${md(c)}</th>`).join('')}</tr>`;

    const dataRows = tableLines.slice(1).filter(l => !l.split('|').slice(1,-1).every(c => /^[-:]+$/.test(c.trim())));
    const rowStyles = ['background:#FCF3E2;color:#B7791F;', 'background:#E8F5EC;color:#1E7A46;', 'background:#FDECEA;color:#C0392B;'];
    dataRows.forEach((row, i) => {
      const cells = row.split('|').slice(1, -1).map(c => c.trim());
      const [scenCell, ...rest] = cells;
      html += `<tr><td style="border:1px solid #ccc;padding:6px 8px;${rowStyles[i] || ''}font-weight:bold;">${md(scenCell)}</td>`;
      rest.forEach(c => { html += `<td style="border:1px solid #ccc;padding:6px 8px;">${md(c)}</td>`; });
      html += '</tr>';
    });
    html += '</table>';
    return html;
  }

  // ── Chiến thuật giao dịch (➤ prefix đặc biệt) ─────────────────────────────
  function renderTactics(text) {
    const items = text.split('\n').filter(l => /^[-*•➤]|^➤/.test(l.trim()));
    if (items.length === 0) return renderParagraphs(text);
    const lis = items.map(item => {
      const clean = item.trim().replace(/^[-*•➤]\s*/, '');
      // Bold phần trước dấu :
      const formatted = clean.replace(/^([^:]+:)/, '<b style="color:#14532D;">➤ $1</b>');
      return `<li style="margin-bottom:6px;">${md(formatted)}</li>`;
    }).join('\n');
    return `<ul style="margin:0 0 10px;padding-left:0;list-style:none;font-size:13.5px;line-height:1.55;">${lis}</ul>`;
  }

  // ── Tin chi tiết (Phần 3) ─────────────────────────────────────────────────
  function renderDetailedNews(text) {
    // Split theo numbered headlines
    const blocks = text.split(/\n(?=\d+\.\s|\*\*\d+\.)/);
    return blocks.map(block => {
      const titleMatch = block.match(/^(?:\*\*)?(\d+)\.\s+(.+?)(?:\*\*)?$/m);
      if (!titleMatch) return renderParagraphs(block);
      const [, num, title] = titleMatch;
      const body = block.replace(/^(?:\*\*)?(\d+)\.\s+(.+?)(?:\*\*)?$/m, '').trim();
      return `<p style="font-size:14px;font-weight:bold;color:#14532D;margin:12px 0 4px;">${num}. ${md(title)}</p>
<p style="font-size:13.5px;line-height:1.55;margin:0 0 10px;text-align:justify;">${md(body)}</p>`;
    }).join('\n');
  }

  // ── Danh mục nguồn ────────────────────────────────────────────────────────
  function renderReferences(text) {
    const items = text.split('\n').filter(l => /^\d+\./.test(l.trim()));
    if (items.length === 0) return '';
    const lis = items.map(item => {
      const clean = item.trim().replace(/^\d+\.\s*/, '');
      return `<li>${md(clean)}</li>`;
    }).join('\n');
    return `<ol style="margin:0;padding-left:22px;font-size:12.5px;line-height:1.6;color:#1E7A46;">${lis}</ol>`;
  }

  // ── Detect sub-sections trong Part 2 ────────────────────────────────────────
  function renderPart2(text) {
    const sections = [];
    const sectionRe = /^#{1,4}\s*(Bảng tín hiệu|Động lực|Kịch bản|Chiến thuật|Lịch tin|Gợi ý kinh doanh|Lưu ý)/im;

    // Tách thành các blocks dựa trên sub-headers
    const parts = text.split(/\n(?=#{1,4}\s)/);
    for (const part of parts) {
      const headerMatch = part.match(/^#{1,4}\s*(.+)/);
      if (!headerMatch) {
        // Phần đầu (banner + tín hiệu)
        sections.push(signalBanner);
        continue;
      }
      const headerTitle = headerMatch[1].trim();
      const bodyText = part.replace(/^#{1,4}\s*.+\n/, '').trim();

      if (/tín hiệu nhanh/i.test(headerTitle)) {
        sections.push(subHeader('Bảng tín hiệu nhanh EUA'));
        sections.push(renderTable(bodyText, '#14532D'));
      } else if (/động lực/i.test(headerTitle)) {
        sections.push(subHeader('Động lực thị trường EUA'));
        sections.push(renderDriversTable(bodyText));
      } else if (/kịch bản/i.test(headerTitle)) {
        sections.push(subHeader('Kịch bản & hành động'));
        sections.push(renderScenariosTable(bodyText));
      } else if (/chiến thuật/i.test(headerTitle)) {
        sections.push(subHeader('Chiến thuật giao dịch (mua/bán)'));
        sections.push(renderTactics(bodyText));
      } else if (/liên thị trường/i.test(headerTitle)) {
        sections.push(subHeader('Tín hiệu liên thị trường'));
        sections.push(renderParagraphs(bodyText));
      } else if (/lịch tin|catalyst/i.test(headerTitle)) {
        sections.push(subHeader('Lịch tin cần theo dõi (catalysts)'));
        sections.push(renderList(bodyText));
      } else if (/gợi ý|giải pháp/i.test(headerTitle)) {
        sections.push(subHeader('Gợi ý kinh doanh / giải pháp'));
        sections.push(renderList(bodyText));
      } else if (/lưu ý/i.test(headerTitle)) {
        sections.push(`<div style="border-top:1px solid #ccc;margin-top:12px;padding-top:6px;font-size:11px;color:#777;"><b>Lưu ý:</b> ${md(bodyText)}</div>`);
      } else {
        sections.push(subHeader(headerTitle));
        sections.push(renderParagraphs(bodyText));
      }
    }
    return sections.join('\n');
  }

  // ── Assemble Part 1 ────────────────────────────────────────────────────────
  const warn1 = renderDataWarning(part1Text);

  // Tìm bảng giá và tin tức trong part1
  const priceTableMatch = part1Text.match(/((?:\|[^\n]+\|\n?)+)/);
  const priceTableHtml = priceTableMatch ? renderTable(priceTableMatch[1]) : '';
  const afterTable = priceTableMatch ? part1Text.slice(part1Text.indexOf(priceTableMatch[1]) + priceTableMatch[1].length) : part1Text;

  // Tách Quốc tế / Việt Nam
  const intlMatch = afterTable.match(/QUỐC TẾ([\s\S]*?)(?=VIỆT NAM|$)/i);
  const vnMatch   = afterTable.match(/VIỆT NAM([\s\S]*?)(?=PHẦN 2|$)/i);

  const intlHtml = intlMatch ? renderList(intlMatch[1]) : '';
  const vnHtml   = vnMatch   ? renderList(vnMatch[1]) : '';

  // Dòng nguồn giá (thường là dòng italic sau bảng)
  const sourceLine = afterTable.match(/Nguồn giá[^\n]*/i);
  const sourceHtml = sourceLine
    ? `<div style="font-size:11px;font-style:italic;color:#777;margin:5px 0 0;">${md(sourceLine[0])}</div>`
    : '';

  // Khối "Lưu ý dữ liệu": ghi rõ số nào lấy từ đâu, đã kiểm chứng thế nào
  const dataNote = afterTable.match(/L[ưu]u ý dữ liệu:[^\n]*/i);
  const dataNoteHtml = dataNote
    ? `<div style="background:#F4F7F5;border-left:4px solid #1E7A46;padding:8px 12px;margin:8px 0 0;font-size:11.5px;line-height:1.55;color:#3d4a42;text-align:justify;">${md(dataNote[0])}</div>`
    : '';

  const part1Html = `
    ${sectionH2('PHẦN 1 — TIN TỨC CHÍNH / NỔI BẬT TRONG NGÀY')}
    ${warn1}
    ${priceTableHtml}
    ${sourceHtml}
    ${dataNoteHtml}
    ${regionBadge('QUỐC TẾ')}
    ${intlHtml}
    ${regionBadge('VIỆT NAM')}
    ${vnHtml}`;

  // ── Assemble Part 2 ────────────────────────────────────────────────────────
  const part2Html = `
    ${sectionH2('PHẦN 2 — NHẬN ĐỊNH & KHUYẾN NGHỊ GIAO DỊCH')}
    ${renderPart2(part2Text)}`;

  // ── Assemble Part 3 ────────────────────────────────────────────────────────
  const intlDetailMatch = part3Text.match(/I\.\s*TIN TỨC QUỐC TẾ([\s\S]*?)(?=II\.|$)/i);
  const vnDetailMatch   = part3Text.match(/II\.\s*TIN TỨC VIỆT NAM([\s\S]*?)(?=DANH MỤC|$)/i);
  const refsMatch       = part3Text.match(/DANH MỤC NGUỒN([\s\S]*?)$/i);

  const part3Html = `
    ${sectionH2('PHẦN 3 — CHI TIẾT CÁC TIN TỨC CHÍNH')}
    ${regionBadge('I. TIN TỨC QUỐC TẾ')}
    ${intlDetailMatch ? renderDetailedNews(intlDetailMatch[1]) : renderParagraphs(part3Text)}
    ${vnDetailMatch ? regionBadge('II. TIN TỨC VIỆT NAM') + renderDetailedNews(vnDetailMatch[1]) : ''}
    ${refsMatch ? `<h2 style="font-size:15px;color:#1E7A46;border-bottom:2px solid #1E7A46;padding-bottom:4px;margin:22px 0 8px;">DANH MỤC NGUỒN THAM KHẢO</h2>${renderReferences(refsMatch[1])}` : ''}`;

  // ── Final HTML document ────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tin tức thị trường Carbon - ${dispDate}</title>
</head>
<body style="margin:0;padding:0;background:#eef1f0;font-family:Arial,Helvetica,sans-serif;color:#222;">
<div style="max-width:820px;margin:0 auto;background:#ffffff;">

  <!-- HEADER -->
  <div style="background:#14532D;padding:18px 28px 8px;text-align:center;">
    <div style="font-size:26px;font-weight:bold;color:#ffffff;letter-spacing:.3px;">TIN TỨC HÀNG NGÀY THỊ TRƯỜNG CARBON</div>
    <div style="font-size:13px;color:#C8E6D4;letter-spacing:2px;margin-top:2px;">CARBON MARKET DAILY NEWS</div>
  </div>
  <div style="background:#1E7A46;padding:8px 28px;text-align:center;color:#fff;font-weight:bold;font-size:15px;">${viDate}</div>
  <div style="padding:6px 28px 0;text-align:center;font-style:italic;color:#666;font-size:12px;">Người báo cáo: ${author}</div>
  <div style="padding:3px 28px 0;text-align:right;font-size:10px;color:#aaa;font-style:italic;">Tạo tự động lúc ${autoTime}</div>
  <div style="margin:8px 28px 0;text-align:center;"><a href="/carbondaily/archive.html" style="display:inline-block;background:#E6F2EA;color:#14532D;text-decoration:none;font-weight:bold;font-size:12px;padding:6px 14px;border-radius:5px;border:1px solid #bfe0cd;">📚 Xem lại báo cáo các ngày trước →</a></div>

  <div style="padding:8px 28px 28px;">
    ${highlightHtml}
    ${part1Html}
    ${part2Html}
    ${part3Html}
  </div>

  <div style="background:#14532D;color:#C8E6D4;text-align:center;padding:10px;font-size:11px;">
    STAVIAN INDUSTRIAL METAL — Phòng CLPT, Team KD TCCB  |  Tin tức hàng ngày thị trường Carbon — ${dispDate}<br>
    <span style="font-size:10px;">Báo cáo tổng hợp tự động có kiểm duyệt. Không phải khuyến nghị đầu tư.</span>
  </div>
</div>
</body>
</html>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Phân tích dữ liệu và tạo dự thảo báo cáo
 * @param {Record<string, import('./collector').PriceData>} prices
 * @param {import('./collector').NewsItem[]} newsItems
 * @returns {Promise<{html: string, markdown: string, date: Date, filename: string}>}
 */
async function analyzAndBuild(prices, newsItems) {
  const reportDate = new Date();
  const author = 'Team KD Tín chỉ carbon, Phòng CLPT — Stavian Industrial Metal';

  log('analyzer', 'Đang xây dựng prompt cho OpenAI...');
  const systemPrompt = loadSystemPrompt();
  const userPrompt = buildUserPrompt(prices, newsItems, reportDate);

  log('analyzer', `System prompt: ${systemPrompt.length} ký tự | User prompt: ${userPrompt.length} ký tự`);

  const markdown = await callAI(systemPrompt, userPrompt);
  log('analyzer', 'Đang render HTML từ markdown...');

  const html = buildHtmlReport(markdown, reportDate, author);

  const filename = `Tin tức thị trường Carbon ${ddmmyyyy(reportDate)}.html`;

  log('analyzer', `✓ Báo cáo tạo xong: "${filename}" (${html.length} ký tự HTML)`);

  return { html, markdown, date: reportDate, filename, author };
}

module.exports = { analyzAndBuild, buildHtmlReport };

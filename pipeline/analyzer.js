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

/**
 * buildHtmlReport — render markdown → HTML theo ĐÚNG mẫu báo cáo ngày 31/07/2026.
 *
 * Mẫu 31/07 vốn là HTML viết tay; hàm này tái tạo lại toàn bộ markup của nó:
 *   - Header xanh #1D6059 kèm logo Stavian
 *   - Khối ĐIỂM NHẤN nền đỏ sẫm #7A1E1E, chữ trắng, link gạch chân trắng
 *   - Bảng giá 3 cột: Sản phẩm | Giá | Thay đổi / Ghi chú
 *   - Hộp "Nguồn giá" nền xanh nhạt #EAF1FB, hộp "Lưu ý dữ liệu" nền hổ phách #FCF3E2
 *   - Phần 2: banner tín hiệu, bảng tín hiệu nhanh 2 cột nhãn/giá trị,
 *     bảng Động lực TĂNG & GIẢM 2 cột, bảng Kịch bản → Hành động 3 cột,
 *     hộp Chiến thuật ➤, danh sách Catalysts, Gợi ý, hộp cảnh báo đỏ cuối phần
 *   - Phần 3: tin chi tiết đánh số + DANH MỤC NGUỒN THAM KHẢO
 *   - Footer tóm tắt số liệu đã kiểm chứng
 *
 * HỢP ĐỒNG MARKDOWN (analyst/AI phải viết đúng các mốc này):
 *   ## ĐIỂM NHẤN — <tiêu đề in hoa>
 *   ## PHẦN 1 — TIN TỨC CHÍNH / NỔI BẬT TRONG NGÀY
 *      | Sản phẩm | Giá | Thay đổi / Ghi chú |
 *      **Nguồn giá:** ...        **Lưu ý dữ liệu:** ...
 *      ### QUỐC TẾ / ### VIỆT NAM  (bullet: - **Tiêu đề:** mô tả *(nguồn)*)
 *   ## PHẦN 2 — NHẬN ĐỊNH & HÀNH ĐỘNG CHO STAVIAN
 *      **TÍN HIỆU: <BUY|HOLD|SELL|THẬN TRỌNG>** — <dòng banner lớn>
 *      <dòng phụ banner>
 *      ### Bảng tín hiệu nhanh            (bảng 2 cột: nhãn | giá trị)
 *      ### Động lực TĂNG & GIẢM           (▲ ... rồi ▼ ...)
 *      ### Kịch bản → Hành động           (bảng 3 cột)
 *      ### Chiến thuật giao dịch (mua/bán)(bullet: - **Nhãn:** nội dung)
 *      ### Catalysts cần theo dõi         (bullet)
 *      ### Gợi ý mô hình hợp tác – kinh doanh (bullet)
 *      ### Lưu ý                          (hộp đỏ cuối Phần 2)
 *   ## PHẦN 3 — CHI TIẾT CÁC TIN TỨC CHÍNH
 *      I. QUỐC TẾ / II. VIỆT NAM  (1. **Tiêu đề** — nội dung *Nguồn: [x](url)*)
 *      DANH MỤC NGUỒN THAM KHẢO   (1. [Tên](url) — ghi chú)
 *   ## TÓM TẮT CUỐI                       (nội dung footer; tuỳ chọn)
 *
 * @param {string} markdown
 * @param {Date} reportDate
 * @param {string} author
 * @returns {string} HTML đầy đủ
 */
function buildHtmlReport(markdown, reportDate, author) {
  const viDate   = viDateString(reportDate);
  const dispDate = `${String(reportDate.getDate()).padStart(2, '0')}/${String(reportDate.getMonth() + 1).padStart(2, '0')}/${reportDate.getFullYear()}`;
  const autoTime = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  const lines = markdown.split('\n');

  // ── Inline markdown → HTML ────────────────────────────────────────────────
  function md(text, linkColor = '#1E7A46') {
    if (!text) return '';
    const linkStyle = linkColor === '#fff'
      ? 'color:#fff;text-decoration:underline;'
      : `color:${linkColor};`;
    return text
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" target="_blank" rel="noopener" style="${linkStyle}">$1</a>`)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:12px;">$1</code>');
  }

  // ── Trích một phần theo mốc "## PHẦN n" ───────────────────────────────────
  function extractSection(marker) {
    const startRe = new RegExp(`^#{1,3}\\s*PHẦN ${marker}`, 'i');
    const nextRe  = /^#{1,3}\s*(PHẦN |TÓM TẮT CUỐI)/i;
    let inSection = false;
    const out = [];
    for (const line of lines) {
      if (startRe.test(line)) { inSection = true; continue; }
      if (inSection && nextRe.test(line)) break;
      if (inSection) out.push(line);
    }
    return out.join('\n');
  }

  // ── Trích khối theo tiêu đề "## X" bất kỳ ────────────────────────────────
  function extractBlock(headingRe) {
    const stopRe = /^#{1,3}\s*(PHẦN |ĐIỂM NHẤN|TÓM TẮT CUỐI)/i;
    let inBlock = false, title = '';
    const body = [];
    for (const line of lines) {
      if (!inBlock && headingRe.test(line)) {
        inBlock = true;
        title = line.replace(/^#{1,3}\s*/, '').replace(/^[^—–-]*[—–-]\s*/, '').trim();
        continue;
      }
      if (inBlock && stopRe.test(line)) break;
      if (inBlock) body.push(line);
    }
    return inBlock ? { title, body: body.join('\n').trim() } : null;
  }

  const part1Text = extractSection('1');
  const part2Text = extractSection('2');
  const part3Text = extractSection('3');

  // ── Tách các tiểu mục "### ..." trong một phần ────────────────────────────
  function splitSubsections(text) {
    const out = [];
    // Phần mở đầu (trước "###" đầu tiên) là MỘT khối duy nhất — gom chung, không
    // tách theo dòng, nếu không mỗi dòng sẽ thành một section và banner tín hiệu
    // bị render lặp lại đúng bằng số dòng.
    let current = { title: null, body: [] };
    for (const line of text.split('\n')) {
      const h = line.match(/^#{3,4}\s*(.+)/);
      if (h) {
        out.push(current);
        current = { title: h[1].trim(), body: [] };
      } else {
        current.body.push(line);
      }
    }
    out.push(current);
    return out
      .map(s => ({ title: s.title, body: (s.body || []).join('\n').trim() }))
      .filter(s => s.title || s.body);
  }

  function subHeader(title, marginTop = '16px') {
    return `      <div style="background:#EAF1FB;font-weight:bold;color:#14532D;padding:5px 10px;margin:${marginTop} 0 8px;font-size:14px;">
        ${title.replace(/&(?!amp;|lt;|gt;|#)/g, '&amp;')}</div>`;
  }

  function regionBadge(label) {
    return `      <div style="background:#E6F2EA;font-weight:bold;color:#14532D;padding:5px 10px;margin:14px 0 8px;font-size:14px;">
        ${label}</div>`;
  }

  function sectionH2(title, marginTop = '24px') {
    return `      <h2 style="font-size:17px;color:#1E7A46;border-bottom:3px solid #1E7A46;padding-bottom:5px;margin:${marginTop} 0 12px;">
        ${title}</h2>`;
  }

  /** Các dòng bảng markdown → mảng ô, đã bỏ dòng phân cách */
  function tableRows(text) {
    return text.split('\n')
      .filter(l => l.trim().startsWith('|'))
      .map(l => l.split('|').slice(1, -1).map(c => c.trim()))
      .filter(cells => !cells.every(c => /^[-:]+$/.test(c)));
  }

  /** Bullet markdown → mảng chuỗi (giữ nguyên inline markdown) */
  function bulletItems(text) {
    return text.split('\n')
      .filter(l => /^\s*[-*•➤]\s+/.test(l))
      .map(l => l.replace(/^\s*[-*•➤]\s+/, '').trim());
  }

  // ══ ĐIỂM NHẤN ═════════════════════════════════════════════════════════════
  function renderHighlight() {
    const blk = extractBlock(/^#{1,3}\s*(?:🚨\s*)?ĐIỂM NHẤN\b/i);
    if (!blk || !blk.title) return '';
    const paras = blk.body.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const bodyHtml = paras.map(p => md(p.replace(/\n/g, ' '), '#fff')).join('<br><br>\n        ');
    return `      <!-- BREAKING -->
      <div
        style="background:#7A1E1E;color:#fff;padding:12px 14px;margin:12px 0 6px;border-radius:4px;font-size:13.5px;line-height:1.55;">
        <b style="font-size:15px;">🚨 ĐIỂM NHẤN — ${md(blk.title, '#fff')}</b><br>
        ${bodyHtml}</div>`;
  }

  // ══ PHẦN 1: bảng giá 3 cột ════════════════════════════════════════════════
  function renderPriceTable(text) {
    const rows = tableRows(text);
    if (rows.length === 0) return '';
    const [header, ...data] = rows;

    let html = `      <table style="border-collapse:collapse;width:100%;font-size:13px;margin:8px 0;">
        <tr style="background:#1E7A46;color:#fff;">
${header.map(c => `          <th style="border:1px solid #ccc;padding:6px 8px;text-align:left;">${md(c)}</th>`).join('\n')}
        </tr>`;

    data.forEach((cells, i) => {
      const alt = i % 2 === 0 ? ' style="background:#f7f9f8;"' : '';
      // Cột 3 quyết định màu cột giá: giảm → đỏ, tăng → xanh, còn lại để mộc
      const changeCell = cells[2] || '';
      let priceStyle = 'border:1px solid #ccc;padding:6px 8px;';
      if (/^[^|]*?[−-]\s*\d|giảm|THỦNG/i.test(changeCell)) priceStyle += 'font-weight:bold;color:#C0392B;';
      else if (/^[^|]*?\+\s*\d|tăng/i.test(changeCell)) priceStyle += 'font-weight:bold;color:#14532D;';

      html += `\n        <tr${alt}>
          <td style="border:1px solid #ccc;padding:6px 8px;font-weight:bold;">${md(cells[0] || '')}</td>
          <td style="${priceStyle}">${md(cells[1] || '')}</td>
          <td style="border:1px solid #ccc;padding:6px 8px;">${md(cells[2] || '')}</td>
        </tr>`;
    });
    return html + '\n      </table>';
  }

  function renderSourceBox(text) {
    const m = text.match(/\*\*Nguồn giá:\*\*([^\n]*)/i) || text.match(/Nguồn giá:([^\n]*)/i);
    if (!m) return '';
    return `      <p style="font-size:12.5px;line-height:1.55;background:#EAF1FB;border-left:4px solid #1E7A46;padding:8px 12px;margin:6px 0 14px;">
        <b>Nguồn giá:</b>${md(m[1])}
      </p>`;
  }

  function renderDataNoteBox(text) {
    const m = text.match(/\*\*Lưu ý dữ liệu:\*\*([\s\S]*?)(?=\n\s*\n|\n###|$)/i)
           || text.match(/Lưu ý dữ liệu:([^\n]*)/i);
    if (!m) return '';
    return `      <p style="font-size:12.5px;line-height:1.55;background:#FCF3E2;border-left:4px solid #B7791F;padding:8px 12px;margin:0 0 14px;">
        <b>Lưu ý dữ liệu:</b>${md(m[1].trim().replace(/\n/g, ' '))}
      </p>`;
  }

  function renderNewsList(text) {
    const items = bulletItems(text);
    if (items.length === 0) return '';
    const lis = items.map(it => `        <li style="margin-bottom:5px;">${md(it)}</li>`).join('\n');
    return `      <ul style="margin:0 0 10px;padding-left:20px;font-size:13.5px;line-height:1.55;">
${lis}
      </ul>`;
  }

  // ══ PHẦN 2 ════════════════════════════════════════════════════════════════
  const signalScope = markdown.split(/#{1,3}\s*PHẦN 2/i)[1] || markdown;
  const sigMatch = signalScope.match(/\*\*TÍN HIỆU:\s*([^*]+?)\*\*\s*[—–-]?\s*([^\n]*)/i);
  const sigWordRaw = sigMatch ? sigMatch[1].trim() : 'HOLD';
  const sigWord = sigWordRaw.toUpperCase();

  let bannerBg = '#B7791F', bannerSubColor = '#F6E7C8'; // HOLD / trung tính
  if (/BUY|MUA|TÍCH CỰC/.test(sigWord)) { bannerBg = '#1E7A46'; bannerSubColor = '#C8E6D4'; }
  else if (/SELL|BÁN|THẬN TRỌNG|PHÒNG THỦ/.test(sigWord)) { bannerBg = '#7A1E1E'; bannerSubColor = '#F3D8D8'; }

  function renderSignalBanner(text) {
    const headline = sigMatch ? sigMatch[2].trim() : '';
    // dòng phụ = dòng không rỗng ngay sau dòng TÍN HIỆU
    const afterLines = text.split('\n');
    const idx = afterLines.findIndex(l => /\*\*TÍN HIỆU:/i.test(l));
    let subline = '';
    for (let i = idx + 1; i < afterLines.length; i++) {
      const t = afterLines[i].trim();
      if (!t) continue;
      if (/^#{2,4}\s/.test(t)) break;
      subline = t;
      break;
    }
    return `      <div style="background:${bannerBg};color:#fff;text-align:center;padding:12px;border-radius:4px;margin-bottom:14px;">
        <div style="font-size:20px;font-weight:bold;letter-spacing:.5px;">TÍN HIỆU HÔM NAY: ${md(headline, '#fff')}</div>
        ${subline ? `<div style="font-size:13px;color:${bannerSubColor};margin-top:3px;">${md(subline, '#fff')}</div>` : ''}
      </div>`;
  }

  /** Bảng tín hiệu nhanh: 2 cột nhãn | giá trị, ô giá trị tô màu theo sắc thái */
  function renderQuickSignalTable(text) {
    const rows = tableRows(text);
    if (rows.length === 0) return '';
    let html = `      <table style="border-collapse:collapse;width:100%;font-size:13px;">`;
    rows.forEach((cells, i) => {
      const label = cells[0] || '';
      const value = cells[1] || '';
      let style = 'border:1px solid #ccc;padding:6px 8px;';
      if (/CẮT LỖ|stop-loss/i.test(label) || /↘|NGHIÊNG GIẢM|PHÒNG THỦ|SUY YẾU/i.test(value)) {
        style += 'background:#FDECEA;color:#C0392B;font-weight:bold;';
      } else if (/↔|GIẰNG CO|TRUNG TÍNH|THẬN TRỌNG|CHỜ/i.test(value)) {
        style += 'background:#FCF3E2;color:#B7791F;font-weight:bold;';
      } else if (/↗|NGHIÊNG TĂNG|TÍCH CỰC/i.test(value)) {
        style += 'background:#E6F2EA;color:#14532D;font-weight:bold;';
      } else {
        style += 'color:#14532D;font-weight:bold;';
      }
      const widthAttr = i === 0 ? 'width:34%;' : '';
      html += `\n        <tr>
          <td style="border:1px solid #ccc;padding:6px 8px;background:#f2f2f2;font-weight:bold;${widthAttr}">${md(label)}</td>
          <td style="${style}">${md(value)}</td>
        </tr>`;
    });
    return html + '\n      </table>';
  }

  /** Động lực TĂNG & GIẢM: 2 cột, các mục cách nhau bằng <br><br> */
  function renderDriversTable(text) {
    const upBlock   = (text.match(/▲[\s\S]*?(?=▼|$)/) || [''])[0];
    const downBlock = (text.match(/▼[\s\S]*/) || [''])[0];
    const cell = block => bulletItems(block).map(it => md(it)).join('<br><br>\n            ');
    return `      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <tr>
          <th style="border:1px solid #ccc;padding:6px 8px;background:#E6F2EA;color:#14532D;text-align:left;width:50%;">▲ ĐỘNG LỰC TĂNG</th>
          <th style="border:1px solid #ccc;padding:6px 8px;background:#FDECEA;color:#C0392B;text-align:left;">▼ ĐỘNG LỰC GIẢM</th>
        </tr>
        <tr>
          <td style="border:1px solid #ccc;padding:8px;vertical-align:top;">
            ${cell(upBlock)}
          </td>
          <td style="border:1px solid #ccc;padding:8px;vertical-align:top;">
            ${cell(downBlock)}
          </td>
        </tr>
      </table>`;
  }

  /** Kịch bản → Hành động: 3 cột, cột Xác suất tô màu theo sắc thái kịch bản */
  function renderScenarioTable(text) {
    const rows = tableRows(text);
    if (rows.length === 0) return '';
    const [header, ...data] = rows;
    let html = `      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <tr style="background:#1E7A46;color:#fff;">
          <th style="border:1px solid #ccc;padding:6px 8px;text-align:left;width:30%;">${md(header[0] || 'Kịch bản')}</th>
          <th style="border:1px solid #ccc;padding:6px 8px;text-align:left;width:14%;">${md(header[1] || 'Xác suất')}</th>
          <th style="border:1px solid #ccc;padding:6px 8px;text-align:left;">${md(header[2] || 'Hành động')}</th>
        </tr>`;
    data.forEach((cells, i) => {
      const alt = i % 2 === 0 ? ' style="background:#f7f9f8;"' : '';
      const scen = cells[0] || '';
      const probColor = /thủng|giảm|cắt lỗ|mất|xấu/i.test(scen) ? '#C0392B'
                      : /giữ|hồi|vượt|tăng|phục hồi/i.test(scen) ? '#14532D'
                      : '#B7791F';
      html += `\n        <tr${alt}>
          <td style="border:1px solid #ccc;padding:6px 8px;font-weight:bold;">${md(scen)}</td>
          <td style="border:1px solid #ccc;padding:6px 8px;font-weight:bold;color:${probColor};">${md(cells[1] || '')}</td>
          <td style="border:1px solid #ccc;padding:6px 8px;">${md(cells[2] || '')}</td>
        </tr>`;
    });
    return html + '\n      </table>';
  }

  /** Chiến thuật giao dịch: hộp xám, mỗi dòng mở đầu ➤ */
  function renderTacticsBox(text) {
    const items = bulletItems(text);
    if (items.length === 0) return '';
    const body = items.map(it => `➤ ${md(it)}`).join('<br><br>\n        ');
    return `      <div style="font-size:13.5px;line-height:1.6;background:#f7f9f8;border:1px solid #ddd;padding:10px 14px;margin-bottom:12px;">
        ${body}
      </div>`;
  }

  function renderPlainList(text) {
    const items = bulletItems(text);
    if (items.length === 0) return '';
    const lis = items.map(it => `        <li style="margin-bottom:4px;">${md(it)}</li>`).join('\n');
    return `      <ul style="margin:0 0 12px;padding-left:20px;font-size:13.5px;line-height:1.55;">
${lis}
      </ul>`;
  }

  function renderPart2Warning(text) {
    if (!text) return '';
    return `      <div style="background:#FDECEA;border:1px solid #C0392B;color:#C0392B;padding:9px 12px;margin:12px 0;font-size:12.5px;font-weight:bold;text-align:center;border-radius:4px;">
        ⚠ ${md(text.replace(/\n/g, ' '))}
      </div>`;
  }

  function renderPart2(text) {
    const subs = splitSubsections(text);
    const out = [];
    for (const s of subs) {
      if (!s.title) { out.push(renderSignalBanner(s.body)); continue; }
      const t = s.title;
      if (/tín hiệu nhanh/i.test(t))        { out.push(subHeader(t, '14px'), renderQuickSignalTable(s.body)); }
      else if (/động lực/i.test(t))         { out.push(subHeader(t), renderDriversTable(s.body)); }
      else if (/kịch bản/i.test(t))         { out.push(subHeader(t), renderScenarioTable(s.body)); }
      else if (/chiến thuật/i.test(t))      { out.push(subHeader(t), renderTacticsBox(s.body)); }
      else if (/lưu ý/i.test(t))            { out.push(renderPart2Warning(s.body)); }
      else                                   { out.push(subHeader(t), renderPlainList(s.body)); }
    }
    return out.filter(Boolean).join('\n\n');
  }

  // ══ PHẦN 3 ════════════════════════════════════════════════════════════════
  function renderDetailedNews(text) {
    const blocks = text.split(/\n(?=\d+\.\s)/).map(b => b.trim()).filter(Boolean);
    return blocks.map(block => {
      const m = block.match(/^(\d+)\.\s+\*\*(.+?)\*\*\s*[—–-]?\s*([\s\S]*)$/);
      if (!m) return '';
      const [, num, title, body] = m;
      return `      <p style="font-size:14px;font-weight:bold;color:#14532D;margin:12px 0 4px;">${num}. ${md(title)}</p>
      <p style="font-size:13.5px;line-height:1.55;margin:0 0 10px;text-align:justify;">${md(body.replace(/\n/g, ' ').trim())}</p>`;
    }).filter(Boolean).join('\n');
  }

  function renderReferences(text) {
    const items = text.split('\n').map(l => l.trim()).filter(l => /^\d+\.\s/.test(l));
    if (items.length === 0) return '';
    const lis = items.map(raw => {
      const clean = raw.replace(/^\d+\.\s*/, '');
      // "[Tên](url) — ghi chú"  →  link + ghi chú xám
      const split = clean.match(/^(\[[^\]]+\]\([^)]+\))\s*[—–-]\s*(.+)$/);
      if (split) {
        return `        <li>${md(split[1])} — <span style="color:#777;">${md(split[2])}</span></li>`;
      }
      return `        <li>${md(clean)}</li>`;
    }).join('\n');
    return `      <ol style="margin:0;padding-left:22px;font-size:12.5px;line-height:1.6;color:#1E7A46;">
${lis}
      </ol>`;
  }

  // ══ Lắp ráp ═══════════════════════════════════════════════════════════════
  const highlightHtml = renderHighlight();

  /**
   * Cắt đoạn giữa hai mốc theo VỊ TRÍ, không dùng lookahead có `$`:
   * với cờ /m, `$` khớp cuối MỌI dòng nên vùng lazy dừng ngay dòng đầu → mất nội dung.
   */
  function sliceBetween(text, startRe, endRe) {
    const s = text.match(startRe);
    if (!s) return null;
    const from = s.index + s[0].length;
    const rest = text.slice(from);
    const e = endRe ? rest.match(endRe) : null;
    return e ? rest.slice(0, e.index) : rest;
  }

  const priceTableHtml = renderPriceTable(part1Text);
  const intlMatch = sliceBetween(part1Text, /^#{3,4}\s*QUỐC TẾ[^\n]*$/im, /^#{3,4}\s*VIỆT NAM/im);
  const vnMatch   = sliceBetween(part1Text, /^#{3,4}\s*VIỆT NAM[^\n]*$/im, null);

  const part1Html = [
    sectionH2('PHẦN 1 — TIN TỨC CHÍNH / NỔI BẬT TRONG NGÀY', '20px'),
    priceTableHtml,
    renderSourceBox(part1Text),
    renderDataNoteBox(part1Text),
    regionBadge('QUỐC TẾ'),
    intlMatch ? renderNewsList(intlMatch) : '',
    regionBadge('VIỆT NAM'),
    vnMatch ? renderNewsList(vnMatch) : '',
  ].filter(Boolean).join('\n');

  const part2Title = (markdown.match(/^#{1,3}\s*(PHẦN 2[^\n]*)/im) || [, 'PHẦN 2 — NHẬN ĐỊNH & HÀNH ĐỘNG CHO STAVIAN'])[1].trim();
  const part2Html = [
    sectionH2(part2Title.replace(/&/g, '&amp;')),
    renderPart2(part2Text),
  ].join('\n');

  const intlDetail = sliceBetween(part3Text, /^I\.\s*(?:TIN TỨC\s*)?QUỐC TẾ[^\n]*$/im, /^II\.\s/im);
  const vnDetail   = sliceBetween(part3Text, /^II\.\s*(?:TIN TỨC\s*)?VIỆT NAM[^\n]*$/im, /^DANH MỤC NGUỒN/im);
  const refs       = sliceBetween(part3Text, /^DANH MỤC NGUỒN[^\n]*$/im, null);

  const part3Html = [
    sectionH2('PHẦN 3 — CHI TIẾT CÁC TIN TỨC CHÍNH'),
    regionBadge('I. QUỐC TẾ'),
    intlDetail ? renderDetailedNews(intlDetail) : '',
    vnDetail ? regionBadge('II. VIỆT NAM') : '',
    vnDetail ? renderDetailedNews(vnDetail) : '',
    refs ? `      <!-- ===== REFERENCES ===== -->
      <h2 style="font-size:15px;color:#1E7A46;border-bottom:2px solid #1E7A46;padding-bottom:4px;margin:22px 0 8px;">
        DANH MỤC NGUỒN THAM KHẢO</h2>` : '',
    refs ? renderReferences(refs) : '',
  ].filter(Boolean).join('\n');

  const summaryBlock = extractBlock(/^#{1,3}\s*TÓM TẮT CUỐI/i);
  const footerText = summaryBlock && summaryBlock.body
    ? md(summaryBlock.body.replace(/\n/g, ' '))
    : `Báo cáo tạo tự động cho Phòng CLPT — Stavian Industrial Metal · Không phải khuyến nghị đầu tư.`;

  // ══ Tài liệu HTML ═════════════════════════════════════════════════════════
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
    <div style="background:#1D6059;padding:18px 28px 8px;text-align:center;">
      <div><img style="width: 150px" src="https://stavianmetal.com/wp-content/uploads/2023/05/logo_banner.png"/></div>
      <br/>

      <div style="font-size:26px;font-weight:bold;color:#ffffff;letter-spacing:.3px;">TIN TỨC HÀNG NGÀY THỊ TRƯỜNG
        CARBON</div>
      <div style="font-size:13px;color:#C8E6D4;letter-spacing:2px;margin-top:2px;">CARBON MARKET DAILY NEWS</div>
    </div>
    <div style="background:#1E7A46;padding:8px 28px;text-align:center;color:#fff;font-weight:bold;font-size:15px;">${viDate}</div>
    <div style="padding:6px 28px 0;text-align:center;font-style:italic;color:#666;font-size:12px;">Người báo cáo: ${author}</div>
    <div style="padding:3px 28px 0;text-align:right;font-size:10px;color:#aaa;font-style:italic;">Tạo tự động lúc ${autoTime}</div>

    <div style="padding:8px 28px 28px;">

${highlightHtml}

${part1Html}

      <!-- ===== PHẦN 2 ===== -->
${part2Html}

      <!-- ===== PHẦN 3 ===== -->
${part3Html}

      <div style="border-top:1px solid #ccc;margin-top:18px;padding-top:8px;font-size:10.5px;color:#999;text-align:center;font-style:italic;">
        ${footerText}
      </div>

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

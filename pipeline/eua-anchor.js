/**
 * eua-anchor.js — Suy ra giá EUA (EUR/tCO2) từ một giá NEO do analyst nhập tay
 * cộng với biến động của tracker bám hợp đồng EUA futures ICE.
 *
 * Lý do tồn tại: Yahoo Finance không có hợp đồng EUA của ICE (EUA=F, CFI2=F đều
 * "no data"), còn KRBN là ETF carbon TOÀN CẦU tính bằng USD nên không thể quy ra
 * EUR/tCO2. Các nguồn giá EUA thật (ICE, EEX, Investing.com) đều bị chặn bởi
 * allowlist egress của môi trường cloud.
 *
 * Cách làm:
 *   1. Analyst nhập giá EUA thật vào eua-anchor.json (giá neo P_A tại ngày A).
 *   2. Tracker CARB.L (WisdomTree Carbon ETC — bám EUA futures ICE) niêm yết bằng
 *      USD, nên phải chia cho EURUSD để có chuỗi tính theo EUR:
 *          T(d) = CARB_USD(d) / EURUSD(d)
 *      Bỏ qua bước này thì biến động tỷ giá sẽ bị hiểu nhầm thành biến động EUA.
 *   3. Giá EUA ngày D:   EUA(D) = P_A × T(D) / T(A)
 *
 * Sai số: (a) trượt roll hợp đồng của tracker, tích lũy theo thời gian → cần làm
 * mới neo hàng tuần; (b) chênh lệch NAV/giá thị trường của ETC. Vì vậy hàm trả về
 * kèm số ngày neo đã trôi và mức độ tin cậy để báo cáo hiển thị trung thực.
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { log, logError } = require('./logger');

const ANCHOR_FILE = path.join(__dirname, 'eua-anchor.json');

const TRACKER = {
  ticker: 'CARB.L',
  name: 'WisdomTree Carbon ETC (LSE)',
  url: 'https://query1.finance.yahoo.com/v8/finance/chart/CARB.L?interval=1d&range=3mo',
};
const FX = {
  ticker: 'EURUSD=X',
  url: 'https://query1.finance.yahoo.com/v8/finance/chart/EURUSD%3DX?interval=1d&range=3mo',
};

const UA = 'Mozilla/5.0 CarbonIntelligence/1.0';

/** Đọc file neo; trả null nếu thiếu hoặc không hợp lệ. */
function readAnchor() {
  try {
    const raw = JSON.parse(fs.readFileSync(ANCHOR_FILE, 'utf8'));
    const price = parseFloat(raw.price);
    if (!isFinite(price) || price <= 0) throw new Error('price không hợp lệ');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date || '')) throw new Error('date phải dạng YYYY-MM-DD');
    return { ...raw, price };
  } catch (err) {
    logError('eua-anchor', `Không đọc được eua-anchor.json: ${err.message}`);
    return null;
  }
}

/**
 * Lấy chuỗi giá đóng cửa theo ngày từ Yahoo → { 'YYYY-MM-DD': number }
 */
async function fetchDailySeries(url, label) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`${label}: kết quả rỗng`);

  const stamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const series = {};
  stamps.forEach((s, i) => {
    const v = closes[i];
    if (v != null && isFinite(v)) series[new Date(s * 1000).toISOString().slice(0, 10)] = v;
  });

  // Giá realtime của phiên hôm nay có thể chưa vào chuỗi lịch sử
  const live = result.meta?.regularMarketPrice;
  if (live != null && isFinite(live)) {
    const liveDay = result.meta?.regularMarketTime
      ? new Date(result.meta.regularMarketTime * 1000).toISOString().slice(0, 10)
      : null;
    if (liveDay) series[liveDay] = live;
  }
  if (Object.keys(series).length === 0) throw new Error(`${label}: không có điểm dữ liệu`);
  return series;
}

/** Lấy giá trị tại ngày d, lùi dần tối đa `maxBack` ngày nếu ngày đó nghỉ giao dịch. */
function valueOnOrBefore(series, dateStr, maxBack = 10) {
  const d = new Date(dateStr + 'T00:00:00Z');
  for (let i = 0; i <= maxBack; i++) {
    const key = new Date(d.getTime() - i * 86400000).toISOString().slice(0, 10);
    if (series[key] != null) return { value: series[key], date: key };
  }
  return null;
}

/** Ngày giao dịch liền trước `dateStr` có trong chuỗi. */
function previousTradingDay(series, dateStr) {
  const keys = Object.keys(series).filter(k => k < dateStr).sort();
  return keys.length ? keys[keys.length - 1] : null;
}

/**
 * Suy ra giá EUA hôm nay từ neo + tracker.
 * @param {string} todayStr - 'YYYY-MM-DD' theo giờ VN
 * @returns {Promise<null | {
 *   price:number, prevClose:number|null, anchor:object, ageDays:number,
 *   confidence:'fact'|'cao'|'trung bình'|'thấp', trackerChangePct:number|null, note:string
 * }>}
 */
async function deriveEuaPrice(todayStr) {
  const anchor = readAnchor();
  if (!anchor) return null;

  let trackerSeries, fxSeries;
  try {
    trackerSeries = await fetchDailySeries(TRACKER.url, TRACKER.ticker);
    fxSeries = await fetchDailySeries(FX.url, FX.ticker);
  } catch (err) {
    logError('eua-anchor', `Không lấy được tracker/tỷ giá: ${err.message}`);
    return null;
  }

  // Chuỗi tracker quy về EUR: chia giá USD cho EURUSD (forward-fill tỷ giá cuối tuần)
  const eurIndex = {};
  for (const [day, usd] of Object.entries(trackerSeries)) {
    const fx = valueOnOrBefore(fxSeries, day);
    if (fx) eurIndex[day] = usd / fx.value;
  }

  const atToday = valueOnOrBefore(eurIndex, todayStr);
  const atAnchor = valueOnOrBefore(eurIndex, anchor.date);
  if (!atToday || !atAnchor || !atAnchor.value) {
    logError('eua-anchor', 'Thiếu điểm tracker tại ngày neo hoặc ngày báo cáo');
    return null;
  }

  const ratio = atToday.value / atAnchor.value;
  const price = +(anchor.price * ratio).toFixed(2);

  // Giá tham chiếu phiên trước, suy từ chính chuỗi tracker
  let prevClose = null;
  let trackerChangePct = null;
  const prevDay = previousTradingDay(eurIndex, atToday.date);
  if (prevDay) {
    prevClose = +(anchor.price * (eurIndex[prevDay] / atAnchor.value)).toFixed(2);
    trackerChangePct = +(((atToday.value - eurIndex[prevDay]) / eurIndex[prevDay]) * 100).toFixed(2);
  }

  const ageDays = Math.max(
    0,
    Math.round((new Date(todayStr + 'T00:00:00Z') - new Date(anchor.date + 'T00:00:00Z')) / 86400000)
  );

  let confidence;
  if (ageDays === 0) confidence = 'fact';
  else if (ageDays <= 3) confidence = 'cao';
  else if (ageDays <= 7) confidence = 'trung bình';
  else confidence = 'thấp';

  const note =
    ageDays === 0
      ? `Giá EUA thật do analyst nhập ngày ${anchor.date} (${anchor.source || 'nguồn không ghi'}). ` +
        `Δ ngày ước tính từ tracker ${TRACKER.ticker} quy đổi EUR.`
      : `Ước tính từ giá neo ${anchor.price} EUR/tCO2 ngày ${anchor.date} (${anchor.source || 'nguồn không ghi'}), ` +
        `điều chỉnh theo tracker ${TRACKER.ticker} quy đổi EUR (đã trôi ${ageDays} ngày, độ tin cậy ${confidence}). ` +
        (ageDays > 7 ? 'NEO QUÁ CŨ — cần cập nhật eua-anchor.json.' : 'Cập nhật neo hàng tuần để giảm sai số trượt roll.');

  log(
    'eua-anchor',
    `[EUA] Neo ${anchor.price} (${anchor.date}) × ${ratio.toFixed(4)} → ${price} EUR/tCO2 ` +
      `| Δ ${trackerChangePct ?? '?'}% | neo trôi ${ageDays} ngày`
  );

  return { price, prevClose, anchor, ageDays, confidence, trackerChangePct, note, trackerTicker: TRACKER.ticker };
}

module.exports = { deriveEuaPrice, readAnchor, ANCHOR_FILE };

'use strict';
/**
 * collector.js — Thu thập dữ liệu giá và tin tức
 *
 * Exports:
 *   collectPrices()  → Promise<PriceMap>
 *   collectNews()    → Promise<NewsItem[]>
 */
const fetch = require('node-fetch');
const { parseStringPromise } = require('xml2js');  // parse RSS
const config = require('./config');
const { log, logError, logWarn } = require('./logger');

// ─── Kiểu dữ liệu (JSDoc) ───────────────────────────────────────────────────
/**
 * @typedef {Object} PriceData
 * @property {string}  id          - Mã hợp đồng (VD: 'WTI')
 * @property {string}  name        - Tên đầy đủ
 * @property {string}  group       - 'energy' | 'carbon' | 'metals'
 * @property {string}  unit        - Đơn vị (VD: 'USD/bbl')
 * @property {number|null} price   - Giá đóng cửa gần nhất
 * @property {number|null} prevClose - Giá phiên trước
 * @property {number|null} changeAbs  - Thay đổi tuyệt đối
 * @property {number|null} changePct  - Thay đổi % (2 chữ số thập phân)
 * @property {string}  timestamp   - ISO timestamp khi lấy giá
 * @property {string}  source      - Tên nguồn đã dùng
 * @property {string}  status      - 'ok' | 'fallback' | 'error'
 * @property {string}  [error]     - Mô tả lỗi nếu status='error'
 */

/**
 * @typedef {Object} NewsItem
 * @property {string}  id          - UUID slug
 * @property {string}  title       - Tiêu đề bài viết
 * @property {string}  url         - URL gốc
 * @property {string}  summary     - Tóm tắt ≤150 từ
 * @property {string}  source      - Tên nguồn
 * @property {string}  group       - 'intl' | 'vn'
 * @property {string}  commodity   - 'energy' | 'carbon' | 'metals' | 'policy' | 'other'
 * @property {string}  tier        - 'A' | 'B' | 'C'
 * @property {string}  publishedAt - ISO date string
 * @property {boolean} isBreaking  - true nếu khớp từ khóa breaking
 * @property {boolean} citable     - true nếu link mở được → đủ tư cách trích dẫn
 * @property {string}  linkStatus  - 'ok' | 'paywalled' | 'http_<mã>' | 'unreachable' | 'unchecked'
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Fetch với timeout */
async function fetchWithTimeout(url, timeoutMs = 15_000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Chờ ms mili giây */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch có timeout + thử lại. Chỉ thử lại với lỗi mạng và 5xx —
 * 4xx là câu trả lời dứt khoát của máy chủ, thử lại chỉ tốn thời gian.
 */
async function fetchWithRetry(url, { timeoutMs = 15_000, retries = 2, ...options } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetchWithTimeout(url, timeoutMs, options);
      if (res.status >= 500 && attempt < retries) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('Không rõ lỗi');
}

/** Slug an toàn làm ID */
function makeId(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 32) + '_' + Date.now();
}

/** Cắt ngắn text còn tối đa N từ */
function truncateWords(text, maxWords = 150) {
  if (!text) return '';
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(' ') + '…';
}

/**
 * So khớp từ khóa theo RANH GIỚI TỪ (Unicode), tránh lỗi khớp chuỗi con:
 * ví dụ 'ban' KHÔNG khớp "Vietcombank", 'war' KHÔNG khớp "warning".
 * Hỗ trợ cả cụm nhiều từ ('rate cut', 'giá đồng').
 * Cache regex đã biên dịch để không tạo lại mỗi lần gọi.
 */
const _kwRegexCache = new Map();
function keywordMatches(text, keyword) {
  const kw = keyword.toLowerCase();
  let re = _kwRegexCache.get(kw);
  if (!re) {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Không có chữ cái/chữ số Unicode liền ngay trước và sau từ khóa
    re = new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'u');
    _kwRegexCache.set(kw, re);
  }
  return re.test(text);
}

/** Phân loại nhóm hàng hóa dựa trên tiêu đề + tóm tắt */
function classifyCommodity(title = '', summary = '') {
  const text = (title + ' ' + summary).toLowerCase();
  const { groupKeywords } = config.news;
  for (const [group, keywords] of Object.entries(groupKeywords)) {
    if (keywords.some(kw => keywordMatches(text, kw))) return group;
  }
  return 'other';
}

/** Kiểm tra có phải breaking news không */
function isBreakingNews(title = '', summary = '') {
  const text = (title + ' ' + summary).toLowerCase();
  return config.news.breakingKeywords.some(kw => keywordMatches(text, kw));
}

/** Kiểm tra bài viết có trong 24h không */
function isWithin24h(dateStr) {
  if (!dateStr) return false;
  const published = new Date(dateStr);
  if (isNaN(published.getTime())) return false;
  const now = new Date();
  const diffMs = now - published;
  return diffMs >= 0 && diffMs <= 24 * 60 * 60 * 1000;
}

/** Dedup đơn giản theo URL */
function deduplicateByUrl(items) {
  const seen = new Set();
  return items.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

// ─── Price Parsers ────────────────────────────────────────────────────────────

/**
 * Parser cho Yahoo Finance API v8 chart endpoint
 * Trả về { price, prevClose }
 */
async function parseYahooPrice(url) {
  const res = await fetchWithTimeout(url, 10_000, {
    headers: { 'User-Agent': 'Mozilla/5.0 CarbonIntelligence/1.0' },
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const data = await res.json();

  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('Yahoo: kết quả rỗng');

  const meta = result.meta;
  const price = meta?.regularMarketPrice ?? null;
  const prevClose = meta?.previousClose ?? meta?.chartPreviousClose ?? null;

  if (price === null) throw new Error('Yahoo: không tìm thấy giá');
  return { price, prevClose };
}

/**
 * Parser dự phòng: Trading Economics trang /commodity/carbon
 * Scrape giá EUA từ meta tag og:description
 */
async function parseTeCarbonPrice(url) {
  const res = await fetchWithTimeout(url, 12_000, {
    headers: { 'User-Agent': 'Mozilla/5.0 CarbonIntelligence/1.0' },
  });
  if (!res.ok) throw new Error(`TE HTTP ${res.status}`);
  const html = await res.text();

  // Tìm pattern "XX.XX" hoặc "XX,XX" trong text của trang
  // TE thường hiển thị giá dạng: "EU Carbon Permits traded at 76.XX..."
  const match = html.match(/EU\s+Carbon[^0-9]*?([\d]+[.,][\d]+)/i);
  if (!match) throw new Error('TE: không parse được giá');

  const price = parseFloat(match[1].replace(',', '.'));
  if (isNaN(price)) throw new Error('TE: giá không hợp lệ');
  return { price, prevClose: null };
}

/**
 * Parser cho Stooq CSV (dùng cho EUA, các hợp đồng châu Âu)
 * URL format: https://stooq.com/q/d/l/?s=co2.f&i=d
 * CSV format: Date,Open,High,Low,Close,Volume
 */
async function parseStooqCsv(url) {
  const res = await fetchWithTimeout(url, 10_000, {
    headers: { 'User-Agent': 'Mozilla/5.0 CarbonIntelligence/1.0' },
  });
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);
  const csv = await res.text();

  const lines = csv.trim().split('\n').filter(l => l.trim() && !l.startsWith('Date'));
  if (lines.length < 2) throw new Error('Stooq: dữ liệu không đủ');

  const parse = (line) => {
    const cols = line.split(',');
    return parseFloat(cols[4]); // Close price
  };

  const price = parse(lines[lines.length - 1]);
  const prevClose = parse(lines[lines.length - 2]);

  if (isNaN(price)) throw new Error('Stooq: giá không hợp lệ');
  return { price, prevClose: isNaN(prevClose) ? null : prevClose };
}

const PARSERS = {
  yahoo: parseYahooPrice,
  te_carbon: parseTeCarbonPrice,
  stooq_csv: parseStooqCsv,
};

// ─── Collect Prices ───────────────────────────────────────────────────────────

/**
 * Thu thập giá cho tất cả hợp đồng trong config
 * @returns {Promise<Record<string, PriceData>>}
 */
async function collectPrices() {
  log('collector', 'Bắt đầu thu thập giá...');
  const timestamp = new Date().toISOString();
  const results = {};

  await Promise.all(
    config.prices.contracts.map(async (contract) => {
      let lastError = null;
      let status = 'error';
      let priceData = null;
      let usedSource = null;

      for (let i = 0; i < contract.sources.length; i++) {
        const src = contract.sources[i];
        const parserFn = PARSERS[src.parser];
        if (!parserFn) {
          log('collector', `[${contract.id}] Parser không hợp lệ: ${src.parser}`);
          continue;
        }

        try {
          log('collector', `[${contract.id}] Thử nguồn ${i === 0 ? 'chính' : 'dự phòng'}: ${src.url.substring(0, 60)}...`);
          const { price, prevClose } = await parserFn(src.url);

          const changeAbs = (prevClose !== null && price !== null) ? +(price - prevClose).toFixed(4) : null;
          const changePct = (prevClose !== null && prevClose !== 0 && price !== null)
            ? +((price - prevClose) / prevClose * 100).toFixed(2)
            : null;

          priceData = { price, prevClose, changeAbs, changePct };
          usedSource = src;
          status = i === 0 ? 'ok' : 'fallback';
          break;
        } catch (err) {
          lastError = err;
          logError('collector', `[${contract.id}] Nguồn ${i + 1} thất bại: ${err.message}`);
        }
      }

      const entry = {
        id: contract.id,
        name: contract.name,
        group: contract.group,
        unit: contract.unit,
        price: priceData?.price ?? null,
        prevClose: priceData?.prevClose ?? null,
        changeAbs: priceData?.changeAbs ?? null,
        changePct: priceData?.changePct ?? null,
        timestamp,
        source: usedSource ? new URL(usedSource.url).hostname : 'n/a',
        status,
        priceNote: contract.priceNote || null,
      };

      if (status === 'error') {
        entry.error = lastError?.message ?? 'Không rõ lỗi';
        log('collector', `[${contract.id}] ⚠ Không có dữ liệu: ${entry.error}`);
      } else {
        log('collector', `[${contract.id}] ✓ ${entry.price} ${contract.unit} (${entry.changePct > 0 ? '+' : ''}${entry.changePct ?? '?'}%) [${status}]`);
      }

      // Kiểm tra ngưỡng cảnh báo
      if (entry.changePct !== null && Math.abs(entry.changePct) >= config.prices.alertThreshold) {
        entry.priceAlert = true;
        log('collector', `[${contract.id}] 🔔 PRICE ALERT: thay đổi ${entry.changePct}% vượt ngưỡng ${config.prices.alertThreshold}%`);
      }

      results[contract.id] = entry;
    })
  );

  // ── Xử lý riêng EUA ──────────────────────────────────────────────────────────
  // Giá tuyệt đối từ proxy KRBN (~34 USD) KHÔNG phải giá EUA thật (~75 €/tCO2).
  // Ưu tiên giá nhập tay (ICE); nếu không có thì chỉ giữ HƯỚNG (Δ%) và ẩn giá sai lệch.
  applyEuaHandling(results.EUA);

  const succeeded = Object.values(results).filter(r => r.status !== 'error').length;
  log('collector', `Thu thập giá hoàn tất: ${succeeded}/${config.prices.contracts.length} hợp đồng thành công`);
  return results;
}

/**
 * Điều chỉnh entry EUA theo giá nhập tay hoặc đánh dấu proxy rõ ràng.
 * @param {Object|undefined} eua - entry EUA trong results (mutate tại chỗ)
 */
function applyEuaHandling(eua) {
  if (!eua) return;
  const override = config.prices.euaOverride || {};

  if (override.price != null && !isNaN(override.price)) {
    // Giá ICE thật do analyst nhập tay
    const prev = (override.prevClose != null && !isNaN(override.prevClose))
      ? override.prevClose
      : eua.prevClose;
    eua.price      = override.price;
    eua.prevClose  = prev ?? null;
    eua.changeAbs  = prev != null ? +(override.price - prev).toFixed(4) : null;
    eua.changePct  = (prev != null && prev !== 0) ? +((override.price - prev) / prev * 100).toFixed(2) : null;
    eua.source     = 'Nhập tay (ICE)';
    eua.status     = 'ok';
    eua.priceNote  = 'Giá EUA nhập tay từ ICE.';
    delete eua.error;
    log('collector', `[EUA] ✓ Dùng giá nhập tay: ${eua.price} €/tCO2 (Δ ${eua.changePct ?? '?'}%)`);
    return;
  }

  if (eua.status === 'error') return; // đã N/A sẵn, giữ nguyên

  // Chỉ có proxy KRBN → giữ hướng biến động, ẩn giá tuyệt đối sai lệch
  const dir = eua.changePct;
  eua.priceProxy = eua.price;   // lưu lại giá proxy để tham khảo/debug
  eua.price      = null;
  eua.changeAbs  = null;
  eua.status     = 'fallback';
  eua.priceNote  = `Chưa có giá ICE. Proxy KRBN chỉ phản ánh XU HƯỚNG (Δ ${dir != null ? (dir > 0 ? '+' : '') + dir + '%' : '?'}); nhập giá thật qua EUA_PRICE_OVERRIDE.`;
  log('collector', `[EUA] ⚠ Chỉ có proxy KRBN — ẩn giá tuyệt đối, giữ hướng Δ ${dir ?? '?'}%`);
}

// ─── RSS Parser ───────────────────────────────────────────────────────────────

async function fetchRssFeed(source) {
  const res = await fetchWithRetry(source.url, {
    timeoutMs: 12_000,
    retries: config.news.feedRetries ?? 2,
    headers: { 'User-Agent': 'Mozilla/5.0 CarbonIntelligence/1.0', ...(source.headers || {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const parsed = await parseStringPromise(xml, { explicitArray: false, trim: true });

  const channel = parsed?.rss?.channel || parsed?.feed;
  if (!channel) throw new Error('Không parse được RSS');

  // Hỗ trợ cả RSS 2.0 và Atom
  const rawItems = channel.item || channel.entry || [];
  const itemArray = Array.isArray(rawItems) ? rawItems : [rawItems];

  return itemArray.map(item => {
    const title = item.title?._ || item.title || '';
    const url = item.link?.href || (Array.isArray(item.link) ? item.link[0] : item.link) || '';
    const rawDesc = item.description?._ || item.description || item.summary?._ || item.summary || item['content:encoded'] || '';
    // Loại bỏ HTML tags cho summary
    const cleanDesc = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const pubDateStr = item.pubDate || item.updated || item.published || '';

    return { title, url: url.trim(), summary: truncateWords(cleanDesc, 150), publishedAt: pubDateStr };
  });
}

// ─── Kiểm tra link có mở được không ───────────────────────────────────────────

// Trình duyệt thật: nhiều site (Cloudflare, WAF) chặn thẳng User-Agent lạ.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * Phát hiện "soft 404": máy chủ trả 200 nhưng đã đá sang trang báo lỗi.
 * Chỉ kết luận khi URL cuối khác URL ban đầu — nếu chính bài viết nằm ở
 * đường dẫn chứa '404' thì không có chuyển hướng nào xảy ra, nên vẫn hợp lệ.
 */
function isSoftNotFound(originalUrl, finalUrl, patterns) {
  if (!finalUrl || !patterns?.length) return false;
  let from, to;
  try {
    from = new URL(originalUrl);
    to = new URL(finalUrl);
  } catch {
    return false;
  }
  const samePage = from.hostname === to.hostname && from.pathname === to.pathname;
  if (samePage) return false;
  const path = to.pathname.toLowerCase();
  return patterns.some(p => path === p || path.startsWith(`${p}.`) || path.startsWith(`${p}/`));
}

/**
 * Kiểm tra một URL người đọc có mở được không.
 * Thử HEAD trước cho nhẹ; nhiều CMS không hỗ trợ HEAD nên fallback sang GET.
 * @returns {Promise<{citable: boolean, linkStatus: string}>}
 */
async function checkLink(url, opts, extraHeaders = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return { citable: false, linkStatus: 'invalid_url' };

  const headers = { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml,*/*', ...extraHeaders };
  let lastStatus = null;

  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetchWithRetry(url, {
        method,
        redirect: 'follow',
        timeoutMs: opts.timeoutMs,
        retries: opts.retries,
        headers,
      });
      if (res.ok) {
        return isSoftNotFound(url, res.url, opts.softNotFoundPatterns)
          ? { citable: false, linkStatus: 'soft_404' }
          : { citable: true, linkStatus: 'ok' };
      }
      lastStatus = res.status;
      // 4xx từ HEAD có thể chỉ là "không hỗ trợ HEAD" → thử tiếp GET.
      // 5xx đã được fetchWithRetry thử lại, tới đây coi như hỏng thật.
      if (opts.blockedStatuses.includes(res.status) && method === 'GET') break;
    } catch (err) {
      lastStatus = lastStatus ?? 'network';
    }
  }

  return {
    citable: false,
    linkStatus: typeof lastStatus === 'number' ? `http_${lastStatus}` : 'unreachable',
  };
}

/**
 * Gắn cờ citable/linkStatus cho từng bài, chạy song song có giới hạn.
 * Bài từ nguồn `paywalled` bị loại ngay, không tốn lượt gọi mạng.
 * @param {NewsItem[]} items
 * @param {Set<string>} paywalledSources - tên nguồn đã biết là trả phí
 * @param {Map<string, Object>} [sourceHeaders] - header riêng theo tên nguồn (VD: cookie thuê bao)
 */
async function annotateLinkAccessibility(items, paywalledSources, sourceHeaders = new Map()) {
  const cfg = config.news.linkCheck || {};
  if (cfg.enabled === false) {
    items.forEach(it => { it.citable = true; it.linkStatus = 'unchecked'; });
    return items;
  }

  const opts = {
    timeoutMs: cfg.timeoutMs ?? 15_000,
    retries: cfg.retries ?? 2,
    blockedStatuses: cfg.blockedStatuses ?? [401, 402, 403, 404, 410, 451],
    softNotFoundPatterns: cfg.softNotFoundPatterns ?? [],
  };

  const pending = items.filter(it => {
    if (paywalledSources.has(it.source)) {
      it.citable = false;
      it.linkStatus = 'paywalled';
      return false;
    }
    return true;
  });

  log('collector', `Kiểm tra link: ${pending.length} bài cần gọi mạng, ${items.length - pending.length} bài bỏ qua (nguồn trả phí)`);

  const concurrency = Math.max(1, cfg.concurrency ?? 6);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
      while (cursor < pending.length) {
        const item = pending[cursor++];
        const { citable, linkStatus } = await checkLink(item.url, opts, sourceHeaders.get(item.source));
        item.citable = citable;
        item.linkStatus = linkStatus;
      }
    })
  );

  return items;
}

/** Gộp số bài không trích dẫn được theo nguồn, để log rõ đã bỏ những gì */
function summarizeUncitable(items) {
  const bySource = new Map();
  for (const it of items) {
    if (it.citable) continue;
    const key = `${it.source} [${it.linkStatus}]`;
    bySource.set(key, (bySource.get(key) || 0) + 1);
  }
  return bySource;
}

// ─── Collect News ─────────────────────────────────────────────────────────────

/**
 * Thu thập và lọc tin tức từ tất cả RSS sources
 * @returns {Promise<NewsItem[]>}
 */
async function collectNews() {
  log('collector', 'Bắt đầu thu thập tin tức...');
  const allItems = [];
  const paywalledSources = new Set(
    config.news.sources.filter(s => s.paywalled).map(s => s.name)
  );
  const sourceHeaders = new Map(
    config.news.sources.filter(s => s.headers).map(s => [s.name, s.headers])
  );
  if (paywalledSources.size > 0) {
    log('collector', `Nguồn trả phí (chỉ dùng làm bối cảnh, không trích dẫn): ${[...paywalledSources].join(', ')}`);
  }

  await Promise.all(
    config.news.sources.map(async (source) => {
      try {
        log('collector', `Đang lấy RSS: ${source.name}`);
        const items = await fetchRssFeed(source);

        // Lọc trong 24h
        const recent = items.filter(item => isWithin24h(item.publishedAt));
        log('collector', `${source.name}: ${recent.length}/${items.length} bài trong 24h`);

        // Giới hạn 50 bài/nguồn
        const limited = recent.slice(0, config.news.maxArticlesPerSource);

        const mapped = limited.map(item => ({
          id: makeId(item.title),
          title: item.title,
          url: item.url,
          summary: item.summary,
          source: source.name,
          group: source.group,
          commodity: classifyCommodity(item.title, item.summary),
          tier: source.tier,
          publishedAt: item.publishedAt,
          isBreaking: isBreakingNews(item.title, item.summary),
        }));

        allItems.push(...mapped);

        // Log breaking news ngay
        mapped.filter(a => a.isBreaking).forEach(a => {
          log('collector', `🚨 BREAKING: [${a.source}] ${a.title}`);
        });

      } catch (err) {
        logError('collector', `Thất bại nguồn ${source.name}: ${err.message}`);
      }
    })
  );

  // Dedup theo URL
  const deduped = deduplicateByUrl(allItems);
  log('collector', `Tin tức tổng cộng sau dedup: ${deduped.length} bài`);

  // Sắp xếp: breaking trước, sau đó theo thời gian
  deduped.sort((a, b) => {
    if (a.isBreaking !== b.isBreaking) return a.isBreaking ? -1 : 1;
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });

  // Chỉ cho phép trích dẫn những link người đọc thực sự mở được
  await annotateLinkAccessibility(deduped, paywalledSources, sourceHeaders);

  const uncitable = summarizeUncitable(deduped);
  if (uncitable.size > 0) {
    const detail = [...uncitable.entries()].map(([k, n]) => `${k} ×${n}`).join('; ');
    logWarn('collector', `Link không mở được → không đủ tư cách trích dẫn: ${detail}`);
  }

  const citable = deduped.filter(it => it.citable);
  log('collector', `Tin đủ tư cách trích dẫn: ${citable.length}/${deduped.length} bài`);

  if (citable.length === 0) {
    logWarn('collector', '⚠ KHÔNG có tin nào trích dẫn được — báo cáo sẽ chỉ còn phần dữ liệu giá');
  }

  const carbonCitable = citable.filter(it => it.commodity === 'carbon').length;
  if (carbonCitable === 0) {
    logWarn('collector', '⚠ Không có tin CARBON nào trích dẫn được — vùng mù thông tin về chính sách ETS/EUA');
  }

  return config.news.dropUncitable === false ? deduped : citable;
}

module.exports = { collectPrices, collectNews };

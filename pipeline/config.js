'use strict';
/**
 * config.js — Cấu hình tập trung cho toàn bộ pipeline
 * Đọc từ biến môi trường (.env). Không có giá trị hardcode nhạy cảm ở đây.
 *
 * AI_PROVIDER = 'openai' | 'bedrock'  (mặc định: 'openai')
 */
require('dotenv').config();

const config = {
  // ── AI Provider selector ─────────────────────────────────────────────────────
  // Đặt AI_PROVIDER=bedrock trong .env để dùng Amazon Bedrock thay vì OpenAI
  aiProvider: (process.env.AI_PROVIDER || 'openai').toLowerCase(),

  // ── OpenAI API ──────────────────────────────────────────────────────────────
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    // Nhiệt độ thấp cho báo cáo phân tích (ưu tiên chính xác, ít "sáng tác")
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.4'),
    maxTokens: 8192,
    retries: 3,
    retryDelay: 15_000, // ms
    timeout: 60_000,    // ms
  },

  // ── Amazon Bedrock ───────────────────────────────────────────────────────────
  // Xác thực: ưu tiên credentials tường minh (key/secret), fallback về IAM role / AWS CLI profile
  bedrock: {
    region:          process.env.AWS_REGION          || 'us-east-1',
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID   || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    sessionToken:    process.env.AWS_SESSION_TOKEN   || '', // chỉ cần khi dùng STS/AssumeRole
    // Model ID trên Bedrock — mặc định Claude 3.5 Sonnet (hỗ trợ tốt tiếng Việt)
    // Danh sách model IDs: https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html
    modelId: process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    maxTokens: 8192,
    retries: 3,
    retryDelay: 15_000, // ms
    timeout: 60_000,    // ms
  },

  // ── Email (Gmail) ────────────────────────────────────────────────────────────
  email: {
    user: process.env.GMAIL_USER || '',
    password: process.env.GMAIL_APP_PASSWORD || '',
    to: process.env.REPORT_TO || '',
    cc: process.env.REPORT_CC || '',
    senderName: 'Stavian CLPT — Carbon Desk',
    retries: 3,
    retryDelay: 5 * 60_000, // 5 phút
  },

  // ── Telegram ─────────────────────────────────────────────────────────────────
  // (đã tắt — giữ block rỗng để tránh lỗi nếu có code cũ tham chiếu)
  telegram: {},

  // ── Pipeline schedule ────────────────────────────────────────────────────────
  schedule: {
    // Thu thập lúc 7h30 T2-T6
    collectCron: '30 7 * * 1-5',
    // Các khung giờ phát hành (chỉ dùng nếu auto-approve bật)
    deliveryCrons: ['30 8 * * 1-5', '0 9 * * 1-5', '0 11 * * 1-5', '0 14 * * 1-5'],
    // Tóm tắt cuối ngày
    digestCron: '0 17 * * 1-5',
    tz: process.env.TZ || 'Asia/Ho_Chi_Minh',
  },

  // ── Thu thập giá ─────────────────────────────────────────────────────────────
  prices: {
    alertThreshold: parseFloat(process.env.PRICE_ALERT_THRESHOLD || '3'), // %
    // Nhập tay giá EUA thật (ICE) — proxy KRBN chỉ phản ánh xu hướng, không phải
    // giá tuyệt đối. Analyst đặt EUA_PRICE_OVERRIDE mỗi sáng để báo cáo hiển thị
    // đúng giá ICE. EUA_PREVCLOSE_OVERRIDE (tuỳ chọn) để tính Δ ngày chính xác.
    euaOverride: {
      price:     process.env.EUA_PRICE_OVERRIDE     ? parseFloat(process.env.EUA_PRICE_OVERRIDE)     : null,
      prevClose: process.env.EUA_PREVCLOSE_OVERRIDE ? parseFloat(process.env.EUA_PREVCLOSE_OVERRIDE) : null,
    },
    contracts: [
      // Mỗi contract: { id, name, group, sources: [{url, parser}] }
      {
        id: 'WTI',
        name: 'WTI Crude Oil (NYMEX CL)',
        group: 'energy',
        unit: 'USD/bbl',
        sources: [
          { url: 'https://query1.finance.yahoo.com/v8/finance/chart/CL=F?interval=1d&range=5d', parser: 'yahoo' },
        ],
      },
      {
        id: 'BRENT',
        name: 'Brent Crude Oil (ICE B)',
        group: 'energy',
        unit: 'USD/bbl',
        sources: [
          { url: 'https://query1.finance.yahoo.com/v8/finance/chart/BZ=F?interval=1d&range=5d', parser: 'yahoo' },
        ],
      },
      {
        id: 'NG',
        name: 'Henry Hub Natural Gas (NYMEX NG)',
        group: 'energy',
        unit: 'USD/MMBtu',
        sources: [
          { url: 'https://query1.finance.yahoo.com/v8/finance/chart/NG=F?interval=1d&range=5d', parser: 'yahoo' },
        ],
      },
      {
        id: 'TTF',
        name: 'TTF Natural Gas (ICE)',
        group: 'energy',
        unit: 'EUR/MWh',
        sources: [
          { url: 'https://query1.finance.yahoo.com/v8/finance/chart/TTF=F?interval=1d&range=5d', parser: 'yahoo' },
        ],
      },
      {
        id: 'EUA',
        name: 'EU Carbon Allowance EUA (ICE)',
        group: 'carbon',
        unit: 'EUR/tCO2',
        sources: [
          // ICE EUA: dùng Yahoo Finance với ticker iPath Bloomberg Carbon ETN làm proxy
          // Ticker KRBN (KraneShares Global Carbon ETF) - proxy EUA trên US markets
          { url: 'https://query1.finance.yahoo.com/v8/finance/chart/KRBN?interval=1d&range=5d', parser: 'yahoo' },
          // Dự phòng: 0P0001BIBY.F là EUA ICE futures trên Yahoo (DE:0P0001BIBY)  
          { url: 'https://query1.finance.yahoo.com/v8/finance/chart/0P0001BIBY.F?interval=1d&range=5d', parser: 'yahoo' },
        ],
        // Ghi chú: Yahoo Finance không cung cấp EUA ICE trực tiếp.
        // KRBN là ETF carbon toàn cầu (EUA ~75% trọng số), dùng làm proxy.
        // Để có giá EUA chính xác, nhập thủ công qua Report Builder hoặc
        // cấu hình thêm API trả phí (Refinitiv, Bloomberg, Ice Data Services).
        priceNote: 'Proxy via KRBN ETF. Giá EUA chính xác cần nhập thủ công.',
      },
      {
        id: 'GOLD',
        name: 'Gold (COMEX GC)',
        group: 'metals',
        unit: 'USD/troy oz',
        sources: [
          { url: 'https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=5d', parser: 'yahoo' },
        ],
      },
      {
        id: 'SILVER',
        name: 'Silver (COMEX SI)',
        group: 'metals',
        unit: 'USD/troy oz',
        sources: [
          { url: 'https://query1.finance.yahoo.com/v8/finance/chart/SI=F?interval=1d&range=5d', parser: 'yahoo' },
        ],
      },
      {
        id: 'COPPER',
        name: 'Copper (COMEX HG)',
        group: 'metals',
        unit: 'USD/lb',
        sources: [
          { url: 'https://query1.finance.yahoo.com/v8/finance/chart/HG=F?interval=1d&range=5d', parser: 'yahoo' },
        ],
      },
      {
        id: 'ALUMINUM',
        name: 'Aluminium (LME)',
        group: 'metals',
        unit: 'USD/tonne',
        sources: [
          { url: 'https://query1.finance.yahoo.com/v8/finance/chart/ALI=F?interval=1d&range=5d', parser: 'yahoo' },
        ],
      },
      {
        id: 'IRON_ORE',
        name: 'Iron Ore 62% Fe (SGX/Dalian)',
        group: 'metals',
        unit: 'USD/tonne',
        sources: [
          // BHP Group (proxy iron ore) — Yahoo Finance
          { url: 'https://query1.finance.yahoo.com/v8/finance/chart/BHP?interval=1d&range=5d', parser: 'yahoo' },
        ],
        priceNote: 'Proxy via BHP stock. Giá quặng sắt SGX futures cần API trả phí (SGX, Refinitiv).',
      },
    ],
  },

  // ── Thu thập tin tức ─────────────────────────────────────────────────────────
  news: {
    maxArticlesPerSource: 50,
    maxAgeHours: 24,
    deduplicationThreshold: 0.8, // độ tương đồng
    sources: [
      // Quốc tế
      { id: 'carbon_pulse', name: 'Carbon Pulse', url: 'https://carbon-pulse.com/feed/', type: 'rss', group: 'intl', tier: 'A' },
      { id: 'reuters_energy', name: 'Reuters Commodities', url: 'https://feeds.reuters.com/reuters/companyNews', type: 'rss', group: 'intl', tier: 'A' },
      { id: 'eia', name: 'EIA News', url: 'https://www.eia.gov/rss/todayinenergy.xml', type: 'rss', group: 'intl', tier: 'A' },
      { id: 'esg_today', name: 'ESG Today', url: 'https://www.esgtoday.com/feed/', type: 'rss', group: 'intl', tier: 'B' },
      { id: 'carbon_credits', name: 'CarbonCredits.com', url: 'https://carboncredits.com/feed/', type: 'rss', group: 'intl', tier: 'B' },
      // Việt Nam
      { id: 'vnexpress', name: 'VnExpress Kinh tế', url: 'https://vnexpress.net/rss/kinh-doanh.rss', type: 'rss', group: 'vn', tier: 'B' },
      { id: 'vneconomy', name: 'VnEconomy', url: 'https://vneconomy.vn/rss/kinh-te.rss', type: 'rss', group: 'vn', tier: 'B' },
      { id: 'baochinhphu', name: 'Báo Chính phủ', url: 'https://baochinhphu.vn/kinh-te.rss', type: 'rss', group: 'vn', tier: 'A' },
    ],
    // Từ khóa phân loại nhóm hàng
    groupKeywords: {
      energy: ['oil', 'crude', 'brent', 'wti', 'gas', 'lng', 'ttf', 'opec', 'refinery', 'dầu', 'khí', 'năng lượng', 'petroleum', 'eia', 'rig count'],
      carbon: ['carbon', 'eua', 'ets', 'cbam', 'emission', 'co2', 'climate', 'tín chỉ', 'phát thải', 'carbon credit', 'vcm', 'msr', 'allowance', 'net zero'],
      // 'đồng' đơn lẻ trùng đơn vị tiền VND → dùng cụm 'giá đồng'/'copper' để tránh nhầm
      metals: ['gold', 'silver', 'copper', 'aluminum', 'aluminium', 'iron ore', 'steel', 'lme', 'comex', 'vàng', 'bạc', 'giá đồng', 'nhôm', 'quặng sắt', 'thép', 'zinc', 'nickel'],
      policy: ['fed', 'rate', 'opec', 'sanction', 'tariff', 'regulation', 'policy', 'parliament', 'congress', 'decree', 'nghị định', 'quy định', 'chính sách', 'lãi suất'],
    },
    // Từ khóa Breaking News
    breakingKeywords: [
      // Energy
      'opec cut', 'opec+ cut', 'emergency meeting', 'iran sanctions', 'russia sanctions',
      'eia inventory', 'crude inventory', 'hurricane warning', 'force majeure',
      // Carbon
      'msr suspension', 'cbam delay', 'ets reform', 'eu ets', 'carbon price crash',
      'thị trường carbon việt nam', 'sàn carbon', 'nghị định 29',
      // Metals
      'lme default', 'china stimulus', 'fed rate', 'rate cut', 'rate hike',
      'bank of japan', 'gold record', 'copper shortage',
      // General ('ban' bị loại: trùng "Vietcombank" và từ tiếng Việt "ban hành/trưởng ban")
      'emergency', 'war', 'conflict', 'shock', 'crisis', 'crash',
    ],
  },

  // ── Output ───────────────────────────────────────────────────────────────────
  outputDir: process.env.OUTPUT_DIR || '../Reports',

  // ── Alert ────────────────────────────────────────────────────────────────────
  alertEmail: process.env.ALERT_EMAIL || process.env.GMAIL_USER || '',
};

// Kiểm tra cấu hình tối thiểu
function validate() {
  const errors = [];

  if (config.aiProvider === 'bedrock') {
    // Bedrock: cần region. Key/secret chỉ bắt buộc nếu không dùng IAM role
    if (!config.bedrock.region) errors.push('AWS_REGION chưa được thiết lập');
    // Nếu không có access key → giả sử dùng IAM role / instance profile (OK trên EC2/Lambda)
    if (!config.bedrock.accessKeyId && !process.env.AWS_PROFILE) {
      errors.push('AWS_ACCESS_KEY_ID chưa thiết lập (hoặc cấu hình AWS_PROFILE / IAM role)');
    }
    if (config.bedrock.accessKeyId && !config.bedrock.secretAccessKey) {
      errors.push('AWS_SECRET_ACCESS_KEY chưa được thiết lập');
    }
  } else {
    // OpenAI
    if (!config.openai.apiKey) errors.push('OPENAI_API_KEY chưa được thiết lập');
  }

  if (!config.email.user)     errors.push('GMAIL_USER chưa được thiết lập');
  if (!config.email.password) errors.push('GMAIL_APP_PASSWORD chưa được thiết lập');
  if (!config.email.to)       errors.push('REPORT_TO chưa được thiết lập');
  return errors;
}

config.validate = validate;
module.exports = config;

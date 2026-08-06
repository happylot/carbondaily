'use strict';
/**
 * index.js — Entry point của Carbon Market Intelligence Pipeline
 *
 * Chế độ hoạt động:
 *   1. Scheduler (mặc định): Chạy theo lịch cron T2-T6
 *   2. Manual: node index.js --run-now
 *   3. Collect only: node index.js --collect-only
 *
 * Pipeline flow:
 *   Thu thập giá & tin → Phân tích AI (Claude) → Lưu HTML → Gửi Email + Telegram
 */
const cron = require('node-cron');
const path = require('path');
const fs   = require('fs');

const config    = require('./config');
const { collectPrices, collectNews } = require('./collector');
const { analyzAndBuild }             = require('./analyzer');
const { deliver, sendInternalAlert } = require('./delivery');
const { log, logError, logWarn }     = require('./logger');

// ─── Trạng thái pipeline ──────────────────────────────────────────────────────
let pipelineState = {
  status: 'idle', // idle | collecting | analyzing | saving | delivering | done | error
  lastRun: null,
  lastResult: null,
};

function setPipelineStatus(status) {
  pipelineState.status = status;
  log('pipeline', `▶ Trạng thái: ${status.toUpperCase()}`);
}

// ─── Output ───────────────────────────────────────────────────────────────────
function ensureOutputDir() {
  const dir = path.resolve(__dirname, config.outputDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log('pipeline', `Tạo thư mục output: ${dir}`);
  }
  return dir;
}

function saveReport(html, filename) {
  const dir = ensureOutputDir();
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, html, 'utf-8');
  log('pipeline', `✓ Đã lưu báo cáo: ${filepath}`);
  return filepath;
}

// ─── Daily digest ─────────────────────────────────────────────────────────────
function buildDailyDigest(runLog) {
  const lines = ['📋 TÓM TẮT HOẠT ĐỘNG PIPELINE — ' + new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })];
  lines.push('');
  lines.push(`Số phiên chạy: ${runLog.runs}`);
  lines.push(`Báo cáo đã gửi: ${runLog.sent}`);
  lines.push(`Breaking news: ${runLog.breaking}`);
  if (runLog.errors.length > 0) {
    lines.push('');
    lines.push('LỖI PHÁT SINH:');
    runLog.errors.forEach(e => lines.push(`  - ${e}`));
  } else {
    lines.push('Không có lỗi.');
  }
  return lines.join('\n');
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

const dailyLog = { runs: 0, sent: 0, breaking: 0, errors: [] };

/**
 * Chạy toàn bộ pipeline một lần
 * @param {Object} options
 * @param {boolean} [options.deliverReport=true] - Có gửi báo cáo không
 */
async function runPipeline(options = {}) {
  const { deliverReport = true } = options;

  if (pipelineState.status !== 'idle' && pipelineState.status !== 'done' && pipelineState.status !== 'error') {
    logWarn('pipeline', `Pipeline đang chạy (${pipelineState.status}), bỏ qua yêu cầu mới`);
    return;
  }

  dailyLog.runs++;
  pipelineState.lastRun = new Date();
  const startTime = Date.now();

  try {
    // ── Bước 1: Thu thập giá ──────────────────────────────────────────────────
    setPipelineStatus('collecting');
    const prices = await collectPrices();

    // ── Bước 2: Thu thập tin tức ──────────────────────────────────────────────
    const newsItems = await collectNews();
    const breakingItems = newsItems.filter(n => n.isBreaking);
    dailyLog.breaking += breakingItems.length;

    if (breakingItems.length > 0) {
      log('pipeline', `🚨 ${breakingItems.length} Breaking News phát hiện hôm nay`);
    }

    // ── Bước 3: Phân tích AI ──────────────────────────────────────────────────
    setPipelineStatus('analyzing');
    const reportData = await analyzAndBuild(prices, newsItems);

    // ── Bước 4: Lưu HTML ─────────────────────────────────────────────────────
    setPipelineStatus('saving');
    const savedPath = saveReport(reportData.html, reportData.filename);
    reportData.savedPath = savedPath;

    // ── Cập nhật kho lưu trữ (reports.json) cho trang archive.html ────────────
    try {
      const { build } = require('../build-archive-manifest');
      const m = build(path.resolve(__dirname, '..'));
      log('pipeline', `✓ Cập nhật reports.json: ${m.count} báo cáo`);
    } catch (e) {
      logWarn('pipeline', `Không cập nhật được reports.json: ${e.message}`);
    }

    // ── Bước 5: Gửi ──────────────────────────────────────────────────────────
    let deliveryResult = { email: 'skipped', telegram: 'skipped' };
    if (deliverReport) {
      setPipelineStatus('delivering');
      deliveryResult = await deliver(reportData);
      if (deliveryResult.email === 'ok') dailyLog.sent++;
      log('pipeline', `Kết quả gửi — Email: ${deliveryResult.email}`);
    }

    // ── Hoàn thành ────────────────────────────────────────────────────────────
    setPipelineStatus('done');
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log('pipeline', `✅ Pipeline hoàn thành trong ${elapsed}s`);

    pipelineState.lastResult = {
      success: true,
      filename: reportData.filename,
      savedPath,
      delivery: deliveryResult,
      elapsed,
    };

    return pipelineState.lastResult;

  } catch (err) {
    setPipelineStatus('error');
    const errorMsg = err.message || String(err);
    logError('pipeline', `Pipeline thất bại: ${errorMsg}`);
    dailyLog.errors.push(`${new Date().toISOString()}: ${errorMsg}`);

    await sendInternalAlert(
      'Pipeline Carbon thất bại',
      `Lỗi: ${errorMsg}\n\nThời điểm: ${new Date().toISOString()}\nBước cuối: ${pipelineState.status}`
    ).catch(() => {});

    pipelineState.lastResult = { success: false, error: errorMsg };
    throw err;
  } finally {
    // Reset về idle sau 60s để cho phép chạy lại nếu cần
    setTimeout(() => {
      if (pipelineState.status === 'done' || pipelineState.status === 'error') {
        pipelineState.status = 'idle';
      }
    }, 60_000);
  }
}

// ─── Collect-only mode ────────────────────────────────────────────────────────

async function runCollectOnly() {
  log('pipeline', '=== CHẾ ĐỘ: CHỈ THU THẬP DỮ LIỆU ===');
  const prices = await collectPrices();
  const newsItems = await collectNews();

  console.log('\n--- BẢNG GIÁ ---');
  Object.values(prices).forEach(p => {
    const status = p.status === 'error' ? '❌' : p.status === 'fallback' ? '⚠' : '✓';
    const priceTxt = p.price !== null ? `${p.price} ${p.unit}` : 'N/A';
    const changeTxt = p.changePct !== null ? ` (${p.changePct > 0 ? '+' : ''}${p.changePct}%)` : '';
    console.log(`${status} [${p.group.toUpperCase().padEnd(7)}] ${p.id.padEnd(12)} ${priceTxt}${changeTxt}`);
  });

  console.log(`\n--- TIN TỨC (${newsItems.length} bài) ---`);
  newsItems.slice(0, 10).forEach((n, i) => {
    const brk = n.isBreaking ? ' 🚨' : '';
    console.log(`${i + 1}. [${n.group.toUpperCase()}/${n.commodity}] ${n.title}${brk}`);
    console.log(`   ${n.source} | ${n.publishedAt}`);
  });
  if (newsItems.length > 10) console.log(`   ... và ${newsItems.length - 10} bài nữa`);

  return { prices, newsItems };
}

// ─── Scheduler setup ──────────────────────────────────────────────────────────

function startScheduler() {
  const { collectCron, digestCron, tz } = config.schedule;

  log('pipeline', `Khởi động scheduler — múi giờ: ${tz}`);

  // Lịch thu thập chính: 7h30 T2-T6
  cron.schedule(collectCron, async () => {
    log('pipeline', '⏰ Lịch tự động kích hoạt (7h30)');
    await runPipeline({ deliverReport: true }).catch(err => {
      logError('pipeline', `Lịch tự động thất bại: ${err.message}`);
    });
  }, { timezone: tz });

  // Daily digest: 17h T2-T6
  cron.schedule(digestCron, async () => {
    log('pipeline', '⏰ Gửi tóm tắt cuối ngày');
    const digest = buildDailyDigest(dailyLog);
    log('pipeline', digest);
    // Reset daily log
    dailyLog.runs = 0; dailyLog.sent = 0; dailyLog.breaking = 0; dailyLog.errors = [];
  }, { timezone: tz });

  log('pipeline', `✓ Scheduler đã cài: ${collectCron} (collect) | ${digestCron} (digest)`);
  log('pipeline', 'Pipeline đang chờ lịch... (Ctrl+C để dừng)');
}

// ─── CLI entry ────────────────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(60));
  console.log('  CARBON MARKET INTELLIGENCE PIPELINE');
  console.log('  Stavian Industrial Metal — Phòng CLPT');
  console.log('═'.repeat(60));

  // Kiểm tra cấu hình
  const errors = config.validate();
  if (errors.length > 0) {
    console.warn('\n⚠ CẢNH BÁO — Cấu hình thiếu:');
    errors.forEach(e => console.warn(`  - ${e}`));
    console.warn('\nTạo file .env từ .env.example và điền đầy đủ trước khi chạy.\n');
  }

  const args = process.argv.slice(2);

  if (args.includes('--run-now')) {
    // Chạy ngay một lần
    log('pipeline', '=== CHẾ ĐỘ: CHẠY NGAY ===');
    const deliver = !args.includes('--no-deliver');
    await runPipeline({ deliverReport: deliver });
    // Thoát sạch: runPipeline giữ event loop sống 60s (timer reset trạng thái),
    // với chế độ chạy-một-lần ta không cần chờ nên thoát ngay.
    process.exit(0);

  } else if (args.includes('--collect-only')) {
    // Chỉ thu thập, in kết quả ra console
    await runCollectOnly();
    process.exit(0);

  } else {
    // Chế độ mặc định: scheduler
    if (errors.length > 0) {
      console.error('Không thể khởi động scheduler khi thiếu cấu hình bắt buộc.');
      console.error('Chạy: node index.js --collect-only để test không cần API keys.');
      process.exit(1);
    }
    startScheduler();
  }
}

// Bắt lỗi unhandled toàn cục để pipeline không "chết ngầm"
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logError('pipeline', `Unhandled Rejection: ${msg}`);
});

process.on('uncaughtException', (err) => {
  logError('pipeline', `Uncaught Exception: ${err.message}`);
  process.exit(1);
});

// Cho phép dừng scheduler bằng Ctrl+C một cách sạch sẽ
process.on('SIGINT', () => {
  log('pipeline', 'Nhận SIGINT — đang dừng pipeline...');
  process.exit(0);
});

// ─── Khởi động ────────────────────────────────────────────────────────────────
main().catch((err) => {
  logError('pipeline', `Lỗi khởi động pipeline: ${err.message}`);
  process.exit(1);
});

// Export cho việc test / tích hợp web dashboard sau này
module.exports = {
  runPipeline,
  runCollectOnly,
  startScheduler,
  getPipelineState: () => pipelineState,
};

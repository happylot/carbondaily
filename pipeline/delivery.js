'use strict';
/**
 * delivery.js — Gửi báo cáo qua Email
 *
 * Exports:
 *   sendEmail(reportData)    → Promise<void>
 *   deliver(reportData)      → Promise<DeliveryResult>
 */
const nodemailer = require('nodemailer');
const config = require('./config');
const { log, logError } = require('./logger');

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: config.email.user,
      pass: config.email.password,
    },
  });
}

// ─── Email ────────────────────────────────────────────────────────────────────

/**
 * Gửi báo cáo HTML qua Gmail, thử lại tối đa 3 lần
 * @param {{html: string, filename: string, date: Date}} reportData
 */
async function sendEmail(reportData) {
  const { html, filename, date } = reportData;
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  const subject = `Tin tức thị trường Carbon - ${d}/${m}/${y}`;

  const mailOptions = {
    from: `"${config.email.senderName}" <${config.email.user}>`,
    to: config.email.to,
    cc: config.email.cc || undefined,
    subject,
    text: `Báo cáo Tin tức thị trường Carbon ngày ${d}/${m}/${y} (vui lòng xem bản HTML đính kèm hoặc nội dung email).`,
    html,
    attachments: [
      {
        filename,
        content: Buffer.from(html, 'utf-8'),
        contentType: 'text/html; charset=utf-8',
      },
    ],
  };

  const { retries, retryDelay } = config.email;
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      log('delivery', `Gửi email (lần ${attempt}/${retries}) đến ${config.email.to}...`);
      const transport = createTransport();
      const info = await transport.sendMail(mailOptions);
      log('delivery', `✓ Email gửi thành công: messageId=${info.messageId}`);
      return; // success
    } catch (err) {
      lastError = err;
      logError('delivery', `Email lần ${attempt} thất bại: ${err.message}`);
      if (attempt < retries) {
        log('delivery', `Chờ ${retryDelay / 60000} phút trước khi thử lại...`);
        await sleep(retryDelay);
      }
    }
  }

  throw new Error(`Gửi email thất bại sau ${retries} lần: ${lastError?.message}`);
}

// ─── Internal alert ───────────────────────────────────────────────────────────

/**
 * Gửi email cảnh báo lỗi nội bộ đến Analyst
 */
async function sendInternalAlert(subject, body) {
  if (!config.alertEmail) return;
  try {
    const transport = createTransport();
    await transport.sendMail({
      from: `"Stavian Pipeline Monitor" <${config.email.user}>`,
      to: config.alertEmail,
      subject: `[PIPELINE ALERT] ${subject}`,
      text: body,
    });
    log('delivery', `Alert nội bộ đã gửi: ${subject}`);
  } catch (err) {
    logError('delivery', `Không gửi được alert nội bộ: ${err.message}`);
  }
}

// ─── Main deliver ─────────────────────────────────────────────────────────────

/**
 * Gửi báo cáo qua Email
 * @returns {Promise<{email: 'ok'|'failed'}>}
 */
async function deliver(reportData) {
  const result = { email: 'pending' };

  try {
    await sendEmail(reportData);
    result.email = 'ok';
  } catch (err) {
    result.email = 'failed';
    logError('delivery', `Email THẤT BẠI cuối cùng: ${err.message}`);
    await sendInternalAlert(
      'Gửi email báo cáo Carbon thất bại',
      `Chi tiết lỗi:\n${err.message}\n\nNgày: ${reportData.date?.toISOString()}\nFile: ${reportData.filename}`
    );
  }

  return result;
}

module.exports = { sendEmail, deliver, sendInternalAlert };

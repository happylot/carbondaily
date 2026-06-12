'use strict';
/**
 * logger.js — Logging đơn giản với timestamp và module tag
 */
const path = require('path');
const fs = require('fs');

const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function getLogFile() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return path.join(LOG_DIR, `pipeline-${date}.log`);
}

function format(level, module, msg) {
  const ts = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  return `[${ts}] [${level.toUpperCase().padEnd(5)}] [${module}] ${msg}`;
}

function log(module, msg) {
  const line = format('info', module, msg);
  console.log(line);
  fs.appendFileSync(getLogFile(), line + '\n');
}

function logError(module, msg) {
  const line = format('error', module, msg);
  console.error(line);
  fs.appendFileSync(getLogFile(), line + '\n');
}

function logWarn(module, msg) {
  const line = format('warn', module, msg);
  console.warn(line);
  fs.appendFileSync(getLogFile(), line + '\n');
}

module.exports = { log, logError, logWarn };

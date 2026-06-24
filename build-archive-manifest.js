// build-archive-manifest.js
// Tạo reports.json từ thư mục Reports/ (quét file "...DD-MM-YYYY.html") cho trang archive.html.
// Dùng: node build-archive-manifest.js  — hoặc require('./build-archive-manifest').build()
'use strict';
const fs = require('fs');
const path = require('path');

const WD = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const RE = /(\d{2})-(\d{2})-(\d{4})\.html$/;

function build(rootDir) {
  rootDir = rootDir || __dirname;
  const dir = path.join(rootDir, 'Reports');
  const items = [];
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(RE);
    if (!m) continue;
    const dd = m[1], mm = m[2], yyyy = m[3];
    const iso = yyyy + '-' + mm + '-' + dd;
    const wd = WD[new Date(iso + 'T00:00:00').getDay()];
    items.push({ iso: iso, date: dd + '/' + mm + '/' + yyyy, weekday: wd, file: 'Reports/' + f });
  }
  items.sort(function (a, b) { return b.iso.localeCompare(a.iso); }); // mới nhất trước
  const out = { updated: new Date().toISOString(), count: items.length, reports: items };
  fs.writeFileSync(path.join(rootDir, 'reports.json'), JSON.stringify(out, null, 2));
  return out;
}

module.exports = { build: build };

if (require.main === module) {
  const out = build();
  console.log('reports.json:', out.count, 'bao cao; moi nhat:', out.reports[0] && out.reports[0].date);
}

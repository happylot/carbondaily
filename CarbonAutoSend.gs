/**
 * STAVIAN — Tự động gửi "Tin tức hàng ngày thị trường Carbon" (định dạng HTML)
 * Gửi từ tài khoản chạy script (phuc189@gmail.com) -> xoan.vu@stavianmetal.com
 *
 * Cơ chế: mỗi sáng tác vụ Claude đẩy FILE .HTML (tên chứa ngày DD-MM-YYYY)
 *   lên Google Drive (folder "Carbon Daily Reports"). Script này tìm HTML của
 *   HÔM NAY, dùng chính nội dung HTML làm THÂN EMAIL (đính kèm thêm file .html),
 *   gửi đi, rồi chuyển file sang "_Da gui" để không gửi lại.
 *   (Không cần Advanced Service; HTML hiển thị trực tiếp trong email.)
 */

const FOLDER_ID = '15Tk8hvUqNIyW7yhz7zE5OmdFabRxFQj1'; // folder "Carbon Daily Reports"
const TO  = 'xoan.vu@stavianmetal.com';
const CC  = '';                       // (tuỳ chọn) thêm email GĐ CLPT
const TZ  = 'Asia/Ho_Chi_Minh';
const SENT_SUBFOLDER = '_Da gui';

function sendCarbonDailyReport() {
  const today = Utilities.formatDate(new Date(), TZ, 'dd-MM-yyyy');
  const folder = DriveApp.getFolderById(FOLDER_ID);

  // Tìm file HTML của hôm nay
  let htmlFile = null;
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const n = f.getName();
    if (n.indexOf(today) !== -1 && n.toLowerCase().slice(-5) === '.html') { htmlFile = f; break; }
  }
  if (!htmlFile) { Logger.log('Chua co HTML cho ngay ' + today); return; }

  const html = htmlFile.getBlob().getDataAsString('UTF-8');
  const dDisplay = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy');
  const subject  = 'Tin tức thị trường Carbon - ' + dDisplay;
  const attach   = htmlFile.getBlob().setName(htmlFile.getName());

  const opts = { htmlBody: html, attachments: [attach], name: 'Stavian CLPT - Carbon Desk' };
  if (CC) opts.cc = CC;
  GmailApp.sendEmail(TO, subject,
    'Báo cáo Tin tức thị trường Carbon ngày ' + dDisplay + ' (vui lòng xem bản HTML).', opts);
  Logger.log('Da gui HTML cho ngay ' + today);

  // Chuyển sang "_Da gui" để tránh gửi trùng
  const fit = folder.getFoldersByName(SENT_SUBFOLDER);
  const sent = fit.hasNext() ? fit.next() : folder.createFolder(SENT_SUBFOLDER);
  sent.addFile(htmlFile); folder.removeFile(htmlFile);
}

/** CHẠY 1 LẦN để cài lịch tự gửi: T2–T6 lúc 9h, 11h, 14h. */
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendCarbonDailyReport') ScriptApp.deleteTrigger(t);
  });
  const days = [ScriptApp.WeekDay.MONDAY, ScriptApp.WeekDay.TUESDAY, ScriptApp.WeekDay.WEDNESDAY,
                ScriptApp.WeekDay.THURSDAY, ScriptApp.WeekDay.FRIDAY];
  [9, 11, 14].forEach(h => days.forEach(d =>
    ScriptApp.newTrigger('sendCarbonDailyReport').timeBased().onWeekDay(d).atHour(h).nearMinute(0).inTimezone(TZ).create()));
  Logger.log('Da cai trigger T2-T6 luc 9h, 11h, 14h.');
}

/** Bấm Run để gửi thử NGAY báo cáo của hôm nay (nếu đã có HTML trên Drive). */
function testSendNow() { sendCarbonDailyReport(); }

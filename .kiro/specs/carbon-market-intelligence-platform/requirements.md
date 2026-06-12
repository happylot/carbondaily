# Tài liệu Yêu cầu — Carbon Market Intelligence Platform

## Introduction

Carbon Market Intelligence Platform là hệ thống tự động hóa toàn diện quy trình thu thập dữ liệu, phân tích, phê duyệt và phân phối báo cáo thị trường hàng hóa hàng ngày cho đội giao dịch Stavian Industrial Metal. Hệ thống thay thế quy trình thủ công hiện tại (nhập tay dữ liệu → xuất HTML → gửi email bằng Google Apps Script), mở rộng phạm vi từ chỉ carbon sang cả ba nhóm hàng hóa: Năng lượng, Tín chỉ Carbon và Kim loại. Nền tảng tích hợp pipeline AI (Claude API) để phân tích chuyên sâu, dashboard duyệt báo cáo cho Giám đốc CLPT, giao tiếp đa kênh (Email + Website), cơ sở dữ liệu lịch sử giá và cơ chế cảnh báo tin đột xuất.

---

## Bảng thuật ngữ

- **Platform**: Hệ thống Carbon Market Intelligence Platform — sản phẩm phần mềm được xây dựng theo tài liệu này.
- **Data_Collector**: Module tự động thu thập dữ liệu giá và tin tức từ các nguồn bên ngoài.
- **AI_Analyzer**: Module tích hợp Claude API để phân tích nội dung và tạo dự thảo báo cáo.
- **Report_Builder**: Module tổng hợp, định dạng và hiển thị dự thảo báo cáo để chỉnh sửa.
- **Approval_Dashboard**: Giao diện web dành cho Giám đốc CLPT để xem xét, chỉnh sửa và phê duyệt báo cáo.
- **Delivery_Engine**: Module phân phối báo cáo đã duyệt qua các kênh Email và Telegram.
- **History_DB**: Cơ sở dữ liệu lưu trữ báo cáo đã phát hành và chuỗi giá lịch sử.
- **Alert_Engine**: Module phát hiện và gửi cảnh báo khi có tin đột xuất quan trọng.
- **Analyst**: Nhân viên phân tích thuộc Phòng CLPT, chịu trách nhiệm vận hành hệ thống hàng ngày.
- **Approver**: Giám đốc CLPT, người có quyền phê duyệt hoặc yêu cầu chỉnh sửa báo cáo trước khi gửi.
- **Subscriber**: Người nhận báo cáo cuối cùng (hiện tại: xoan.vu@stavianmetal.com và kênh Telegram nội bộ).
- **EUA**: European Union Allowance — hạn ngạch phát thải trong EU ETS.
- **CBAM**: Carbon Border Adjustment Mechanism — cơ chế điều chỉnh carbon biên giới của EU.
- **VCM**: Voluntary Carbon Market — thị trường carbon tự nguyện.
- **Breaking_News**: Tin đột xuất có khả năng tác động ngay lập tức đến giá thị trường, được xác định theo ngưỡng cấu hình.
- **Report_Template**: Mẫu 9 mục báo cáo theo system prompt: Tóm tắt điều hành, Bảng giá nhanh, Năng lượng, Tín chỉ Carbon, Kim loại, Tín hiệu liên thị trường, Quan điểm trái chiều, Lịch sự kiện, Nguồn tham khảo.
- **Scheduled_Window**: Khung giờ phát hành lịch định sẵn: 8h30, 9h00, 11h00, 14h00 (T2–T6).

---

## Requirements

### Requirement 1: Thu thập dữ liệu giá tự động

**User Story:** Là một Analyst, tôi muốn hệ thống tự động lấy giá đóng cửa và giá hiện tại của tất cả các hợp đồng cần theo dõi, để tôi không phải tra cứu thủ công từng nguồn mỗi sáng.

#### Tiêu chí chấp nhận

1. WHEN lịch thu thập được kích hoạt vào các ngày T2–T6, THE Data_Collector SHALL lấy giá của ít nhất 9 hợp đồng: WTI (NYMEX CL), Brent (ICE B), Henry Hub NG, TTF, EUA (ICE), Vàng (COMEX GC), Bạc (COMEX SI), Đồng (LME/COMEX HG), Nhôm (LME), Quặng sắt (SGX/DCE).
2. WHEN Data_Collector hoàn thành một phiên thu thập, THE Data_Collector SHALL ghi nhận giá đóng cửa phiên gần nhất, mức thay đổi tuyệt đối và phần trăm so với phiên trước, và thời điểm lấy dữ liệu (timestamp theo múi giờ Asia/Ho_Chi_Minh).
3. IF Data_Collector không thể kết nối được nguồn dữ liệu chính trong vòng 30 giây, THEN THE Data_Collector SHALL thử nguồn dự phòng đã cấu hình và ghi log lỗi kèm tên nguồn thất bại.
4. IF tất cả nguồn dữ liệu cho một hợp đồng đều không phản hồi, THEN THE Data_Collector SHALL đánh dấu trường giá đó là "Không có dữ liệu" và gửi cảnh báo lỗi đến Analyst qua email nội bộ.
5. THE Data_Collector SHALL lưu toàn bộ giá thu thập được vào History_DB với định danh nguồn, timestamp và trạng thái thu thập (thành công / dự phòng / thất bại).
6. WHEN giá của một hợp đồng thay đổi vượt ngưỡng cấu hình (mặc định ±3% trong vòng 1 giờ) trong giờ giao dịch, THE Data_Collector SHALL đánh dấu sự kiện này để Alert_Engine xử lý tiếp.

---

### Requirement 2: Thu thập tin tức tự động

**User Story:** Là một Analyst, tôi muốn hệ thống tự động quét và tổng hợp tin tức từ các nguồn uy tín trong nước và quốc tế, để tôi tiết kiệm thời gian tìm kiếm và không bỏ sót thông tin quan trọng.

#### Tiêu chí chấp nhận

1. WHEN lịch thu thập tin tức được kích hoạt, THE Data_Collector SHALL quét ít nhất các nguồn quốc tế sau: Carbon Pulse, Trading Economics, Reuters (năng lượng/hàng hóa), EIA, CME/ICE/LME thông báo chính thức, ESG Today, Fastmarkets.
2. WHEN lịch thu thập tin tức được kích hoạt, THE Data_Collector SHALL quét ít nhất các nguồn Việt Nam sau: VnExpress, VnEconomy, Người Quan Sát, Vietnam+, Báo Chính phủ.
3. THE Data_Collector SHALL lọc và chỉ giữ lại các bài viết được đăng hoặc cập nhật trong vòng 24 giờ tính từ thời điểm thu thập, bao gồm các bài viết được đăng đúng 24 giờ trước (tính biên đóng). Quy tắc 24 giờ áp dụng cho toàn bộ bài viết thu thập được, bao gồm cả bài đã thu thập trong phiên trước nhưng đang được xử lý lại.
4. WHEN một bài viết được thu thập, THE Data_Collector SHALL lưu: URL nguồn, tiêu đề gốc, tóm tắt tự động (tối đa 150 từ), tên nguồn, ngày đăng và phân loại nhóm hàng (Năng lượng / Carbon / Kim loại / Chính sách / Khác).
5. IF Data_Collector phát hiện bài viết chứa từ khóa thuộc danh sách Breaking_News đã cấu hình (ví dụ: "OPEC cut", "MSR suspension", "CBAM delay", "thị trường carbon Việt Nam", "Fed rate"), THEN THE Data_Collector SHALL đánh dấu bài viết là Breaking_News và chuyển ngay đến Alert_Engine.
6. THE Data_Collector SHALL loại bỏ trùng lặp bằng cách so sánh URL và độ tương đồng nội dung (≥80% coi là trùng), chỉ giữ bản đầu tiên thu thập được.
7. IF tổng số bài viết thu thập từ một nguồn trong một phiên vượt quá 50 bài, THEN THE Data_Collector SHALL chỉ giữ lại 50 bài có điểm phù hợp cao nhất theo từ khóa theo dõi đã cấu hình.

---

### Requirement 3: Phân tích AI và tạo dự thảo báo cáo

**User Story:** Là một Analyst, tôi muốn hệ thống tự động tổng hợp dữ liệu giá và tin tức thành dự thảo báo cáo theo đúng template 9 mục, để tôi chỉ cần rà soát và chỉnh sửa thay vì viết từ đầu.

#### Tiêu chí chấp nhận

1. WHEN Data_Collector hoàn thành phiên thu thập dữ liệu và tin tức, THE AI_Analyzer SHALL gửi dữ liệu tổng hợp cùng system prompt cấu hình tới Claude API để tạo dự thảo báo cáo.
2. THE AI_Analyzer SHALL yêu cầu Claude tạo báo cáo tuân thủ đúng Report_Template 9 mục: (1) Tóm tắt điều hành, (2) Bảng giá nhanh, (3) Năng lượng, (4) Tín chỉ Carbon, (5) Kim loại, (6) Tín hiệu liên thị trường, (7) Quan điểm trái chiều, (8) Lịch sự kiện 7 ngày tới, (9) Nguồn tham khảo.
3. THE AI_Analyzer SHALL đảm bảo mỗi thông tin trong báo cáo được phân loại rõ ràng là FACT, OPINION hoặc FORECAST kèm nguồn trích dẫn cụ thể.
4. THE AI_Analyzer SHALL phân tích và đưa vào Mục 6 ít nhất một tín hiệu liên thị trường (hoặc ghi rõ "Không có tín hiệu liên thị trường mới" khi không có).
5. IF Claude API trả về lỗi hoặc không phản hồi trong vòng 60 giây, THEN THE AI_Analyzer SHALL thử lại tối đa 3 lần với khoảng cách 15 giây giữa mỗi lần; IF vẫn thất bại, THEN THE AI_Analyzer SHALL thông báo lỗi đến Analyst và dừng pipeline. IF Claude API trả về phản hồi không xác định được là thành công hay lỗi (phản hồi mơ hồ), THEN THE AI_Analyzer SHALL ngay lập tức coi là thất bại mà không thực hiện thử lại.
6. WHEN dự thảo báo cáo được tạo thành công, THE AI_Analyzer SHALL chuyển dữ liệu đến Report_Builder để hiển thị; đồng thời THE AI_Analyzer SHALL cố gắng lưu dự thảo vào History_DB với trạng thái "draft". IF việc lưu vào History_DB thất bại, THEN THE AI_Analyzer SHALL tiếp tục pipeline và chuyển dự thảo đến Report_Builder mà không dừng lại, đồng thời ghi nhật ký lỗi lưu trữ.
7. THE AI_Analyzer SHALL không đưa vào báo cáo bất kỳ nhận định, số liệu hoặc sự kiện nào không có nguồn dữ liệu đầu vào tương ứng từ phiên thu thập.
8. WHERE tính năng phân tích CBAM được bật, THE AI_Analyzer SHALL bổ sung mục "Tác động chính sách CBAM" vào Mục 4 (Tín chỉ Carbon) khi phát hiện tin liên quan đến CBAM trong dữ liệu thu thập.

---

### Requirement 4: Giao diện Report Builder cải tiến

**User Story:** Là một Analyst, tôi muốn có giao diện chỉnh sửa dự thảo báo cáo thân thiện hỗ trợ cả 3 nhóm hàng, để tôi dễ dàng điều chỉnh nội dung AI tạo ra trước khi gửi duyệt.

#### Tiêu chí chấp nhận

1. THE Report_Builder SHALL hiển thị dự thảo báo cáo theo Report_Template 9 mục với giao diện chỉnh sửa trực tiếp (inline editing) cho từng mục.
2. THE Report_Builder SHALL hỗ trợ chỉnh sửa đầy đủ nội dung cho cả 3 nhóm hàng: Năng lượng (WTI, Brent, NG, TTF), Tín chỉ Carbon (EUA, UK ETS, California, VCM, CBAM) và Kim loại (Vàng, Bạc, Đồng, Nhôm, Quặng sắt).
3. WHEN Analyst thay đổi bất kỳ trường nào trong Report_Builder, THE Report_Builder SHALL cập nhật bản xem trước HTML theo thời gian thực (không cần nhấn nút Lưu thủ công).
4. THE Report_Builder SHALL cung cấp bảng nhập giá nhanh cho 9+ hợp đồng với các trường: Giá hiện tại, Δ ngày, Δ tuần, Ghi chú — và tự động điền từ dữ liệu Data_Collector nếu có.
5. THE Report_Builder SHALL cung cấp bộ chọn tín hiệu giao dịch (HOLD / BUY / SELL) cho phần nhận định thị trường carbon với hiển thị màu sắc trực quan (xanh/đỏ/vàng).
6. THE Report_Builder SHALL cho phép Analyst thêm, sửa, xóa từng mục tin tức trong danh sách Quốc tế và Việt Nam với các trường: tiêu đề, tóm tắt, URL nguồn, ngày đăng.
7. WHEN Analyst nhấn "Xuất HTML", THE Report_Builder SHALL tạo file HTML self-contained với CSS inline, sẵn sàng làm thân email, đặt tên theo định dạng "Tin tức thị trường Carbon DD-MM-YYYY.html".
8. THE Report_Builder SHALL lưu tự động (auto-save) trạng thái chỉnh sửa mỗi 60 giây để tránh mất dữ liệu khi trình duyệt đóng đột ngột.
9. IF Analyst cố gắng thoát trang khi có thay đổi chưa lưu, THEN THE Report_Builder SHALL hiển thị hộp thoại xác nhận với hai nút riêng biệt cùng lúc: "Lưu và thoát" và "Thoát không lưu".

---

### Requirement 5: Approval Workflow — Dashboard phê duyệt

**User Story:** Là Giám đốc CLPT (Approver), tôi muốn có dashboard để xem xét, chú thích và phê duyệt báo cáo trước khi gửi đến người nhận, để đảm bảo chất lượng và kiểm soát nội dung phát hành.

#### Tiêu chí chấp nhận

1. WHEN báo cáo đạt trạng thái "ready_for_review", THE Approval_Dashboard SHALL gửi thông báo đến Approver qua email với đường dẫn trực tiếp đến trang xem xét.
2. THE Approval_Dashboard SHALL hiển thị nội dung báo cáo theo Report_Template đầy đủ cùng bản xem trước HTML giống email thật sẽ được gửi đến Subscriber.
3. WHEN Approver nhấn "Phê duyệt", THE Approval_Dashboard SHALL cập nhật trạng thái báo cáo thành "approved", ghi nhận thời điểm phê duyệt và người phê duyệt, rồi kích hoạt Delivery_Engine. Trạng thái "approved" có thể tồn tại trong khoảng thời gian ngắn trước khi Delivery_Engine bắt đầu gửi; đây là hành vi bình thường của hệ thống. THE Platform SHALL hỗ trợ kích hoạt Delivery_Engine theo quy trình tự động (không cần nhận diện thao tác nhấn nút cụ thể) miễn là báo cáo đã ở trạng thái "approved" và các điều kiện gửi khác được đáp ứng. WHERE chế độ Auto-approve được bật, THE Approval_Dashboard SHALL cập nhật trạng thái thành "approved" sau khoảng thời gian cấu hình mà không kích hoạt Delivery_Engine tự động — Delivery_Engine chỉ được kích hoạt khi có trigger rõ ràng (nhấn phê duyệt hoặc lịch gửi đến).
4. WHEN Approver nhấn "Yêu cầu chỉnh sửa" kèm ghi chú, THE Approval_Dashboard SHALL cập nhật trạng thái thành "revision_requested", lưu ghi chú chỉnh sửa, và thông báo đến Analyst kèm nội dung ghi chú.
5. THE Approval_Dashboard SHALL cho phép Approver chỉnh sửa trực tiếp nội dung báo cáo trong dashboard mà không cần chuyển lại cho Analyst, sau đó phê duyệt ngay.
6. THE Approval_Dashboard SHALL hiển thị lịch sử trạng thái của báo cáo (draft → ready_for_review → approved/revision_requested) kèm thời gian và người thực hiện từng thay đổi trạng thái.
7. IF báo cáo không được phê duyệt hoặc từ chối trong vòng 2 giờ kể từ khi gửi yêu cầu xem xét, THEN THE Approval_Dashboard SHALL gửi nhắc nhở tự động đến Approver.
8. WHERE chế độ "Auto-approve" được bật trong cấu hình, THE Approval_Dashboard SHALL tự động chuyển trạng thái báo cáo thành "approved" nếu không có phản hồi trong khoảng thời gian cấu hình. THE Delivery_Engine SHALL được phép kích hoạt dựa trên điều kiện trạng thái báo cáo là "approved" và điều kiện lịch gửi, bất kể chế độ Auto-approve có bật hay không — miễn là báo cáo đã đạt trạng thái "approved" thông qua bất kỳ con đường hợp lệ nào.

---

### Requirement 6: Phân phối báo cáo đa kênh

**User Story:** Là một Analyst, tôi muốn hệ thống tự động gửi báo cáo đã duyệt đến người nhận qua cả Email và Telegram, theo đúng lịch đã cấu hình, để tôi không phải thao tác gửi thủ công.

#### Tiêu chí chấp nhận

1. WHEN báo cáo đạt trạng thái "approved" và đang ở trong Scheduled_Window (8h30, 9h00, 11h00 hoặc 14h00 T2–T6), THE Delivery_Engine SHALL gửi email đến danh sách người nhận đã cấu hình với nội dung HTML làm thân email và file .html đính kèm.
2. THE Delivery_Engine SHALL gửi nội dung tóm tắt (Mục 1 — Tóm tắt điều hành + Bảng giá nhanh) đến kênh Telegram đã cấu hình, kèm đường dẫn xem báo cáo đầy đủ.
3. THE Delivery_Engine SHALL ghi nhận trạng thái gửi (thành công / thất bại) cho mỗi kênh và lưu vào History_DB.
4. IF gửi email thất bại lần đầu, THEN THE Delivery_Engine SHALL thử lại tối đa 3 lần với khoảng cách 5 phút giữa mỗi lần. Việc gửi email và gửi Telegram là hai luồng độc lập — trạng thái thất bại của Telegram không kích hoạt thử lại email và ngược lại.
5. IF gửi Telegram thất bại lần đầu, THEN THE Delivery_Engine SHALL thử lại tối đa 3 lần với khoảng cách 2 phút giữa mỗi lần.
6. IF tất cả lần thử gửi qua một kênh đều thất bại, THEN THE Delivery_Engine SHALL thông báo lỗi đến Analyst qua email nội bộ với thông tin lỗi chi tiết. IF cả Email và Telegram đều thất bại đồng thời, THEN THE Delivery_Engine SHALL gửi hai thông báo lỗi riêng biệt — một cho kênh Email và một cho kênh Telegram — để Analyst nắm rõ từng kênh bị ảnh hưởng.
7. THE Delivery_Engine SHALL hỗ trợ cấu hình danh sách người nhận email phân theo nhóm (vd: nhóm "duyệt" và nhóm "nhận sau duyệt") và gửi đúng nội dung đến đúng nhóm theo từng bước trong approval workflow.
8. THE Delivery_Engine SHALL đảm bảo mỗi báo cáo chỉ được gửi đúng một lần đến mỗi người nhận trong cùng một phiên phát hành, ngăn chặn gửi trùng.

---

### Requirement 7: Cơ sở dữ liệu lịch sử

**User Story:** Là một Analyst, tôi muốn hệ thống lưu trữ toàn bộ báo cáo đã phát hành và chuỗi giá lịch sử, để tôi có thể tra cứu xu hướng và so sánh với các phiên trước.

#### Tiêu chí chấp nhận

1. THE History_DB SHALL lưu trữ mỗi báo cáo đã phát hành bao gồm: nội dung đầy đủ, ngày phát hành, người phê duyệt, kênh gửi, trạng thái gửi và phiên bản (nếu có chỉnh sửa sau duyệt).
2. THE History_DB SHALL lưu trữ chuỗi giá hàng ngày cho tất cả hợp đồng trong phạm vi theo dõi, với độ phân giải tối thiểu 1 giá/ngày (giá đóng cửa), có thể mở rộng đến nhiều điểm/ngày nếu nguồn cung cấp.
3. THE Platform SHALL cung cấp giao diện tìm kiếm báo cáo lịch sử với các bộ lọc: khoảng ngày, từ khóa trong nội dung, tên hàng hóa, trạng thái phê duyệt.
4. WHEN Analyst truy vấn lịch sử giá của một hợp đồng, THE History_DB SHALL trả về chuỗi giá theo thứ tự thời gian với đầy đủ trường: ngày, giá đóng cửa, mức thay đổi ngày, nguồn dữ liệu.
5. THE History_DB SHALL hỗ trợ so sánh giá hiện tại với mức giá trung bình 4 tuần, 12 tuần và 52 tuần để hỗ trợ phân tích xu hướng.
6. THE Platform SHALL hiển thị biểu đồ đường (line chart) lịch sử giá cho từng hợp đồng với khung thời gian có thể chọn: 1 tháng, 3 tháng, 6 tháng, 1 năm.
7. THE History_DB SHALL duy trì dữ liệu giá trong tối thiểu 24 tháng và dữ liệu báo cáo đã phát hành trong tối thiểu 12 tháng.
8. IF dữ liệu lịch sử của một ngày giao dịch bị thiếu do lỗi thu thập, THEN THE History_DB SHALL đánh dấu rõ khoảng trống dữ liệu thay vì nội suy tự động mà không có cảnh báo.

---

### Requirement 8: Cảnh báo tin đột xuất (Breaking News Alert)

**User Story:** Là một Analyst và Approver, tôi muốn nhận cảnh báo ngay lập tức khi có tin đột xuất quan trọng ảnh hưởng đến thị trường, để có thể phản ứng kịp thời ngoài lịch báo cáo định kỳ.

#### Tiêu chí chấp nhận

1. WHEN Alert_Engine nhận được tín hiệu Breaking_News từ Data_Collector, THE Alert_Engine SHALL tạo bản tin cảnh báo ngay trong vòng 5 phút kể từ khi phát hiện.
2. THE Alert_Engine SHALL gửi cảnh báo Breaking_News đồng thời qua cả Email và Telegram đến Analyst và Approver, bất kể thời điểm trong ngày (kể cả ngoài Scheduled_Window).
3. THE Alert_Engine SHALL định dạng bản tin cảnh báo bao gồm: tiêu đề tin, tóm tắt tác động thị trường dự kiến (do AI_Analyzer tạo), nguồn gốc và đường dẫn gốc, nhóm hàng bị ảnh hưởng, và thời điểm phát hiện.
4. THE Platform SHALL cho phép Analyst cấu hình danh sách từ khóa kích hoạt Breaking_News alert riêng cho từng nhóm hàng, với khả năng thêm/xóa/chỉnh sửa qua giao diện quản trị.
5. IF cùng một sự kiện kích hoạt nhiều từ khóa Breaking_News, THEN THE Alert_Engine SHALL chỉ gửi 1 cảnh báo duy nhất cho sự kiện đó, tổng hợp tất cả từ khóa khớp.
6. THE Alert_Engine SHALL ghi nhận lịch sử tất cả cảnh báo đã gửi (thời điểm, nội dung, kênh, trạng thái) vào History_DB để phục vụ kiểm tra sau.
7. WHILE Alert_Engine đang trong trạng thái "maintenance mode" do Analyst bật, THE Alert_Engine SHALL ghi nhận các sự kiện Breaking_News vào hàng đợi nhưng không gửi thông báo, cho đến khi maintenance mode được tắt.

---

### Requirement 9: Lịch phát hành và quản lý lịch trình

**User Story:** Là một Analyst, tôi muốn hệ thống tự động kích hoạt toàn bộ pipeline theo lịch đã cấu hình và tôi có thể điều chỉnh hoặc kích hoạt thủ công khi cần, để hệ thống hoạt động đều đặn mà không cần giám sát liên tục.

#### Tiêu chí chấp nhận

1. WHEN lịch tự động được kích hoạt vào 7h30 sáng mỗi ngày T2–T6 (múi giờ Asia/Ho_Chi_Minh), THE Platform SHALL ngay lập tức chuyển trạng thái pipeline thành "COLLECTING" và bắt đầu thu thập dữ liệu.
2. THE Platform SHALL hỗ trợ lịch phát hành có thể cấu hình với mặc định là 4 khung giờ gửi: 8h30, 9h00, 11h00 và 14h00 (T2–T6).
3. WHEN Analyst kích hoạt "Chạy ngay" (manual trigger) từ giao diện quản trị, THE Platform SHALL bắt đầu pipeline thu thập ngay lập tức bất kể lịch tự động.
4. THE Platform SHALL hiển thị trạng thái pipeline hiện tại trên dashboard chính (Đang thu thập / Đang phân tích / Chờ duyệt / Đang gửi / Hoàn thành / Lỗi) và cập nhật trạng thái theo thời gian thực.
5. IF ngày hiện tại là ngày lễ Việt Nam (theo danh sách cấu hình), THEN THE Platform SHALL bỏ qua lịch chạy tự động và ghi nhật ký "Ngày lễ — không chạy". Việc kích hoạt thủ công (manual trigger) vẫn được phép vào ngày lễ khi Analyst có nhu cầu.
6. THE Platform SHALL ghi nhật ký đầy đủ (log) cho từng bước trong pipeline bao gồm: thời điểm bắt đầu, kết thúc, trạng thái, số lượng bản ghi xử lý, và thông tin lỗi nếu có.
7. THE Platform SHALL gửi tóm tắt hoạt động hàng ngày (daily digest) đến Analyst lúc 17h00 liệt kê: số báo cáo đã gửi, số cảnh báo Breaking_News đã kích hoạt, lỗi phát sinh trong ngày (nếu có).

---

### Requirement 10: Quản lý cấu hình hệ thống

**User Story:** Là một Analyst, tôi muốn có giao diện quản trị để cấu hình các tham số hệ thống (nguồn dữ liệu, từ khóa, người nhận, API key), để không phải sửa code trực tiếp khi cần điều chỉnh vận hành.

#### Tiêu chí chấp nhận

1. THE Platform SHALL cung cấp giao diện quản trị web cho phép Analyst thêm, sửa, xóa danh sách nguồn dữ liệu cho từng nhóm hàng mà không cần sửa code.
2. THE Platform SHALL cho phép cấu hình danh sách người nhận email (To, CC, BCC) theo từng bước của approval workflow qua giao diện quản trị.
3. THE Platform SHALL cho phép cấu hình các tham số Breaking_News alert: danh sách từ khóa theo nhóm hàng, ngưỡng thay đổi giá (%) kích hoạt alert, và khoảng thời gian giữa các alert liên tiếp của cùng chủ đề.
4. THE Platform SHALL lưu trữ API key và thông tin xác thực (Claude API key, Gmail credentials, Telegram Bot token) trong biến môi trường hoặc secret manager, không lưu dưới dạng plaintext trong code hoặc database.
5. WHEN Analyst thay đổi cấu hình và nhấn "Lưu", THE Platform SHALL xác nhận tính hợp lệ của cấu hình mới (ví dụ: định dạng email đúng, API key không rỗng) trước khi lưu; IF cấu hình không hợp lệ, THEN THE Platform SHALL hiển thị thông báo lỗi cụ thể và giữ nguyên cấu hình cũ. THE Platform SHALL hiển thị thông báo lỗi hợp lệ ngay khi phát hiện vấn đề trong quá trình nhập, không chỉ khi nhấn Lưu. THE Platform SHALL ngăn chặn mọi hành vi lưu cấu hình không hợp lệ, bao gồm cả cấu hình đang trong quá trình nhập dở (work-in-progress) chưa hoàn chỉnh.
6. THE Platform SHALL cho phép Analyst cấu hình system prompt cho Claude API qua giao diện text editor, thay thế cho việc chỉnh sửa file markdown trực tiếp.
7. THE Platform SHALL duy trì lịch sử thay đổi cấu hình (configuration history) gồm: người thay đổi, thời điểm, nội dung thay đổi, và hỗ trợ rollback về phiên bản cấu hình trước.

---

### Requirement 11: Tích hợp phân tích liên thị trường

**User Story:** Là một Analyst, tôi muốn hệ thống tự động phát hiện và nêu bật các tín hiệu liên kết giữa 3 nhóm hàng (Năng lượng ↔ Carbon ↔ Kim loại), để báo cáo cung cấp giá trị phân tích vượt ra ngoài từng nhóm riêng lẻ.

#### Tiêu chí chấp nhận

1. WHEN AI_Analyzer xử lý dữ liệu ngày, THE AI_Analyzer SHALL kiểm tra ít nhất các mối liên kết sau: (a) giá khí/điện châu Âu và chi phí sản xuất nhôm/kẽm, (b) giá EUA và fuel switching than/khí, (c) CBAM và dòng chảy thương mại thép/nhôm, (d) USD và lãi suất thực tác động lên vàng/dầu/kim loại.
2. WHEN AI_Analyzer phát hiện tín hiệu liên thị trường có cơ sở dữ liệu, THE AI_Analyzer SHALL tạo nội dung cho Mục 6 nêu rõ: hàng hóa liên quan, chiều hướng tác động (tăng/giảm), cơ sở dữ liệu và mức độ chắc chắn (cao/trung bình/thấp).
3. IF AI_Analyzer không phát hiện tín hiệu liên thị trường có cơ sở trong dữ liệu ngày, THEN THE AI_Analyzer SHALL ghi rõ "Không có tín hiệu liên thị trường mới" vào Mục 6 VÀ ghi lý do loại bỏ vào nhật ký nội bộ. Phần giải thích lý do chỉ xuất hiện trong nhật ký nội bộ, không đưa vào báo cáo cuối cùng.
4. WHEN AI_Analyzer phát hiện một sự kiện vĩ mô tác động đồng thời lên từ 2 nhóm hàng trở lên, THE AI_Analyzer SHALL tạo nội dung Mục 6 nêu rõ sự kiện, các nhóm hàng bị ảnh hưởng và chiều hướng tác động. IF AI_Analyzer phát hiện sự kiện vĩ mô nhưng sự kiện đó chỉ tác động lên ít hơn 2 nhóm hàng, THEN THE AI_Analyzer SHALL thực hiện kiểm tra phát hiện liên thị trường nhưng không tạo nội dung Mục 6 cho sự kiện đó. IF tín hiệu liên thị trường được phát hiện nhưng không có đủ cơ sở dữ liệu để mô tả chiều hướng tác động một cách đáng tin cậy, THEN THE AI_Analyzer SHALL loại bỏ tín hiệu đó và ghi rõ lý do trong nhật ký nội bộ, không đưa tín hiệu thiếu cơ sở vào báo cáo.
5. THE AI_Analyzer SHALL phân biệt rõ ràng giữa tín hiệu liên thị trường đã xảy ra (FACT) và tín hiệu dự kiến có thể xảy ra (FORECAST) trong nội dung Mục 6.

---

### Requirement 12: Phân loại và kiểm chứng nguồn thông tin

**User Story:** Là một Analyst và Approver, tôi muốn mọi thông tin trong báo cáo đều được phân loại rõ ràng (FACT/OPINION/FORECAST) và gắn nguồn trích dẫn cụ thể, để đảm bảo chất lượng và độ tin cậy của báo cáo.

#### Tiêu chí chấp nhận

1. THE AI_Analyzer SHALL gắn nhãn FACT, OPINION hoặc FORECAST cho mỗi thông tin có nội dung phân tích trong báo cáo, theo định nghĩa: FACT là số liệu đã công bố/sự kiện đã xảy ra; OPINION là nhận định của analyst/tổ chức; FORECAST là dự báo kèm phương pháp và thời hạn.
2. THE AI_Analyzer SHALL gắn nguồn trích dẫn (tên tổ chức + ngày) cho mọi OPINION và FORECAST trong báo cáo; IF không có nguồn cụ thể, THEN THE AI_Analyzer SHALL loại bỏ thông tin đó khỏi báo cáo.
3. THE AI_Analyzer SHALL phân loại nguồn theo 3 hạng: Hạng A (sàn/cơ quan chính thức, ngân hàng đầu tư lớn), Hạng B (báo chí tài chính uy tín), Hạng C (mạng xã hội, blog); IF nguồn Hạng C mâu thuẫn với nguồn Hạng A hoặc B, THEN THE AI_Analyzer SHALL ưu tiên nguồn Hạng A/B và chỉ giữ lại thông tin từ nguồn Hạng C như chỉ số tâm lý thị trường (sentiment indicator) kèm nhãn "Hạng C — sentiment only", không loại bỏ hoàn toàn.
4. WHEN AI_Analyzer phát hiện hai nguồn có quan điểm mâu thuẫn về cùng một chủ đề, THE AI_Analyzer SHALL trình bày cả hai quan điểm kèm lập luận chính của mỗi bên và nêu rõ dữ kiện nào sẽ phân định trong tương lai. IF một trong hai quan điểm mâu thuẫn không thể được mô tả đầy đủ do thiếu nguồn trích dẫn cụ thể, THEN THE AI_Analyzer SHALL không trình bày bất kỳ quan điểm nào trong cặp mâu thuẫn đó, ghi chú rằng tồn tại quan điểm đối lập nhưng không đủ nguồn để trình bày.
5. THE Report_Builder SHALL hiển thị Mục 9 (Nguồn tham khảo) với danh sách đánh số đầy đủ mọi nguồn được trích dẫn trong báo cáo, kèm hyperlink đến tài liệu gốc.

---

## Ràng buộc phi chức năng

### Hiệu năng
- THE Platform SHALL hoàn thành toàn bộ pipeline từ bắt đầu thu thập đến tạo xong dự thảo báo cáo trong vòng 15 phút.
- THE Platform SHALL phản hồi thao tác người dùng trên giao diện web trong vòng 2 giây trong điều kiện tải bình thường.

### Bảo mật
- THE Platform SHALL yêu cầu xác thực (đăng nhập) cho tất cả giao diện web bao gồm Approval_Dashboard và giao diện quản trị.
- THE Platform SHALL lưu trữ API key và thông tin xác thực dưới dạng mã hóa, không bao giờ hiển thị plaintext trên giao diện hoặc log.

### Khả dụng
- THE Platform SHALL ghi nhật ký lỗi (error log) chi tiết cho mọi bước thất bại trong pipeline để hỗ trợ khắc phục sự cố.
- THE Platform SHALL cho phép Analyst tải xuống bản sao dữ liệu lịch sử (export) dưới định dạng CSV hoặc JSON khi cần.

/**
 * CARBON DAILY REPORT BUILDER - APPLICATION LOGIC
 * Features: Real-time iframe data-binding, date calculations, references/news state management, HTML export.
 */

// --- INITIAL STATE ---
const state = {
  date: '2026-06-10',
  author: 'Team KD Tín chỉ carbon, Phòng CLPT — Stavian Industrial Metal',
  prices: {
    eua: '76,55 €/tấn',
    euaChange: '▼ 0,53% so 8/6',
    euaNote: '+3,53%/4 tuần; +7,83%/12 tháng; đỉnh T4/2026 (77,46 €)',
    range: '75–80 €/tấn',
    rangeChange: '↔ Đi ngang',
    rangeNote: 'Rangebound đến kỳ rà soát ETS tháng 7 (Energy Aspects)',
    forecast: '~92,5 €/tấn',
    forecastChange: 'Hạ từ 100 €',
    forecastNote: 'Đồng thuận khảo sát Reuters (hạ ~7,6% do bất định chính sách)',
    cbam: '>75 €/tấn CO₂',
    cbamChange: '—',
    cbamNote: 'Mốc công bố tiếp: 6/7, 5/10, đầu 1/2027 (EU)'
  },
  references: [
    { id: 'ref_1', title: 'Trading Economics — EU Carbon Permits (giá EUA)', url: 'https://tradingeconomics.com/commodity/carbon' },
    { id: 'ref_2', title: 'Carbon Pulse — ETS2/MSR2, trilogue 10/6', url: 'https://carbon-pulse.com/498825/' },
    { id: 'ref_3', title: 'CarbonCredits.com — Ý kêu gọi cải tổ/tạm ngưng EU ETS', url: 'https://carboncredits.com/eu-carbon-market-under-pressure-business-lobby-for-reform-italy-calls-for-suspension/' },
    { id: 'ref_4', title: 'ESG Today — EC khởi động cải cách EU ETS', url: 'https://www.esgtoday.com/eu-commission-launches-first-of-planned-ets-reforms-amid-industry-pressure/' },
    { id: 'ref_5', title: 'Fastmarkets — Chỉ số định giá CBAM hằng ngày', url: 'https://www.fastmarkets.com/insights/fastmarkets-closes-the-cbam-pricing-gap-with-daily-view-of-carbon-import-costs/' },
    { id: 'ref_6', title: 'Carbon Direct — 2026 State of the Voluntary Carbon Market', url: 'https://www.carbon-direct.com/voluntary-carbon-market/2026' },
    { id: 'ref_7', title: 'European Commission — About the EU ETS', url: 'https://climate.ec.europa.eu/eu-action/carbon-markets/about-eu-ets_en' },
    { id: 'ref_8', title: 'VnExpress — Sàn giao dịch carbon thí điểm trong tháng 6', url: 'https://vnexpress.net/san-giao-dich-carbon-du-kien-duoc-thi-diem-trong-thang-6-5082310.html' },
    { id: 'ref_9', title: 'Người Quan Sát — Sàn carbon & Nghị định 29', url: 'https://nguoiquansat.vn/san-giao-dich-carbon-co-the-van-hanh-thi-diem-ngay-trong-thang-6-296063.html' },
    { id: 'ref_10', title: 'VnEconomy — CBAM & thép xuất khẩu', url: 'https://vneconomy.vn/khi-tam-ho-chieu-ra-thi-truong-cua-hang-hoa-tham-dung-carbon-khong-con-mien-phi.htm' },
    { id: 'ref_11', title: 'VnEconomy — Tín chỉ carbon rừng không còn "một giá"', url: 'https://vneconomy.vn/tin-chi-carbon-rung-khong-con-mot-gia-va-xu-huong-dich-chuyen-cau-truc-moi.htm' }
  ],
  news: {
    intl: [
      {
        id: 'news_i1',
        title: 'Giá EUA giảm nhẹ',
        desc: 'EUA đóng cửa ~76,55 €/tấn ngày 9/6, giảm 0,53% so với ngày 8/6; thị trường thận trọng chờ đề xuất rà soát EU ETS (tháng 7).',
        refId: 'ref_1'
      },
      {
        id: 'news_i2',
        title: 'Khởi động đàm phán trilogue MSR2/ETS2 (10/6)',
        desc: 'các nước thành viên phản đối đề xuất của Nghị viện hủy hạn ngạch dự trữ ETS2 (50% năm 2034, phần còn lại 2036).',
        refId: 'ref_2'
      },
      {
        id: 'news_i3',
        title: 'Ý kêu gọi cải tổ/tạm ngưng EU ETS',
        desc: 'cảnh báo nguy cơ phi công nghiệp hóa; 10 nước xin gia hạn phân bổ miễn phí sau 2034.',
        refId: 'ref_3'
      },
      {
        id: 'news_i4',
        title: 'EC sẽ rà soát toàn diện EU ETS vào tháng 7/2026',
        desc: 'đã khởi động gói cải cách đầu tiên (tăng phân bổ miễn phí cho công nghiệp).',
        refId: 'ref_4'
      },
      {
        id: 'news_i5',
        title: 'Fastmarkets ra mắt 2 chỉ số định giá CBAM hằng ngày (9/6)',
        desc: 'lần đầu thị trường có góc nhìn nhất quán về chi phí chứng chỉ CBAM trước khi EU công bố giá chính thức.',
        refId: 'ref_5'
      },
      {
        id: 'news_i6',
        title: 'Thị trường carbon tự nguyện (VCM) chững lại',
        desc: 'tín chỉ retire 2025 giảm 7% dù cam kết DN tăng 227%; nguồn cung CDR chất lượng cao khan hiếm.',
        refId: 'ref_6'
      }
    ],
    vn: [
      {
        id: 'news_v1',
        title: 'Sàn giao dịch carbon trong nước có thể thí điểm ngay trong tháng 6',
        desc: 'hạ tầng CSDL đăng ký hạn ngạch & tín chỉ cơ bản hoàn thành.',
        refId: 'ref_8'
      },
      {
        id: 'news_v2',
        title: 'Cấu trúc thị trường theo Nghị định 29',
        desc: 'gồm cơ quan quản lý, UBCKNN, hai sở GDCK, ngân hàng thương mại và công ty chứng khoán.',
        refId: 'ref_9'
      },
      {
        id: 'news_v3',
        title: 'CBAM vận hành đầy đủ từ 1/1/2026',
        desc: 'giá tham chiếu chứng chỉ Q1/2026 >75 €/tấn CO₂; mốc công bố tiếp 6/7, 5/10, đầu 1/2027.',
        refId: 'ref_10'
      },
      {
        id: 'news_v4',
        title: 'Thép HRC Việt Nam có thể chịu chi phí CBAM ~238 €/tấn vào 2027',
        desc: 'chênh ~22% so với Thái Lan (~436.000 € phụ trội cho đơn 10.000 tấn).',
        refId: 'ref_10'
      },
      {
        id: 'news_v5',
        title: 'Tín chỉ carbon rừng không còn "một giá"',
        desc: 'giá chênh tới 5 lần theo chất lượng (dự án ≥BBB ~30 USD, <BB ~8,7 USD); cung lâm nghiệp/đất tăng lên 36%.',
        refId: 'ref_11'
      }
    ]
  },
  signal: 'HOLD',
  signalDesc: 'Mua tích lũy 75–76 €  ·  Trung hạn thiên TĂNG  ·  Cắt lỗ &lt; 74 €',
  signalTable: {
    trendShort: '↔ Đi ngang (75–80 €/tấn)',
    trendMid: '↗ Thiên TĂNG',
    position: 'NẮM GIỮ + Mua tích lũy',
    buyZone: '75 – 76 €/tấn',
    supportResist: '75 € / 80 €/tấn',
    stopLoss: '&lt; 74 €/tấn',
    targetMid: '~92 €/tấn (TB 2026 – Reuters)',
    trust: 'Trung bình — chờ rà soát ETS 7/2026'
  },
  driversUp: '• Cắt giảm nguồn cung 2026 (~8%)\n• Kết thúc front-loading RepowerEU\n• Giá khí TTF cao → fuel-switching\n• Dòng tiền tổ chức tích lũy',
  driversDown: '• Ý/giới công nghiệp đòi nới lỏng ETS\n• EC đề xuất tăng phân bổ miễn phí\n• Bất định trước rà soát ETS T7\n• CBAM khuyến khích giảm phát thải',
  scenarios: {
    base: 'GIỮ vị thế, mua dần 75–76 €; chưa chốt lời.',
    up: 'TĂNG vị thế; chốt một phần khi tiệm cận mục tiêu ~92 €.',
    down: 'GIẢM/CẮT vị thế; chờ thị trường ổn định rồi vào lại.'
  },
  tactics: {
    open: 'TIẾP TỤC NẮM GIỮ, chưa chốt — trung hạn nghiêng tăng. Theo dõi mốc hỗ trợ ~75 € và kháng cự ~80 €.',
    new: 'ưu tiên mua tích lũy vùng 75–76 €/tấn; tránh đuổi giá sát 80 € ngay trước tin rà soát ETS tháng 7.',
    risk: 'cân nhắc giảm vị thế nếu giá phá thủng ~74 € kèm tín hiệu EC nới lỏng mạnh ETS.',
    pending: '(1) đề xuất rà soát EU ETS của EC (tháng 7); (2) mốc công bố giá chứng chỉ CBAM 6/7.'
  },
  catalysts: '10/6: Khởi động đàm phán trilogue MSR2/ETS2 — ảnh hưởng nguồn cung dài hạn. | Carbon Pulse | https://carbon-pulse.com/498825/\n~6/7: EU công bố giá tham chiếu chứng chỉ CBAM quý tiếp theo. | Fastmarkets/EU | https://www.fastmarkets.com/insights/fastmarkets-closes-the-cbam-pricing-gap-with-daily-view-of-carbon-import-costs/\n7/2026: EC công bố đề xuất rà soát toàn diện EU ETS — chất xúc tác lớn nhất. | ESG Today | https://www.esgtoday.com/eu-commission-launches-first-of-planned-ets-reforms-amid-industry-pressure/',
  solutions: 'Hedge & định giá hợp đồng: dùng chỉ số CBAM hằng ngày của Fastmarkets để ước tính chi phí carbon, đưa vào báo giá thép/nhôm xuất EU.\nNăng lực MRV thành lợi thế: đầu tư đo lường–báo cáo–thẩm định phát thải để giữ đơn hàng EU và giảm chi phí CBAM.\nChuẩn bị nguồn tín chỉ nội địa: theo dõi sàn carbon VN thí điểm tháng 6 để tiếp cận tín chỉ chất lượng cao.'
};

let currentNewsTab = 'intl'; // 'intl' or 'vn'

// --- DOCUMENT DOM ELEMENTS ---
const elements = {
  reportDate: document.getElementById('report-date'),
  reportAuthor: document.getElementById('report-author'),
  
  // Prices
  priceEua: document.getElementById('price-eua'),
  priceEuaChange: document.getElementById('price-eua-change'),
  priceEuaNote: document.getElementById('price-eua-note'),
  priceRange: document.getElementById('price-range'),
  priceRangeChange: document.getElementById('price-range-change'),
  priceRangeNote: document.getElementById('price-range-note'),
  priceForecast: document.getElementById('price-forecast'),
  priceForecastChange: document.getElementById('price-forecast-change'),
  priceForecastNote: document.getElementById('price-forecast-note'),
  priceCbam: document.getElementById('price-cbam'),
  priceCbamChange: document.getElementById('price-cbam-change'),
  priceCbamNote: document.getElementById('price-cbam-note'),
  
  // References
  refTitle: document.getElementById('ref-title'),
  refUrl: document.getElementById('ref-url'),
  btnAddRef: document.getElementById('btn-add-ref'),
  referenceList: document.getElementById('reference-list'),
  newsRefSelect: document.getElementById('news-ref-select'),
  
  // News Editor
  newsTitle: document.getElementById('news-title'),
  newsDesc: document.getElementById('news-desc'),
  btnAddNews: document.getElementById('btn-add-news'),
  newsList: document.getElementById('news-list'),
  
  // Signal
  btnSignals: document.querySelectorAll('.btn-signal'),
  signalDesc: document.getElementById('signal-desc'),
  trendShort: document.getElementById('trend-short'),
  trendMid: document.getElementById('trend-mid'),
  posRec: document.getElementById('pos-rec'),
  buyZone: document.getElementById('buy-zone'),
  supportResist: document.getElementById('support-resist'),
  stopLoss: document.getElementById('stop-loss'),
  targetMid: document.getElementById('target-mid'),
  signalTrust: document.getElementById('signal-trust'),
  
  driversUp: document.getElementById('drivers-up'),
  driversDown: document.getElementById('drivers-down'),
  
  // Scenarios
  scenBaseVal: document.getElementById('scen-base-val'),
  scenUpVal: document.getElementById('scen-up-val'),
  scenDownVal: document.getElementById('scen-down-val'),
  
  // Tactics
  tacticOpen: document.getElementById('tactic-open'),
  tacticNew: document.getElementById('tactic-new'),
  tacticRisk: document.getElementById('tactic-risk'),
  tacticPending: document.getElementById('tactic-pending'),
  
  // Catalysts / Solutions
  catalystItems: document.getElementById('catalyst-items'),
  solutionItems: document.getElementById('solution-items'),
  
  // Actions & Preview
  btnDownload: document.getElementById('btn-download'),
  btnCopy: document.getElementById('btn-copy'),
  previewSubject: document.getElementById('preview-subject'),
  previewIframe: document.getElementById('preview-iframe'),
  previewWrapper: document.getElementById('preview-wrapper'),
  
  // Responsive Toggles
  btnViewDesktop: document.getElementById('btn-view-desktop'),
  btnViewMobile: document.getElementById('btn-view-mobile'),
  
  // Toast
  toast: document.getElementById('toast-notification'),
  toastMsg: document.getElementById('toast-msg')
};

// --- APP INITIALIZATION ---
function init() {
  // Set default date to today if not defined
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  state.date = `${yyyy}-${mm}-${dd}`;
  elements.reportDate.value = state.date;
  
  // Populate UI inputs from State
  loadStateIntoInputs();
  
  // Attach Event Listeners
  setupEventListeners();
  
  // Initial renders
  renderReferencesList();
  renderNewsList();
  updateLivePreview();
}

// --- STATE BINDINGS ---
function loadStateIntoInputs() {
  elements.reportAuthor.value = state.author;
  
  // Prices
  elements.priceEua.value = state.prices.eua;
  elements.priceEuaChange.value = state.prices.euaChange;
  elements.priceEuaNote.value = state.prices.euaNote;
  elements.priceRange.value = state.prices.range;
  elements.priceRangeChange.value = state.prices.rangeChange;
  elements.priceRangeNote.value = state.prices.rangeNote;
  elements.priceForecast.value = state.prices.forecast;
  elements.priceForecastChange.value = state.prices.forecastChange;
  elements.priceForecastNote.value = state.prices.forecastNote;
  elements.priceCbam.value = state.prices.cbam;
  elements.priceCbamChange.value = state.prices.cbamChange;
  elements.priceCbamNote.value = state.prices.cbamNote;
  
  // Signal
  elements.signalDesc.value = state.signalDesc;
  elements.trendShort.value = state.signalTable.trendShort;
  elements.trendMid.value = state.signalTable.trendMid;
  elements.posRec.value = state.signalTable.position;
  elements.buyZone.value = state.signalTable.buyZone;
  elements.supportResist.value = state.signalTable.supportResist;
  elements.stopLoss.value = state.signalTable.stopLoss;
  elements.targetMid.value = state.signalTable.targetMid;
  elements.signalTrust.value = state.signalTable.trust;
  
  // Active Signal Button
  elements.btnSignals.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.signal === state.signal);
  });
  
  // Drivers
  elements.driversUp.value = state.driversUp;
  elements.driversDown.value = state.driversDown;
  
  // Scenarios
  elements.scenBaseVal.value = state.scenarios.base;
  elements.scenUpVal.value = state.scenarios.up;
  elements.scenDownVal.value = state.scenarios.down;
  
  // Tactics
  elements.tacticOpen.value = state.tactics.open;
  elements.tacticNew.value = state.tactics.new;
  elements.tacticRisk.value = state.tactics.risk;
  elements.tacticPending.value = state.tactics.pending;
  
  // Catalysts / Solutions
  elements.catalystItems.value = state.catalysts;
  elements.solutionItems.value = state.solutions;
}

function setupEventListeners() {
  // Basic Config changes
  elements.reportDate.addEventListener('change', (e) => {
    state.date = e.target.value;
    updateLivePreview();
  });
  elements.reportAuthor.addEventListener('input', (e) => {
    state.author = e.target.value;
    updateLivePreview();
  });
  
  // Prices changes
  const priceInputs = [
    { el: elements.priceEua, key: 'eua' },
    { el: elements.priceEuaChange, key: 'euaChange' },
    { el: elements.priceEuaNote, key: 'euaNote' },
    { el: elements.priceRange, key: 'range' },
    { el: elements.priceRangeChange, key: 'rangeChange' },
    { el: elements.priceRangeNote, key: 'rangeNote' },
    { el: elements.priceForecast, key: 'forecast' },
    { el: elements.priceForecastChange, key: 'forecastChange' },
    { el: elements.priceForecastNote, key: 'forecastNote' },
    { el: elements.priceCbam, key: 'cbam' },
    { el: elements.priceCbamChange, key: 'cbamChange' },
    { el: elements.priceCbamNote, key: 'cbamNote' }
  ];
  
  priceInputs.forEach(item => {
    item.el.addEventListener('input', (e) => {
      state.prices[item.key] = e.target.value;
      updateLivePreview();
    });
  });
  
  // Add Reference Button
  elements.btnAddRef.addEventListener('click', addReference);
  
  // Add News Button
  elements.btnAddNews.addEventListener('click', addNewsItem);
  
  // Signal Buttons Click
  elements.btnSignals.forEach(btn => {
    btn.addEventListener('click', (e) => {
      elements.btnSignals.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.signal = e.target.dataset.signal;
      updateLivePreview();
    });
  });
  
  // Signal details input
  elements.signalDesc.addEventListener('input', (e) => {
    state.signalDesc = e.target.value;
    updateLivePreview();
  });
  
  const signalTableInputs = [
    { el: elements.trendShort, key: 'trendShort' },
    { el: elements.trendMid, key: 'trendMid' },
    { el: elements.posRec, key: 'position' },
    { el: elements.buyZone, key: 'buyZone' },
    { el: elements.supportResist, key: 'supportResist' },
    { el: elements.stopLoss, key: 'stopLoss' },
    { el: elements.targetMid, key: 'targetMid' },
    { el: elements.signalTrust, key: 'trust' }
  ];
  
  signalTableInputs.forEach(item => {
    item.el.addEventListener('input', (e) => {
      state.signalTable[item.key] = e.target.value;
      updateLivePreview();
    });
  });
  
  // Drivers Textareas
  elements.driversUp.addEventListener('input', (e) => {
    state.driversUp = e.target.value;
    updateLivePreview();
  });
  elements.driversDown.addEventListener('input', (e) => {
    state.driversDown = e.target.value;
    updateLivePreview();
  });
  
  // Scenarios inputs
  elements.scenBaseVal.addEventListener('input', (e) => {
    state.scenarios.base = e.target.value;
    updateLivePreview();
  });
  elements.scenUpVal.addEventListener('input', (e) => {
    state.scenarios.up = e.target.value;
    updateLivePreview();
  });
  elements.scenDownVal.addEventListener('input', (e) => {
    state.scenarios.down = e.target.value;
    updateLivePreview();
  });
  
  // Tactics textareas
  elements.tacticOpen.addEventListener('input', (e) => {
    state.tactics.open = e.target.value;
    updateLivePreview();
  });
  elements.tacticNew.addEventListener('input', (e) => {
    state.tactics.new = e.target.value;
    updateLivePreview();
  });
  elements.tacticRisk.addEventListener('input', (e) => {
    state.tactics.risk = e.target.value;
    updateLivePreview();
  });
  elements.tacticPending.addEventListener('input', (e) => {
    state.tactics.pending = e.target.value;
    updateLivePreview();
  });
  
  // Catalysts / Solutions inputs
  elements.catalystItems.addEventListener('input', (e) => {
    state.catalysts = e.target.value;
    updateLivePreview();
  });
  elements.solutionItems.addEventListener('input', (e) => {
    state.solutions = e.target.value;
    updateLivePreview();
  });
  
  // Download and Copy triggers
  elements.btnDownload.addEventListener('click', downloadReportHtml);
  elements.btnCopy.addEventListener('click', copyReportHtml);
  
  // Responsive view toggles
  elements.btnViewDesktop.addEventListener('click', () => {
    elements.btnViewDesktop.classList.add('active');
    elements.btnViewMobile.classList.remove('active');
    elements.previewWrapper.classList.remove('mobile-view');
  });
  
  elements.btnViewMobile.addEventListener('click', () => {
    elements.btnViewMobile.classList.add('active');
    elements.btnViewDesktop.classList.remove('active');
    elements.previewWrapper.classList.add('mobile-view');
  });
}

// --- REFERENCES MANAGEMENT ---
function renderReferencesList() {
  elements.referenceList.innerHTML = '';
  elements.newsRefSelect.innerHTML = '<option value="">-- Không có nguồn trích dẫn --</option>';
  
  state.references.forEach(ref => {
    // Add to references list panel
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="item-info">
        <span class="item-name">${ref.title}</span>
        <span class="item-meta">${ref.url}</span>
      </div>
      <button class="btn-remove" onclick="removeReference('${ref.id}')" title="Xóa nguồn">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    `;
    elements.referenceList.appendChild(li);
    
    // Add to reference dropdown select for News form
    const option = document.createElement('option');
    option.value = ref.id;
    option.textContent = ref.title.split(' — ')[0];
    elements.newsRefSelect.appendChild(option);
  });
}

function addReference() {
  const title = elements.refTitle.value.trim();
  const url = elements.refUrl.value.trim();
  
  if (!title || !url) {
    showToast('Vui lòng điền đầy đủ Tên nguồn và URL!');
    return;
  }
  
  const id = 'ref_' + Date.now();
  state.references.push({ id, title, url });
  
  // Clean inputs
  elements.refTitle.value = '';
  elements.refUrl.value = '';
  
  renderReferencesList();
  updateLivePreview();
  showToast('Đã thêm nguồn tham khảo mới!');
}

function removeReference(id) {
  state.references = state.references.filter(r => r.id !== id);
  
  // Clean ref references in news items
  state.news.intl.forEach(n => { if (n.refId === id) n.refId = ''; });
  state.news.vn.forEach(n => { if (n.refId === id) n.refId = ''; });
  
  renderReferencesList();
  renderNewsList();
  updateLivePreview();
  showToast('Đã xóa nguồn tham khảo!');
}

// --- NEWS MANAGEMENT ---
function switchNewsTab(tab) {
  currentNewsTab = tab;
  
  // Toggle UI active tabs
  const tabIntl = document.getElementById('btn-tab-intl');
  const tabVn = document.getElementById('btn-tab-vn');
  if (tab === 'intl') {
    tabIntl.classList.add('active');
    tabVn.classList.remove('active');
  } else {
    tabVn.classList.add('active');
    tabIntl.classList.remove('active');
  }
  
  renderNewsList();
}

function renderNewsList() {
  elements.newsList.innerHTML = '';
  const list = state.news[currentNewsTab];
  
  if (list.length === 0) {
    elements.newsList.innerHTML = `<li style="justify-content: center; color: var(--text-muted); font-style: italic;">Chưa có tin tức nào trong nhóm này.</li>`;
    return;
  }
  
  list.forEach(n => {
    const ref = state.references.find(r => r.id === n.refId);
    const refLabel = ref ? ref.title.split(' — ')[0] : 'Không nguồn';
    
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="item-info">
        <span class="item-name">${n.title}</span>
        <span class="item-meta">${refLabel} — ${n.desc.substring(0, 70)}...</span>
      </div>
      <button class="btn-remove" onclick="removeNewsItem('${n.id}')" title="Xóa tin tức">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    `;
    elements.newsList.appendChild(li);
  });
}

function addNewsItem() {
  const title = elements.newsTitle.value.trim();
  const desc = elements.newsDesc.value.trim();
  const refId = elements.newsRefSelect.value;
  
  if (!title || !desc) {
    showToast('Vui lòng nhập đầy đủ Tiêu đề và Nội dung chi tiết!');
    return;
  }
  
  const id = 'news_' + Date.now();
  state.news[currentNewsTab].push({ id, title, desc, refId });
  
  // Clean inputs
  elements.newsTitle.value = '';
  elements.newsDesc.value = '';
  elements.newsRefSelect.value = '';
  
  renderNewsList();
  updateLivePreview();
  showToast('Đã thêm một dòng tin tức!');
}

function removeNewsItem(id) {
  state.news[currentNewsTab] = state.news[currentNewsTab].filter(n => n.id !== id);
  renderNewsList();
  updateLivePreview();
  showToast('Đã xóa tin tức!');
}

// --- UTILITIES FOR DATE ---
function getFormattedDisplayDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function getVietnameseDateString(dateStr) {
  if (!dateStr) return '';
  const dateParts = dateStr.split('-');
  const year = parseInt(dateParts[0], 10);
  const month = parseInt(dateParts[1], 10);
  const day = parseInt(dateParts[2], 10);
  
  const date = new Date(year, month - 1, day);
  const dayOfWeekNames = [
    "Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"
  ];
  const dayName = dayOfWeekNames[date.getDay()];
  const pad = (n) => n.toString().padStart(2, '0');
  
  return `${dayName}, ngày ${pad(day)} tháng ${pad(month)} năm ${year}`;
}

function getShortCitationDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  return `${day}/${month}`;
}

// --- HTML REPORT COMPILER ---
function buildReportHtml() {
  const dispDate = getFormattedDisplayDate(state.date);
  const viDate = getVietnameseDateString(state.date);
  const shortDate = getShortCitationDate(state.date);
  
  // Compile news intl
  const intlNewsHtml = state.news.intl.map(n => {
    const ref = state.references.find(r => r.id === n.refId);
    const refHtml = ref ? ` <a href="${ref.url}" style="color:#1E7A46;font-style:italic;">(${ref.title.split(' — ')[0]}, ${shortDate})</a>` : '';
    return `    <li style="margin-bottom:7px;"><b>${n.title}:</b> ${n.desc}${refHtml}</li>`;
  }).join('\n');
  
  // Compile news vn
  const vnNewsHtml = state.news.vn.map(n => {
    const ref = state.references.find(r => r.id === n.refId);
    const refHtml = ref ? ` <a href="${ref.url}" style="color:#1E7A46;font-style:italic;">(${ref.title.split(' — ')[0]}, ${shortDate})</a>` : '';
    return `    <li style="margin-bottom:7px;"><b>${n.title}:</b> ${n.desc}${refHtml}</li>`;
  }).join('\n');
  
  // Compile detailed Section 3 Intl News
  const intlDetailsHtml = state.news.intl.map((n, idx) => {
    const ref = state.references.find(r => r.id === n.refId);
    const refHtml = ref ? ` <a href="${ref.url}" style="color:#1E7A46;font-style:italic;">Nguồn: ${ref.title.split(' — ')[0]}</a>` : '';
    return `  <p style="font-size:14px;font-weight:bold;color:#14532D;margin:12px 0 4px;">${idx + 1}. ${n.title}</p>\n  <p style="font-size:13.5px;line-height:1.55;margin:0 0 10px;text-align:justify;">${n.desc}${refHtml}</p>`;
  }).join('\n');
  
  // Compile detailed Section 3 Vn News
  const vnDetailsHtml = state.news.vn.map((n, idx) => {
    const ref = state.references.find(r => r.id === n.refId);
    const refHtml = ref ? ` <a href="${ref.url}" style="color:#1E7A46;font-style:italic;">Nguồn: ${ref.title.split(' — ')[0]}</a>` : '';
    return `  <p style="font-size:14px;font-weight:bold;color:#14532D;margin:12px 0 4px;">${idx + 1}. ${n.title}</p>\n  <p style="font-size:13.5px;line-height:1.55;margin:0 0 10px;text-align:justify;">${n.desc}${refHtml}</p>`;
  }).join('\n');
  
  // Compile references footer
  const referencesHtml = state.references.map((r, idx) => {
    return `    <li><a href="${r.url}" style="color:#1E7A46;">${r.title}</a></li>`;
  }).join('\n');
  
  // Compile drivers (up vs down)
  const driversUpHtml = state.driversUp.split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => line.startsWith('•') ? line : `• ${line}`)
    .join('<br>');
    
  const driversDownHtml = state.driversDown.split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => line.startsWith('•') ? line : `• ${line}`)
    .join('<br>');

  // Compile catalysts
  const catalystsHtml = state.catalysts.split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => {
      const parts = line.split('|');
      const textPart = parts[0] ? parts[0].trim() : '';
      const sourcePart = parts[1] ? parts[1].trim() : '';
      const urlPart = parts[2] ? parts[2].trim() : '#';
      
      const colonIndex = textPart.indexOf(':');
      let boldText = '';
      let normalText = textPart;
      
      if (colonIndex !== -1) {
        boldText = textPart.substring(0, colonIndex + 1);
        normalText = textPart.substring(colonIndex + 1).trim();
      }
      
      const boldHtml = boldText ? `<b style="color:#14532D;">${boldText}</b> ` : '';
      const linkHtml = sourcePart ? ` <a href="${urlPart}" style="color:#1E7A46;font-style:italic;">(${sourcePart})</a>` : '';
      
      return `    <li style="margin-bottom:5px;">${boldHtml}${normalText}${linkHtml}</li>`;
    }).join('\n');

  // Compile business solutions
  const solutionsHtml = state.solutions.split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => {
      const colonIndex = line.indexOf(':');
      let boldText = '';
      let normalText = line;
      
      if (colonIndex !== -1) {
        boldText = line.substring(0, colonIndex + 1);
        normalText = line.substring(colonIndex + 1).trim();
      }
      const boldHtml = boldText ? `<b style="color:#14532D;">${boldText}</b> ` : '';
      return `    <li style="margin-bottom:5px;">${boldHtml}${normalText}</li>`;
    }).join('\n');

  // Signal Styles
  let signalClassStyle = 'background:#1E7A46;color:#fff;text-align:center;padding:12px;border-radius:4px;';
  let signalText = 'TÍN HIỆU HÔM NAY: NẮM GIỮ (HOLD)';
  if (state.signal === 'BUY') {
    signalClassStyle = 'background:#0369a1;color:#fff;text-align:center;padding:12px;border-radius:4px;';
    signalText = 'TÍN HIỆU HÔM NAY: MUA (BUY)';
  } else if (state.signal === 'SELL') {
    signalClassStyle = 'background:#C0392B;color:#fff;text-align:center;padding:12px;border-radius:4px;';
    signalText = 'TÍN HIỆU HÔM NAY: BÁN (SELL)';
  }

  // COMPLETE HTML STRING FROM TEMPLATE
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
  <div style="background:#14532D;padding:18px 28px 8px;text-align:center;">
    <div style="font-size:26px;font-weight:bold;color:#ffffff;letter-spacing:.3px;">TIN TỨC HÀNG NGÀY THỊ TRƯỜNG CARBON</div>
    <div style="font-size:13px;color:#C8E6D4;letter-spacing:2px;margin-top:2px;">CARBON MARKET DAILY NEWS</div>
  </div>
  <div style="background:#1E7A46;padding:8px 28px;text-align:center;color:#fff;font-weight:bold;font-size:15px;">${viDate}</div>
  <div style="padding:6px 28px 0;text-align:center;font-style:italic;color:#666;font-size:12px;">Người báo cáo: ${state.author}</div>

  <div style="padding:6px 28px 28px;">

  <!-- ===== PHẦN 1 ===== -->
  <h2 style="font-size:17px;color:#1E7A46;border-bottom:3px solid #1E7A46;padding-bottom:5px;margin:18px 0 12px;">PHẦN 1 — TIN TỨC CHÍNH / NỔI BẬT TRONG NGÀY</h2>

  <table style="border-collapse:collapse;width:100%;font-size:13px;">
    <tr style="background:#1E7A46;color:#fff;">
      <th style="border:1px solid #ccc;padding:6px 8px;text-align:left;">Sản phẩm</th>
      <th style="border:1px solid #ccc;padding:6px 8px;text-align:left;">Giá</th>
      <th style="border:1px solid #ccc;padding:6px 8px;text-align:left;">Thay đổi</th>
      <th style="border:1px solid #ccc;padding:6px 8px;text-align:left;">Ghi chú</th>
    </tr>
    <tr>
      <td style="border:1px solid #ccc;padding:6px 8px;font-weight:bold;">EUA (EU ETS)</td>
      <td style="border:1px solid #ccc;padding:6px 8px;font-weight:bold;">${state.prices.eua}</td>
      <td style="border:1px solid #ccc;padding:6px 8px;color:#C0392B;font-weight:bold;">${state.prices.euaChange}</td>
      <td style="border:1px solid #ccc;padding:6px 8px;">${state.prices.euaNote}</td>
    </tr>
    <tr style="background:#f7f9f8;">
      <td style="border:1px solid #ccc;padding:6px 8px;font-weight:bold;">Vùng dao động</td>
      <td style="border:1px solid #ccc;padding:6px 8px;font-weight:bold;">${state.prices.range}</td>
      <td style="border:1px solid #ccc;padding:6px 8px;color:#555;">${state.prices.rangeChange}</td>
      <td style="border:1px solid #ccc;padding:6px 8px;">${state.prices.rangeNote}</td>
    </tr>
    <tr>
      <td style="border:1px solid #ccc;padding:6px 8px;font-weight:bold;">Dự báo TB 2026</td>
      <td style="border:1px solid #ccc;padding:6px 8px;font-weight:bold;">${state.prices.forecast}</td>
      <td style="border:1px solid #ccc;padding:6px 8px;color:#B7791F;">${state.prices.forecastChange}</td>
      <td style="border:1px solid #ccc;padding:6px 8px;">${state.prices.forecastNote}</td>
    </tr>
    <tr style="background:#f7f9f8;">
      <td style="border:1px solid #ccc;padding:6px 8px;font-weight:bold;">CBAM cert (tham chiếu Q1/26)</td>
      <td style="border:1px solid #ccc;padding:6px 8px;font-weight:bold;">${state.prices.cbam}</td>
      <td style="border:1px solid #ccc;padding:6px 8px;color:#555;">${state.prices.cbamChange}</td>
      <td style="border:1px solid #ccc;padding:6px 8px;">${state.prices.cbamNote}</td>
    </tr>
  </table>
  
  <div style="background:#E6F2EA;font-weight:bold;color:#14532D;padding:5px 10px;margin:16px 0 8px;font-size:14px;">QUỐC TẾ</div>
  <ul style="margin:0;padding-left:20px;font-size:13.5px;line-height:1.5;">
${intlNewsHtml}
  </ul>

  <div style="background:#E6F2EA;font-weight:bold;color:#14532D;padding:5px 10px;margin:14px 0 8px;font-size:14px;">VIỆT NAM</div>
  <ul style="margin:0;padding-left:20px;font-size:13.5px;line-height:1.5;">
${vnNewsHtml}
  </ul>

  <!-- ===== PHẦN 2 ===== -->
  <h2 style="font-size:17px;color:#14532D;border-bottom:3px solid #14532D;padding-bottom:5px;margin:24px 0 12px;">PHẦN 2 — NHẬN ĐỊNH &amp; KHUYẾN NGHỊ GIAO DỊCH</h2>

  <div style="${signalClassStyle}">
    <div style="font-size:20px;font-weight:bold;letter-spacing:.5px;">${signalText}</div>
    <div style="font-size:13px;color:#E6F2EA;margin-top:3px;">${state.signalDesc}</div>
  </div>

  <div style="background:#EAF1FB;font-weight:bold;color:#14532D;padding:5px 10px;margin:14px 0 8px;font-size:14px;">Bảng tín hiệu nhanh</div>
  <table style="border-collapse:collapse;width:100%;font-size:13px;">
    <tr><td style="border:1px solid #ccc;padding:6px 8px;background:#f2f2f2;font-weight:bold;width:34%;">Xu hướng NGẮN HẠN</td><td style="border:1px solid #ccc;padding:6px 8px;color:#555;font-weight:bold;">${state.signalTable.trendShort}</td></tr>
    <tr><td style="border:1px solid #ccc;padding:6px 8px;background:#f2f2f2;font-weight:bold;">Xu hướng TRUNG HẠN</td><td style="border:1px solid #ccc;padding:6px 8px;background:#E8F5EC;color:#1E7A46;font-weight:bold;">${state.signalTable.trendMid}</td></tr>
    <tr><td style="border:1px solid #ccc;padding:6px 8px;background:#f2f2f2;font-weight:bold;">KHUYẾN NGHỊ VỊ THẾ</td><td style="border:1px solid #ccc;padding:6px 8px;background:#E8F5EC;color:#1E7A46;font-weight:bold;">${state.signalTable.position}</td></tr>
    <tr><td style="border:1px solid #ccc;padding:6px 8px;background:#f2f2f2;font-weight:bold;">Vùng MUA (entry)</td><td style="border:1px solid #ccc;padding:6px 8px;color:#14532D;font-weight:bold;">${state.signalTable.buyZone}</td></tr>
    <tr><td style="border:1px solid #ccc;padding:6px 8px;background:#f2f2f2;font-weight:bold;">Hỗ trợ / Kháng cự</td><td style="border:1px solid #ccc;padding:6px 8px;font-weight:bold;">${state.signalTable.supportResist}</td></tr>
    <tr><td style="border:1px solid #ccc;padding:6px 8px;background:#f2f2f2;font-weight:bold;">CẮT LỖ (stop-loss)</td><td style="border:1px solid #ccc;padding:6px 8px;background:#FDECEA;color:#C0392B;font-weight:bold;">${state.signalTable.stopLoss}</td></tr>
    <tr><td style="border:1px solid #ccc;padding:6px 8px;background:#f2f2f2;font-weight:bold;">Mục tiêu trung hạn</td><td style="border:1px solid #ccc;padding:6px 8px;color:#14532D;font-weight:bold;">${state.signalTable.targetMid}</td></tr>
    <tr><td style="border:1px solid #ccc;padding:6px 8px;background:#f2f2f2;font-weight:bold;">Độ tin cậy tín hiệu</td><td style="border:1px solid #ccc;padding:6px 8px;background:#FCF3E2;color:#B7791F;font-weight:bold;">${state.signalTable.trust}</td></tr>
  </table>

  <div style="background:#EAF1FB;font-weight:bold;color:#14532D;padding:5px 10px;margin:14px 0 8px;font-size:14px;">Động lực thị trường</div>
  <table style="border-collapse:collapse;width:100%;font-size:13px;">
    <tr>
      <th style="border:1px solid #ccc;padding:6px 8px;background:#1E7A46;color:#fff;width:50%;text-align:left;">▲ ĐỘNG LỰC TĂNG GIÁ</th>
      <th style="border:1px solid #ccc;padding:6px 8px;background:#C0392B;color:#fff;width:50%;text-align:left;">▼ ÁP LỰC GIẢM GIÁ</th>
    </tr>
    <tr>
      <td style="border:1px solid #ccc;padding:8px;background:#E8F5EC;vertical-align:top;">${driversUpHtml}</td>
      <td style="border:1px solid #ccc;padding:8px;background:#FDECEA;vertical-align:top;">${driversDownHtml}</td>
    </tr>
  </table>

  <div style="background:#EAF1FB;font-weight:bold;color:#14532D;padding:5px 10px;margin:14px 0 8px;font-size:14px;">Kịch bản &amp; hành động</div>
  <table style="border-collapse:collapse;width:100%;font-size:13px;">
    <tr>
      <th style="border:1px solid #ccc;padding:6px 8px;background:#14532D;color:#fff;width:38%;text-align:left;">KỊCH BẢN GIÁ</th>
      <th style="border:1px solid #ccc;padding:6px 8px;background:#14532D;color:#fff;text-align:left;">HÀNH ĐỘNG</th>
    </tr>
    <tr>
      <td style="border:1px solid #ccc;padding:6px 8px;background:#FCF3E2;color:#B7791F;font-weight:bold;">75–80 € (cơ sở)</td>
      <td style="border:1px solid #ccc;padding:6px 8px;">${state.scenarios.base}</td>
    </tr>
    <tr>
      <td style="border:1px solid #ccc;padding:6px 8px;background:#E8F5EC;color:#1E7A46;font-weight:bold;">&gt; 80 € + ETS thắt chặt/MSR mạnh</td>
      <td style="border:1px solid #ccc;padding:6px 8px;">${state.scenarios.up}</td>
    </tr>
    <tr>
      <td style="border:1px solid #ccc;padding:6px 8px;background:#FDECEA;color:#C0392B;font-weight:bold;">&lt; 74 € + EC nới lỏng mạnh</td>
      <td style="border:1px solid #ccc;padding:6px 8px;">${state.scenarios.down}</td>
    </tr>
  </table>

  <div style="background:#EAF1FB;font-weight:bold;color:#14532D;padding:5px 10px;margin:14px 0 8px;font-size:14px;">Chiến thuật giao dịch (mua/bán)</div>
  <ul style="margin:0;padding-left:20px;font-size:13.5px;line-height:1.55;list-style:none;">
    <li style="margin-bottom:6px;"><b style="color:#14532D;">➤ Lệnh đang mở (đang nắm giữ tín chỉ):</b> ${state.tactics.open}</li>
    <li style="margin-bottom:6px;"><b style="color:#14532D;">➤ Mở lệnh mới:</b> ${state.tactics.new}</li>
    <li style="margin-bottom:6px;"><b style="color:#14532D;">➤ Quản trị rủi ro:</b> ${state.tactics.risk}</li>
    <li style="margin-bottom:6px;"><b style="color:#14532D;">➤ Tin chờ làm rõ:</b> ${state.tactics.pending}</li>
  </ul>

  <div style="background:#EAF1FB;font-weight:bold;color:#14532D;padding:5px 10px;margin:14px 0 8px;font-size:14px;">Lịch tin cần theo dõi (catalysts)</div>
  <ul style="margin:0;padding-left:20px;font-size:13.5px;line-height:1.5;">
${catalystsHtml}
  </ul>

  <div style="background:#EAF1FB;font-weight:bold;color:#14532D;padding:5px 10px;margin:14px 0 8px;font-size:14px;">Gợi ý kinh doanh / giải pháp</div>
  <ul style="margin:0;padding-left:20px;font-size:13.5px;line-height:1.5;">
${solutionsHtml}
  </ul>
  <div style="border-top:1px solid #ccc;margin-top:12px;padding-top:6px;font-size:11px;color:#777;"><b>Lưu ý:</b> Nhận định dựa trên các nguồn dẫn trong báo cáo, KHÔNG phải khuyến nghị đầu tư. Quyết định giao dịch thuộc về người sử dụng.</div>

  <!-- ===== PHẦN 3 ===== -->
  <h2 style="font-size:17px;color:#1E7A46;border-bottom:3px solid #1E7A46;padding-bottom:5px;margin:24px 0 12px;">PHẦN 3 — CHI TIẾT CÁC TIN TỨC CHÍNH</h2>

  <div style="background:#E6F2EA;font-weight:bold;color:#14532D;padding:5px 10px;margin:6px 0 8px;font-size:14px;">I. TIN TỨC QUỐC TẾ</div>
${intlDetailsHtml}

  <div style="background:#E6F2EA;font-weight:bold;color:#14532D;padding:5px 10px;margin:16px 0 8px;font-size:14px;">II. TIN TỨC VIỆT NAM</div>
${vnDetailsHtml}

  <!-- ===== REFERENCES ===== -->
  <h2 style="font-size:15px;color:#1E7A46;border-bottom:2px solid #1E7A46;padding-bottom:4px;margin:22px 0 8px;">DANH MỤC NGUỒN THAM KHẢO</h2>
  <ol style="margin:0;padding-left:22px;font-size:12.5px;line-height:1.6;color:#1E7A46;">
${referencesHtml}
  </ol>

  </div>
  <div style="background:#14532D;color:#C8E6D4;text-align:center;padding:10px;font-size:11px;">STAVIAN INDUSTRIAL METAL — Phòng CLPT, Team KD TCCB  |  Tin tức hàng ngày thị trường Carbon — ${dispDate}</div>

</div>
</body>
</html>`;
}

// --- PREVIEW UPDATE ---
function updateLivePreview() {
  const htmlContent = buildReportHtml();
  
  // Set Iframe Contents
  const iframeDoc = elements.previewIframe.contentWindow.document;
  iframeDoc.open();
  iframeDoc.write(htmlContent);
  iframeDoc.close();
  
  // Update Preview Subject line
  const dispDate = getFormattedDisplayDate(state.date);
  elements.previewSubject.textContent = `Tin tức thị trường Carbon - ${dispDate}`;
}

// --- EXPORT FUNCTIONALITIES ---
function downloadReportHtml() {
  const htmlContent = buildReportHtml();
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
  
  // Create filename containing report date
  const parts = state.date.split('-');
  const formattedFilenameDate = `${parts[2]}-${parts[1]}-${parts[0]}`; // DD-MM-YYYY
  const filename = `Tin tức thị trường Carbon ${formattedFilenameDate}.html`;
  
  // Download Link trigger
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast(`Đã tải về báo cáo: ${filename}`);
  }
}

function copyReportHtml() {
  const htmlContent = buildReportHtml();
  
  navigator.clipboard.writeText(htmlContent)
    .then(() => {
      showToast('Đã sao chép toàn bộ mã HTML vào Clipboard!');
    })
    .catch(err => {
      showToast('Lỗi khi sao chép mã HTML!');
      console.error(err);
    });
}

// --- NOTIFICATION TOAST ---
let toastTimeout;
function showToast(message) {
  elements.toastMsg.textContent = message;
  elements.toast.classList.add('show');
  
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    elements.toast.classList.remove('show');
  }, 3500);
}

// --- ACCORDION ACCESSIBILITY ---
function toggleCard(headerElement) {
  const card = headerElement.closest('.config-card');
  card.classList.toggle('closed');
}

// Start app on DOM load
window.addEventListener('DOMContentLoaded', init);

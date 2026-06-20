/**
 * The GoldFinch i18n string table (design-spec shell.md section 8, from
 * design/prototype/i18n.jsx). Two languages exactly: 'en' and 'ko'.
 *
 * Mechanism (kept from the prototype): keys ARE the English source strings.
 * Rendering in English is the key itself; rendering in Korean is the value
 * in this table. Typing t() to I18nKey makes "string added without a Korean
 * translation" a compile error, so translation coverage is enforced by tsc.
 *
 * Deliberately NOT in this table (shell.md 8.5 annotations):
 * - [PARAM] rows (month/date/name/count-templated sentences such as
 *   "June spending", "Good morning, Alex", "6 months"): Korean word order and
 *   particles make concatenation untranslatable, so they ship as typed pure
 *   functions in ./messages.ts and locale-aware date formatting in
 *   app/src/lib/dates.ts -- never as literal keys.
 * - [DATA] rows (category names, goal names, linked-account names): payees,
 *   account names, and user-created category/goal names are API data and
 *   render verbatim. t() is NEVER applied to API data.
 *
 * The last block ("keys introduced by the design spec") is not in the
 * prototype table; the Korean copy there is proposed and flagged for
 * native-speaker review before release. 'English' / '한국어' render in their
 * own language by convention -- language pickers do not translate language
 * names.
 */
export const ko = {
  // Tabs
  Home: '홈',
  Activity: '활동',
  Budget: '예산',
  Investments: '투자',
  Reports: '리포트',
  More: '더보기',

  // Titles / nav
  Dashboard: '대시보드',
  Transactions: '거래내역',
  Goals: '목표',
  Recurring: '정기결제',
  Rules: '규칙',
  Import: '가져오기',
  Settings: '설정',

  // Dashboard
  'Net worth': '순자산',
  Assets: '자산',
  Liabilities: '부채',
  Accounts: '계좌',
  Bank: '은행',
  Type: '유형',
  'Upcoming bills': '예정된 청구',
  'Recent activity': '최근 활동',
  'See all': '전체 보기',
  All: '전체',

  // Transactions
  'Search payees': '가맹점 검색',
  Income: '수입',
  Expenses: '지출',
  Transfers: '이체',
  'All categories': '전체 카테고리',
  Pending: '대기 중',
  'No transactions match.': '일치하는 거래가 없습니다.',
  Today: '오늘',
  Yesterday: '어제',
  Transfer: '이체',
  Uncategorized: '미분류',
  Suggested: '추천',
  PENDING: '대기 중',
  // Date-scope control (P11-5): Activity filter + dashboard spending toggle.
  Week: '주',
  Month: '월',
  Year: '년',
  Custom: '사용자 지정',
  'This week': '이번 주',
  'This month': '이번 달',

  // Budget date-range presets (budget-range feature, Section 9.2). 'This week'
  // / 'This month' / 'Custom' are reused above; these are the new preset labels
  // + the chooser title. Korean copy proposed, flagged for native review.
  'Last month': '지난달',
  'Last 30 days': '최근 30일',
  'Last 90 days': '최근 90일',
  'This quarter': '이번 분기',
  'Year to date': '연초부터 현재까지',
  'Date range': '기간 선택',

  // Budget
  'Cash flow': '현금 흐름',
  Categories: '카테고리',
  Budgeted: '예산',
  Left: '남음',
  Over: '초과',
  'Income vs spending': '수입 대비 지출',
  'Avg income': '평균 수입',
  'Avg spending': '평균 지출',
  'Net saved': '순저축',
  Spending: '지출',

  // Reports
  'Net worth trend': '순자산 추이',
  'Monthly trends': '월별 추이',
  'Income / Spend': '수입 / 지출',
  'Total income': '총수입',
  'Total spent': '총지출',
  Saved: '저축',
  in: '수입',
  YTD: '연초 대비',

  // Goals
  'Add funds': '자금 추가',
  'New goal': '새 목표',
  Manual: '직접 입력',
  ETA: '예상',
  Contribution: '납입액',
  'Confirm contribution': '납입 확정',

  // Recurring
  Upcoming: '예정',
  Bills: '청구',
  Confirm: '확인',
  Ignore: '무시',
  Weekly: '매주',
  Biweekly: '격주',
  Monthly: '매월',
  Yearly: '매년',

  // More hub
  'Savings targets & projections': '저축 목표 및 예측',
  'Bills, subscriptions & income': '청구·구독·수입',
  'Auto-categorize transactions': '거래 자동 분류',
  'Bring in CSV statements': 'CSV 명세서 가져오기',
  'Accounts, security, profile': '계좌·보안·프로필',
  Version: '버전',

  // Sheets / buttons
  Transaction: '거래 상세',
  'Edit budget': '예산 편집',
  Add: '추가',
  'Save changes': '변경사항 저장',
  Cancel: '취소',
  'Save budget': '예산 저장',
  Category: '카테고리',
  Note: '메모',
  'Add a note': '메모 추가',
  'Note saved': '메모 저장됨',
  'Note cleared': '메모 삭제됨',
  Date: '날짜',
  Account: '계좌',
  Status: '상태',
  Posted: '완료',
  'Monthly limit': '월 한도',
  Period: '기간',
  'Roll over leftovers': '잔액 이월',
  'Unspent funds carry to next month': '남은 금액을 다음 달로 이월',
  'Save & teach GoldFinch': '저장하고 학습시키기',
  'GoldFinch suggests': 'GoldFinch 추천',
  'Learned from this merchant name': '가맹점 이름으로 학습됨',
  'GoldFinch learned a rule': 'GoldFinch가 규칙을 학습했어요',
  'Add transaction': '거래 추가',
  'Log a manual expense or income': '지출·수입 직접 입력',
  'Start saving toward something': '새로운 저축 시작',
  'Add recurring bill': '정기 청구 추가',
  'Track a subscription or bill': '구독·청구 추적',
  'Link account': '계좌 연결',
  'Connect a bank via SimpleFIN': 'SimpleFIN으로 은행 연결',
  'Import CSV': 'CSV 가져오기',
  'Bring in statement history': '명세서 내역 가져오기',

  // Rules (the three-part explainer sentence and the per-rule counters are
  // [PARAM]: see rulesExplainer / taggedCount / categorizedAs in messages.ts)
  'No rules yet — categorize a transaction to teach one.':
    '아직 규칙이 없습니다 — 거래를 분류해 학습시켜 보세요.',
  LEARNED: '학습됨',

  // Misc / dynamic labels
  'All activity': '전체 거래',
  Overdue: '연체',
  'Due today': '오늘 마감',
  Tomorrow: '내일',
  Spent: '지출',
  Finish: '완료',
  Review: '검토',

  // Keys introduced by the design spec (settings surfaces; ko proposed,
  // flagged for native-speaker review before release)
  Appearance: '테마',
  Theme: '테마 스타일',
  Mode: '모드',
  System: '시스템',
  Light: '라이트',
  Dark: '다크',
  Language: '언어',
  'System default': '시스템 기본값',
  English: 'English',
  Korean: '한국어',
  Security: '보안',
  // Motion kill switch (PHASE9-DECISIONS P9-3; ko proposed, flagged for
  // native-speaker review before release).
  'Reduce animations': '애니메이션 줄이기',
  // Privacy (amount masking; ko proposed, flagged for native-speaker review).
  Privacy: '개인정보 보호',
  'Open with amounts hidden': '금액을 숨긴 채로 열기',
  'Mask balances until you tap the eye on the dashboard':
    '대시보드에서 눈 아이콘을 누를 때까지 잔액을 가립니다',
  'Hide amounts': '금액 숨기기',
  'Show amounts': '금액 표시',
  // Home-screen widget privacy toggle (separate from the per-session eye;
  // ko proposed, flagged for native-speaker review before release).
  'Show amounts on widget': '위젯에 금액 표시',
  'Display spending totals on the home screen widget':
    '홈 화면 위젯에 지출 합계를 표시합니다',
  'Require Face ID / biometric unlock': 'Face ID·생체 인증 잠금 사용',
  'Sign out': '로그아웃',
  'Signing out': '로그아웃 중',
  Close: '닫기',

  // Profile / display name (settings section + greeting source; ko proposed,
  // flagged for native-speaker review before release). The length-bounds
  // validation message is [PARAM] (displayNameLengthError in messages.ts).
  Profile: '프로필',
  'Display name': '표시 이름',
  'Edit name': '이름 편집',
  'Save name': '이름 저장',
  'Shown in your dashboard greeting': '대시보드 인사말에 표시됩니다',
  'Could not save your name': '이름을 저장하지 못했습니다',

  // Category icon + color picker (Phase 10; ko proposed, flagged for
  // native-speaker review before release).
  Icon: '아이콘',
  Color: '색상',
  Search: '검색',
  'Search icons': '아이콘 검색',
  // Bank-data freshness (dashboard; ko proposed, flagged for review).
  'Bank data': '은행 데이터',
  'Sync now': '지금 동기화',
  Syncing: '동기화 중',
  'refresh in SimpleFIN': 'SimpleFIN에서 새로고침',
  '(banks can lag a few days)': '(은행 반영은 며칠 걸릴 수 있어요)',
} as const satisfies Record<string, string>;

/** Every translatable UI string; keys are the English source strings. */
export type I18nKey = keyof typeof ko;

/** A concrete rendering language. */
export type Lang = 'en' | 'ko';

/** The persisted user preference: follow the device, or force a language. */
export type LanguageSetting = 'system' | Lang;

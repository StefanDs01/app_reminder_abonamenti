(() => {
  'use strict';

  // --- STORAGE KEYS ---
  const STORAGE_KEYS = {
    AUTH_SESSION: 'scadenzapp_auth_session_v2',
    LOCAL_USERS_DB: 'scadenzapp_local_users_v2',
    LANG: 'scadenzapp_lang_v1',
    CURRENCY: 'scadenzapp_currency_v1',
    THEME: 'scadenzapp_theme_v2',
    NOTIFIED_LOG: 'scadenzapp_notified_log_v1'
  };

  // --- APPLICATION STATE ---
  let state = {
    isAuthenticated: false,
    authMode: 'login', // 'login' | 'register'
    user: {
      username: '',
      displayName: '',
      password: ''
    },
    lang: 'it', // 'it' | 'ro'
    mainCurrency: 'EUR', // 'EUR' | 'RON'
    items: [],
    history: [],
    gmailStatus: { enabled: false, email: '', lastScanAt: '' },
    currentView: 'list', // 'list' | 'calendar' | 'history'
    currentFilter: 'all',
    catalogCategory: 'all',
    searchQuery: '',
    sortBy: 'dueDateAsc',
    calendarDate: new Date()
  };

  let swRegistration = null;
  let deferredInstallPrompt = null;

  // --- I18N HELPER ---
  function t(key) {
    const dict = (window.I18N && window.I18N[state.lang]) || window.I18N.it;
    return dict[key] || window.I18N.it[key] || key;
  }

  // --- DATE & CURRENCY HELPERS ---
  function getTodayMidnight() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function parseLocalDate(dateStr) {
    if (!dateStr) return getTodayMidnight();
    const parts = dateStr.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function formatDateInput(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function addDays(dateObj, days) {
    const d = new Date(dateObj);
    d.setDate(d.getDate() + days);
    return d;
  }

  function addMonthsKeepDay(dateStr, monthsToAdd) {
    const d = parseLocalDate(dateStr);
    const targetMonth = d.getMonth() + monthsToAdd;
    const day = d.getDate();
    const result = new Date(d.getFullYear(), targetMonth, 1);
    const maxDaysInTarget = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(day, maxDaysInTarget));
    return formatDateInput(result);
  }

  function getDaysRemaining(nextDateStr) {
    const today = getTodayMidnight();
    const target = parseLocalDate(nextDateStr);
    const diffMs = target.getTime() - today.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
  }

  function formatLocalizedDate(dateStr) {
    if (!dateStr) return '-';
    const d = parseLocalDate(dateStr);
    const locale = state.lang === 'ro' ? 'ro-RO' : 'it-IT';
    return d.toLocaleDateString(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  function formatCurrency(val, currencyCode = null) {
    const num = Number(val) || 0;
    const curr = (currencyCode || state.mainCurrency || 'EUR').toUpperCase();
    const locale = curr === 'RON' || state.lang === 'ro' ? 'ro-RO' : 'it-IT';
    return num.toLocaleString(locale, {
      style: 'currency',
      currency: curr
    });
  }

  function convertAmount(amount, fromCurrency, toCurrency) {
    const val = Number(amount) || 0;
    const from = (fromCurrency || 'EUR').toUpperCase();
    const to = (toCurrency || state.mainCurrency || 'EUR').toUpperCase();
    if (from === to) return val;
    const rates = window.CURRENCY_RATES || { EUR_TO_RON: 4.97, RON_TO_EUR: 1 / 4.97 };
    if (from === 'EUR' && to === 'RON') return val * rates.EUR_TO_RON;
    if (from === 'RON' && to === 'EUR') return val * rates.RON_TO_EUR;
    return val;
  }

  function generateId() {
    return 'item_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
  }

  // --- AUTHENTICATION (LOGIN / REGISTER ON VPS + LOCAL CACHE) ---
  function loadPreferencesAndCheckSession() {
    const savedLang = localStorage.getItem(STORAGE_KEYS.LANG);
    const savedCurr = localStorage.getItem(STORAGE_KEYS.CURRENCY);
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);

    if (savedLang === 'it' || savedLang === 'ro') state.lang = savedLang;
    if (savedCurr === 'EUR' || savedCurr === 'RON') state.mainCurrency = savedCurr;
    const effectiveTheme = savedTheme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', effectiveTheme);
    updateThemeButtonIcon(effectiveTheme);

    applyStaticTranslations();

    try {
      const savedSession = localStorage.getItem(STORAGE_KEYS.AUTH_SESSION);
      if (savedSession) {
        const parsed = JSON.parse(savedSession);
        if (parsed && parsed.username && parsed.password) {
          state.user = parsed;
          performAuthRequest('login', parsed.username, parsed.password, true);
          return;
        }
      }
    } catch (_) {}

    showAuthScreen();
  }

  function showAuthScreen() {
    state.isAuthenticated = false;
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('appScreen').classList.add('hidden');
    applyStaticTranslations();
  }

  function showAppScreen() {
    state.isAuthenticated = true;
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');

    const disp = state.user.displayName || state.user.username || 'Utente';
    document.getElementById('loggedUsernameDisplay').textContent = disp;
    document.getElementById('userAvatarInitial').textContent = disp.charAt(0).toUpperCase();

    renderAll();
    checkAndSendDueNotifications(false);
  }

  async function performAuthRequest(mode, rawUsername, password, isAutoLogin = false) {
    const errEl = document.getElementById('authErrorMsg');
    const submitBtn = document.getElementById('btnAuthSubmit');
    if (errEl) errEl.classList.add('hidden');

    const username = rawUsername.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    if (username.length < 2 || password.length < 3) {
      if (errEl) {
        errEl.textContent =
          state.lang === 'ro'
            ? '⚠️ Numele (min 2 caractere) și parola (min 3 caractere) sunt obligatorii.'
            : '⚠️ Inserisci uno username (min 2 caratteri) e una password (min 3 caratteri).';
        errEl.classList.remove('hidden');
      }
      return;
    }

    if (submitBtn && !isAutoLogin) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳...';
    }

    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: rawUsername.trim(),
          password,
          lang: state.lang,
          mainCurrency: state.mainCurrency
        })
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Errore autenticazione (${res.status})`);
      }

      // Login o Registrazione sul server VPS riusciti!
      state.user = {
        username: data.username,
        displayName: data.displayName || rawUsername.trim(),
        password
      };
      state.items = Array.isArray(data.items) ? data.items : [];
      state.history = Array.isArray(data.history) ? data.history : [];
      if (data.gmailStatus) state.gmailStatus = data.gmailStatus;
      if (data.lang === 'it' || data.lang === 'ro') state.lang = data.lang;
      if (data.mainCurrency === 'EUR' || data.mainCurrency === 'RON') state.mainCurrency = data.mainCurrency;

      localStorage.setItem(STORAGE_KEYS.AUTH_SESSION, JSON.stringify(state.user));
      saveUserCacheLocally();
      showAppScreen();

      if (!isAutoLogin) {
        showToast(
          mode === 'register'
            ? state.lang === 'ro'
              ? `🎉 Contul "${state.user.displayName}" a fost creat!`
              : `🎉 Account "${state.user.displayName}" creato! Ora collega i tuoi veri abbonamenti.`
            : state.lang === 'ro'
            ? `👋 Bine ai revenit, ${state.user.displayName}!`
            : `👋 Bentornato/a, ${state.user.displayName}!`
        );
      }
    } catch (err) {
      // Se l'errore è 401/404/409 dal server (es. password errata o utente non registrato), mostriamolo chiaramente!
      if (
        err.message.includes('Password') ||
        err.message.includes('Utente non trovato') ||
        err.message.includes('esiste già') ||
        err.message.includes('PIN')
      ) {
        if (isAutoLogin) {
          localStorage.removeItem(STORAGE_KEYS.AUTH_SESSION);
          showAuthScreen();
        }
        if (errEl) {
          errEl.textContent = `❌ ${err.message}`;
          errEl.classList.remove('hidden');
        }
      } else {
        // Fallback locale se il server non risponde (es. apertura file offline)
        handleOfflineLocalAuth(mode, username, rawUsername.trim(), password, errEl, isAutoLogin);
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = state.authMode === 'register' ? t('btnRegisterSubmit') : t('btnLoginSubmit');
      }
    }
  }

  function handleOfflineLocalAuth(mode, username, displayName, password, errEl, isAutoLogin) {
    let localDb = {};
    try {
      localDb = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOCAL_USERS_DB) || '{}');
    } catch (_) {
      localDb = {};
    }

    if (mode === 'register') {
      if (localDb[username]) {
        if (errEl) {
          errEl.textContent = '❌ Questo username esiste già! Passa alla scheda "Accedi".';
          errEl.classList.remove('hidden');
        }
        return;
      }
      localDb[username] = {
        username,
        displayName,
        password,
        lang: state.lang,
        mainCurrency: state.mainCurrency,
        items: [],
        history: []
      };
      localStorage.setItem(STORAGE_KEYS.LOCAL_USERS_DB, JSON.stringify(localDb));
    } else {
      if (!localDb[username]) {
        if (isAutoLogin) {
          showAuthScreen();
          return;
        }
        if (errEl) {
          errEl.textContent = '❌ Utente non trovato. Clicca su "✨ Crea Account" per registrarti!';
          errEl.classList.remove('hidden');
        }
        return;
      }
      if (localDb[username].password !== password) {
        if (errEl) {
          errEl.textContent = '❌ Password non corretta!';
          errEl.classList.remove('hidden');
        }
        return;
      }
    }

    const userRecord = localDb[username];
    state.user = { username, displayName: userRecord.displayName || displayName, password };
    state.items = userRecord.items || [];
    state.history = userRecord.history || [];
    localStorage.setItem(STORAGE_KEYS.AUTH_SESSION, JSON.stringify(state.user));
    showAppScreen();
  }

  function saveUserCacheLocally() {
    if (!state.user.username) return;
    let localDb = {};
    try {
      localDb = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOCAL_USERS_DB) || '{}');
    } catch (_) {
      localDb = {};
    }
    localDb[state.user.username] = {
      username: state.user.username,
      displayName: state.user.displayName,
      password: state.user.password,
      lang: state.lang,
      mainCurrency: state.mainCurrency,
      items: state.items,
      history: state.history
    };
    localStorage.setItem(STORAGE_KEYS.LOCAL_USERS_DB, JSON.stringify(localDb));
  }

  async function saveUserDataAndSync() {
    localStorage.setItem(STORAGE_KEYS.LANG, state.lang);
    localStorage.setItem(STORAGE_KEYS.CURRENCY, state.mainCurrency);
    saveUserCacheLocally();

    if (!state.isAuthenticated || !state.user.username || !state.user.password) return;

    try {
      await fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: state.user.username,
          displayName: state.user.displayName,
          password: state.user.password,
          pin: state.user.password,
          lang: state.lang,
          mainCurrency: state.mainCurrency,
          items: state.items,
          history: state.history
        })
      });
    } catch (_) {
      // Salvato nella cache locale dell'utente, sincronizzerà alla prossima connessione
    }
  }

  function handleLogout() {
    localStorage.removeItem(STORAGE_KEYS.AUTH_SESSION);
    state.isAuthenticated = false;
    state.user = { username: '', displayName: '', password: '' };
    state.items = [];
    state.history = [];
    document.getElementById('authForm').reset();
    showAuthScreen();
  }

  // --- URGENCY & FINANCIAL CALCULATIONS ---
  function isItemUrgent(item) {
    if (item.status !== 'active') return false;
    const days = getDaysRemaining(item.nextDate);
    if (days <= item.remindDaysBefore) return true;
    if (item.cancelBeforeRenewal && days <= Math.max(item.remindDaysBefore, 10)) return true;
    return false;
  }

  function getMonthlyEquivalentInMainCurrency(item) {
    const priceInMain = convertAmount(item.price, item.currency || 'EUR', state.mainCurrency);
    const cycleInfo = window.BILLING_CYCLES[item.billingCycle];
    if (!cycleInfo || cycleInfo.months === 0) return priceInMain;
    return priceInMain / cycleInfo.months;
  }

  function getYearlyEquivalentInMainCurrency(item) {
    const priceInMain = convertAmount(item.price, item.currency || 'EUR', state.mainCurrency);
    const cycleInfo = window.BILLING_CYCLES[item.billingCycle];
    if (!cycleInfo || cycleInfo.months === 0) return priceInMain;
    return (priceInMain * 12) / cycleInfo.months;
  }

  // --- APPLY STATIC TRANSLATIONS ---
  function applyStaticTranslations() {
    document.documentElement.lang = state.lang;

    const btnLang = document.getElementById('btnLangToggle');
    if (btnLang) btnLang.textContent = state.lang === 'ro' ? '🇷🇴 RO' : '🇮🇹 IT';

    const btnAuthLang = document.getElementById('btnAuthLangToggle');
    if (btnAuthLang) {
      btnAuthLang.textContent = state.lang === 'ro' ? '🇷🇴 Română (RON / EUR)' : '🇮🇹 Italiano (EUR / RON)';
    }

    const btnCurr = document.getElementById('btnCurrencyToggle');
    if (btnCurr) btnCurr.textContent = state.mainCurrency === 'RON' ? '🇷🇴 RON' : '💶 EUR';

    const mapIds = {
      txtAuthWelcomeSub: 'authWelcomeSub',
      tabBtnLogin: 'tabLogin',
      tabBtnRegister: 'tabRegister',
      txtLabelUsername: 'labelUsername',
      txtLabelPassword: 'labelPassword',
      txtAuthFooterNote: 'authFooterNote',
      btnAuthDownloadApp: 'downloadAppBtn',
      txtDownloadAppBtn: 'downloadAppBtn',
      txtLogoutBtn: 'logoutBtn',
      txtHeroGreeting: 'heroGreeting',
      txtHeroMonthlyTitle: 'heroMonthlyTitle',
      txtKpiUrgentLabel: 'kpiUrgentLabel',
      txtKpiBillsLabel: 'kpiBillsLabel',
      txtKpiSavedLabel: 'kpiSavedLabel',
      btnTriggerBrowserNotif: 'btnTestNotif',
      txtMyActiveTitle: 'myActiveTitle',
      optSortDueDate: 'sortDueDateAsc',
      optSortCancelFirst: 'sortCancelFirst',
      optSortPriceDesc: 'sortPriceDesc',
      optSortNameAsc: 'sortNameAsc',
      txtFilterAll: 'filterAll',
      txtFilterMustCancel: 'filterMustCancel',
      txtFilterSubs: 'filterSubs',
      txtFilterBills: 'filterBills',
      txtFilterAuto: 'filterAuto',
      txtFilterCancelled: 'filterCancelled',
      txtEmptyTitle: 'emptyMySubsTitle',
      txtEmptyDesc: 'emptyMySubsDesc',
      btnEmptyConnectGmail: 'btnEmptyConnectGmail',
      btnEmptyGoConnect: 'btnGoToConnect',
      btnEmptyAdd: 'btnAddCustom',
      txtGmailTagNew: 'gmailTagNew',
      txtGmailBannerTitle: 'gmailBannerTitle',
      txtGmailBannerDesc: 'gmailBannerDesc',
      btnScanGmailQuick: 'btnScanGmailQuick',
      txtConnectSectionTitle: 'connectSectionTitle',
      txtConnectSectionSub: 'connectSectionSub',
      txtCatTabAll: 'catTabAll',
      txtCatTabStreaming: 'catTabStreaming',
      txtCatTabSoftware: 'catTabSoftware',
      txtCatTabBills: 'catTabBills',
      txtCatTabAuto: 'catTabAuto',
      txtNavMySubsLabel: 'navMySubs',
      txtNavConnect: 'navConnect',
      txtNavCalendar: 'navCalendar',
      txtNavHistoryLabel: 'navHistory',
      btnPrevMonth: 'prevMonth',
      btnNextMonth: 'nextMonth',
      txtHistoryTitle: 'historyTitle',
      txtHistorySubtitle: 'historySubtitle',
      btnExportIcsAll: 'btnExportIcs',
      btnExportJson: 'btnExportJson',
      txtBtnImportJson: 'btnImportJson',
      btnClearHistory: 'clearHistoryBtn',
      txtAutoDetectBoxTitle: 'autoDetectBoxTitle',
      txtAutoDetectStepHelp: 'autoDetectStepHelp',
      btnVerifyOfficialAccount: 'btnOpenSiteAndDetect',
      btnAutoPasteFromPage: 'btnAutoPasteFromPage',
      btnDirectCancelPage: 'btnDirectCancelPage',
      txtChooseRealPlan: 'chooseRealPlan',
      txtTypeSubTitle: 'typeSubTitle',
      txtTypeSubDesc: 'typeSubDesc',
      txtTypeBillTitle: 'typeBillTitle',
      txtTypeBillDesc: 'typeBillDesc',
      txtMustCancelSwitchTitle: 'mustCancelSwitchTitle',
      txtMustCancelSwitchDesc: 'mustCancelSwitchDesc',
      txtLabelName: 'labelName',
      txtLabelAccountEmail: 'labelAccountEmail',
      txtLabelCategory: 'labelCategory',
      txtLabelPrice: 'labelPrice',
      txtLabelCurrency: 'labelCurrency',
      txtLabelCycle: 'labelCycle',
      optCycleMonthly: 'cycleMonthly',
      optCycleBimonthly: 'cycleBimonthly',
      optCycleQuarterly: 'cycleQuarterly',
      optCycleSemiannual: 'cycleSemiannual',
      optCycleYearly: 'cycleYearly',
      optCycleBiennial: 'cycleBiennial',
      optCycleOnce: 'cycleOnce',
      txtLabelRemindDays: 'labelRemindDays',
      optRemind1: 'remind1d',
      optRemind2: 'remind2d',
      optRemind3: 'remind3d',
      optRemind5: 'remind5d',
      optRemind7: 'remind7d',
      optRemind10: 'remind10d',
      optRemind15: 'remind15d',
      optRemind30: 'remind30d',
      txtLabelPaymentMethod: 'labelPaymentMethod',
      optCatStreaming: 'catOptStreaming',
      optCatSoftware: 'catOptSoftware',
      optCatBills: 'catOptBills',
      optCatAuto: 'catOptAuto',
      optCatOther: 'catOptOther',
      txtLabelCancelUrl: 'labelCancelUrl',
      txtLabelNotes: 'labelNotes',
      btnCancelModal: 'btnCancel',
      btnSaveItem: 'btnSave',
      downloadAppModalTitle: 'downloadModalTitle',
      txtDownloadMethod1Title: 'downloadMethod1Title',
      txtDownloadMethod1Desc: 'downloadMethod1Desc',
      btnTriggerNativeInstall: 'btnInstallNowPhone',
      txtDownloadMethod2Title: 'downloadMethod2Title',
      btnDownloadApkFile: 'btnDownloadApkFile',
      gmailModalTitle: 'gmailModalTitle',
      txtGmailModalSec1Title: 'gmailModalSec1Title',
      txtGmailModalSec1Desc: 'gmailModalSec1Desc',
      txtGmailGuideTitle: 'gmailGuideTitle',
      txtGmailGuideStep1: 'gmailGuideStep1',
      txtGmailGuideStep2: 'gmailGuideStep2',
      txtGmailGuideStep3: 'gmailGuideStep3',
      btnGmailGuideLink: 'gmailGuideBtn',
      txtLabelGmailAddress: 'labelGmailAddress',
      txtLabelGmailAppPass: 'labelGmailAppPass',
      btnConnectAndScanGmail: 'btnConnectAndScanGmail',
      btnRescanGmailModal: 'btnRescanGmailModal',
      btnDisconnectGmail: 'btnDisconnectGmail',
      txtGmailModalSec2Title: 'gmailModalSec2Title',
      txtGmailModalSec2Desc: 'gmailModalSec2Desc',
      btnParseReceiptText: 'btnParseReceiptText'
    };

    Object.entries(mapIds).forEach(([elId, tKey]) => {
      const el = document.getElementById(elId);
      if (el) el.textContent = t(tKey);
    });

    const authSubmit = document.getElementById('btnAuthSubmit');
    if (authSubmit) {
      authSubmit.textContent = state.authMode === 'register' ? t('btnRegisterSubmit') : t('btnLoginSubmit');
    }

    const placeholdersMap = {
      authUsername: 'placeholderUsername',
      authPassword: 'placeholderPassword',
      searchInput: 'searchPlaceholder',
      itemAccountEmail: 'placeholderAccountEmail',
      itemPaymentMethod: 'placeholderPaymentMethod',
      itemNotes: 'placeholderNotes',
      inputPasteReceiptText: 'placeholderPasteReceipt'
    };
    Object.entries(placeholdersMap).forEach(([elId, tKey]) => {
      const el = document.getElementById(elId);
      if (el) el.placeholder = t(tKey);
    });

    const weekdaysRow = document.getElementById('calendarWeekdaysRow');
    if (weekdaysRow) {
      const days = t('weekdays');
      weekdaysRow.innerHTML = days.map((d) => `<div>${d}</div>`).join('');
    }
  }

  // --- RENDERING DASHBOARD ---
  function renderAll() {
    applyStaticTranslations();
    renderGmailStatus();
    renderUrgentBanner();
    renderKpis();
    renderCounts();
    renderItemsList();
    renderServiceProposals();
    renderCalendar();
    renderHistory();
  }

  function renderUrgentBanner() {
    const section = document.getElementById('urgentAlertsSection');
    const listEl = document.getElementById('urgentAlertsList');
    const titleEl = document.getElementById('urgentSectionTitle');

    const urgentItems = state.items
      .filter(isItemUrgent)
      .sort((a, b) => getDaysRemaining(a.nextDate) - getDaysRemaining(b.nextDate));

    if (urgentItems.length === 0) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    const mustCancelCount = urgentItems.filter((i) => i.cancelBeforeRenewal).length;

    titleEl.textContent =
      state.lang === 'ro'
        ? mustCancelCount > 0
          ? `🚨 ${urgentItems.length} Alerte (${mustCancelCount} DE ANULAT ca să nu plătești!)`
          : `⚠️ ${urgentItems.length} Scadențe în următoarele zile`
        : mustCancelCount > 0
        ? `🚨 ${urgentItems.length} Avvisi (${mustCancelCount} DA DISDIRE per non pagare!)`
        : `⚠️ ${urgentItems.length} Scadenze imminenti`;

    listEl.innerHTML = urgentItems
      .map((item) => {
        const days = getDaysRemaining(item.nextDate);
        const isBill = item.itemType === 'bill';
        const itemPriceFormatted = formatCurrency(item.price, item.currency || 'EUR');
        const cancelDeadline = formatLocalizedDate(formatDateInput(addDays(parseLocalDate(item.nextDate), -1)));

        let timingText = '';
        if (days < 0) timingText = state.lang === 'ro' ? `Expirat (${Math.abs(days)}z)` : `Scaduto da ${Math.abs(days)} gg`;
        else if (days === 0) timingText = state.lang === 'ro' ? 'SCADENT AZI!' : 'SCADE OGGI!';
        else if (days === 1) timingText = state.lang === 'ro' ? 'Scadent MÂINE!' : 'Scade DOMANI!';
        else timingText = state.lang === 'ro' ? `Peste ${days} zile` : `Tra ${days} giorni`;

        return `
          <div class="urgent-banner-item">
            <div class="urgent-item-top">
              <span>${escapeHtml(item.icon)} ${escapeHtml(item.name)}</span>
              <strong>${itemPriceFormatted}</strong>
            </div>
            <div class="urgent-item-msg">
              <strong>${timingText} (${formatLocalizedDate(item.nextDate)})</strong>
              ${
                item.cancelBeforeRenewal
                  ? `<br/>${t('cancelCalloutPrefix')} <strong>${cancelDeadline}</strong> ${t('cancelCalloutSuffix')}`
                  : ''
              }
            </div>
            <div class="urgent-item-actions">
              ${
                item.cancelBeforeRenewal || item.itemType === 'subscription'
                  ? `<button type="button" class="btn btn-xs btn-danger" data-action="mark-cancelled" data-id="${item.id}">
                       ${t('btnMarkCancelled')}
                     </button>`
                  : ''
              }
              ${
                item.cancelUrl
                  ? `<a href="${escapeAttr(item.cancelUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-outline">
                       ${t('btnManageAccount')}
                     </a>`
                  : ''
              }
              <button type="button" class="btn btn-xs btn-success" data-action="mark-paid" data-id="${item.id}">
                ${isBill ? t('btnMarkPaid') : t('btnMarkRenewed')}
              </button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderKpis() {
    const activeItems = state.items.filter((i) => i.status === 'active');
    const urgentItems = activeItems.filter(isItemUrgent);
    const mustCancelActive = activeItems.filter((i) => i.cancelBeforeRenewal);

    document.getElementById('kpiUrgentCount').textContent = String(urgentItems.length);
    document.getElementById('kpiUrgentSub').textContent =
      mustCancelActive.length > 0
        ? `${mustCancelActive.length} ${state.lang === 'ro' ? 'de anulat' : 'da disdire'}`
        : t('kpiUrgentNone');

    const activeSubs = activeItems.filter((i) => i.itemType === 'subscription');
    const monthlySubsTotal = activeSubs.reduce((acc, item) => acc + getMonthlyEquivalentInMainCurrency(item), 0);
    const yearlySubsTotal = activeSubs.reduce((acc, item) => acc + getYearlyEquivalentInMainCurrency(item), 0);

    document.getElementById('kpiMonthlySubs').textContent = formatCurrency(monthlySubsTotal, state.mainCurrency);
    document.getElementById('kpiYearlySubs').textContent =
      state.lang === 'ro'
        ? `Anual: ${formatCurrency(yearlySubsTotal, state.mainCurrency)} • ${activeSubs.length} abonamente reale active`
        : `Proiezione annua: ${formatCurrency(yearlySubsTotal, state.mainCurrency)} • ${activeSubs.length} abbonamenti reali attivi`;

    const activeBills = activeItems.filter((i) => i.itemType === 'bill');
    const yearlyBillsTotal = activeBills.reduce((acc, item) => acc + getYearlyEquivalentInMainCurrency(item), 0);
    const monthlyBillsAvg = yearlyBillsTotal / 12;

    document.getElementById('kpiYearlyBills').textContent = formatCurrency(yearlyBillsTotal, state.mainCurrency);
    document.getElementById('kpiMonthlyBills').textContent = `${formatCurrency(monthlyBillsAvg, state.mainCurrency)}/m`;

    const cancelledHistory = state.history.filter((h) => h.actionType === 'cancelled_saved');
    const totalSaved = cancelledHistory.reduce(
      (acc, h) => acc + convertAmount(h.amount, h.currency || 'EUR', state.mainCurrency),
      0
    );

    document.getElementById('kpiSavedMoney').textContent = formatCurrency(totalSaved, state.mainCurrency);
    document.getElementById('kpiSavedCount').textContent = `${cancelledHistory.length} OK`;

    // Aggiornamento Barre Verticali Bento (Opzione 2)
    const streamingSpend = activeItems
      .filter((i) => i.category === 'streaming')
      .reduce((acc, i) => acc + getMonthlyEquivalentInMainCurrency(i), 0);
    const billsSpend = activeBills.reduce((acc, i) => acc + getMonthlyEquivalentInMainCurrency(i), 0);
    const otherSpend = activeItems
      .filter((i) => i.category !== 'streaming' && i.itemType !== 'bill')
      .reduce((acc, i) => acc + getMonthlyEquivalentInMainCurrency(i), 0);

    const hasAnySpend = streamingSpend > 0 || billsSpend > 0 || otherSpend > 0;
    const maxSpend = Math.max(streamingSpend, billsSpend, otherSpend, 1);

    const barStreaming = document.getElementById('barFillStreaming');
    const barBills = document.getElementById('barFillBills');
    const barOther = document.getElementById('barFillOther');

    if (barStreaming) {
      barStreaming.style.height = hasAnySpend
        ? `${Math.max(16, Math.min(100, Math.round((streamingSpend / maxSpend) * 100)))}%`
        : '68%';
    }
    if (barBills) {
      barBills.style.height = hasAnySpend
        ? `${Math.max(16, Math.min(100, Math.round((billsSpend / maxSpend) * 100)))}%`
        : '36%';
    }
    if (barOther) {
      barOther.style.height = hasAnySpend
        ? `${Math.max(16, Math.min(100, Math.round((otherSpend / maxSpend) * 100)))}%`
        : '48%';
    }

    const lblStreaming = document.getElementById('lblBarStreaming');
    const lblBills = document.getElementById('lblBarBills');
    const lblOther = document.getElementById('lblBarOther');
    const btnAddSubHero = document.getElementById('txtBtnHeroAddSub');
    if (lblStreaming) lblStreaming.textContent = state.lang === 'ro' ? 'Streaming' : 'Streaming';
    if (lblBills) lblBills.textContent = state.lang === 'ro' ? 'Facturi' : 'Bollette';
    if (lblOther) lblOther.textContent = state.lang === 'ro' ? 'Servicii' : 'Servizi';
    if (btnAddSubHero) btnAddSubHero.textContent = state.lang === 'ro' ? 'Conectează Serviciu' : 'Collega Servizio';
  }

  function renderCounts() {
    const activeCount = state.items.filter((i) => i.status === 'active').length;
    const mustCancelCount = state.items.filter((i) => i.status === 'active' && i.cancelBeforeRenewal).length;
    const elAll = document.getElementById('countAllActive');
    const elMust = document.getElementById('countMustCancel');
    const elHist = document.getElementById('countHistory');
    if (elAll) elAll.textContent = String(activeCount);
    if (elMust) elMust.textContent = String(mustCancelCount);
    if (elHist) elHist.textContent = String(state.history.length);
  }

  // --- RENDER REAL USER SUBSCRIPTIONS ---
  function getFilteredAndSortedItems() {
    let list = [...state.items];

    if (state.currentFilter === 'cancelled') {
      list = list.filter((i) => i.status === 'cancelled');
    } else {
      list = list.filter((i) => i.status === 'active');
      if (state.currentFilter === 'must-cancel') {
        list = list.filter((i) => i.cancelBeforeRenewal);
      } else if (state.currentFilter === 'subscriptions') {
        list = list.filter((i) => i.itemType === 'subscription');
      } else if (state.currentFilter === 'bills') {
        list = list.filter((i) => i.itemType === 'bill' && i.category !== 'auto');
      } else if (state.currentFilter === 'auto') {
        list = list.filter((i) => i.category === 'auto');
      }
    }

    if (state.searchQuery.trim() !== '') {
      const q = state.searchQuery.toLowerCase().trim();
      list = list.filter(
        (i) =>
          (i.name && i.name.toLowerCase().includes(q)) ||
          (i.accountEmail && i.accountEmail.toLowerCase().includes(q)) ||
          (i.notes && i.notes.toLowerCase().includes(q))
      );
    }

    list.sort((a, b) => {
      if (state.sortBy === 'cancelFirst') {
        if (a.cancelBeforeRenewal !== b.cancelBeforeRenewal) return a.cancelBeforeRenewal ? -1 : 1;
        return getDaysRemaining(a.nextDate) - getDaysRemaining(b.nextDate);
      }
      if (state.sortBy === 'priceDesc') {
        return (
          convertAmount(b.price, b.currency || 'EUR', state.mainCurrency) -
          convertAmount(a.price, a.currency || 'EUR', state.mainCurrency)
        );
      }
      if (state.sortBy === 'nameAsc') {
        return (a.name || '').localeCompare(b.name || '', state.lang);
      }
      return getDaysRemaining(a.nextDate) - getDaysRemaining(b.nextDate);
    });

    return list;
  }

  function renderItemsList() {
    const grid = document.getElementById('itemsGrid');
    const emptyState = document.getElementById('emptyState');
    const items = getFilteredAndSortedItems();

    if (items.length === 0) {
      grid.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');

    const radius = 28;
    const circumference = Math.round(2 * Math.PI * radius); // ~176

    grid.innerHTML = items
      .map((item) => {
        const days = getDaysRemaining(item.nextDate);
        const cycleMeta = window.BILLING_CYCLES[item.billingCycle] || {
          label: 'Mensile',
          short: '/mese',
          short_ro: '/lună'
        };
        const isBill = item.itemType === 'bill';
        const isCancelled = item.status === 'cancelled';
        const itemCurrency = item.currency || 'EUR';

        // Calcolo Anello Circolare di Scadenza (Opzione 3) con Colori Opzione 2 (Warm Olive, Honey Gold, Coral Red)
        let ringColor = '#65a30d'; // Warm Olive Green
        let ringTextColor = 'var(--text-main)';
        let ringMainText = '';
        let ringSubText = '';
        let ringPct = 65;

        if (isCancelled) {
          ringColor = '#94a3b8';
          ringPct = 0;
          ringMainText = '✓';
          ringSubText = state.lang === 'ro' ? 'OPRIT' : 'OFF';
        } else if (days < 0) {
          ringColor = '#e11d48';
          ringTextColor = '#e11d48';
          ringPct = 100;
          ringMainText = `-${Math.abs(days)}`;
          ringSubText = state.lang === 'ro' ? 'EXPIRAT' : 'SCADUTO';
        } else if (days === 0) {
          ringColor = '#e11d48';
          ringTextColor = '#e11d48';
          ringPct = 100;
          ringMainText = state.lang === 'ro' ? 'AZI' : 'OGGI';
          ringSubText = '!';
        } else if (days === 1) {
          ringColor = '#e11d48';
          ringTextColor = '#e11d48';
          ringPct = 90;
          ringMainText = '1';
          ringSubText = state.lang === 'ro' ? 'ZI' : 'GIORNO';
        } else {
          ringMainText = String(days);
          ringSubText = state.lang === 'ro' ? 'ZILE' : 'GIORNI';
          if (item.cancelBeforeRenewal || days <= item.remindDaysBefore || days <= 3) {
            ringColor = '#e11d48'; // Coral Red urgente
            ringTextColor = '#e11d48';
            ringPct = Math.max(18, Math.min(95, Math.round((Math.min(days, 30) / 30) * 100)));
          } else if (days <= 10) {
            ringColor = '#d97706'; // Honey Gold attenzione
            ringTextColor = '#d97706';
            ringPct = Math.max(25, Math.min(92, Math.round((Math.min(days, 30) / 30) * 100)));
          } else {
            ringColor = '#65a30d'; // Warm Olive tranquillo
            ringPct = Math.max(30, Math.min(92, Math.round((Math.min(days, 30) / 30) * 100)));
          }
        }

        const dashOffset = Math.round(circumference - (ringPct / 100) * circumference);

        const recommendedCancelDate = formatLocalizedDate(
          formatDateInput(addDays(parseLocalDate(item.nextDate), -Math.max(1, Math.min(item.remindDaysBefore, 3))))
        );

        const cycleShort = state.lang === 'ro' ? cycleMeta.short_ro || cycleMeta.short : cycleMeta.short;
        const renewsLabelText = isCancelled
          ? state.lang === 'ro'
            ? 'Anulat'
            : 'Disdetto'
          : `${isBill ? (state.lang === 'ro' ? 'Scadent' : 'Scade') : (state.lang === 'ro' ? 'Reînnoire' : 'Rinnovo')}: ${formatLocalizedDate(item.nextDate)}`;

        return `
          <article class="sub-card ${item.cancelBeforeRenewal && !isCancelled ? 'must-cancel-card' : ''}" data-card-expand="${item.id}">
            <div class="card-head">
              <div class="card-service-info">
                <div class="service-avatar" style="background: ${escapeAttr(item.color || '#d97706')}">
                  ${escapeHtml(item.icon || '🎬')}
                </div>
                <div class="service-main-meta">
                  <div class="service-title-row">
                    <h3 class="service-title">${escapeHtml(item.name)}</h3>
                    ${
                      isCancelled
                        ? `<span class="tag tag-cancelled">${t('tagCancelled')}</span>`
                        : item.cancelBeforeRenewal
                        ? `<span class="tag tag-must-cancel">${t('tagMustCancel')}</span>`
                        : isBill
                        ? `<span class="tag tag-bill">${t('tagBill')}</span>`
                        : ''
                    }
                  </div>
                  <div class="card-price-inline">
                    <span class="card-price">${formatCurrency(item.price, itemCurrency)}</span>
                    <span class="card-cycle">${escapeHtml(cycleShort)}</span>
                  </div>
                  <div class="card-manage-pill">
                    <span>${state.lang === 'ro' ? 'Gestionează' : 'Gestisci'} ▾</span>
                  </div>
                </div>
              </div>

              <!-- ANELLO CIRCOLARE DI SCADENZA (Opzione 3) -->
              <div class="card-right-col">
                <div class="card-countdown-ring">
                  <svg class="progress-ring-svg" viewBox="0 0 68 68">
                    <circle class="progress-ring-track" cx="34" cy="34" r="28"></circle>
                    <circle class="progress-ring-value" cx="34" cy="34" r="28"
                      stroke="${ringColor}"
                      stroke-dasharray="${circumference}"
                      stroke-dashoffset="${dashOffset}"></circle>
                  </svg>
                  <div class="ring-center-label">
                    <span class="ring-days-num" style="color: ${ringTextColor}">${ringMainText}</span>
                    <span class="ring-days-unit">${ringSubText}</span>
                  </div>
                </div>
                <span class="ring-renews-date">${renewsLabelText}</span>
              </div>
            </div>

            <!-- Cassetto dettagli che si apre toccando la card -->
            <div class="card-expandable-body">
              ${
                item.accountEmail
                  ? `<div class="account-email-badge">👤 ${escapeHtml(item.accountEmail)}</div>`
                  : ''
              }
              <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 8px; display: flex; gap: 12px; flex-wrap: wrap;">
                <span>🔔 ${t('remindBeforeLabel')} ${item.remindDaysBefore} ${t('daysBefore')}</span>
                ${item.paymentMethod ? `<span>💳 ${escapeHtml(item.paymentMethod)}</span>` : ''}
              </div>
              ${
                item.cancelBeforeRenewal && !isCancelled
                  ? `<div class="cancel-limit-callout">
                       ${t('cancelCalloutPrefix')} <strong>${recommendedCancelDate}</strong> ${t('cancelCalloutSuffix')}
                     </div>`
                  : ''
              }
              ${item.notes ? `<div class="card-notes">💡 ${escapeHtml(item.notes)}</div>` : ''}

              <div class="card-footer-actions">
                <div class="card-primary-actions">
                  ${
                    !isCancelled
                      ? `
                        ${
                          item.itemType === 'subscription' || item.cancelBeforeRenewal
                            ? `<button type="button" class="btn btn-xs ${item.cancelBeforeRenewal ? 'btn-danger' : 'btn-outline'}" data-action="mark-cancelled" data-id="${item.id}">
                                 ${t('btnMarkCancelled')}
                               </button>`
                            : ''
                        }
                        <button type="button" class="btn btn-xs btn-success" data-action="mark-paid" data-id="${item.id}">
                          ${isBill ? t('btnMarkPaid') : t('btnMarkRenewed')}
                        </button>
                        ${
                          item.itemType === 'subscription'
                            ? `<button type="button" class="btn btn-xs btn-ghost" data-action="toggle-must-cancel" data-id="${item.id}">
                                 ${item.cancelBeforeRenewal ? t('btnKeepActive') : t('btnWantToCancel')}
                               </button>`
                            : ''
                        }
                      `
                      : `
                        <button type="button" class="btn btn-xs btn-primary" data-action="reactivate" data-id="${item.id}">
                          ${t('btnReactivate')}
                        </button>
                      `
                  }
                </div>

                <div class="card-secondary-actions">
                  ${
                    item.cancelUrl
                      ? `<a href="${escapeAttr(item.cancelUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-outline">${t('btnManageAccount')}</a>`
                      : ''
                  }
                  <button type="button" class="btn btn-xs btn-ghost" data-action="edit" data-id="${item.id}" title="Modifica">✏️</button>
                  <button type="button" class="btn btn-xs btn-ghost text-danger" data-action="delete" data-id="${item.id}" title="Elimina">🗑️</button>
                </div>
              </div>
            </div>
          </article>
        `;
      })
      .join('');
  }

  // --- RENDER SERVICE PROPOSALS ("COLLEGA NETFLIX, DISNEY+...") ---
  let waitingForAutoDetectFromSite = false;

  function renderServiceProposals() {
    const grid = document.getElementById('serviceProposalsGrid');
    if (!grid) return;

    const presets = window.SERVICE_PRESETS.filter(
      (p) =>
        (state.catalogCategory === 'all' || p.category === state.catalogCategory) &&
        (!p.country || p.country === 'all' || p.country === state.lang)
    );

    grid.innerHTML = presets
      .map((preset) => {
        const displayName = state.lang === 'ro' && preset.name_ro ? preset.name_ro : preset.name;
        const isAlreadyConnected = state.items.some(
          (i) =>
            i.status === 'active' &&
            (i.presetId === preset.id || i.name.toLowerCase().includes(preset.name.toLowerCase().split(' ')[0]))
        );

        const cycleMeta = window.BILLING_CYCLES[preset.billingCycle] || { short: '/mese', short_ro: '/lună' };
        const cycleShort = state.lang === 'ro' ? cycleMeta.short_ro || cycleMeta.short : cycleMeta.short;
        const useRon = state.lang === 'ro' || state.mainCurrency === 'RON';
        const shownPrice = useRon && preset.defaultPriceRON ? preset.defaultPriceRON : preset.defaultPrice;
        const shownCurrency = useRon && preset.defaultPriceRON ? 'RON' : preset.defaultCurrency;

        return `
          <div class="proposal-card ${isAlreadyConnected ? 'is-already-connected' : ''}" data-connect-preset="${preset.id}">
            <div class="proposal-top">
              <div class="brand-badge-logo" style="background-color: ${escapeAttr(preset.color)}">
                ${escapeHtml(preset.brandTag || preset.icon)}
              </div>
              <div class="proposal-info">
                <h4>${escapeHtml(preset.icon)} ${escapeHtml(displayName)}</h4>
                <span>${t('fromPricePrefix')} ${formatCurrency(shownPrice, shownCurrency)}${escapeHtml(cycleShort)}</span>
              </div>
            </div>

            <div class="proposal-actions">
              <button type="button" class="btn btn-sm ${isAlreadyConnected ? 'btn-outline' : 'btn-primary'}" data-connect-preset="${preset.id}">
                ${isAlreadyConnected ? t('btnConnectedAlready') : `${t('btnConnectService')} ${escapeHtml(displayName.split(' ')[0])}`}
              </button>
              ${
                preset.cancelUrl
                  ? `<a href="${escapeAttr(preset.cancelUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-ghost" title="${t('btnOpenServiceSite')}">↗</a>`
                  : ''
              }
            </div>
          </div>
        `;
      })
      .join('');
  }

  // --- OPEN CONNECT / ADD MODAL WITH REAL PLANS & AUTO-DETECT ---
  function openConnectServiceModal(presetId) {
    const preset = window.SERVICE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    const backdrop = document.getElementById('itemModalBackdrop');
    const form = document.getElementById('itemForm');
    const title = document.getElementById('modalTitle');
    const planBox = document.getElementById('servicePlanSelectorBox');
    const plansGrid = document.getElementById('servicePlansButtons');
    const officialRow = document.getElementById('officialAccountRow');
    const verifyBtn = document.getElementById('btnVerifyOfficialAccount');
    const directCancelBtn = document.getElementById('btnDirectCancelPage');
    const howToCancelBox = document.getElementById('howToCancelCallout');

    const displayName = state.lang === 'ro' && preset.name_ro ? preset.name_ro : preset.name;
    const useRon = state.lang === 'ro' || state.mainCurrency === 'RON';
    const initialPrice = useRon && preset.defaultPriceRON ? preset.defaultPriceRON : preset.defaultPrice;
    const initialCurrency = useRon && preset.defaultPriceRON ? 'RON' : preset.defaultCurrency || state.mainCurrency || 'EUR';
    const howToCancelText = state.lang === 'ro' ? preset.howToCancel_ro || preset.howToCancel_it : preset.howToCancel_it;

    form.reset();
    document.getElementById('itemId').value = '';
    title.textContent = `${t('modalConnectPrefix')} ${preset.icon} ${displayName}`;

    // Pre-fill form fields from the selected service
    document.getElementById('itemName').value = displayName;
    document.getElementById('itemIcon').value = preset.icon;
    document.getElementById('itemCategory').value = preset.category;
    document.getElementById('itemPrice').value = initialPrice;
    document.getElementById('itemCurrency').value = initialCurrency;
    document.getElementById('itemCycle').value = preset.billingCycle;
    document.getElementById('itemRemindDays').value = String(preset.remindDaysBefore);
    document.getElementById('itemColor').value = preset.color;
    document.getElementById('itemCancelUrl').value = preset.directCancelUrl || preset.cancelUrl || '';
    document.getElementById('itemNotes').value = howToCancelText || '';
    document.getElementById('itemNextDate').value = addMonthsKeepDay(formatDateInput(getTodayMidnight()), 1);

    if (state.gmailStatus && state.gmailStatus.email) {
      document.getElementById('itemAccountEmail').value = state.gmailStatus.email;
    }

    const radio = document.querySelector(`input[name="itemType"][value="${preset.itemType}"]`);
    if (radio) radio.checked = true;
    updateFormVisibilityByType(preset.itemType);

    // Show Auto-Detect box + how to cancel + real plans
    if ((preset.plans && preset.plans.length > 0) || preset.cancelUrl || howToCancelText) {
      planBox.classList.remove('hidden');

      if (preset.cancelUrl) {
        officialRow.classList.remove('hidden');
        verifyBtn.href = preset.cancelUrl;
      } else {
        officialRow.classList.add('hidden');
      }

      if (directCancelBtn) {
        if (preset.directCancelUrl) {
          directCancelBtn.href = preset.directCancelUrl;
          directCancelBtn.classList.remove('hidden');
        } else {
          directCancelBtn.classList.add('hidden');
        }
      }

      if (howToCancelBox) {
        if (howToCancelText) {
          howToCancelBox.innerHTML = `<strong>${t('howToCancelLabel')}</strong> ${escapeHtml(howToCancelText)}`;
          howToCancelBox.classList.remove('hidden');
        } else {
          howToCancelBox.classList.add('hidden');
        }
      }

      if (preset.plans && preset.plans.length > 0) {
        plansGrid.innerHTML = preset.plans
          .map((plan, idx) => {
            const pLabel = state.lang === 'ro' && plan.label_ro ? plan.label_ro : plan.label;
            return `
            <button type="button" class="plan-option-btn ${idx === 1 ? 'selected' : ''}"
              data-plan-price="${plan.price}"
              data-plan-currency="${plan.currency}"
              data-plan-cycle="${plan.cycle}"
              data-plan-label="${escapeAttr(pLabel)}">
              ${escapeHtml(pLabel)}
            </button>
          `;
          })
          .join('');
      } else {
        plansGrid.innerHTML = '';
      }
    } else {
      planBox.classList.add('hidden');
    }

    backdrop.classList.remove('hidden');
  }

  function openCustomItemModal(mode = 'create', item = null) {
    const backdrop = document.getElementById('itemModalBackdrop');
    const form = document.getElementById('itemForm');
    const title = document.getElementById('modalTitle');
    const planBox = document.getElementById('servicePlanSelectorBox');

    form.reset();
    planBox.classList.add('hidden');

    if (mode === 'edit' && item) {
      title.textContent = `${t('modalEditPrefix')} ${item.name}`;
      document.getElementById('itemId').value = item.id;
      document.getElementById('itemName').value = item.name;
      document.getElementById('itemIcon').value = item.icon || '🎬';
      document.getElementById('itemAccountEmail').value = item.accountEmail || '';
      document.getElementById('itemCategory').value = item.category || 'streaming';
      document.getElementById('itemPrice').value = item.price;
      document.getElementById('itemCurrency').value = item.currency || 'EUR';
      document.getElementById('itemCycle').value = item.billingCycle || 'monthly';
      document.getElementById('itemNextDate').value = item.nextDate;
      document.getElementById('itemRemindDays').value = String(item.remindDaysBefore || 3);
      document.getElementById('itemPaymentMethod').value = item.paymentMethod || '';
      document.getElementById('itemColor').value = item.color || '#4f46e5';
      document.getElementById('itemCancelUrl').value = item.cancelUrl || '';
      document.getElementById('itemNotes').value = item.notes || '';

      const radio = document.querySelector(`input[name="itemType"][value="${item.itemType || 'subscription'}"]`);
      if (radio) radio.checked = true;
      updateFormVisibilityByType(item.itemType || 'subscription');
      document.getElementById('cancelBeforeRenewal').checked = Boolean(item.cancelBeforeRenewal);
    } else {
      title.textContent = t('modalNewTitle');
      document.getElementById('itemId').value = '';
      document.getElementById('itemNextDate').value = addMonthsKeepDay(formatDateInput(getTodayMidnight()), 1);
      document.getElementById('itemCurrency').value = state.mainCurrency || 'EUR';
      document.getElementById('itemColor').value = '#6366f1';
      document.querySelector('input[name="itemType"][value="subscription"]').checked = true;
      updateFormVisibilityByType('subscription');
    }

    backdrop.classList.remove('hidden');
  }

  function closeItemModal() {
    document.getElementById('itemModalBackdrop').classList.add('hidden');
  }

  function updateFormVisibilityByType(itemType) {
    const antiRenewalBox = document.getElementById('antiRenewalBox');
    const labelNextDate = document.getElementById('labelNextDate');
    if (itemType === 'bill') {
      antiRenewalBox.classList.add('hidden');
      document.getElementById('cancelBeforeRenewal').checked = false;
      labelNextDate.textContent = t('labelNextDateBill');
    } else {
      antiRenewalBox.classList.remove('hidden');
      labelNextDate.textContent = t('labelNextDateSub');
    }
  }

  function handleSaveItemForm(e) {
    e.preventDefault();

    const id = document.getElementById('itemId').value;
    const itemType = document.querySelector('input[name="itemType"]:checked').value;
    const name = document.getElementById('itemName').value.trim();
    const icon = document.getElementById('itemIcon').value.trim() || (itemType === 'bill' ? '⚡' : '🎬');
    const accountEmail = document.getElementById('itemAccountEmail').value.trim();
    const category = document.getElementById('itemCategory').value;
    const price = parseFloat(document.getElementById('itemPrice').value) || 0;
    const currency = document.getElementById('itemCurrency').value || 'EUR';
    const billingCycle = document.getElementById('itemCycle').value;
    const nextDate = document.getElementById('itemNextDate').value;
    const remindDaysBefore = parseInt(document.getElementById('itemRemindDays').value, 10) || 3;
    const cancelBeforeRenewal = itemType === 'subscription' && document.getElementById('cancelBeforeRenewal').checked;
    const paymentMethod = document.getElementById('itemPaymentMethod').value.trim();
    const color = document.getElementById('itemColor').value || '#6366f1';
    const cancelUrl = document.getElementById('itemCancelUrl').value.trim();
    const notes = document.getElementById('itemNotes').value.trim();

    if (!name || !nextDate) return;

    if (id) {
      const idx = state.items.findIndex((i) => i.id === id);
      if (idx !== -1) {
        state.items[idx] = {
          ...state.items[idx],
          name,
          icon,
          accountEmail,
          category,
          itemType,
          price,
          currency,
          billingCycle,
          nextDate,
          remindDaysBefore,
          cancelBeforeRenewal,
          paymentMethod,
          color,
          cancelUrl,
          notes
        };
      }
      showToast(state.lang === 'ro' ? `✅ "${name}" actualizat!` : `✅ "${name}" aggiornato!`);
    } else {
      state.items.push({
        id: generateId(),
        name,
        icon,
        accountEmail,
        category,
        itemType,
        price,
        currency,
        billingCycle,
        nextDate,
        remindDaysBefore,
        cancelBeforeRenewal,
        paymentMethod,
        color,
        cancelUrl,
        notes,
        status: 'active',
        createdAt: new Date().toISOString()
      });
      showToast(state.lang === 'ro' ? `🔗 "${name}" adăugat în contul tău!` : `🔗 "${name}" collegato al tuo account!`);
    }

    saveUserDataAndSync();
    closeItemModal();
    const navHomeBtn = document.querySelector('.bottom-nav-item[data-nav="list"]');
    if (navHomeBtn) navHomeBtn.click();
    renderAll();
    checkAndSendDueNotifications(false);
  }

  // --- ITEM ACTIONS ---
  function handleMarkCancelled(itemId) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;

    item.status = 'cancelled';
    item.cancelBeforeRenewal = false;

    state.history.unshift({
      id: generateId(),
      itemId: item.id,
      name: item.name,
      icon: item.icon,
      actionType: 'cancelled_saved',
      amount: Number(item.price) || 0,
      currency: item.currency || 'EUR',
      date: formatDateInput(getTodayMidnight()),
      details: `${formatLocalizedDate(item.nextDate)}`
    });

    saveUserDataAndSync();
    renderAll();
    showToast(`✂️ "${item.name}" disdetto! Hai risparmiato ${formatCurrency(item.price, item.currency)}!`);
  }

  function handleMarkPaidOrRenewed(itemId) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;

    const paidDateStr = formatDateInput(getTodayMidnight());
    const oldDueDate = item.nextDate;
    const cycleMeta = window.BILLING_CYCLES[item.billingCycle];

    state.history.unshift({
      id: generateId(),
      itemId: item.id,
      name: item.name,
      icon: item.icon,
      actionType: 'paid_renewed',
      amount: Number(item.price) || 0,
      currency: item.currency || 'EUR',
      date: paidDateStr,
      details: `${formatLocalizedDate(oldDueDate)}`
    });

    if (!cycleMeta || cycleMeta.months === 0) {
      item.status = 'cancelled';
    } else {
      item.nextDate = addMonthsKeepDay(item.nextDate, cycleMeta.months);
    }

    saveUserDataAndSync();
    renderAll();
    showToast(`✅ "${item.name}" -> ${formatLocalizedDate(item.nextDate)}`);
  }

  function handleToggleMustCancel(itemId) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;
    item.cancelBeforeRenewal = !item.cancelBeforeRenewal;
    saveUserDataAndSync();
    renderAll();
  }

  function handleReactivateItem(itemId) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;
    item.status = 'active';
    item.cancelBeforeRenewal = true;
    item.nextDate = addMonthsKeepDay(formatDateInput(getTodayMidnight()), 1);
    saveUserDataAndSync();
    renderAll();
  }

  function handleDeleteItem(itemId) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;
    if (!confirm(`Vuoi rimuovere "${item.name}"?`)) return;
    state.items = state.items.filter((i) => i.id !== itemId);
    saveUserDataAndSync();
    renderAll();
  }

  // --- CALENDAR & HISTORY ---
  function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    const title = document.getElementById('calendarMonthTitle');
    if (!grid || !title) return;

    const year = state.calendarDate.getFullYear();
    const month = state.calendarDate.getMonth();
    const locale = state.lang === 'ro' ? 'ro-RO' : 'it-IT';

    const monthName = new Date(year, month, 1).toLocaleDateString(locale, {
      month: 'long',
      year: 'numeric'
    });
    title.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    const firstDayOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = (firstDayOfMonth.getDay() + 6) % 7;

    const todayStr = formatDateInput(getTodayMidnight());
    const activeItems = state.items.filter((i) => i.status === 'active');

    let cellsHtml = '';
    for (let i = 0; i < startWeekday; i++) {
      cellsHtml += `<div class="cal-day"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = dateStr === todayStr;
      const dayEvents = activeItems.filter((item) => item.nextDate === dateStr);

      const eventsHtml = dayEvents
        .map(
          (ev) => `
          <div class="cal-event ${ev.cancelBeforeRenewal ? 'must-cancel' : ''}" data-action="edit" data-id="${ev.id}">
            ${escapeHtml(ev.icon)} ${escapeHtml(ev.name)}
          </div>
        `
        )
        .join('');

      cellsHtml += `
        <div class="cal-day ${isToday ? 'is-today' : ''}">
          <div class="cal-day-num">${day}</div>
          ${eventsHtml}
        </div>
      `;
    }

    grid.innerHTML = cellsHtml;
  }

  function renderHistory() {
    const listEl = document.getElementById('historyList');
    if (!listEl) return;

    if (state.history.length === 0) {
      listEl.innerHTML = `<p class="text-muted">Nessuna operazione registrata nello storico.</p>`;
      return;
    }

    listEl.innerHTML = state.history
      .map((h) => {
        const isSaved = h.actionType === 'cancelled_saved';
        const formattedAmt = formatCurrency(h.amount, h.currency || 'EUR');
        return `
          <div class="history-row">
            <div>
              <strong>${escapeHtml(h.icon || '🧾')} ${escapeHtml(h.name)}</strong>
              <div class="text-muted" style="font-size: 0.76rem;">${formatLocalizedDate(h.date)}</div>
            </div>
            <div style="font-weight: 800; color: ${isSaved ? 'var(--success)' : 'var(--text-main)'};">
              ${isSaved ? '+ ' + formattedAmt : formattedAmt}
            </div>
          </div>
        `;
      })
      .join('');
  }

  // --- NOTIFICATIONS & SERVICE WORKER ---
  async function initServiceWorkerAndNotifications() {
    if ('serviceWorker' in navigator) {
      try {
        swRegistration = await navigator.serviceWorker.register('./sw.js?v=9');
        if (swRegistration && swRegistration.update) swRegistration.update();
      } catch (_) {}
    }
  }

  async function requestNotificationPermission() {
    if (!('Notification' in window)) {
      showToast('⚠️ Notifiche non supportate dal browser');
      return false;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      sendNativeNotification('🔔 ScadenzApp', 'Notifiche attive sul tuo dispositivo!');
      return true;
    }
    return false;
  }

  function sendNativeNotification(title, body, itemId = null) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const options = {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: itemId ? `scadenzapp-${itemId}` : `scadenzapp-${Date.now()}`
    };
    if (swRegistration && swRegistration.showNotification) {
      swRegistration.showNotification(title, options).catch(() => new Notification(title, options));
    } else {
      new Notification(title, options);
    }
  }

  function checkAndSendDueNotifications(force = false) {
    if (!state.isAuthenticated || !('Notification' in window) || Notification.permission !== 'granted') return;
    const todayKey = formatDateInput(getTodayMidnight());
    let log = {};
    try {
      log = JSON.parse(localStorage.getItem(STORAGE_KEYS.NOTIFIED_LOG) || '{}');
    } catch (_) {}

    state.items.filter(isItemUrgent).forEach((item) => {
      const k = `${state.user.username}_${item.id}_${item.nextDate}_${todayKey}`;
      if (!force && log[k]) return;
      const days = getDaysRemaining(item.nextDate);
      const title = item.cancelBeforeRenewal
        ? `🛑 ${t('tagMustCancel')} ${item.name}`
        : `🔔 ${item.name} (${formatCurrency(item.price, item.currency)})`;
      sendNativeNotification(title, `${formatLocalizedDate(item.nextDate)} (${days} gg)`, item.id);
      log[k] = true;
    });
    localStorage.setItem(STORAGE_KEYS.NOTIFIED_LOG, JSON.stringify(log));
  }

  // --- EXPORT .ICS & .JSON ---
  function exportToIcs(itemsToExport) {
    if (!itemsToExport || itemsToExport.length === 0) return;
    const fmt = (s) => s.replace(/-/g, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ScadenzApp//IT-RO//EN'];
    itemsToExport.forEach((item) => {
      const d1 = fmt(item.nextDate);
      const d2 = fmt(formatDateInput(addDays(parseLocalDate(item.nextDate), 1)));
      lines.push(
        'BEGIN:VEVENT',
        `UID:${item.id}@scadenzapp`,
        `DTSTART;VALUE=DATE:${d1}`,
        `DTEND;VALUE=DATE:${d2}`,
        `SUMMARY:${item.name} (${formatCurrency(item.price, item.currency)})`,
        'END:VEVENT'
      );
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'scadenzapp-calendario.ics';
    a.click();
  }

  function exportBackupJson() {
    const payload = {
      user: state.user.username,
      exportedAt: new Date().toISOString(),
      items: state.items,
      history: state.history
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `scadenzapp-${state.user.username || 'backup'}.json`;
    a.click();
  }

  // --- UTILITIES ---
  function showToast(message) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }

  function updateThemeButtonIcon(theme) {
    const btn = document.getElementById('btnThemeToggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  // --- BIND EVENTS ---
  function bindEvents() {
    // Auth Tabs (Login vs Register)
    document.querySelectorAll('.auth-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.authMode = tab.dataset.authMode;
        document.querySelectorAll('.auth-tab').forEach((tEl) => tEl.classList.toggle('active', tEl === tab));
        document.getElementById('authErrorMsg').classList.add('hidden');
        applyStaticTranslations();
      });
    });

    // Auth Form Submit
    document.getElementById('authForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const u = document.getElementById('authUsername').value;
      const p = document.getElementById('authPassword').value;
      performAuthRequest(state.authMode, u, p, false);
    });

    // Language toggle on Auth screen & App header
    const toggleLanguage = () => {
      state.lang = state.lang === 'it' ? 'ro' : 'it';
      if (state.lang === 'ro' && state.mainCurrency === 'EUR') state.mainCurrency = 'RON';
      saveUserDataAndSync();
      renderAll();
    };
    document.getElementById('btnAuthLangToggle').addEventListener('click', toggleLanguage);
    document.getElementById('btnLangToggle').addEventListener('click', toggleLanguage);

    // Currency toggle
    document.getElementById('btnCurrencyToggle').addEventListener('click', () => {
      state.mainCurrency = state.mainCurrency === 'EUR' ? 'RON' : 'EUR';
      saveUserDataAndSync();
      renderAll();
    });

    // Logout
    document.getElementById('btnLogout').addEventListener('click', handleLogout);

    // Modifica Nome Profilo (Toccando il nome/avatar in alto a sinistra)
    const btnEditProfile = document.getElementById('btnEditProfileName');
    const profileModal = document.getElementById('profileModalBackdrop');
    const inputProfileName = document.getElementById('inputProfileDisplayName');
    const closeProfileModal = () => {
      if (profileModal) profileModal.classList.add('hidden');
    };

    if (btnEditProfile && profileModal && inputProfileName) {
      btnEditProfile.addEventListener('click', () => {
        inputProfileName.value = state.user.displayName || state.user.username || '';
        const titleEl = document.getElementById('profileModalTitle');
        const lblEl = document.getElementById('txtLabelProfileName');
        const btnCancelEl = document.getElementById('btnCancelProfileModal');
        const btnSaveEl = document.getElementById('btnSaveProfileName');
        if (titleEl) titleEl.textContent = state.lang === 'ro' ? '✏️ Modifică Numele Profilului' : '✏️ Modifica Nome Profilo';
        if (lblEl) lblEl.textContent = state.lang === 'ro' ? 'Cum vrei să te numim în aplicație?' : "Come vuoi essere chiamato nell'app?";
        if (btnCancelEl) btnCancelEl.textContent = t('btnCancel');
        if (btnSaveEl) btnSaveEl.textContent = state.lang === 'ro' ? '✅ Salvează Numele' : '✅ Salva Nome';

        profileModal.classList.remove('hidden');
        setTimeout(() => inputProfileName.focus(), 60);
      });
    }

    const btnCloseProf = document.getElementById('btnCloseProfileModal');
    const btnCancelProf = document.getElementById('btnCancelProfileModal');
    const profileForm = document.getElementById('profileForm');
    if (btnCloseProf) btnCloseProf.addEventListener('click', closeProfileModal);
    if (btnCancelProf) btnCancelProf.addEventListener('click', closeProfileModal);
    if (profileForm) {
      profileForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const newName = (inputProfileName.value || '').trim();
        if (!newName) return;
        state.user.displayName = newName;
        document.getElementById('loggedUsernameDisplay').textContent = newName;
        document.getElementById('userAvatarInitial').textContent = newName.charAt(0).toUpperCase();
        localStorage.setItem(STORAGE_KEYS.AUTH_SESSION, JSON.stringify(state.user));
        saveUserDataAndSync();
        closeProfileModal();
        showToast(
          state.lang === 'ro'
            ? `✨ Numele profilului a fost schimbat în "${newName}"!`
            : `✨ Nome profilo aggiornato in "${newName}"!`
        );
      });
    }

    // Helper per cambiare vista in modo fluido e pulito
    const switchMainView = (target) => {
      state.currentView = target;
      document.querySelectorAll('.bottom-nav-item').forEach((b) => {
        b.classList.toggle('active', b.dataset.nav === target);
      });
      const vList = document.getElementById('viewList');
      const vConn = document.getElementById('viewConnect');
      const vCal = document.getElementById('viewCalendar');
      const vHist = document.getElementById('viewHistory');
      if (vList) vList.classList.toggle('hidden', target !== 'list');
      if (vConn) vConn.classList.toggle('hidden', target !== 'connect');
      if (vCal) vCal.classList.toggle('hidden', target !== 'calendar');
      if (vHist) vHist.classList.toggle('hidden', target !== 'history');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Bottom Navigation Bar
    document.querySelectorAll('.bottom-nav-item').forEach((navBtn) => {
      navBtn.addEventListener('click', () => {
        switchMainView(navBtn.dataset.nav);
      });
    });

    // Add Custom / Connect buttons
    document.getElementById('btnAddNewMain').addEventListener('click', () => openCustomItemModal('create'));
    document.getElementById('btnEmptyAdd').addEventListener('click', () => openCustomItemModal('create'));
    document.getElementById('btnEmptyGoConnect').addEventListener('click', () => switchMainView('connect'));
    const btnHeroQuick = document.getElementById('btnHeroQuickAdd');
    if (btnHeroQuick) {
      btnHeroQuick.addEventListener('click', () => switchMainView('connect'));
    }

    // Pillole KPI Interattive nella Hero Card
    document.querySelectorAll('[data-quick-filter]').forEach((kpiBtn) => {
      kpiBtn.addEventListener('click', () => {
        const filterVal = kpiBtn.dataset.quickFilter;
        state.currentFilter = state.currentFilter === filterVal ? 'all' : filterVal;
        document.querySelectorAll('#categoryFilterPills .pill').forEach((p) => {
          p.classList.toggle('active', p.dataset.filter === state.currentFilter);
        });
        renderItemsList();
      });
    });

    document.querySelectorAll('[data-quick-nav]').forEach((kpiNav) => {
      kpiNav.addEventListener('click', () => {
        switchMainView(kpiNav.dataset.quickNav);
      });
    });

    // Catalog Category Filter Tabs
    document.querySelectorAll('#catalogFilterTabs .preset-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.catalogCategory = tab.dataset.catalogCat;
        document.querySelectorAll('#catalogFilterTabs .preset-tab').forEach((tEl) => tEl.classList.remove('active'));
        tab.classList.add('active');
        renderServiceProposals();
      });
    });

    // Delegated clicks for Service Proposals ("Collega Netflix"), Plans, and Interactive Item Cards
    document.body.addEventListener('click', (e) => {
      // Se clicca su un link esterno (<a>), lascia fare al browser
      if (e.target.closest('a')) return;

      // 1. Click on "Collega [Service]" proposal card
      const connectBtn = e.target.closest('[data-connect-preset]');
      if (connectBtn) {
        openConnectServiceModal(connectBtn.dataset.connectPreset);
        return;
      }

      // 2. Click on a Real Plan button inside the modal
      const planBtn = e.target.closest('.plan-option-btn');
      if (planBtn) {
        document.querySelectorAll('.plan-option-btn').forEach((b) => b.classList.remove('selected'));
        planBtn.classList.add('selected');
        document.getElementById('itemPrice').value = planBtn.dataset.planPrice;
        document.getElementById('itemCurrency').value = planBtn.dataset.planCurrency;
        document.getElementById('itemCycle').value = planBtn.dataset.planCycle;
        return;
      }

      // 3. Click on Card actions (Disdetto, Pagato, Modifica, Elimina)
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.dataset.action;
        const id = actionBtn.dataset.id;

        if (action === 'mark-cancelled') handleMarkCancelled(id);
        else if (action === 'mark-paid') handleMarkPaidOrRenewed(id);
        else if (action === 'toggle-must-cancel') handleToggleMustCancel(id);
        else if (action === 'reactivate') handleReactivateItem(id);
        else if (action === 'delete') handleDeleteItem(id);
        else if (action === 'edit') {
          const item = state.items.find((i) => i.id === id);
          if (item) openCustomItemModal('edit', item);
        }
        return;
      }

      // 4. Tap-to-Expand sulla Card di un abbonamento per aprire/chiudere i dettagli in modo fluido!
      const expandableCard = e.target.closest('.sub-card[data-card-expand]');
      if (expandableCard) {
        expandableCard.classList.toggle('expanded');
      }
    });

    // Modal form events
    document.getElementById('btnCloseItemModal').addEventListener('click', closeItemModal);
    document.getElementById('btnCancelModal').addEventListener('click', closeItemModal);
    document.getElementById('itemForm').addEventListener('submit', handleSaveItemForm);

    document.querySelectorAll('input[name="itemType"]').forEach((radio) => {
      radio.addEventListener('change', (e) => updateFormVisibilityByType(e.target.value));
    });

    // Filter Pills
    document.querySelectorAll('#categoryFilterPills .pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        state.currentFilter = pill.dataset.filter;
        document.querySelectorAll('#categoryFilterPills .pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        renderItemsList();
      });
    });

    document.getElementById('searchInput').addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderItemsList();
    });

    document.getElementById('sortSelect').addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      renderItemsList();
    });

    // Calendar month nav
    document.getElementById('btnPrevMonth').addEventListener('click', () => {
      state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() - 1, 1);
      renderCalendar();
    });
    document.getElementById('btnNextMonth').addEventListener('click', () => {
      state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + 1, 1);
      renderCalendar();
    });

    // History & Export actions
    document.getElementById('btnExportIcsAll').addEventListener('click', () => {
      exportToIcs(state.items.filter((i) => i.status === 'active'));
    });
    document.getElementById('btnExportJson').addEventListener('click', exportBackupJson);
    document.getElementById('inputImportJson').addEventListener('change', (e) => {
      if (!e.target.files || !e.target.files[0]) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (Array.isArray(data.items)) {
            state.items = data.items;
            saveUserDataAndSync();
            renderAll();
            showToast('⬆️ Backup importato!');
          }
        } catch (_) {}
      };
      reader.readAsText(e.target.files[0]);
    });
    document.getElementById('btnClearHistory').addEventListener('click', () => {
      if (!confirm('Svuotare lo storico?')) return;
      state.history = [];
      saveUserDataAndSync();
      renderAll();
    });

    // Notifications
    document.getElementById('btnNotificationStatus').addEventListener('click', requestNotificationPermission);
    document.getElementById('btnTriggerBrowserNotif').addEventListener('click', async () => {
      const ok = await requestNotificationPermission();
      if (ok) checkAndSendDueNotifications(true);
    });

    // Android Native Install Prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
    });

    const btnTriggerNativeInstall = document.getElementById('btnTriggerNativeInstall');
    if (btnTriggerNativeInstall) {
      btnTriggerNativeInstall.addEventListener('click', async () => {
        if (deferredInstallPrompt) {
          deferredInstallPrompt.prompt();
          await deferredInstallPrompt.userChoice;
          deferredInstallPrompt = null;
        } else {
          const stepGuide = document.getElementById('nativeInstallStepGuide');
          if (stepGuide) stepGuide.classList.remove('hidden');
        }
      });
    }

    // Theme Toggle
    document.getElementById('btnThemeToggle').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(STORAGE_KEYS.THEME, next);
      updateThemeButtonIcon(next);
    });

    // Gmail / Google Play Auto-Import Events
    const btnOpenGmail = document.getElementById('btnOpenGmailModal');
    const btnEmptyGmail = document.getElementById('btnEmptyConnectGmail');
    const btnCloseGmail = document.getElementById('btnCloseGmailModal');
    const btnConnectGmail = document.getElementById('btnConnectAndScanGmail');
    const btnRescanModal = document.getElementById('btnRescanGmailModal');
    const btnScanQuick = document.getElementById('btnScanGmailQuick');
    const btnDisconnectGmail = document.getElementById('btnDisconnectGmail');
    const btnParseReceipt = document.getElementById('btnParseReceiptText');

    if (btnOpenGmail) btnOpenGmail.addEventListener('click', openGmailModal);
    if (btnEmptyGmail) btnEmptyGmail.addEventListener('click', openGmailModal);
    if (btnCloseGmail) btnCloseGmail.addEventListener('click', closeGmailModal);
    if (btnConnectGmail) btnConnectGmail.addEventListener('click', handleConnectAndScanGmail);
    if (btnRescanModal) btnRescanModal.addEventListener('click', handleScanGmailNow);
    if (btnScanQuick) btnScanQuick.addEventListener('click', handleScanGmailNow);
    if (btnDisconnectGmail) btnDisconnectGmail.addEventListener('click', handleDisconnectGmail);
    if (btnParseReceipt) btnParseReceipt.addEventListener('click', handleParseReceiptText);

    // Auto-Detect when clicking "1. Apri Account Ufficiale" and returning to ScadenzApp
    const btnVerifyOfficial = document.getElementById('btnVerifyOfficialAccount');
    const btnAutoPastePage = document.getElementById('btnAutoPasteFromPage');

    if (btnVerifyOfficial) {
      btnVerifyOfficial.addEventListener('click', () => {
        waitingForAutoDetectFromSite = true;
        showToast(
          state.lang === 'ro'
            ? '🌐 Copiază prețul/scadența din contul deschis și revino în aplicație!'
            : '🌐 Copia la riga col prezzo/scadenza dalla pagina aperta e torna qui!'
        );
      });
    }

    if (btnAutoPastePage) {
      btnAutoPastePage.addEventListener('click', () => triggerAutoReadFromClipboardOrPrompt(false));
    }

    window.addEventListener('focus', () => {
      if (waitingForAutoDetectFromSite) {
        waitingForAutoDetectFromSite = false;
        triggerAutoReadFromClipboardOrPrompt(true);
      }
    });
  }

  // --- AUTO-DETECT PRICE, RENEWAL DATE & EMAIL FROM OFFICIAL SITE (NETFLIX, DISNEY+, ETC.) ---
  const MONTH_NAMES_MAP = {
    gennaio: 1, gen: 1, ianuarie: 1, ian: 1, january: 1, jan: 1,
    febbraio: 2, feb: 2, februarie: 2, february: 2,
    marzo: 3, mar: 3, martie: 3, march: 3,
    aprile: 4, apr: 4, aprilie: 4, april: 4,
    maggio: 5, mag: 5, mai: 5, may: 5,
    giugno: 6, giu: 6, iunie: 6, iun: 6, june: 6, jun: 6,
    luglio: 7, lug: 7, iulie: 7, iul: 7, july: 7, jul: 7,
    agosto: 8, ago: 8, august: 8, aug: 8,
    settembre: 9, set: 9, septembrie: 9, sep: 9, sept: 9, september: 9,
    ottobre: 10, ott: 10, octombrie: 10, oct: 10, october: 10,
    novembre: 11, nov: 11, noiembrie: 11, november: 11,
    dicembre: 12, dic: 12, decembrie: 12, dec: 12, december: 12
  };

  function extractExplicitDateFromText(text) {
    if (!text) return null;
    const now = new Date();

    // 1. DD/MM/YYYY o DD.MM.YYYY o DD-MM-YYYY
    const numMatch = text.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);
    if (numMatch) {
      const d = parseInt(numMatch[1], 10);
      const m = parseInt(numMatch[2], 10);
      let y = parseInt(numMatch[3], 10);
      if (y < 100) y += 2000;
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 2024 && y <= 2035) {
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }

    // 2. DD <mese IT/RO/EN> [YYYY] (es. "18 novembre 2026" o "18 noiembrie")
    const wordRegex = /\b(\d{1,2})\s+([a-zA-ZăâîșțĂÂÎȘȚ]{3,12})(?:\.?\s+(\d{4}))?\b/g;
    let mMatch;
    while ((mMatch = wordRegex.exec(text)) !== null) {
      const day = parseInt(mMatch[1], 10);
      const monthRaw = mMatch[2].toLowerCase();
      const month = MONTH_NAMES_MAP[monthRaw];
      if (month && day >= 1 && day <= 31) {
        let year = mMatch[3] ? parseInt(mMatch[3], 10) : now.getFullYear();
        const candidate = new Date(year, month - 1, day);
        if (!mMatch[3] && candidate < getTodayMidnight()) {
          year += 1;
        }
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }

    return null;
  }

  function extractPriceAndCurrencyFromText(text) {
    if (!text) return null;
    const patterns = [
      { re: /(?:€|EUR)\s*(\d{1,4}[.,]\d{2})/i, curr: 'EUR' },
      { re: /(\d{1,4}[.,]\d{2})\s*(?:€|EUR)/i, curr: 'EUR' },
      { re: /(\d{1,4}[.,]\d{2})\s*(?:lei|LEI|RON)/i, curr: 'RON' },
      { re: /(?:RON|LEI)\s*(\d{1,4}[.,]\d{2})/i, curr: 'RON' }
    ];
    for (const p of patterns) {
      const m = text.match(p.re);
      if (m) {
        const val = parseFloat(m[1].replace(',', '.'));
        if (val >= 0.5 && val <= 3000) {
          return { price: val, currency: p.curr };
        }
      }
    }
    return null;
  }

  async function triggerAutoReadFromClipboardOrPrompt(isSilentFocus = false) {
    let rawText = '';
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        rawText = await navigator.clipboard.readText();
      }
    } catch (_) {}

    if (!rawText || rawText.trim().length < 3) {
      if (isSilentFocus) return;
      const promptMsg =
        state.lang === 'ro'
          ? 'Lipește aici textul copiat din pagina contului tău (Netflix, Disney+, Spotify... cu prețul și data facturării):'
          : 'Incolla qui il testo copiato dalla pagina del tuo account (Netflix, Disney+, Spotify... con prezzo e data di rinnovo):';
      rawText = window.prompt(promptMsg, '') || '';
    }

    if (!rawText.trim()) return;

    const priceFound = extractPriceAndCurrencyFromText(rawText);
    const dateFound = extractExplicitDateFromText(rawText);
    const emailMatch = rawText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

    if (!priceFound && !dateFound && !emailMatch) {
      if (!isSilentFocus) {
        showToast(
          state.lang === 'ro'
            ? '⚠️ Nu am găsit prețul sau data în textul copiat. Copiază rândul cu prețul și data scadenței!'
            : '⚠️ Non ho trovato prezzo o data nel testo copiato. Copia la riga con prezzo e scadenza!'
        );
      }
      return;
    }

    if (priceFound) {
      document.getElementById('itemPrice').value = priceFound.price.toFixed(2);
      document.getElementById('itemCurrency').value = priceFound.currency;
    }
    if (dateFound) {
      document.getElementById('itemNextDate').value = dateFound;
    }
    if (emailMatch) {
      document.getElementById('itemAccountEmail').value = emailMatch[0];
    }

    const summaryParts = [];
    if (priceFound) summaryParts.push(formatCurrency(priceFound.price, priceFound.currency));
    if (dateFound) summaryParts.push(formatLocalizedDate(dateFound));
    if (emailMatch) summaryParts.push(emailMatch[0]);

    showToast(
      state.lang === 'ro'
        ? `⚡ Preluat automat din pagină: ${summaryParts.join(' • ')}!`
        : `⚡ Rilevato in automatico dalla pagina: ${summaryParts.join(' • ')}!`
    );
  }

  // --- GMAIL / GOOGLE PLAY AUTO-IMPORT LOGIC ---
  function renderGmailStatus() {
    const pill = document.getElementById('gmailStatusPill');
    const btnOpen = document.getElementById('btnOpenGmailModal');
    const btnQuickScan = document.getElementById('btnScanGmailQuick');
    const modalBadge = document.getElementById('gmailModalStatusBadge');
    const btnRescanModal = document.getElementById('btnRescanGmailModal');
    const btnDisconnect = document.getElementById('btnDisconnectGmail');
    const inputEmail = document.getElementById('inputGmailAddress');

    const isConnected = Boolean(state.gmailStatus && state.gmailStatus.enabled && state.gmailStatus.email);

    if (pill) {
      if (isConnected) {
        pill.textContent = `${t('gmailConnectedPrefix')} ${state.gmailStatus.email}`;
        pill.classList.add('connected');
      } else {
        pill.textContent = t('gmailNotConnected');
        pill.classList.remove('connected');
      }
    }

    if (btnOpen) {
      btnOpen.textContent = isConnected ? t('btnOpenGmailManage') : t('btnOpenGmailConnect');
    }

    if (btnQuickScan) {
      btnQuickScan.classList.toggle('hidden', !isConnected);
    }

    if (modalBadge) {
      modalBadge.textContent = isConnected ? `🟢 ${state.gmailStatus.email}` : t('gmailNotConnected');
    }
    if (inputEmail && isConnected && !inputEmail.value) {
      inputEmail.value = state.gmailStatus.email;
    }
    if (btnRescanModal) btnRescanModal.classList.toggle('hidden', !isConnected);
    if (btnDisconnect) btnDisconnect.classList.toggle('hidden', !isConnected);
  }

  function openGmailModal() {
    const modal = document.getElementById('gmailModalBackdrop');
    const alertEl = document.getElementById('gmailModalAlert');
    if (alertEl) alertEl.classList.add('hidden');
    renderGmailStatus();
    if (modal) modal.classList.remove('hidden');
  }

  function closeGmailModal() {
    const modal = document.getElementById('gmailModalBackdrop');
    if (modal) modal.classList.add('hidden');
  }

  function showGmailModalMessage(msg, isError = true) {
    const alertEl = document.getElementById('gmailModalAlert');
    if (!alertEl) return;
    alertEl.textContent = msg;
    alertEl.style.background = isError ? 'rgba(239, 68, 68, 0.16)' : 'rgba(16, 185, 129, 0.16)';
    alertEl.style.borderColor = isError ? 'rgba(239, 68, 68, 0.45)' : 'rgba(16, 185, 129, 0.45)';
    alertEl.style.color = isError ? '#fca5a5' : '#6ee7b7';
    alertEl.classList.remove('hidden');
  }

  async function handleConnectAndScanGmail() {
    const gmailEmail = (document.getElementById('inputGmailAddress').value || '').trim();
    const gmailAppPassword = (document.getElementById('inputGmailAppPassword').value || '').trim();
    const btn = document.getElementById('btnConnectAndScanGmail');

    if (!gmailEmail || !gmailEmail.includes('@')) {
      showGmailModalMessage(
        state.lang === 'ro'
          ? '⚠️ Introdu o adresă @gmail.com validă.'
          : '⚠️ Inserisci il tuo indirizzo @gmail.com valido.',
        true
      );
      return;
    }

    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent =
      state.lang === 'ro'
        ? '⏳ Conectare la Gmail și scanare în curs...'
        : '⏳ Connessione a Gmail e scansione in corso...';

    try {
      const res = await fetch('/api/gmail/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: state.user.username,
          password: state.user.password,
          gmailEmail,
          gmailAppPassword
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Errore connessione Gmail');
      }

      if (Array.isArray(data.items)) state.items = data.items;
      if (data.gmailStatus) state.gmailStatus = data.gmailStatus;
      saveUserCacheLocally();
      renderAll();

      const count = data.addedCount || 0;
      showGmailModalMessage(
        count > 0
          ? state.lang === 'ro'
            ? `🎉 Gmail conectat! Am găsit și importat ${count} abonamente noi din emailurile tale!`
            : `🎉 Gmail collegata! Trovati e importati ${count} nuovi abbonamenti dalle tue email!`
          : state.lang === 'ro'
          ? '✅ Gmail conectat cu succes! Niciun abonament nou în ultimele 60 de zile (serverul va verifica automat emailurile viitoare).'
          : '✅ Gmail collegata con successo! Nessun nuovo abbonamento negli ultimi 60 giorni (il server controllerà in automatico le prossime email).',
        false
      );
      showToast(
        count > 0
          ? state.lang === 'ro'
            ? `🎉 ${count} abonamente importate din Gmail!`
            : `🎉 Importati ${count} abbonamenti da Gmail!`
          : state.lang === 'ro'
          ? '✅ Gmail conectat! Auto-Import activ.'
          : '✅ Gmail collegata! Auto-Import attivo.'
      );
    } catch (err) {
      showGmailModalMessage(`⚠️ ${err.message}`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }

  async function handleScanGmailNow() {
    const btnQuick = document.getElementById('btnScanGmailQuick');
    const btnModal = document.getElementById('btnRescanGmailModal');
    if (btnQuick) {
      btnQuick.disabled = true;
      btnQuick.textContent = '⏳...';
    }
    if (btnModal) {
      btnModal.disabled = true;
      btnModal.textContent = '⏳...';
    }

    try {
      const res = await fetch('/api/gmail/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: state.user.username,
          password: state.user.password
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Errore scansione Gmail');
      }

      if (Array.isArray(data.items)) state.items = data.items;
      if (data.gmailStatus) state.gmailStatus = data.gmailStatus;
      saveUserCacheLocally();
      renderAll();

      const count = data.addedCount || 0;
      const msg =
        count > 0
          ? state.lang === 'ro'
            ? `🎉 Am găsit și adăugat ${count} abonamente noi din emailurile tale!`
            : `🎉 Trovati e aggiunti ${count} nuovi abbonamenti dalle tue email!`
          : state.lang === 'ro'
          ? '✅ Scanare completă: niciun abonament nou găsit.'
          : '✅ Scansione completata: nessun nuovo abbonamento trovato.';
      showGmailModalMessage(msg, false);
      showToast(msg);
    } catch (err) {
      showGmailModalMessage(`⚠️ ${err.message}`, true);
      showToast(`⚠️ ${err.message}`);
    } finally {
      if (btnQuick) {
        btnQuick.disabled = false;
        btnQuick.textContent = t('btnScanGmailQuick');
      }
      if (btnModal) {
        btnModal.disabled = false;
        btnModal.textContent = t('btnRescanGmailModal');
      }
    }
  }

  async function handleDisconnectGmail() {
    try {
      const res = await fetch('/api/gmail/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: state.user.username,
          password: state.user.password
        })
      });
      const data = await res.json();
      if (data.gmailStatus) state.gmailStatus = data.gmailStatus;
      document.getElementById('inputGmailAppPassword').value = '';
      renderAll();
      const msg = state.lang === 'ro' ? '🔌 Gmail deconectat.' : '🔌 Gmail scollegata.';
      showGmailModalMessage(msg, false);
      showToast(msg);
    } catch (_) {}
  }

  async function handleParseReceiptText() {
    const rawText = (document.getElementById('inputPasteReceiptText').value || '').trim();
    if (!rawText) {
      showGmailModalMessage(
        state.lang === 'ro'
          ? '⚠️ Lipește mai întâi textul din cont sau din chitanță.'
          : "⚠️ Incolla prima il testo della pagina account o dell'email.",
        true
      );
      return;
    }

    try {
      const res = await fetch('/api/gmail/parse-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: rawText,
          mainCurrency: state.mainCurrency
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !data.item) {
        throw new Error(data.error || 'Impossibile leggere il testo');
      }

      // Se nel testo c'è una data esplicita (es. "18 novembre 2026"), usiamola!
      const explicitDate = extractExplicitDateFromText(rawText);
      if (explicitDate) {
        data.item.nextDate = explicitDate;
        data.item.nextDueDate = explicitDate;
      }

      state.items.unshift(data.item);
      document.getElementById('inputPasteReceiptText').value = '';
      saveUserDataAndSync();
      renderAll();
      closeGmailModal();
      showToast(
        `✅ ${data.item.icon} ${data.item.name} (${formatCurrency(data.item.price, data.item.currency)})`
      );
    } catch (err) {
      showGmailModalMessage(`⚠️ ${err.message}`, true);
    }
  }

  // --- INIT ---
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadPreferencesAndCheckSession();
    initServiceWorkerAndNotifications();
  });
})();

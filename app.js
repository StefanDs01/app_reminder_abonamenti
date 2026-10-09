(() => {
  'use strict';

  // --- STORAGE KEYS ---
  const STORAGE_KEYS = {
    ITEMS: 'scadenzapp_items_v1',
    HISTORY: 'scadenzapp_history_v1',
    GH_CONFIG: 'scadenzapp_gh_config_v1',
    VPS_CONFIG: 'scadenzapp_vps_config_v1',
    LANG: 'scadenzapp_lang_v1',
    CURRENCY: 'scadenzapp_currency_v1',
    THEME: 'scadenzapp_theme_v1',
    NOTIFIED_LOG: 'scadenzapp_notified_log_v1'
  };

  // --- APPLICATION STATE ---
  let state = {
    lang: 'it', // 'it' | 'ro'
    mainCurrency: 'EUR', // 'EUR' | 'RON'
    items: [],
    history: [],
    currentView: 'list',
    currentFilter: 'all',
    searchQuery: '',
    sortBy: 'dueDateAsc',
    calendarDate: new Date(),
    presetCategoryFilter: 'all',
    vpsConfig: {
      username: '',
      pin: '',
      serverUrl: '',
      autoSync: true,
      lastSyncAt: null
    },
    ghConfig: {
      token: '',
      gistId: '',
      autoSync: false,
      lastSyncAt: null
    }
  };

  let swRegistration = null;

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

  // --- LOAD & SAVE DATA ---
  function loadState() {
    try {
      const savedLang = localStorage.getItem(STORAGE_KEYS.LANG);
      const savedCurrency = localStorage.getItem(STORAGE_KEYS.CURRENCY);
      const savedItems = localStorage.getItem(STORAGE_KEYS.ITEMS);
      const savedHistory = localStorage.getItem(STORAGE_KEYS.HISTORY);
      const savedVps = localStorage.getItem(STORAGE_KEYS.VPS_CONFIG);
      const savedGh = localStorage.getItem(STORAGE_KEYS.GH_CONFIG);
      const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);

      if (savedLang === 'it' || savedLang === 'ro') {
        state.lang = savedLang;
      }
      if (savedCurrency === 'EUR' || savedCurrency === 'RON') {
        state.mainCurrency = savedCurrency;
      }

      if (savedItems) {
        state.items = JSON.parse(savedItems);
      } else {
        state.items = getStarterExamples(state.lang);
        saveItemsToLocal(false);
      }

      if (savedHistory) {
        state.history = JSON.parse(savedHistory);
      }

      if (savedVps) {
        state.vpsConfig = { ...state.vpsConfig, ...JSON.parse(savedVps) };
      }

      if (savedGh) {
        state.ghConfig = { ...state.ghConfig, ...JSON.parse(savedGh) };
      }

      if (savedTheme === 'light' || savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', savedTheme);
        updateThemeButtonIcon(savedTheme);
      }
    } catch (err) {
      console.error('Errore caricamento stato locale:', err);
    }
  }

  function saveItemsToLocal(triggerCloudSync = true) {
    try {
      localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify(state.items));
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(state.history));
      localStorage.setItem(STORAGE_KEYS.LANG, state.lang);
      localStorage.setItem(STORAGE_KEYS.CURRENCY, state.mainCurrency);

      if (triggerCloudSync) {
        if (state.vpsConfig.autoSync && state.vpsConfig.username && state.vpsConfig.pin) {
          pushToVpsServer(true);
        }
        if (state.ghConfig.autoSync && state.ghConfig.token) {
          pushToGitHubGist(true);
        }
      }
      updateSyncStatusUI();
    } catch (err) {
      console.error('Errore salvataggio locale:', err);
    }
  }

  function getStarterExamples(lang = 'it') {
    const today = getTodayMidnight();
    if (lang === 'ro') {
      return [
        {
          id: generateId(),
          name: 'Disney+ (Doar 1 Lună)',
          icon: '✨',
          category: 'streaming',
          itemType: 'subscription',
          price: 9.99,
          currency: 'EUR',
          billingCycle: 'monthly',
          nextDate: formatDateInput(addDays(today, 3)),
          remindDaysBefore: 5,
          cancelBeforeRenewal: true,
          paymentMethod: 'Card Revolut / BT',
          color: '#0063E5',
          cancelUrl: 'https://www.disneyplus.com/account/subscription',
          notes: 'Abonament făcut doar pe o lună! De anulat înainte de reînnoire.',
          status: 'active',
          createdAt: new Date().toISOString()
        },
        {
          id: generateId(),
          name: 'Netflix',
          icon: '🎬',
          category: 'streaming',
          itemType: 'subscription',
          price: 13.99,
          currency: 'EUR',
          billingCycle: 'monthly',
          nextDate: formatDateInput(addDays(today, 12)),
          remindDaysBefore: 3,
          cancelBeforeRenewal: false,
          paymentMethod: 'Card',
          color: '#E50914',
          cancelUrl: 'https://www.netflix.com/youraccount',
          notes: 'Plan Standard HD',
          status: 'active',
          createdAt: new Date().toISOString()
        },
        {
          id: generateId(),
          name: 'DIGI (Internet + TV + Mobil) 🇷🇴',
          icon: '🌐',
          category: 'bills',
          itemType: 'bill',
          price: 95.00,
          currency: 'RON',
          billingCycle: 'monthly',
          nextDate: formatDateInput(addDays(today, 5)),
          remindDaysBefore: 5,
          cancelBeforeRenewal: false,
          paymentMethod: 'MyDIGI / Pago',
          color: '#0284C7',
          cancelUrl: 'https://www.digi.ro/my-digi',
          notes: 'Factură lunară DIGI Romania',
          status: 'active',
          createdAt: new Date().toISOString()
        },
        {
          id: generateId(),
          name: 'Rovinietă Auto (CNAIR) 🇷🇴',
          icon: '🛣️',
          category: 'auto',
          itemType: 'bill',
          price: 139.00,
          currency: 'RON',
          billingCycle: 'yearly',
          nextDate: formatDateInput(addDays(today, 14)),
          remindDaysBefore: 15,
          cancelBeforeRenewal: false,
          paymentMethod: 'erovinieta.ro',
          color: '#DC2626',
          cancelUrl: 'https://www.erovinieta.ro/',
          notes: 'Valabilitate rovinietă 12 luni',
          status: 'active',
          createdAt: new Date().toISOString()
        }
      ];
    }

    return [
      {
        id: generateId(),
        name: 'Disney+ (Solo 1 Mese)',
        icon: '✨',
        category: 'streaming',
        itemType: 'subscription',
        price: 9.99,
        currency: 'EUR',
        billingCycle: 'monthly',
        nextDate: formatDateInput(addDays(today, 3)),
        remindDaysBefore: 5,
        cancelBeforeRenewal: true,
        paymentMethod: 'PayPal',
        color: '#0063E5',
        cancelUrl: 'https://www.disneyplus.com/it-it/account/subscription',
        notes: 'Fatto solo per 1 mese! Disdire prima del rinnovo automatico.',
        status: 'active',
        createdAt: new Date().toISOString()
      },
      {
        id: generateId(),
        name: 'Netflix',
        icon: '🎬',
        category: 'streaming',
        itemType: 'subscription',
        price: 13.99,
        currency: 'EUR',
        billingCycle: 'monthly',
        nextDate: formatDateInput(addDays(today, 12)),
        remindDaysBefore: 3,
        cancelBeforeRenewal: false,
        paymentMethod: 'Carta Revolut',
        color: '#E50914',
        cancelUrl: 'https://www.netflix.com/youraccount',
        notes: 'Piano Standard HD',
        status: 'active',
        createdAt: new Date().toISOString()
      },
      {
        id: generateId(),
        name: 'Bolletta Luce & Elettricità',
        icon: '⚡',
        category: 'bills',
        itemType: 'bill',
        price: 84.50,
        currency: 'EUR',
        billingCycle: 'bimonthly',
        nextDate: formatDateInput(addDays(today, 5)),
        remindDaysBefore: 7,
        cancelBeforeRenewal: false,
        paymentMethod: 'PagoPA / Domiciliazione',
        color: '#F59E0B',
        cancelUrl: '',
        notes: 'Bimestre corrente - verificare lettura contatore',
        status: 'active',
        createdAt: new Date().toISOString()
      },
      {
        id: generateId(),
        name: 'Bollo Auto',
        icon: '🚗',
        category: 'auto',
        itemType: 'bill',
        price: 198.00,
        currency: 'EUR',
        billingCycle: 'yearly',
        nextDate: formatDateInput(addDays(today, 14)),
        remindDaysBefore: 15,
        cancelBeforeRenewal: false,
        paymentMethod: 'PagoPA / App IO / ACI',
        color: '#DC2626',
        cancelUrl: 'https://www.aci.it/i-servizi/servizi-online/bollo-auto.html',
        notes: 'Targa veicolo • Pagare entro fine mese di scadenza',
        status: 'active',
        createdAt: new Date().toISOString()
      }
    ];
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
    if (btnLang) {
      btnLang.textContent = state.lang === 'ro' ? '🇷🇴 RO' : '🇮🇹 IT';
    }

    const btnCurr = document.getElementById('btnCurrencyToggle');
    if (btnCurr) {
      btnCurr.textContent = state.mainCurrency === 'RON' ? '🇷🇴 RON (lei)' : '💶 EUR (€)';
    }

    const mapIds = {
      txtAppSubtitle: 'appSubtitle',
      txtCalendarIcs: 'calendarIcs',
      txtAddDeadlineBtn: 'addDeadlineBtn',
      txtWhatToMonitor: 'whatToMonitor',
      txtChooseQuickMode: 'chooseQuickMode',
      txtQuickTrialTitle: 'quickTrialTitle',
      txtQuickTrialDesc: 'quickTrialDesc',
      txtQuickSubTitle: 'quickSubTitle',
      txtQuickSubDesc: 'quickSubDesc',
      txtQuickBillTitle: 'quickBillTitle',
      txtQuickBillDesc: 'quickBillDesc',
      btnTriggerBrowserNotif: 'testDeviceNotif',
      txtKpiUrgentLabel: 'kpiUrgentLabel',
      txtKpiSubsLabel: 'kpiSubsLabel',
      txtKpiBillsLabel: 'kpiBillsLabel',
      txtKpiSavedLabel: 'kpiSavedLabel',
      txtTabList: 'tabList',
      txtTabCalendar: 'tabCalendar',
      txtTabHistory: 'tabHistory',
      txtFilterAll: 'filterAll',
      txtFilterMustCancel: 'filterMustCancel',
      txtFilterSubs: 'filterSubs',
      txtFilterBills: 'filterBills',
      txtFilterAuto: 'filterAuto',
      txtFilterCancelled: 'filterCancelled',
      optSortDueDate: 'sortDueDate',
      optSortCancelFirst: 'sortCancelFirst',
      optSortPriceDesc: 'sortPriceDesc',
      optSortNameAsc: 'sortNameAsc',
      txtEmptyTitle: 'emptyTitle',
      txtEmptyDesc: 'emptyDesc',
      btnEmptyAdd: 'emptyAddBtn',
      btnLoadDemoData: 'emptyDemoBtn',
      btnPrevMonth: 'prevMonth',
      btnNextMonth: 'nextMonth',
      txtHistoryTitle: 'historyTitle',
      txtHistorySubtitle: 'historySubtitle',
      btnClearHistory: 'clearHistoryBtn',
      txtPresetHeaderLabel: 'presetHeaderLabel',
      txtTypeSubTitle: 'typeSubTitle',
      txtTypeSubDesc: 'typeSubDesc',
      txtTypeBillTitle: 'typeBillTitle',
      txtTypeBillDesc: 'typeBillDesc',
      txtMustCancelSwitchTitle: 'mustCancelSwitchTitle',
      txtMustCancelSwitchDesc: 'mustCancelSwitchDesc',
      txtLabelName: 'labelName',
      txtLabelCategory: 'labelCategory',
      txtLabelPrice: 'labelPrice',
      txtLabelCurrency: 'labelCurrency',
      txtLabelCycle: 'labelCycle',
      txtLabelRemindDays: 'labelRemindDays',
      txtLabelPaymentMethod: 'labelPaymentMethod',
      txtLabelColor: 'labelColor',
      txtLabelCancelUrl: 'labelCancelUrl',
      txtLabelNotes: 'labelNotes',
      btnCancelModal: 'btnCancel',
      btnSaveItem: 'btnSave'
    };

    Object.entries(mapIds).forEach(([elId, tKey]) => {
      const el = document.getElementById(elId);
      if (el) el.textContent = t(tKey);
    });

    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.placeholder = t('searchPlaceholder');

    const weekdaysRow = document.getElementById('calendarWeekdaysRow');
    if (weekdaysRow) {
      const days = t('weekdays');
      weekdaysRow.innerHTML = days.map((d) => `<div>${d}</div>`).join('');
    }

    updateNotificationStatusUI();
  }

  // --- RENDERING DASHBOARD ---
  function renderAll() {
    applyStaticTranslations();
    renderUrgentBanner();
    renderKpis();
    renderCounts();
    renderItemsList();
    renderCalendar();
    renderHistory();
    updateSyncStatusUI();
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

    if (state.lang === 'ro') {
      titleEl.textContent =
        mustCancelCount > 0
          ? `🚨 Atenție: ${urgentItems.length} scadențe apropiate (${mustCancelCount} DE ANULAT ca să nu plătești!)`
          : `⚠️ ${urgentItems.length} Scadențe / Plăți în următoarele zile`;
    } else {
      titleEl.textContent =
        mustCancelCount > 0
          ? `🚨 Attenzione: ${urgentItems.length} scadenze imminenti (${mustCancelCount} DA DISDIRE per non pagare!)`
          : `⚠️ ${urgentItems.length} Scadenze / Pagamenti in arrivo nei prossimi giorni`;
    }

    listEl.innerHTML = urgentItems
      .map((item) => {
        const days = getDaysRemaining(item.nextDate);
        const isBill = item.itemType === 'bill';
        const itemPriceFormatted = formatCurrency(item.price, item.currency || 'EUR');
        let timingText = '';

        if (state.lang === 'ro') {
          if (days < 0) timingText = `EXPIRAT de ${Math.abs(days)} zile (${formatLocalizedDate(item.nextDate)})`;
          else if (days === 0) timingText = `SCADENT AZI (${formatLocalizedDate(item.nextDate)})!`;
          else if (days === 1) timingText = `Scadent MÂINE (${formatLocalizedDate(item.nextDate)})`;
          else timingText = `Peste ${days} zile (${formatLocalizedDate(item.nextDate)})`;
        } else {
          if (days < 0) timingText = `SCADUTO da ${Math.abs(days)} giorni (${formatLocalizedDate(item.nextDate)})`;
          else if (days === 0) timingText = `SCADE OGGI (${formatLocalizedDate(item.nextDate)})!`;
          else if (days === 1) timingText = `Scade DOMANI (${formatLocalizedDate(item.nextDate)})`;
          else timingText = `Tra ${days} giorni (${formatLocalizedDate(item.nextDate)})`;
        }

        const cancelDeadline = formatLocalizedDate(
          formatDateInput(addDays(parseLocalDate(item.nextDate), -1))
        );

        const detailMsg = item.cancelBeforeRenewal
          ? state.lang === 'ro'
            ? ` • 🛑 Anulează până pe <strong>${cancelDeadline}</strong> pentru a evita plata!`
            : ` • 🛑 Disdici entro il <strong>${cancelDeadline}</strong> per evitare l'addebito!`
          : isBill
          ? state.lang === 'ro'
            ? ` • Nu uita să efectuezi plata până la scadență.`
            : ` • Ricordati di effettuare il pagamento entro la scadenza.`
          : state.lang === 'ro'
          ? ` • Reînnoire automată pe ${formatLocalizedDate(item.nextDate)}.`
          : ` • Rinnovo automatico previsto il ${formatLocalizedDate(item.nextDate)}.`;

        return `
          <div class="urgent-banner-item ${isBill ? 'is-bill-alert' : ''}">
            <div class="urgent-item-top">
              <div class="urgent-item-name">
                <span>${escapeHtml(item.icon || '🔔')}</span>
                <span>${escapeHtml(item.name)}</span>
                ${
                  item.cancelBeforeRenewal
                    ? `<span class="tag tag-must-cancel">${t('tagMustCancel')}</span>`
                    : isBill
                    ? `<span class="tag tag-bill">${t('tagBill')}</span>`
                    : `<span class="tag tag-sub">${t('tagSub')}</span>`
                }
              </div>
              <strong>${itemPriceFormatted}</strong>
            </div>
            <div class="urgent-item-msg">
              <strong>${timingText}</strong>${detailMsg}
            </div>
            <div class="urgent-item-actions">
              ${
                item.cancelBeforeRenewal || item.itemType === 'subscription'
                  ? `<button type="button" class="btn btn-xs btn-danger" data-action="mark-cancelled" data-id="${item.id}">
                       ${t('btnMarkCancelled')} (${itemPriceFormatted})
                     </button>`
                  : ''
              }
              ${
                item.cancelUrl
                  ? `<a href="${escapeAttr(item.cancelUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-outline">
                       ${isBill ? t('btnGoToPay') : t('btnGoToCancel')}
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

    // 1. Urgent KPI
    document.getElementById('kpiUrgentCount').textContent = String(urgentItems.length);
    if (state.lang === 'ro') {
      document.getElementById('kpiUrgentSub').textContent =
        mustCancelActive.length > 0
          ? `${mustCancelActive.length} abonamente setate "De Anulat"`
          : urgentItems.length > 0
          ? 'Verifică alertele de mai sus'
          : t('kpiUrgentNone');
    } else {
      document.getElementById('kpiUrgentSub').textContent =
        mustCancelActive.length > 0
          ? `${mustCancelActive.length} abbonament${mustCancelActive.length === 1 ? 'o' : 'i'} impostati "Da Disdire"`
          : urgentItems.length > 0
          ? 'Controlla il banner avvisi qui sopra'
          : t('kpiUrgentNone');
    }

    // 2. Subscriptions KPI (converted to mainCurrency)
    const activeSubs = activeItems.filter((i) => i.itemType === 'subscription');
    const monthlySubsTotal = activeSubs.reduce((acc, item) => acc + getMonthlyEquivalentInMainCurrency(item), 0);
    const yearlySubsTotal = activeSubs.reduce((acc, item) => acc + getYearlyEquivalentInMainCurrency(item), 0);

    document.getElementById('kpiMonthlySubs').textContent = formatCurrency(monthlySubsTotal, state.mainCurrency);
    document.getElementById('kpiYearlySubs').textContent =
      state.lang === 'ro'
        ? `Total anual: ${formatCurrency(yearlySubsTotal, state.mainCurrency)} (${activeSubs.length} active)`
        : `Proiezione annua: ${formatCurrency(yearlySubsTotal, state.mainCurrency)} (${activeSubs.length} attivi)`;

    // 3. Bills & Auto KPI
    const activeBills = activeItems.filter((i) => i.itemType === 'bill');
    const yearlyBillsTotal = activeBills.reduce((acc, item) => acc + getYearlyEquivalentInMainCurrency(item), 0);
    const monthlyBillsAvg = yearlyBillsTotal / 12;

    document.getElementById('kpiYearlyBills').textContent = formatCurrency(yearlyBillsTotal, state.mainCurrency);
    document.getElementById('kpiMonthlyBills').textContent =
      state.lang === 'ro'
        ? `Medie lunară: ${formatCurrency(monthlyBillsAvg, state.mainCurrency)}/lună (${activeBills.length})`
        : `Media mensile: ${formatCurrency(monthlyBillsAvg, state.mainCurrency)}/mese (${activeBills.length} voci)`;

    // 4. Saved Money KPI
    const cancelledHistory = state.history.filter((h) => h.actionType === 'cancelled_saved');
    const totalSaved = cancelledHistory.reduce(
      (acc, h) => acc + convertAmount(h.amount, h.currency || 'EUR', state.mainCurrency),
      0
    );

    document.getElementById('kpiSavedMoney').textContent = formatCurrency(totalSaved, state.mainCurrency);
    document.getElementById('kpiSavedCount').textContent =
      state.lang === 'ro'
        ? `${cancelledHistory.length} reînnoiri nedorite evitate`
        : `${cancelledHistory.length} rinnov${cancelledHistory.length === 1 ? 'o evitato' : 'i evitati'} in tempo`;
  }

  function renderCounts() {
    const activeCount = state.items.filter((i) => i.status === 'active').length;
    const mustCancelCount = state.items.filter((i) => i.status === 'active' && i.cancelBeforeRenewal).length;
    document.getElementById('countAllActive').textContent = String(activeCount);
    document.getElementById('countMustCancel').textContent = String(mustCancelCount);
    document.getElementById('countHistory').textContent = String(state.history.length);
  }

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
          (i.notes && i.notes.toLowerCase().includes(q)) ||
          (i.paymentMethod && i.paymentMethod.toLowerCase().includes(q))
      );
    }

    list.sort((a, b) => {
      if (state.sortBy === 'cancelFirst') {
        if (a.cancelBeforeRenewal !== b.cancelBeforeRenewal) {
          return a.cancelBeforeRenewal ? -1 : 1;
        }
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

    grid.innerHTML = items
      .map((item) => {
        const days = getDaysRemaining(item.nextDate);
        const cycleMeta = window.BILLING_CYCLES[item.billingCycle] || {
          label: 'Mensile',
          short: '/mese',
          short_ro: '/lună'
        };
        const catMeta = window.CATEGORY_META[item.category] || {
          label: 'Altro',
          label_ro: 'Altele',
          icon: '📌'
        };
        const isBill = item.itemType === 'bill';
        const isCancelled = item.status === 'cancelled';
        const itemCurrency = item.currency || 'EUR';

        let countdownClass = 'countdown-ok';
        let countdownLabel = state.lang === 'ro' ? `Peste ${days} zile` : `Tra ${days} giorni`;

        if (isCancelled) {
          countdownClass = 'countdown-ok';
          countdownLabel = state.lang === 'ro' ? 'Anulat / Finalizat' : 'Disdetto / Concluso';
        } else if (days < 0) {
          countdownClass = 'countdown-danger';
          countdownLabel =
            state.lang === 'ro' ? `⚠️ Expirat de ${Math.abs(days)} zile` : `⚠️ Scaduto da ${Math.abs(days)} gg`;
        } else if (days === 0) {
          countdownClass = 'countdown-danger';
          countdownLabel = state.lang === 'ro' ? '🚨 SCADENT AZI!' : '🚨 SCADE OGGI!';
        } else if (days === 1) {
          countdownClass = 'countdown-danger';
          countdownLabel = state.lang === 'ro' ? '⏰ Scadent MÂINE!' : '⏰ Scade DOMANI!';
        } else if (days <= item.remindDaysBefore || (item.cancelBeforeRenewal && days <= 7)) {
          countdownClass = 'countdown-danger';
          countdownLabel = state.lang === 'ro' ? `⏳ Mai sunt ${days} zile` : `⏳ Mancano ${days} giorni`;
        } else if (days <= 14) {
          countdownClass = 'countdown-warning';
        }

        const recommendedCancelDate = formatLocalizedDate(
          formatDateInput(addDays(parseLocalDate(item.nextDate), -Math.max(1, Math.min(item.remindDaysBefore, 3))))
        );

        const cycleShort = state.lang === 'ro' ? cycleMeta.short_ro || cycleMeta.short : cycleMeta.short;
        const catLabel = state.lang === 'ro' ? catMeta.label_ro || catMeta.label : catMeta.label;

        return `
          <article class="sub-card ${item.cancelBeforeRenewal && !isCancelled ? 'must-cancel-card' : ''} ${isCancelled ? 'is-cancelled' : ''}">
            <div class="card-stripe" style="background-color: ${escapeAttr(item.color || '#6366f1')}"></div>

            <div class="card-head">
              <div class="card-service-info">
                <div class="service-avatar" style="border-color: ${escapeAttr(item.color || '#6366f1')}55">
                  ${escapeHtml(item.icon || catMeta.icon)}
                </div>
                <div>
                  <h3 class="service-title">${escapeHtml(item.name)}</h3>
                  <div class="service-meta">
                    ${
                      isCancelled
                        ? `<span class="tag tag-cancelled">${t('tagCancelled')}</span>`
                        : item.cancelBeforeRenewal
                        ? `<span class="tag tag-must-cancel">${t('tagMustCancelLong')}</span>`
                        : isBill
                        ? `<span class="tag tag-bill">${t('tagBillLong')}</span>`
                        : `<span class="tag tag-sub">${t('tagSubLong')}</span>`
                    }
                    <span class="text-muted" style="font-size:0.75rem;">${escapeHtml(catLabel)}</span>
                  </div>
                </div>
              </div>

              <div class="card-price-box">
                <div class="card-price">${formatCurrency(item.price, itemCurrency)}</div>
                <div class="card-cycle">${escapeHtml(cycleShort)}</div>
              </div>
            </div>

            <div class="card-deadline-box">
              <div class="deadline-row">
                <span>${isBill ? t('duePaymentLabel') : t('nextRenewalLabel')} <strong>${formatLocalizedDate(item.nextDate)}</strong></span>
                <span class="countdown-badge ${countdownClass}">${countdownLabel}</span>
              </div>
              <div class="deadline-row" style="font-size: 0.77rem; color: var(--text-muted);">
                <span>${t('remindBeforeLabel')} ${item.remindDaysBefore} ${t('daysBefore')}</span>
                ${item.paymentMethod ? `<span>💳 ${escapeHtml(item.paymentMethod)}</span>` : ''}
              </div>
              ${
                item.cancelBeforeRenewal && !isCancelled
                  ? `<div class="cancel-limit-callout">
                       ${t('cancelCalloutPrefix')} <strong>${recommendedCancelDate}</strong> ${t('cancelCalloutSuffix')}
                     </div>`
                  : ''
              }
            </div>

            ${item.notes ? `<div class="card-notes">📝 ${escapeHtml(item.notes)}</div>` : ''}

            <div class="card-footer-actions">
              <div class="card-primary-actions">
                ${
                  !isCancelled
                    ? `
                      ${
                        item.itemType === 'subscription' || item.cancelBeforeRenewal
                          ? `<button type="button" class="btn btn-xs ${item.cancelBeforeRenewal ? 'btn-danger' : 'btn-outline'}" data-action="mark-cancelled" data-id="${item.id}">
                               ${t('btnMarkCancelledShort')}
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
                    ? `<a href="${escapeAttr(item.cancelUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-ghost">${t('btnSite')}</a>`
                    : ''
                }
                <button type="button" class="btn btn-xs btn-ghost" data-action="export-ics-single" data-id="${item.id}" title=".ics">📅</button>
                <button type="button" class="btn btn-xs btn-ghost" data-action="edit" data-id="${item.id}" title="Edit">✏️</button>
                <button type="button" class="btn btn-xs btn-ghost text-danger" data-action="delete" data-id="${item.id}" title="Delete">🗑️</button>
              </div>
            </div>
          </article>
        `;
      })
      .join('');
  }

  // --- CALENDAR VIEW ---
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
      cellsHtml += `<div class="cal-day other-month"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = dateStr === todayStr;
      const dayEvents = activeItems.filter((item) => item.nextDate === dateStr);

      const eventsHtml = dayEvents
        .map((ev) => {
          const cls = ev.cancelBeforeRenewal ? 'must-cancel' : ev.itemType === 'bill' ? 'is-bill' : '';
          return `
            <div class="cal-event ${cls}" data-action="edit" data-id="${ev.id}" title="${escapeAttr(ev.name)}">
              ${escapeHtml(ev.icon)} ${escapeHtml(ev.name)} (${formatCurrency(ev.price, ev.currency || 'EUR')})
            </div>
          `;
        })
        .join('');

      cellsHtml += `
        <div class="cal-day ${isToday ? 'is-today' : ''}">
          <div class="cal-day-num">${day} ${isToday ? (state.lang === 'ro' ? '• Azi' : '• Oggi') : ''}</div>
          ${eventsHtml}
        </div>
      `;
    }

    grid.innerHTML = cellsHtml;
  }

  // --- HISTORY VIEW ---
  function renderHistory() {
    const listEl = document.getElementById('historyList');
    if (!listEl) return;

    if (state.history.length === 0) {
      listEl.innerHTML = `<p class="text-muted">${
        state.lang === 'ro'
          ? 'Nicio operațiune înregistrată în istoric.'
          : 'Nessuna operazione registrata nello storico.'
      }</p>`;
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
              <span class="tag ${isSaved ? 'tag-cancelled' : 'tag-sub'}" style="margin-left: 8px;">
                ${
                  isSaved
                    ? state.lang === 'ro'
                      ? '✂️ Anulat la timp (Economisit)'
                      : '✂️ Disdetto in tempo (Risparmiato)'
                    : state.lang === 'ro'
                    ? '✅ Plătit / Reînnoit'
                    : '✅ Pagato / Rinnovato'
                }
              </span>
              <div class="text-muted" style="font-size: 0.78rem; margin-top: 2px;">
                ${formatLocalizedDate(h.date)} • ${escapeHtml(h.details || '')}
              </div>
            </div>
            <div style="font-weight: 800; color: ${isSaved ? 'var(--success)' : 'var(--text-main)'};">
              ${isSaved ? '+ ' + formattedAmt : formattedAmt}
            </div>
          </div>
        `;
      })
      .join('');
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
      details:
        state.lang === 'ro'
          ? `Anulat înainte de reînnoirea din ${formatLocalizedDate(item.nextDate)}`
          : `Disdetto prima del rinnovo del ${formatLocalizedDate(item.nextDate)}`
    });

    saveItemsToLocal();
    renderAll();
    showToast(
      state.lang === 'ro'
        ? `✂️ Bravo! Ai anulat "${item.name}" și ai economisit ${formatCurrency(item.price, item.currency)}!`
        : `✂️ Grande! Hai disdetto "${item.name}" risparmiando ${formatCurrency(item.price, item.currency)}!`
    );
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
      showToast(`✅ "${item.name}" OK!`);
    } else {
      item.nextDate = addMonthsKeepDay(item.nextDate, cycleMeta.months);
      showToast(
        state.lang === 'ro'
          ? `✅ "${item.name}" plătit! Următoarea scadență: ${formatLocalizedDate(item.nextDate)}.`
          : `✅ "${item.name}" pagato! Prossima scadenza spostata al ${formatLocalizedDate(item.nextDate)}.`
      );
    }

    saveItemsToLocal();
    renderAll();
  }

  function handleToggleMustCancel(itemId) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;
    item.cancelBeforeRenewal = !item.cancelBeforeRenewal;
    saveItemsToLocal();
    renderAll();
    showToast(
      item.cancelBeforeRenewal
        ? `🛑 "${item.name}" -> ${t('tagMustCancel')}`
        : `🔄 "${item.name}" -> ${t('tagSubLong')}`
    );
  }

  function handleReactivateItem(itemId) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;
    item.status = 'active';
    item.cancelBeforeRenewal = true;
    item.nextDate = addMonthsKeepDay(formatDateInput(getTodayMidnight()), 1);
    saveItemsToLocal();
    renderAll();
    showToast(`♻️ "${item.name}" OK!`);
  }

  function handleDeleteItem(itemId) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;
    const msg =
      state.lang === 'ro'
        ? `Sigur vrei să ștergi "${item.name}"?`
        : `Vuoi eliminare definitivamente "${item.name}" dallo scadenzario?`;
    if (!confirm(msg)) return;
    state.items = state.items.filter((i) => i.id !== itemId);
    saveItemsToLocal();
    renderAll();
    showToast(`🗑️ "${item.name}"`);
  }

  // --- MODAL ADD / EDIT & PRESET PICKER ---
  function renderPresetChips() {
    const container = document.getElementById('presetChipsContainer');
    if (!container) return;

    const presets = window.SERVICE_PRESETS.filter(
      (p) => state.presetCategoryFilter === 'all' || p.category === state.presetCategoryFilter
    );

    container.innerHTML = presets
      .map(
        (p) => `
        <button type="button" class="preset-chip" data-preset-id="${p.id}">
          <span>${p.icon}</span>
          <span>${escapeHtml(p.name)}</span>
        </button>
      `
      )
      .join('');
  }

  function applyPresetToForm(presetId) {
    const preset = window.SERVICE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    document.getElementById('itemName').value = preset.name;
    document.getElementById('itemIcon').value = preset.icon;
    document.getElementById('itemCategory').value = preset.category;
    document.getElementById('itemPrice').value = preset.defaultPrice;
    document.getElementById('itemCurrency').value = preset.defaultCurrency || state.mainCurrency || 'EUR';
    document.getElementById('itemCycle').value = preset.billingCycle;
    document.getElementById('itemRemindDays').value = String(preset.remindDaysBefore);
    document.getElementById('itemColor').value = preset.color;
    document.getElementById('itemCancelUrl').value = preset.cancelUrl || '';
    document.getElementById('itemNotes').placeholder = preset.notesPlaceholder || '';

    const radioToSelect = document.querySelector(`input[name="itemType"][value="${preset.itemType}"]`);
    if (radioToSelect) radioToSelect.checked = true;
    updateFormVisibilityByType(preset.itemType);
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

  function openItemModal(mode = 'create', item = null, quickIntent = null) {
    const backdrop = document.getElementById('itemModalBackdrop');
    const form = document.getElementById('itemForm');
    const title = document.getElementById('modalTitle');
    const presetSection = document.getElementById('presetPickerSection');

    form.reset();
    const defaultNextMonth = addMonthsKeepDay(formatDateInput(getTodayMidnight()), 1);

    if (mode === 'edit' && item) {
      title.textContent = `${t('modalEditPrefix')} ${item.name}`;
      presetSection.classList.add('hidden');
      document.getElementById('itemId').value = item.id;
      document.getElementById('itemName').value = item.name;
      document.getElementById('itemIcon').value = item.icon || '🎬';
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
      presetSection.classList.remove('hidden');
      document.getElementById('itemId').value = '';
      document.getElementById('itemNextDate').value = defaultNextMonth;
      document.getElementById('itemColor').value = '#4f46e5';
      document.getElementById('itemCurrency').value = state.mainCurrency || 'EUR';

      if (quickIntent === 'trial-1-month') {
        title.textContent = t('modalTrialTitle');
        state.presetCategoryFilter = 'streaming';
        document.querySelector('input[name="itemType"][value="subscription"]').checked = true;
        updateFormVisibilityByType('subscription');
        document.getElementById('cancelBeforeRenewal').checked = true;
        document.getElementById('itemRemindDays').value = '5';
        document.getElementById('itemIcon').value = '🛑';
      } else if (quickIntent === 'bill-bollo') {
        title.textContent = t('modalBillTitle');
        state.presetCategoryFilter = 'bills';
        document.querySelector('input[name="itemType"][value="bill"]').checked = true;
        updateFormVisibilityByType('bill');
        document.getElementById('itemCategory').value = 'bills';
        document.getElementById('itemRemindDays').value = '7';
        document.getElementById('itemIcon').value = '⚡';
      } else {
        title.textContent = t('modalNewTitle');
        state.presetCategoryFilter = 'all';
        document.querySelector('input[name="itemType"][value="subscription"]').checked = true;
        updateFormVisibilityByType('subscription');
        document.getElementById('cancelBeforeRenewal').checked = false;
        document.getElementById('itemIcon').value = '🎬';
      }

      document.querySelectorAll('.preset-tab').forEach((tEl) => {
        tEl.classList.toggle('active', tEl.dataset.presetCat === state.presetCategoryFilter);
      });
      renderPresetChips();
    }

    backdrop.classList.remove('hidden');
  }

  function closeItemModal() {
    document.getElementById('itemModalBackdrop').classList.add('hidden');
  }

  function handleSaveItemForm(e) {
    e.preventDefault();

    const id = document.getElementById('itemId').value;
    const itemType = document.querySelector('input[name="itemType"]:checked').value;
    const name = document.getElementById('itemName').value.trim();
    const icon = document.getElementById('itemIcon').value.trim() || (itemType === 'bill' ? '⚡' : '🎬');
    const category = document.getElementById('itemCategory').value;
    const price = parseFloat(document.getElementById('itemPrice').value) || 0;
    const currency = document.getElementById('itemCurrency').value || 'EUR';
    const billingCycle = document.getElementById('itemCycle').value;
    const nextDate = document.getElementById('itemNextDate').value;
    const remindDaysBefore = parseInt(document.getElementById('itemRemindDays').value, 10) || 3;
    const cancelBeforeRenewal = itemType === 'subscription' && document.getElementById('cancelBeforeRenewal').checked;
    const paymentMethod = document.getElementById('itemPaymentMethod').value.trim();
    const color = document.getElementById('itemColor').value;
    const cancelUrl = document.getElementById('itemCancelUrl').value.trim();
    const notes = document.getElementById('itemNotes').value.trim();

    if (!name || !nextDate) return;

    if (id) {
      const existingIndex = state.items.findIndex((i) => i.id === id);
      if (existingIndex !== -1) {
        state.items[existingIndex] = {
          ...state.items[existingIndex],
          name,
          icon,
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
      showToast(`💾 "${name}" OK!`);
    } else {
      state.items.push({
        id: generateId(),
        name,
        icon,
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
      showToast(`✅ "${name}" OK!`);
    }

    saveItemsToLocal();
    closeItemModal();
    renderAll();
    checkAndSendDueNotifications(false);
  }

  // --- MULTI-USER VPS SERVER SYNC (USERNAME + PIN) ---
  function getVpsBaseUrl() {
    const customUrl = (state.vpsConfig.serverUrl || '').trim().replace(/\/+$/, '');
    return customUrl || '';
  }

  function saveVpsConfigFromModal() {
    const uEl = document.getElementById('vpsUsernameInput');
    const pEl = document.getElementById('vpsPinInput');
    const sEl = document.getElementById('vpsServerUrlInput');
    const aEl = document.getElementById('vpsAutoSync');

    if (uEl) state.vpsConfig.username = uEl.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (pEl) state.vpsConfig.pin = pEl.value.trim();
    if (sEl) state.vpsConfig.serverUrl = sEl.value.trim();
    if (aEl) state.vpsConfig.autoSync = aEl.checked;

    localStorage.setItem(STORAGE_KEYS.VPS_CONFIG, JSON.stringify(state.vpsConfig));
    updateSyncStatusUI();
  }

  async function pushToVpsServer(silent = false) {
    saveVpsConfigFromModal();
    const statusMsg = document.getElementById('vpsStatusMsg');

    if (!state.vpsConfig.username || !state.vpsConfig.pin) {
      if (!silent && statusMsg) {
        statusMsg.textContent = '⚠️ Inserisci Nome Utente (es. daniel o maria) e PIN personale.';
        statusMsg.style.color = 'var(--danger)';
      }
      return;
    }

    if (!silent && statusMsg) {
      statusMsg.textContent = '⏳ Salvataggio sul Server VPS in corso...';
      statusMsg.style.color = 'var(--text-secondary)';
    }

    try {
      const baseUrl = getVpsBaseUrl();
      const res = await fetch(`${baseUrl}/api/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: state.vpsConfig.username,
          pin: state.vpsConfig.pin,
          lang: state.lang,
          mainCurrency: state.mainCurrency,
          items: state.items,
          history: state.history
        })
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      state.vpsConfig.lastSyncAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEYS.VPS_CONFIG, JSON.stringify(state.vpsConfig));
      updateSyncStatusUI();

      if (!silent && statusMsg) {
        statusMsg.textContent = `✅ Profilo "${state.vpsConfig.username}" salvato sul Server VPS (${new Date().toLocaleTimeString()})!`;
        statusMsg.style.color = 'var(--success)';
        showToast(`🖥️ Profilo "${state.vpsConfig.username}" sincronizzato sulla VPS!`);
      }
    } catch (err) {
      if (!silent && statusMsg) {
        statusMsg.textContent = `❌ Errore connessione Server VPS: ${err.message}. Assicurati che server.py / Docker sia attivo sulla VPS.`;
        statusMsg.style.color = 'var(--danger)';
      }
    }
  }

  async function pullFromVpsServer() {
    saveVpsConfigFromModal();
    const statusMsg = document.getElementById('vpsStatusMsg');

    if (!state.vpsConfig.username || !state.vpsConfig.pin) {
      if (statusMsg) {
        statusMsg.textContent = '⚠️ Inserisci Nome Utente e PIN per accedere al tuo profilo.';
        statusMsg.style.color = 'var(--danger)';
      }
      return;
    }

    if (statusMsg) {
      statusMsg.textContent = `⏳ Accesso al profilo "${state.vpsConfig.username}" sul Server VPS...`;
      statusMsg.style.color = 'var(--text-secondary)';
    }

    try {
      const baseUrl = getVpsBaseUrl();
      const res = await fetch(`${baseUrl}/api/sync/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: state.vpsConfig.username,
          pin: state.vpsConfig.pin
        })
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      if (data.isNewUser) {
        // Il profilo non esisteva ancora sul server: salviamo i dati attuali per creare il nuovo profilo!
        await pushToVpsServer(false);
        if (statusMsg) {
          statusMsg.textContent = `🎉 Nuovo profilo "${state.vpsConfig.username}" creato e salvato sulla VPS!`;
          statusMsg.style.color = 'var(--success)';
        }
        return;
      }

      if (Array.isArray(data.items)) state.items = data.items;
      if (Array.isArray(data.history)) state.history = data.history;
      if (data.lang === 'it' || data.lang === 'ro') state.lang = data.lang;
      if (data.mainCurrency === 'EUR' || data.mainCurrency === 'RON') state.mainCurrency = data.mainCurrency;

      state.vpsConfig.lastSyncAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEYS.VPS_CONFIG, JSON.stringify(state.vpsConfig));
      saveItemsToLocal(false);
      renderAll();

      if (statusMsg) {
        statusMsg.textContent = `✅ Profilo "${state.vpsConfig.username}" caricato (${state.items.length} scadenze)!`;
        statusMsg.style.color = 'var(--success)';
      }
      showToast(`👤 Bentornato/a ${state.vpsConfig.username}! Dati caricati dalla VPS.`);
    } catch (err) {
      if (statusMsg) {
        statusMsg.textContent = `❌ Errore accesso VPS: ${err.message}`;
        statusMsg.style.color = 'var(--danger)';
      }
    }
  }

  function handleVpsLogout() {
    state.vpsConfig.username = '';
    state.vpsConfig.pin = '';
    state.vpsConfig.lastSyncAt = null;
    localStorage.setItem(STORAGE_KEYS.VPS_CONFIG, JSON.stringify(state.vpsConfig));
    updateSyncStatusUI();
    const statusMsg = document.getElementById('vpsStatusMsg');
    if (statusMsg) {
      statusMsg.textContent = '🚪 Profilo VPS disconnesso da questo dispositivo.';
      statusMsg.style.color = 'var(--text-muted)';
    }
    showToast('🚪 Profilo disconnesso.');
  }

  // --- BROWSER NOTIFICATIONS & SERVICE WORKER ---
  async function initServiceWorkerAndNotifications() {
    if ('serviceWorker' in navigator) {
      try {
        swRegistration = await navigator.serviceWorker.register('./sw.js');
      } catch (err) {
        console.warn('Service Worker non registrato:', err);
      }
    }
    updateNotificationStatusUI();
    setTimeout(() => {
      checkAndSendDueNotifications(false);
    }, 1500);
    setInterval(() => {
      checkAndSendDueNotifications(false);
    }, 30 * 60 * 1000);
  }

  function updateNotificationStatusUI() {
    const iconEl = document.getElementById('notifStatusIcon');
    const textEl = document.getElementById('notifStatusText');
    if (!iconEl || !textEl) return;

    if (!('Notification' in window)) {
      iconEl.textContent = '🔕';
      textEl.textContent = 'N/A';
      return;
    }

    if (Notification.permission === 'granted') {
      iconEl.textContent = '🔔';
      textEl.textContent = t('notifActive');
    } else if (Notification.permission === 'denied') {
      iconEl.textContent = '🚫';
      textEl.textContent = t('notifBlocked');
    } else {
      iconEl.textContent = '🔔';
      textEl.textContent = t('enableNotif');
    }
  }

  async function requestNotificationPermission() {
    if (!('Notification' in window)) {
      showToast('⚠️ Browser notifications non supportate', 'danger');
      return false;
    }

    if (Notification.permission === 'granted') {
      sendNativeNotification(
        state.lang === 'ro' ? '✅ Notificări ScadenzApp Active!' : '✅ Notifiche ScadenzApp Attive!',
        state.lang === 'ro'
          ? 'Vei primi alerte înainte de reînnoirea abonamentelor sau scadența facturilor.'
          : 'Riceverai un avviso prima del rinnovo dei tuoi abbonamenti o della scadenza di bollette e bollo auto.',
        null
      );
      showToast('🔔 Test OK!');
      return true;
    }

    const perm = await Notification.requestPermission();
    updateNotificationStatusUI();

    if (perm === 'granted') {
      sendNativeNotification('🎉 ScadenzApp', 'OK!', null);
      checkAndSendDueNotifications(true);
      return true;
    }
    return false;
  }

  function sendNativeNotification(title, body, itemId = null) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const options = {
      body,
      icon: './icon.svg',
      badge: './icon.svg',
      tag: itemId ? `scadenzapp-${itemId}` : `scadenzapp-test-${Date.now()}`,
      requireInteraction: true,
      data: { url: './index.html', itemId }
    };

    if (swRegistration && swRegistration.showNotification) {
      swRegistration.showNotification(title, options).catch(() => new Notification(title, options));
    } else {
      new Notification(title, options);
    }
  }

  function checkAndSendDueNotifications(forceAllUrgent = false) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const todayKey = formatDateInput(getTodayMidnight());
    let notifiedLog = {};
    try {
      notifiedLog = JSON.parse(localStorage.getItem(STORAGE_KEYS.NOTIFIED_LOG) || '{}');
    } catch (_) {
      notifiedLog = {};
    }

    const urgentItems = state.items.filter(isItemUrgent);
    urgentItems.forEach((item) => {
      const logKey = `${item.id}_${item.nextDate}_${todayKey}`;
      if (!forceAllUrgent && notifiedLog[logKey]) return;

      const days = getDaysRemaining(item.nextDate);
      const formattedAmt = formatCurrency(item.price, item.currency || 'EUR');
      const title = item.cancelBeforeRenewal
        ? `🛑 ${t('tagMustCancel')} ${item.name} (${formattedAmt})`
        : item.itemType === 'bill'
        ? `💳 ${t('tagBill')}: ${item.name} (${formattedAmt})`
        : `🔄 ${item.name} (${formattedAmt})`;

      const body = `${formatLocalizedDate(item.nextDate)} (${days} gg/zile)`;
      sendNativeNotification(title, body, item.id);
      notifiedLog[logKey] = true;
    });

    localStorage.setItem(STORAGE_KEYS.NOTIFIED_LOG, JSON.stringify(notifiedLog));
  }

  // --- EXPORT .ICS CALENDAR ---
  function formatIcsDate(dateStr) {
    return dateStr.replace(/-/g, '');
  }

  function exportToIcs(itemsToExport, filename = 'scadenze-abbonamenti-bollette.ics') {
    if (!itemsToExport || itemsToExport.length === 0) return;

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ScadenzApp//IT-RO//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ];

    itemsToExport.forEach((item) => {
      const dtStart = formatIcsDate(item.nextDate);
      const nextDayStr = formatIcsDate(formatDateInput(addDays(parseLocalDate(item.nextDate), 1)));
      const prefix = item.cancelBeforeRenewal ? '🛑 ' : item.itemType === 'bill' ? '💳 ' : '🔄 ';
      const summary = `${prefix}${item.name} (${formatCurrency(item.price, item.currency || 'EUR')})`;

      lines.push(
        'BEGIN:VEVENT',
        `UID:${item.id}@scadenzapp.local`,
        `DTSTAMP:${formatIcsDate(formatDateInput(new Date()))}T090000Z`,
        `DTSTART;VALUE=DATE:${dtStart}`,
        `DTEND;VALUE=DATE:${nextDayStr}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${item.notes || ''}`,
        'BEGIN:VALARM',
        `TRIGGER:-P${Math.max(1, item.remindDaysBefore || 3)}D`,
        'ACTION:DISPLAY',
        `DESCRIPTION:${summary}`,
        'END:VALARM',
        'END:VEVENT'
      );
    });

    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // --- LOCAL JSON EXPORT / IMPORT & GITHUB GIST SYNC ---
  function exportBackupJson() {
    const payload = {
      app: 'ScadenzApp',
      version: 2,
      exportedAt: new Date().toISOString(),
      lang: state.lang,
      mainCurrency: state.mainCurrency,
      items: state.items,
      history: state.history
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scadenzapp-backup-${formatDateInput(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importBackupJson(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || !Array.isArray(data.items)) throw new Error('JSON non valido');
        state.items = data.items;
        if (Array.isArray(data.history)) state.history = data.history;
        saveItemsToLocal();
        renderAll();
        showToast(`⬆️ ${state.items.length} OK!`);
      } catch (err) {
        showToast('⚠️ ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function saveGhConfigFromModal() {
    state.ghConfig.token = document.getElementById('ghTokenInput').value.trim();
    state.ghConfig.gistId = document.getElementById('ghGistIdInput').value.trim();
    state.ghConfig.autoSync = document.getElementById('ghAutoSync').checked;
    localStorage.setItem(STORAGE_KEYS.GH_CONFIG, JSON.stringify(state.ghConfig));
    updateSyncStatusUI();
  }

  function updateSyncStatusUI() {
    const storageBadge = document.getElementById('storageStatusBadge');
    const syncBtnLabel = document.getElementById('syncBtnLabel');
    const vpsBadge = document.getElementById('vpsSyncBadge');
    const ghBadge = document.getElementById('githubSyncBadge');

    const vpsU = document.getElementById('vpsUsernameInput');
    const vpsP = document.getElementById('vpsPinInput');
    const vpsS = document.getElementById('vpsServerUrlInput');
    const vpsA = document.getElementById('vpsAutoSync');

    if (vpsU && document.activeElement !== vpsU) vpsU.value = state.vpsConfig.username || '';
    if (vpsP && document.activeElement !== vpsP) vpsP.value = state.vpsConfig.pin || '';
    if (vpsS && document.activeElement !== vpsS) vpsS.value = state.vpsConfig.serverUrl || '';
    if (vpsA) vpsA.checked = Boolean(state.vpsConfig.autoSync);

    const tokenInput = document.getElementById('ghTokenInput');
    const gistInput = document.getElementById('ghGistIdInput');
    const autoCheck = document.getElementById('ghAutoSync');
    if (tokenInput && document.activeElement !== tokenInput) tokenInput.value = state.ghConfig.token || '';
    if (gistInput && document.activeElement !== gistInput) gistInput.value = state.ghConfig.gistId || '';
    if (autoCheck) autoCheck.checked = Boolean(state.ghConfig.autoSync);

    if (state.vpsConfig.username && state.vpsConfig.pin) {
      if (vpsBadge) {
        vpsBadge.textContent = `🟢 Profilo: ${state.vpsConfig.username}`;
        vpsBadge.style.color = 'var(--success)';
      }
      if (storageBadge) {
        storageBadge.textContent = `🖥️ VPS (${state.vpsConfig.username})`;
      }
      if (syncBtnLabel) {
        syncBtnLabel.textContent = `👤 ${state.vpsConfig.username}`;
      }
    } else {
      if (vpsBadge) {
        vpsBadge.textContent = 'Non connesso';
        vpsBadge.style.color = 'var(--text-muted)';
      }
      if (storageBadge) {
        storageBadge.textContent = state.ghConfig.gistId ? '💾 Locale + 🐙 GitHub' : t('localActive');
      }
      if (syncBtnLabel) {
        syncBtnLabel.textContent = t('profileSyncBtn');
      }
    }

    if (ghBadge) {
      ghBadge.textContent = state.ghConfig.gistId ? '✅ GitHub Gist' : 'Opzionale';
    }
  }

  async function pushToGitHubGist(silent = false) {
    saveGhConfigFromModal();
    const statusMsg = document.getElementById('ghStatusMsg');
    if (!state.ghConfig.token) return;

    const payloadContent = JSON.stringify(
      {
        app: 'ScadenzApp',
        updatedAt: new Date().toISOString(),
        lang: state.lang,
        mainCurrency: state.mainCurrency,
        items: state.items,
        history: state.history
      },
      null,
      2
    );

    const bodyData = {
      description: 'ScadenzApp Backup',
      public: false,
      files: { 'scadenzapp-db.json': { content: payloadContent } }
    };

    try {
      const isUpdate = Boolean(state.ghConfig.gistId);
      const url = isUpdate ? `https://api.github.com/gists/${state.ghConfig.gistId}` : 'https://api.github.com/gists';
      const res = await fetch(url, {
        method: isUpdate ? 'PATCH' : 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${state.ghConfig.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bodyData)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.ghConfig.gistId = data.id;
      localStorage.setItem(STORAGE_KEYS.GH_CONFIG, JSON.stringify(state.ghConfig));
      updateSyncStatusUI();
      if (!silent && statusMsg) {
        statusMsg.textContent = `✅ GitHub Gist ID: ${data.id}`;
        statusMsg.style.color = 'var(--success)';
      }
    } catch (err) {
      if (!silent && statusMsg) {
        statusMsg.textContent = `❌ GitHub: ${err.message}`;
        statusMsg.style.color = 'var(--danger)';
      }
    }
  }

  async function pullFromGitHubGist() {
    saveGhConfigFromModal();
    const statusMsg = document.getElementById('ghStatusMsg');
    if (!state.ghConfig.token || !state.ghConfig.gistId) return;

    try {
      const res = await fetch(`https://api.github.com/gists/${state.ghConfig.gistId}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${state.ghConfig.token}`
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const gist = await res.json();
      const fileObj = gist.files && (gist.files['scadenzapp-db.json'] || Object.values(gist.files)[0]);
      const parsed = JSON.parse(fileObj.content);
      if (Array.isArray(parsed.items)) state.items = parsed.items;
      if (Array.isArray(parsed.history)) state.history = parsed.history;
      saveItemsToLocal(false);
      renderAll();
      if (statusMsg) {
        statusMsg.textContent = `✅ Scaricate ${state.items.length} voci da GitHub!`;
        statusMsg.style.color = 'var(--success)';
      }
    } catch (err) {
      if (statusMsg) {
        statusMsg.textContent = `❌ GitHub Pull: ${err.message}`;
        statusMsg.style.color = 'var(--danger)';
      }
    }
  }

  // --- UTILITIES ---
  function showToast(message) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3800);
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

  // --- EVENT LISTENERS BINDING ---
  function bindEvents() {
    // Language Toggle (IT <-> RO)
    document.getElementById('btnLangToggle').addEventListener('click', () => {
      state.lang = state.lang === 'it' ? 'ro' : 'it';
      saveItemsToLocal();
      renderAll();
      showToast(state.lang === 'ro' ? '🇷🇴 Limba schimbată în Română!' : '🇮🇹 Lingua impostata su Italiano!');
    });

    // Main Currency Toggle (EUR <-> RON)
    document.getElementById('btnCurrencyToggle').addEventListener('click', () => {
      state.mainCurrency = state.mainCurrency === 'EUR' ? 'RON' : 'EUR';
      saveItemsToLocal();
      renderAll();
      showToast(
        state.mainCurrency === 'RON'
          ? '🇷🇴 Valuta principale: RON (lei)'
          : '💶 Valuta principale: EUR (€)'
      );
    });

    // Main Add & Quick Intent buttons
    document.getElementById('btnAddNewMain').addEventListener('click', () => openItemModal('create'));
    document.getElementById('btnEmptyAdd').addEventListener('click', () => openItemModal('create'));
    document.getElementById('btnQuickTrial').addEventListener('click', () => openItemModal('create', null, 'trial-1-month'));
    document.getElementById('btnQuickSub').addEventListener('click', () => openItemModal('create', null, 'sub'));
    document.getElementById('btnQuickBill').addEventListener('click', () => openItemModal('create', null, 'bill-bollo'));

    document.getElementById('btnLoadDemoData').addEventListener('click', () => {
      state.items = getStarterExamples(state.lang);
      saveItemsToLocal();
      renderAll();
    });

    // Modal close & form submit
    document.getElementById('btnCloseItemModal').addEventListener('click', closeItemModal);
    document.getElementById('btnCancelModal').addEventListener('click', closeItemModal);
    document.getElementById('itemForm').addEventListener('submit', handleSaveItemForm);

    document.querySelectorAll('input[name="itemType"]').forEach((radio) => {
      radio.addEventListener('change', (e) => updateFormVisibilityByType(e.target.value));
    });

    document.querySelectorAll('.preset-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.presetCategoryFilter = tab.dataset.presetCat;
        document.querySelectorAll('.preset-tab').forEach((tEl) => tEl.classList.remove('active'));
        tab.classList.add('active');
        renderPresetChips();
      });
    });

    document.getElementById('presetChipsContainer').addEventListener('click', (e) => {
      const chip = e.target.closest('.preset-chip');
      if (!chip) return;
      applyPresetToForm(chip.dataset.presetId);
    });

    document.body.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-action]');
      if (!actionBtn) return;

      const action = actionBtn.dataset.action;
      const id = actionBtn.dataset.id;

      if (action === 'mark-cancelled') handleMarkCancelled(id);
      else if (action === 'mark-paid') handleMarkPaidOrRenewed(id);
      else if (action === 'toggle-must-cancel') handleToggleMustCancel(id);
      else if (action === 'reactivate') handleReactivateItem(id);
      else if (action === 'delete') handleDeleteItem(id);
      else if (action === 'edit') {
        const item = state.items.find((i) => i.id === id);
        if (item) openItemModal('edit', item);
      } else if (action === 'export-ics-single') {
        const item = state.items.find((i) => i.id === id);
        if (item) exportToIcs([item], `scadenza-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`);
      }
    });

    document.querySelectorAll('.view-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.currentView = tab.dataset.view;
        document.querySelectorAll('.view-tab').forEach((tEl) => {
          tEl.classList.toggle('active', tEl === tab);
          tEl.setAttribute('aria-selected', String(tEl === tab));
        });

        document.getElementById('viewList').classList.toggle('hidden', state.currentView !== 'list');
        document.getElementById('listFiltersContainer').classList.toggle('hidden', state.currentView !== 'list');
        document.getElementById('viewCalendar').classList.toggle('hidden', state.currentView !== 'calendar');
        document.getElementById('viewHistory').classList.toggle('hidden', state.currentView !== 'history');
      });
    });

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

    document.getElementById('btnPrevMonth').addEventListener('click', () => {
      state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() - 1, 1);
      renderCalendar();
    });
    document.getElementById('btnNextMonth').addEventListener('click', () => {
      state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + 1, 1);
      renderCalendar();
    });

    document.getElementById('btnClearHistory').addEventListener('click', () => {
      if (!confirm('OK?')) return;
      state.history = [];
      saveItemsToLocal();
      renderAll();
    });

    document.getElementById('btnNotificationStatus').addEventListener('click', requestNotificationPermission);
    document.getElementById('btnTriggerBrowserNotif').addEventListener('click', async () => {
      const ok = await requestNotificationPermission();
      if (ok) checkAndSendDueNotifications(true);
    });

    document.getElementById('btnExportIcsAll').addEventListener('click', () => {
      const active = state.items.filter((i) => i.status === 'active');
      exportToIcs(active);
    });

    // Sync & Profile Modal
    const syncBackdrop = document.getElementById('syncModalBackdrop');
    document.getElementById('btnOpenSyncModal').addEventListener('click', () => {
      updateSyncStatusUI();
      syncBackdrop.classList.remove('hidden');
    });
    document.getElementById('btnCloseSyncModal').addEventListener('click', () => {
      syncBackdrop.classList.add('hidden');
    });

    // VPS Multi-user buttons
    document.getElementById('btnVpsPull').addEventListener('click', pullFromVpsServer);
    document.getElementById('btnVpsPush').addEventListener('click', () => pushToVpsServer(false));
    document.getElementById('btnVpsLogout').addEventListener('click', handleVpsLogout);

    // Local & GitHub buttons
    document.getElementById('btnExportJson').addEventListener('click', exportBackupJson);
    document.getElementById('inputImportJson').addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        importBackupJson(e.target.files[0]);
        e.target.value = '';
      }
    });
    document.getElementById('btnSaveGhConfig').addEventListener('click', () => {
      saveGhConfigFromModal();
      showToast('💾 GitHub OK!');
    });
    document.getElementById('btnGhPush').addEventListener('click', () => pushToGitHubGist(false));
    document.getElementById('btnGhPull').addEventListener('click', pullFromGitHubGist);

    document.getElementById('btnThemeToggle').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(STORAGE_KEYS.THEME, next);
      updateThemeButtonIcon(next);
    });
  }

  // --- INIT ---
  document.addEventListener('DOMContentLoaded', () => {
    loadState();
    bindEvents();
    renderAll();
    initServiceWorkerAndNotifications();
  });
})();

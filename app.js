(() => {
  'use strict';

  // --- STORAGE KEYS ---
  const STORAGE_KEYS = {
    ITEMS: 'scadenzapp_items_v1',
    HISTORY: 'scadenzapp_history_v1',
    GH_CONFIG: 'scadenzapp_gh_config_v1',
    THEME: 'scadenzapp_theme_v1',
    NOTIFIED_LOG: 'scadenzapp_notified_log_v1'
  };

  // --- APPLICATION STATE ---
  let state = {
    items: [],
    history: [],
    currentView: 'list', // 'list' | 'calendar' | 'history'
    currentFilter: 'all', // 'all' | 'must-cancel' | 'subscriptions' | 'bills' | 'auto' | 'cancelled'
    searchQuery: '',
    sortBy: 'dueDateAsc',
    calendarDate: new Date(),
    presetCategoryFilter: 'all',
    ghConfig: {
      token: '',
      gistId: '',
      autoSync: false,
      lastSyncAt: null
    }
  };

  let swRegistration = null;

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

  function formatItalianDate(dateStr) {
    if (!dateStr) return '-';
    const d = parseLocalDate(dateStr);
    return d.toLocaleDateString('it-IT', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  function formatCurrency(val) {
    const num = Number(val) || 0;
    return num.toLocaleString('it-IT', {
      style: 'currency',
      currency: 'EUR'
    });
  }

  function generateId() {
    return 'item_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
  }

  // --- LOAD & SAVE DATA ---
  function loadState() {
    try {
      const savedItems = localStorage.getItem(STORAGE_KEYS.ITEMS);
      const savedHistory = localStorage.getItem(STORAGE_KEYS.HISTORY);
      const savedGh = localStorage.getItem(STORAGE_KEYS.GH_CONFIG);
      const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);

      if (savedItems) {
        state.items = JSON.parse(savedItems);
      } else {
        // First time user: load helpful realistic starter examples so the user immediately sees how it works
        state.items = getStarterExamples();
        saveItemsToLocal(false);
      }

      if (savedHistory) {
        state.history = JSON.parse(savedHistory);
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

  function saveItemsToLocal(triggerGhSync = true) {
    try {
      localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify(state.items));
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(state.history));
      flashLocalSavedBadge();
      if (triggerGhSync && state.ghConfig.autoSync && state.ghConfig.token) {
        pushToGitHubGist(true);
      }
    } catch (err) {
      console.error('Errore salvataggio locale:', err);
      showToast('⚠️ Errore nel salvataggio locale', 'danger');
    }
  }

  function flashLocalSavedBadge() {
    const badge = document.getElementById('storageStatusBadge');
    if (!badge) return;
    badge.textContent = '💾 Salvato in locale';
    setTimeout(() => {
      badge.textContent = state.ghConfig.gistId
        ? '💾 Locale + 🐙 GitHub'
        : '💾 Locale Attivo';
    }, 1500);
  }

  function getStarterExamples() {
    const today = getTodayMidnight();
    return [
      {
        id: generateId(),
        name: 'Disney+ (Solo 1 Mese)',
        icon: '✨',
        category: 'streaming',
        itemType: 'subscription',
        price: 9.99,
        billingCycle: 'monthly',
        nextDate: formatDateInput(addDays(today, 3)),
        remindDaysBefore: 5,
        cancelBeforeRenewal: true, // Esempio chiave: abbonamento fatto per 1 mese da disdire!
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
    // Se l'utente ha segnato "Voglio disdirlo prima del rinnovo", mostriamolo negli avvisi già da 10 giorni prima
    if (item.cancelBeforeRenewal && days <= Math.max(item.remindDaysBefore, 10)) return true;
    return false;
  }

  function getMonthlyEquivalent(item) {
    const price = Number(item.price) || 0;
    const cycleInfo = window.BILLING_CYCLES[item.billingCycle];
    if (!cycleInfo || cycleInfo.months === 0) return price;
    return price / cycleInfo.months;
  }

  function getYearlyEquivalent(item) {
    const price = Number(item.price) || 0;
    const cycleInfo = window.BILLING_CYCLES[item.billingCycle];
    if (!cycleInfo || cycleInfo.months === 0) return price;
    return (price * 12) / cycleInfo.months;
  }

  // --- RENDERING DASHBOARD ---
  function renderAll() {
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
    titleEl.textContent =
      mustCancelCount > 0
        ? `🚨 Attenzione: ${urgentItems.length} scadenze imminenti (${mustCancelCount} DA DISDIRE per non pagare!)`
        : `⚠️ ${urgentItems.length} Scadenze / Pagamenti in arrivo nei prossimi giorni`;

    listEl.innerHTML = urgentItems
      .map((item) => {
        const days = getDaysRemaining(item.nextDate);
        const isBill = item.itemType === 'bill';
        let timingText = '';
        if (days < 0) {
          timingText = `SCADUTO da ${Math.abs(days)} giorni (${formatItalianDate(item.nextDate)})`;
        } else if (days === 0) {
          timingText = `SCADE OGGI (${formatItalianDate(item.nextDate)})!`;
        } else if (days === 1) {
          timingText = `Scade DOMANI (${formatItalianDate(item.nextDate)})`;
        } else {
          timingText = `Tra ${days} giorni (${formatItalianDate(item.nextDate)})`;
        }

        const cancelDeadline = formatItalianDate(
          formatDateInput(addDays(parseLocalDate(item.nextDate), -1))
        );

        return `
          <div class="urgent-banner-item ${isBill ? 'is-bill-alert' : ''}">
            <div class="urgent-item-top">
              <div class="urgent-item-name">
                <span>${escapeHtml(item.icon || '🔔')}</span>
                <span>${escapeHtml(item.name)}</span>
                ${
                  item.cancelBeforeRenewal
                    ? `<span class="tag tag-must-cancel">🛑 DA DISDIRE!</span>`
                    : isBill
                    ? `<span class="tag tag-bill">💳 DA PAGARE</span>`
                    : `<span class="tag tag-sub">🔄 RINNOVO</span>`
                }
              </div>
              <strong>${formatCurrency(item.price)}</strong>
            </div>
            <div class="urgent-item-msg">
              <strong>${timingText}</strong>
              ${
                item.cancelBeforeRenewal
                  ? ` • 🛑 Disdici entro il <strong>${cancelDeadline}</strong> per evitare l'addebito!`
                  : isBill
                  ? ` • Ricordati di effettuare il pagamento entro la scadenza.`
                  : ` • Rinnovo automatico previsto il ${formatItalianDate(item.nextDate)}.`
              }
            </div>
            <div class="urgent-item-actions">
              ${
                item.cancelBeforeRenewal || item.itemType === 'subscription'
                  ? `<button type="button" class="btn btn-xs btn-danger" data-action="mark-cancelled" data-id="${item.id}">
                       ✂️ Ho Disdetto (Salva ${formatCurrency(item.price)})
                     </button>`
                  : ''
              }
              ${
                item.cancelUrl
                  ? `<a href="${escapeAttr(item.cancelUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-outline">
                       🔗 ${isBill ? 'Vai al Pagamento' : 'Pagina Disdetta'}
                     </a>`
                  : ''
              }
              <button type="button" class="btn btn-xs btn-success" data-action="mark-paid" data-id="${item.id}">
                ✅ ${isBill ? 'Segna Pagato' : 'Conferma Rinnovo'}
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
    document.getElementById('kpiUrgentSub').textContent =
      mustCancelActive.length > 0
        ? `${mustCancelActive.length} abbonament${mustCancelActive.length === 1 ? 'o' : 'i'} impostati "Da Disdire"`
        : urgentItems.length > 0
        ? 'Controlla il banner avvisi qui sopra'
        : 'Tutto sotto controllo!';

    // 2. Subscriptions KPI (excluding one-month trials marked to cancel? No, include active subscriptions so user sees what they pay if they don't cancel!)
    const activeSubs = activeItems.filter((i) => i.itemType === 'subscription');
    const monthlySubsTotal = activeSubs.reduce((acc, item) => acc + getMonthlyEquivalent(item), 0);
    const yearlySubsTotal = activeSubs.reduce((acc, item) => acc + getYearlyEquivalent(item), 0);

    document.getElementById('kpiMonthlySubs').textContent = formatCurrency(monthlySubsTotal);
    document.getElementById('kpiYearlySubs').textContent = `Proiezione annua: ${formatCurrency(yearlySubsTotal)} (${activeSubs.length} attivi)`;

    // 3. Bills & Bollo Auto KPI
    const activeBills = activeItems.filter((i) => i.itemType === 'bill');
    const yearlyBillsTotal = activeBills.reduce((acc, item) => acc + getYearlyEquivalent(item), 0);
    const monthlyBillsAvg = yearlyBillsTotal / 12;

    document.getElementById('kpiYearlyBills').textContent = formatCurrency(yearlyBillsTotal);
    document.getElementById('kpiMonthlyBills').textContent = `Media mensile: ${formatCurrency(monthlyBillsAvg)}/mese (${activeBills.length} voci)`;

    // 4. Saved Money KPI (from cancelled subscriptions in history + cancelled items)
    const cancelledHistory = state.history.filter((h) => h.actionType === 'cancelled_saved');
    const totalSaved = cancelledHistory.reduce((acc, h) => acc + (Number(h.amount) || 0), 0);

    document.getElementById('kpiSavedMoney').textContent = formatCurrency(totalSaved);
    document.getElementById('kpiSavedCount').textContent = `${cancelledHistory.length} rinnov${cancelledHistory.length === 1 ? 'o evitato' : 'i evitati'} in tempo`;
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

    // Filter by category/tab
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

    // Filter by search query
    if (state.searchQuery.trim() !== '') {
      const q = state.searchQuery.toLowerCase().trim();
      list = list.filter(
        (i) =>
          (i.name && i.name.toLowerCase().includes(q)) ||
          (i.notes && i.notes.toLowerCase().includes(q)) ||
          (i.paymentMethod && i.paymentMethod.toLowerCase().includes(q))
      );
    }

    // Sort
    list.sort((a, b) => {
      if (state.sortBy === 'cancelFirst') {
        if (a.cancelBeforeRenewal !== b.cancelBeforeRenewal) {
          return a.cancelBeforeRenewal ? -1 : 1;
        }
        return getDaysRemaining(a.nextDate) - getDaysRemaining(b.nextDate);
      }
      if (state.sortBy === 'priceDesc') {
        return (Number(b.price) || 0) - (Number(a.price) || 0);
      }
      if (state.sortBy === 'nameAsc') {
        return (a.name || '').localeCompare(b.name || '', 'it');
      }
      // Default: dueDateAsc
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
        const cycleMeta = window.BILLING_CYCLES[item.billingCycle] || { label: 'Mensile', short: '/mese' };
        const catMeta = window.CATEGORY_META[item.category] || { label: 'Altro', icon: '📌' };
        const isBill = item.itemType === 'bill';
        const isCancelled = item.status === 'cancelled';

        // Countdown badge style & label
        let countdownClass = 'countdown-ok';
        let countdownLabel = `Tra ${days} giorni`;

        if (isCancelled) {
          countdownClass = 'countdown-ok';
          countdownLabel = 'Disdetto / Concluso';
        } else if (days < 0) {
          countdownClass = 'countdown-danger';
          countdownLabel = `⚠️ Scaduto da ${Math.abs(days)} gg`;
        } else if (days === 0) {
          countdownClass = 'countdown-danger';
          countdownLabel = '🚨 SCADE OGGI!';
        } else if (days === 1) {
          countdownClass = 'countdown-danger';
          countdownLabel = '⏰ Scade DOMANI!';
        } else if (days <= item.remindDaysBefore || (item.cancelBeforeRenewal && days <= 7)) {
          countdownClass = 'countdown-danger';
          countdownLabel = `⏳ Mancano ${days} giorni`;
        } else if (days <= 14) {
          countdownClass = 'countdown-warning';
          countdownLabel = `Tra ${days} giorni`;
        }

        const recommendedCancelDate = formatItalianDate(
          formatDateInput(addDays(parseLocalDate(item.nextDate), -Math.max(1, Math.min(item.remindDaysBefore, 3))))
        );

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
                        ? `<span class="tag tag-cancelled">✂️ Disdetto / Non attivo</span>`
                        : item.cancelBeforeRenewal
                        ? `<span class="tag tag-must-cancel">🛑 DA DISDIRE (1 Mese/Prova)</span>`
                        : isBill
                        ? `<span class="tag tag-bill">💳 Bolletta / Scadenza</span>`
                        : `<span class="tag tag-sub">🔄 Rinnovo Automatico</span>`
                    }
                    <span class="text-muted" style="font-size:0.75rem;">${escapeHtml(catMeta.label)}</span>
                  </div>
                </div>
              </div>

              <div class="card-price-box">
                <div class="card-price">${formatCurrency(item.price)}</div>
                <div class="card-cycle">${escapeHtml(cycleMeta.short)}</div>
              </div>
            </div>

            <div class="card-deadline-box">
              <div class="deadline-row">
                <span>${isBill ? '📅 Scadenza pagamento:' : '📅 Prossimo rinnovo:'} <strong>${formatItalianDate(item.nextDate)}</strong></span>
                <span class="countdown-badge ${countdownClass}">${countdownLabel}</span>
              </div>
              <div class="deadline-row" style="font-size: 0.77rem; color: var(--text-muted);">
                <span>🔔 Preavviso: ${item.remindDaysBefore} gg prima</span>
                ${item.paymentMethod ? `<span>💳 ${escapeHtml(item.paymentMethod)}</span>` : ''}
              </div>
              ${
                item.cancelBeforeRenewal && !isCancelled
                  ? `<div class="cancel-limit-callout">
                       🛑 <strong>Ricordati di disdire!</strong> Consigliato entro il <strong>${recommendedCancelDate}</strong> per non pagare il rinnovo.
                     </div>`
                  : ''
              }
            </div>

            ${
              item.notes
                ? `<div class="card-notes">📝 ${escapeHtml(item.notes)}</div>`
                : ''
            }

            <div class="card-footer-actions">
              <div class="card-primary-actions">
                ${
                  !isCancelled
                    ? `
                      ${
                        item.itemType === 'subscription' || item.cancelBeforeRenewal
                          ? `<button type="button" class="btn btn-xs ${item.cancelBeforeRenewal ? 'btn-danger' : 'btn-outline'}" data-action="mark-cancelled" data-id="${item.id}" title="Segna che hai disdetto l'abbonamento in tempo">
                               ✂️ Disdetto
                             </button>`
                          : ''
                      }
                      <button type="button" class="btn btn-xs btn-success" data-action="mark-paid" data-id="${item.id}" title="${isBill ? 'Registra pagamento e sposta alla prossima scadenza' : 'Conferma rinnovo e sposta al prossimo ciclo'}">
                        ✅ ${isBill ? 'Pagato' : 'Rinnovato'}
                      </button>
                      ${
                        item.itemType === 'subscription'
                          ? `<button type="button" class="btn btn-xs btn-ghost" data-action="toggle-must-cancel" data-id="${item.id}" title="Attiva/Disattiva promemoria 'Voglio disdirlo prima del rinnovo'">
                               ${item.cancelBeforeRenewal ? '🔄 Tienilo attivo' : '🛑 Voglio disdirlo'}
                             </button>`
                          : ''
                      }
                    `
                    : `
                      <button type="button" class="btn btn-xs btn-primary" data-action="reactivate" data-id="${item.id}">
                        ♻️ Riattiva per 1 mese / nuovo ciclo
                      </button>
                    `
                }
              </div>

              <div class="card-secondary-actions">
                ${
                  item.cancelUrl
                    ? `<a href="${escapeAttr(item.cancelUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-ghost" title="Apri link disdetta o pagamento">🔗 Sito</a>`
                    : ''
                }
                <button type="button" class="btn btn-xs btn-ghost" data-action="export-ics-single" data-id="${item.id}" title="Scarica promemoria per Calendario (.ics)">📅</button>
                <button type="button" class="btn btn-xs btn-ghost" data-action="edit" data-id="${item.id}" title="Modifica">✏️</button>
                <button type="button" class="btn btn-xs btn-ghost text-danger" data-action="delete" data-id="${item.id}" title="Elimina">🗑️</button>
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

    const monthName = new Date(year, month, 1).toLocaleDateString('it-IT', {
      month: 'long',
      year: 'numeric'
    });
    title.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    const firstDayOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // Monday-based index (0 = Mon ... 6 = Sun)
    const startWeekday = (firstDayOfMonth.getDay() + 6) % 7;

    const todayStr = formatDateInput(getTodayMidnight());
    const activeItems = state.items.filter((i) => i.status === 'active');

    let cellsHtml = '';

    // Empty leading cells
    for (let i = 0; i < startWeekday; i++) {
      cellsHtml += `<div class="cal-day other-month"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = dateStr === todayStr;

      const dayEvents = activeItems.filter((item) => item.nextDate === dateStr);

      const eventsHtml = dayEvents
        .map((ev) => {
          const cls = ev.cancelBeforeRenewal
            ? 'must-cancel'
            : ev.itemType === 'bill'
            ? 'is-bill'
            : '';
          return `
            <div class="cal-event ${cls}" data-action="edit" data-id="${ev.id}" title="${escapeAttr(ev.name)} - ${formatCurrency(ev.price)}">
              ${escapeHtml(ev.icon)} ${escapeHtml(ev.name)} (${formatCurrency(ev.price)})
            </div>
          `;
        })
        .join('');

      cellsHtml += `
        <div class="cal-day ${isToday ? 'is-today' : ''}">
          <div class="cal-day-num">${day} ${isToday ? '• Oggi' : ''}</div>
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
      listEl.innerHTML = `<p class="text-muted">Nessuna operazione registrata nello storico. Quando segni una bolletta come "Pagata" o un abbonamento come "Disdetto", comparirà qui.</p>`;
      return;
    }

    listEl.innerHTML = state.history
      .map((h) => {
        const isSaved = h.actionType === 'cancelled_saved';
        return `
          <div class="history-row">
            <div>
              <strong>${escapeHtml(h.icon || '🧾')} ${escapeHtml(h.name)}</strong>
              <span class="tag ${isSaved ? 'tag-cancelled' : 'tag-sub'}" style="margin-left: 8px;">
                ${isSaved ? '✂️ Disdetto in tempo (Risparmiato)' : '✅ Pagato / Rinnovato'}
              </span>
              <div class="text-muted" style="font-size: 0.78rem; margin-top: 2px;">
                ${formatItalianDate(h.date)} • ${escapeHtml(h.details || '')}
              </div>
            </div>
            <div style="font-weight: 800; color: ${isSaved ? 'var(--success)' : 'var(--text-main)'};">
              ${isSaved ? '+ ' + formatCurrency(h.amount) + ' salvati' : formatCurrency(h.amount)}
            </div>
          </div>
        `;
      })
      .join('');
  }

  // --- ITEM ACTIONS (MARK CANCELLED, MARK PAID, TOGGLE, EDIT, DELETE) ---
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
      date: formatDateInput(getTodayMidnight()),
      details: `Disdetto prima del rinnovo del ${formatItalianDate(item.nextDate)}`
    });

    saveItemsToLocal();
    renderAll();
    showToast(`✂️ Grande! Hai disdetto "${item.name}" risparmiando ${formatCurrency(item.price)}!`);
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
      date: paidDateStr,
      details: `${item.itemType === 'bill' ? 'Pagamento effettuato' : 'Rinnovo confermato'} (scadenza ${formatItalianDate(oldDueDate)})`
    });

    if (!cycleMeta || cycleMeta.months === 0) {
      // Era una scadenza singola / una tantum
      item.status = 'cancelled';
      showToast(`✅ "${item.name}" segnato come pagato e concluso!`);
    } else {
      // Avanza automaticamente alla prossima scadenza
      item.nextDate = addMonthsKeepDay(item.nextDate, cycleMeta.months);
      showToast(`✅ "${item.name}" pagato! Prossima scadenza spostata al ${formatItalianDate(item.nextDate)}.`);
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
        ? `🛑 "${item.name}" impostato come DA DISDIRE prima del rinnovo!`
        : `🔄 "${item.name}" impostato come abbonamento attivo ricorrente.`
    );
  }

  function handleReactivateItem(itemId) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;
    item.status = 'active';
    item.cancelBeforeRenewal = true; // Utile se lo riattiva per 1 mese!
    item.nextDate = addMonthsKeepDay(formatDateInput(getTodayMidnight()), 1);
    saveItemsToLocal();
    renderAll();
    showToast(`♻️ "${item.name}" riattivato per 1 mese (con avviso di disdetta attivo)!`);
  }

  function handleDeleteItem(itemId) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;
    if (!confirm(`Vuoi eliminare definitivamente "${item.name}" dallo scadenzario?`)) return;
    state.items = state.items.filter((i) => i.id !== itemId);
    saveItemsToLocal();
    renderAll();
    showToast(`🗑️ "${item.name}" eliminato.`);
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
      labelNextDate.textContent = 'Data Scadenza Pagamento *';
    } else {
      antiRenewalBox.classList.remove('hidden');
      labelNextDate.textContent = 'Data Prossimo Rinnovo / Addebito *';
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
      title.textContent = `✏️ Modifica: ${item.name}`;
      presetSection.classList.add('hidden');
      document.getElementById('itemId').value = item.id;
      document.getElementById('itemName').value = item.name;
      document.getElementById('itemIcon').value = item.icon || '🎬';
      document.getElementById('itemCategory').value = item.category || 'streaming';
      document.getElementById('itemPrice').value = item.price;
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

      if (quickIntent === 'trial-1-month') {
        title.textContent = '🛑 Nuovo Abbonamento "Solo 1 Mese / Da Disdire"';
        state.presetCategoryFilter = 'streaming';
        document.querySelector('input[name="itemType"][value="subscription"]').checked = true;
        updateFormVisibilityByType('subscription');
        document.getElementById('cancelBeforeRenewal').checked = true;
        document.getElementById('itemRemindDays').value = '5';
        document.getElementById('itemIcon').value = '🛑';
      } else if (quickIntent === 'bill-bollo') {
        title.textContent = '🚗 Nuova Bolletta / Bollo Auto / Scadenza';
        state.presetCategoryFilter = 'bills';
        document.querySelector('input[name="itemType"][value="bill"]').checked = true;
        updateFormVisibilityByType('bill');
        document.getElementById('itemCategory').value = 'bills';
        document.getElementById('itemRemindDays').value = '7';
        document.getElementById('itemIcon').value = '⚡';
      } else {
        title.textContent = '＋ Nuova Scadenza / Abbonamento';
        state.presetCategoryFilter = 'all';
        document.querySelector('input[name="itemType"][value="subscription"]').checked = true;
        updateFormVisibilityByType('subscription');
        document.getElementById('cancelBeforeRenewal').checked = false;
        document.getElementById('itemIcon').value = '🎬';
      }

      document.querySelectorAll('.preset-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.presetCat === state.presetCategoryFilter);
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
    const billingCycle = document.getElementById('itemCycle').value;
    const nextDate = document.getElementById('itemNextDate').value;
    const remindDaysBefore = parseInt(document.getElementById('itemRemindDays').value, 10) || 3;
    const cancelBeforeRenewal = itemType === 'subscription' && document.getElementById('cancelBeforeRenewal').checked;
    const paymentMethod = document.getElementById('itemPaymentMethod').value.trim();
    const color = document.getElementById('itemColor').value;
    const cancelUrl = document.getElementById('itemCancelUrl').value.trim();
    const notes = document.getElementById('itemNotes').value.trim();

    if (!name || !nextDate) {
      showToast('⚠️ Compila nome e data di scadenza', 'danger');
      return;
    }

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
      showToast(`💾 "${name}" aggiornato con successo!`);
    } else {
      state.items.push({
        id: generateId(),
        name,
        icon,
        category,
        itemType,
        price,
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
      showToast(
        cancelBeforeRenewal
          ? `🛑 "${name}" aggiunto con avviso prioritario di DISDETTA!`
          : `✅ "${name}" aggiunto allo scadenzario!`
      );
    }

    saveItemsToLocal();
    closeItemModal();
    renderAll();
    checkAndSendDueNotifications(false);
  }

  // --- BROWSER NOTIFICATIONS & SERVICE WORKER ---
  async function initServiceWorkerAndNotifications() {
    if ('serviceWorker' in navigator) {
      try {
        swRegistration = await navigator.serviceWorker.register('./sw.js');
      } catch (err) {
        console.warn('Service Worker non registrato (es. protocollo file://):', err);
      }
    }
    updateNotificationStatusUI();
    // Controlla automaticamente all'avvio se ci sono scadenze da notificare oggi
    setTimeout(() => {
      checkAndSendDueNotifications(false);
    }, 1500);

    // Controllo periodico ogni 30 minuti se l'app rimane aperta
    setInterval(() => {
      checkAndSendDueNotifications(false);
    }, 30 * 60 * 1000);
  }

  function updateNotificationStatusUI() {
    const iconEl = document.getElementById('notifStatusIcon');
    const textEl = document.getElementById('notifStatusText');
    if (!('Notification' in window)) {
      iconEl.textContent = '🔕';
      textEl.textContent = 'Notifiche non supportate';
      return;
    }

    if (Notification.permission === 'granted') {
      iconEl.textContent = '🔔';
      textEl.textContent = 'Notifiche Attive';
    } else if (Notification.permission === 'denied') {
      iconEl.textContent = '🚫';
      textEl.textContent = 'Notifiche Bloccate';
    } else {
      iconEl.textContent = '🔔';
      textEl.textContent = 'Attiva Notifiche';
    }
  }

  async function requestNotificationPermission() {
    if (!('Notification' in window)) {
      showToast('⚠️ Il tuo browser non supporta le notifiche Web.', 'danger');
      return false;
    }

    if (Notification.permission === 'granted') {
      sendNativeNotification(
        '✅ Notifiche ScadenzApp Attive!',
        'Riceverai un avviso prima del rinnovo dei tuoi abbonamenti o della scadenza di bollette e bollo auto.',
        null
      );
      showToast('🔔 Notifica di conferma inviata!');
      return true;
    }

    const perm = await Notification.requestPermission();
    updateNotificationStatusUI();

    if (perm === 'granted') {
      sendNativeNotification(
        '🎉 Notifiche Attivate con successo!',
        'Ti avviseremo in tempo per disdire gli abbonamenti o pagare bollette e bollo auto.',
        null
      );
      showToast('✅ Permesso notifiche attivato!');
      checkAndSendDueNotifications(true);
      return true;
    } else {
      showToast('⚠️ Permesso notifiche negato. Abilitalo dalle impostazioni del browser.', 'danger');
      return false;
    }
  }

  function sendNativeNotification(title, body, itemId = null) {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }

    const options = {
      body,
      icon: './icon.svg',
      badge: './icon.svg',
      tag: itemId ? `scadenzapp-${itemId}` : `scadenzapp-test-${Date.now()}`,
      requireInteraction: true,
      data: {
        url: './index.html',
        itemId
      }
    };

    if (swRegistration && swRegistration.showNotification) {
      swRegistration.showNotification(title, options).catch(() => {
        new Notification(title, options);
      });
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
      const timePhrase =
        days < 0
          ? `è SCADUTO da ${Math.abs(days)} giorni!`
          : days === 0
          ? `SCADE OGGI!`
          : days === 1
          ? `scade DOMANI!`
          : `scade tra ${days} giorni (${formatItalianDate(item.nextDate)})`;

      const title = item.cancelBeforeRenewal
        ? `🛑 DISDICI ORA: ${item.name} (${formatCurrency(item.price)})`
        : item.itemType === 'bill'
        ? `💳 DA PAGARE: ${item.name} (${formatCurrency(item.price)})`
        : `🔄 Rinnovo in arrivo: ${item.name} (${formatCurrency(item.price)})`;

      const body = item.cancelBeforeRenewal
        ? `Il tuo abbonamento ${timePhrase} Disdici subito per non farti addebitare ${formatCurrency(item.price)}!`
        : `${item.name} ${timePhrase}. Apri ScadenzApp per gestire la scadenza.`;

      sendNativeNotification(title, body, item.id);
      notifiedLog[logKey] = true;
    });

    localStorage.setItem(STORAGE_KEYS.NOTIFIED_LOG, JSON.stringify(notifiedLog));
  }

  // --- EXPORT .ICS CALENDAR (GOOGLE / APPLE / OUTLOOK ALARM) ---
  function formatIcsDate(dateStr) {
    return dateStr.replace(/-/g, '');
  }

  function exportToIcs(itemsToExport, filename = 'scadenze-abbonamenti-bollette.ics') {
    if (!itemsToExport || itemsToExport.length === 0) {
      showToast('⚠️ Nessuna scadenza attiva da esportare', 'danger');
      return;
    }

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ScadenzApp//Abbonamenti e Bollette IT//IT',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ];

    itemsToExport.forEach((item) => {
      const dtStart = formatIcsDate(item.nextDate);
      const nextDayStr = formatIcsDate(formatDateInput(addDays(parseLocalDate(item.nextDate), 1)));
      const prefix = item.cancelBeforeRenewal
        ? '🛑 DISDIRE: '
        : item.itemType === 'bill'
        ? '💳 PAGARE: '
        : '🔄 RINNOVO: ';

      const summary = `${prefix}${item.name} (${formatCurrency(item.price)})`;
      const desc = [
        item.cancelBeforeRenewal ? 'ATTENZIONE: Da disdire prima del rinnovo automatico!' : '',
        `Importo: ${formatCurrency(item.price)}`,
        item.paymentMethod ? `Metodo: ${item.paymentMethod}` : '',
        item.cancelUrl ? `Link: ${item.cancelUrl}` : '',
        item.notes ? `Note: ${item.notes}` : ''
      ]
        .filter(Boolean)
        .join('\\n');

      lines.push(
        'BEGIN:VEVENT',
        `UID:${item.id}@scadenzapp.local`,
        `DTSTAMP:${formatIcsDate(formatDateInput(new Date()))}T090000Z`,
        `DTSTART;VALUE=DATE:${dtStart}`,
        `DTEND;VALUE=DATE:${nextDayStr}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${desc}`,
        'BEGIN:VALARM',
        `TRIGGER:-P${Math.max(1, item.remindDaysBefore || 3)}D`,
        'ACTION:DISPLAY',
        `DESCRIPTION:Promemoria ${summary}`,
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

    showToast('📅 File Calendario (.ics) scaricato! Aprilo per aggiungere le sveglie.');
  }

  // --- LOCAL JSON EXPORT / IMPORT & GITHUB GIST SYNC ---
  function exportBackupJson() {
    const payload = {
      app: 'ScadenzApp',
      version: 1,
      exportedAt: new Date().toISOString(),
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
    showToast('⬇️ Backup JSON esportato con successo!');
  }

  function importBackupJson(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || !Array.isArray(data.items)) {
          throw new Error('Formato file JSON non valido');
        }
        state.items = data.items;
        if (Array.isArray(data.history)) {
          state.history = data.history;
        }
        saveItemsToLocal();
        renderAll();
        showToast(`⬆️ Importate ${state.items.length} scadenze dal backup!`);
      } catch (err) {
        showToast('⚠️ File JSON non valido: ' + err.message, 'danger');
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
    const badge = document.getElementById('githubSyncBadge');
    const storageBadge = document.getElementById('storageStatusBadge');
    const tokenInput = document.getElementById('ghTokenInput');
    const gistInput = document.getElementById('ghGistIdInput');
    const autoCheck = document.getElementById('ghAutoSync');

    if (tokenInput && document.activeElement !== tokenInput) {
      tokenInput.value = state.ghConfig.token || '';
    }
    if (gistInput && document.activeElement !== gistInput) {
      gistInput.value = state.ghConfig.gistId || '';
    }
    if (autoCheck) {
      autoCheck.checked = Boolean(state.ghConfig.autoSync);
    }

    if (state.ghConfig.token && state.ghConfig.gistId) {
      if (badge) {
        badge.textContent = '✅ Collegato a GitHub Gist';
        badge.style.color = 'var(--success)';
      }
      if (storageBadge) {
        storageBadge.textContent = '💾 Locale + 🐙 GitHub';
      }
    } else if (state.ghConfig.token) {
      if (badge) {
        badge.textContent = '🟡 Token pronto (Premi Push)';
        badge.style.color = 'var(--warning)';
      }
    } else {
      if (badge) {
        badge.textContent = 'Solo Locale';
        badge.style.color = 'var(--text-muted)';
      }
    }
  }

  async function pushToGitHubGist(silent = false) {
    saveGhConfigFromModal();
    const statusMsg = document.getElementById('ghStatusMsg');

    if (!state.ghConfig.token) {
      if (!silent) {
        statusMsg.textContent = '⚠️ Inserisci prima un Personal Access Token GitHub con permesso "gist".';
        statusMsg.style.color = 'var(--danger)';
      }
      return;
    }

    if (!silent && statusMsg) {
      statusMsg.textContent = '⏳ Salvataggio su GitHub Gist in corso...';
      statusMsg.style.color = 'var(--text-secondary)';
    }

    const payloadContent = JSON.stringify(
      {
        app: 'ScadenzApp',
        updatedAt: new Date().toISOString(),
        items: state.items,
        history: state.history
      },
      null,
      2
    );

    const bodyData = {
      description: 'ScadenzApp — Backup sincronizzato Abbonamenti, Bollette e Bollo Auto',
      public: false,
      files: {
        'scadenzapp-db.json': {
          content: payloadContent
        }
      }
    };

    try {
      const isUpdate = Boolean(state.ghConfig.gistId);
      const url = isUpdate
        ? `https://api.github.com/gists/${state.ghConfig.gistId}`
        : 'https://api.github.com/gists';

      const res = await fetch(url, {
        method: isUpdate ? 'PATCH' : 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${state.ghConfig.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bodyData)
      });

      if (!res.ok) {
        throw new Error(`GitHub API HTTP ${res.status}`);
      }

      const data = await res.json();
      state.ghConfig.gistId = data.id;
      state.ghConfig.lastSyncAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEYS.GH_CONFIG, JSON.stringify(state.ghConfig));
      updateSyncStatusUI();

      if (!silent) {
        statusMsg.textContent = `✅ Sincronizzato su GitHub Gist (ID: ${data.id}) alle ${new Date().toLocaleTimeString('it-IT')}`;
        statusMsg.style.color = 'var(--success)';
        showToast('🐙 Dati salvati sul tuo GitHub Gist privato!');
      }
    } catch (err) {
      if (!silent && statusMsg) {
        statusMsg.textContent = `❌ Errore sincronizzazione GitHub: ${err.message}`;
        statusMsg.style.color = 'var(--danger)';
      }
    }
  }

  async function pullFromGitHubGist() {
    saveGhConfigFromModal();
    const statusMsg = document.getElementById('ghStatusMsg');

    if (!state.ghConfig.token || !state.ghConfig.gistId) {
      statusMsg.textContent = '⚠️ Inserisci sia il Token GitHub sia l\'ID del Gist da cui scaricare i dati.';
      statusMsg.style.color = 'var(--danger)';
      return;
    }

    statusMsg.textContent = '⏳ Scaricamento dati da GitHub Gist...';
    statusMsg.style.color = 'var(--text-secondary)';

    try {
      const res = await fetch(`https://api.github.com/gists/${state.ghConfig.gistId}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${state.ghConfig.token}`
        }
      });

      if (!res.ok) {
        throw new Error(`GitHub API HTTP ${res.status}`);
      }

      const gist = await res.json();
      const fileObj = gist.files && (gist.files['scadenzapp-db.json'] || Object.values(gist.files)[0]);
      if (!fileObj || !fileObj.content) {
        throw new Error('File scadenzapp-db.json non trovato nel Gist');
      }

      const parsed = JSON.parse(fileObj.content);
      if (!Array.isArray(parsed.items)) {
        throw new Error('Contenuto JSON non valido');
      }

      state.items = parsed.items;
      if (Array.isArray(parsed.history)) {
        state.history = parsed.history;
      }

      saveItemsToLocal(false);
      renderAll();
      statusMsg.textContent = `✅ Scaricate ${state.items.length} scadenze da GitHub!`;
      statusMsg.style.color = 'var(--success)';
      showToast('🐙 Dati aggiornati da GitHub Gist!');
    } catch (err) {
      statusMsg.textContent = `❌ Errore durante il Pull da GitHub: ${err.message}`;
      statusMsg.style.color = 'var(--danger)';
    }
  }

  // --- UTILITIES (TOAST, ESCAPE, THEME) ---
  function showToast(message) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3800);
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
    // Main Add & Quick Intent buttons
    document.getElementById('btnAddNewMain').addEventListener('click', () => openItemModal('create'));
    document.getElementById('btnEmptyAdd').addEventListener('click', () => openItemModal('create'));
    document.getElementById('btnQuickTrial').addEventListener('click', () => openItemModal('create', null, 'trial-1-month'));
    document.getElementById('btnQuickSub').addEventListener('click', () => openItemModal('create', null, 'sub'));
    document.getElementById('btnQuickBill').addEventListener('click', () => openItemModal('create', null, 'bill-bollo'));

    document.getElementById('btnLoadDemoData').addEventListener('click', () => {
      state.items = getStarterExamples();
      saveItemsToLocal();
      renderAll();
      showToast('✨ Esempi caricati (Disney+ 1 mese, Netflix, Luce, Bollo Auto)!');
    });

    // Modal close & form submit
    document.getElementById('btnCloseItemModal').addEventListener('click', closeItemModal);
    document.getElementById('btnCancelModal').addEventListener('click', closeItemModal);
    document.getElementById('itemForm').addEventListener('submit', handleSaveItemForm);

    // Radio type change inside modal
    document.querySelectorAll('input[name="itemType"]').forEach((radio) => {
      radio.addEventListener('change', (e) => updateFormVisibilityByType(e.target.value));
    });

    // Preset category tabs & chips inside modal
    document.querySelectorAll('.preset-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.presetCategoryFilter = tab.dataset.presetCat;
        document.querySelectorAll('.preset-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        renderPresetChips();
      });
    });

    document.getElementById('presetChipsContainer').addEventListener('click', (e) => {
      const chip = e.target.closest('.preset-chip');
      if (!chip) return;
      applyPresetToForm(chip.dataset.presetId);
    });

    // Delegated clicks on cards & urgent banner
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

    // View Tabs (List / Calendar / History)
    document.querySelectorAll('.view-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.currentView = tab.dataset.view;
        document.querySelectorAll('.view-tab').forEach((t) => {
          t.classList.toggle('active', t === tab);
          t.setAttribute('aria-selected', String(t === tab));
        });

        document.getElementById('viewList').classList.toggle('hidden', state.currentView !== 'list');
        document.getElementById('listFiltersContainer').classList.toggle('hidden', state.currentView !== 'list');
        document.getElementById('viewCalendar').classList.toggle('hidden', state.currentView !== 'calendar');
        document.getElementById('viewHistory').classList.toggle('hidden', state.currentView !== 'history');
      });
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

    // Search & Sort
    document.getElementById('searchInput').addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderItemsList();
    });

    document.getElementById('sortSelect').addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      renderItemsList();
    });

    // Calendar navigation
    document.getElementById('btnPrevMonth').addEventListener('click', () => {
      state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() - 1, 1);
      renderCalendar();
    });
    document.getElementById('btnNextMonth').addEventListener('click', () => {
      state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + 1, 1);
      renderCalendar();
    });

    // Clear History
    document.getElementById('btnClearHistory').addEventListener('click', () => {
      if (!confirm('Vuoi azzerare il registro storico dei pagamenti e delle disdette?')) return;
      state.history = [];
      saveItemsToLocal();
      renderAll();
      showToast('🗑️ Storico svuotato.');
    });

    // Notifications buttons
    document.getElementById('btnNotificationStatus').addEventListener('click', requestNotificationPermission);
    document.getElementById('btnTriggerBrowserNotif').addEventListener('click', async () => {
      const ok = await requestNotificationPermission();
      if (ok) checkAndSendDueNotifications(true);
    });
    document.getElementById('btnRequestNotifPermModal').addEventListener('click', requestNotificationPermission);
    document.getElementById('btnTestNotifModal').addEventListener('click', async () => {
      const ok = await requestNotificationPermission();
      if (ok) checkAndSendDueNotifications(true);
    });

    // Export all .ics
    document.getElementById('btnExportIcsAll').addEventListener('click', () => {
      const active = state.items.filter((i) => i.status === 'active');
      exportToIcs(active);
    });

    // Sync & Backup Modal
    const syncBackdrop = document.getElementById('syncModalBackdrop');
    document.getElementById('btnOpenSyncModal').addEventListener('click', () => {
      updateSyncStatusUI();
      syncBackdrop.classList.remove('hidden');
    });
    document.getElementById('btnCloseSyncModal').addEventListener('click', () => {
      syncBackdrop.classList.add('hidden');
    });
    document.getElementById('btnExportJson').addEventListener('click', exportBackupJson);
    document.getElementById('inputImportJson').addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        importBackupJson(e.target.files[0]);
        e.target.value = '';
      }
    });
    document.getElementById('btnSaveGhConfig').addEventListener('click', () => {
      saveGhConfigFromModal();
      showToast('💾 Configurazione GitHub salvata in locale!');
    });
    document.getElementById('btnGhPush').addEventListener('click', () => pushToGitHubGist(false));
    document.getElementById('btnGhPull').addEventListener('click', pullFromGitHubGist);

    // Theme toggle
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

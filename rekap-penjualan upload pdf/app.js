/* Rekap Penjualan — aplikasi web (PWA). Tanpa framework, tanpa server.
   Login: Google Identity Services. Data: Google Sheets API dengan token milik
   pengguna sendiri, sehingga hak akses mengikuti pengaturan Bagikan (Share) sheet. */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var L = window.Logic;
  var SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.email'
  ];
  var KEY_HINT = 'rekap.loginHint';

  /* ---------------------------------------------------------- helpers */
  function $(s, el) { return (el || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var nf = new Intl.NumberFormat('id-ID');
  function rp(n) { return (n < 0 ? '-' : '') + 'Rp ' + nf.format(Math.abs(Math.round(n || 0))); }
  function dec(n) { return n.toLocaleString('id-ID', { maximumFractionDigits: 2 }); }
  function rpShort(n) {
    var a = Math.abs(n || 0);
    if (a >= 1e12) return 'Rp ' + dec(n / 1e12) + ' T';
    if (a >= 1e9) return 'Rp ' + dec(n / 1e9) + ' M';
    if (a >= 1e6) return 'Rp ' + dec(n / 1e6) + ' jt';
    return rp(n);
  }
  function dfmt(d) {
    return d ? d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  }
  function iso(d) {
    return d ? d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) : '';
  }
  function monthShort(m) { return new Date(m.year, m.month, 1).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }); }
  function monthLong(m) { return new Date(m.year, m.month, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }); }
  function titleCase(s) { return String(s).toLowerCase().replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); }); }

  var ST = {
    'SUDAH KONTRAK': { cls: 'st-kontrak', label: 'Sudah Kontrak' },
    'MASIH NEGOSIASI': { cls: 'st-nego', label: 'Masih Negosiasi' },
    'CANCEL ORDER': { cls: 'st-cancel', label: 'Cancel Order' },
    'BARANG SUDAH DITERIMA': { cls: 'st-diterima', label: 'Barang Sudah Diterima' },
    'SUDAH KIRIM': { cls: 'st-kirim', label: 'Sudah Kirim' },
    'DIKIRIM SEBAGIAN': { cls: 'st-sebagian', label: 'Dikirim Sebagian' }
  };
  function stMeta(s) { return ST[s] || { cls: 'st-other', label: titleCase(s) }; }
  function badge(s) { var m = stMeta(s); return '<span class="badge ' + m.cls + '">' + esc(m.label) + '</span>'; }

  var ICONS = {
    dashboard: '<path d="M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z"/>',
    orders: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/>',
    items: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9"/>',
    analisis: '<path d="M4 20V11M10 20V4M16 20v-6M22 20H2"/>'
  };
  var TABS = [
    { id: 'dashboard', label: 'Ringkasan' },
    { id: 'orders', label: 'Order' },
    { id: 'items', label: 'Item' },
    { id: 'analisis', label: 'Analisis' }
  ];

  /* ---------------------------------------------------------- state */
  var S = {
    source: 'sheets',          // 'sheets' | 'demo'
    user: null,
    token: null,
    tokenExp: 0,
    orders: [],
    items: [],
    lastSync: null,
    loading: false,
    error: null,               // {kind, msg}
    tab: 'dashboard',
    trendMode: 'value',
    axMode: 'count',
    detail: null,
    form: null,                // isian form input/edit order (lihat form.js)
    skipPop: false,
    f: {
      o: { q: '', status: '', marketing: '', daerah: '', company: '', month: '', sort: 'date_desc' },
      i: { q: '', merk: '', status: '', marketing: '' }
    }
  };

  function AppError(kind, msg) { var e = new Error(msg); e.kind = kind; return e; }

  /* ---------------------------------------------------------- layar */
  function show(id) {
    ['boot', 'login', 'app'].forEach(function (x) { $('#' + x).hidden = x !== id; });
  }
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 3800);
  }
  function loginMsg(text, isErr) {
    var m = $('#login-msg');
    m.textContent = text || ''; m.hidden = !text;
    m.className = 'msg' + (isErr ? ' err' : '');
  }
  function banner(html) {
    var b = $('#banner');
    b.innerHTML = html || ''; b.hidden = !html;
  }
  function showLogin(msg, isErr) {
    S.form = null;
    closeDetail(true);
    show('login');
    $('#btn-login').disabled = false;
    loginMsg(msg, isErr);
  }

  /* ---------------------------------------------------------- autentikasi (Google Identity Services) */
  var tokenClient = null, pending = null;

  function isConfigured() {
    var id = String(CFG.GOOGLE_CLIENT_ID || '');
    return /\.apps\.googleusercontent\.com$/.test(id) && id.indexOf('ISI_') !== 0;
  }
  function whenGsi() {
    return new Promise(function (res, rej) {
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      var t0 = Date.now();
      var iv = setInterval(function () {
        if (window.google && google.accounts && google.accounts.oauth2) { clearInterval(iv); res(); }
        else if (Date.now() - t0 > 12000) { clearInterval(iv); rej(AppError('network', 'Layanan login Google tidak dapat dimuat. Periksa koneksi internet.')); }
      }, 150);
    });
  }
  function initAuth() {
    if (tokenClient) return Promise.resolve();
    return whenGsi().then(function () {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CFG.GOOGLE_CLIENT_ID,
        scope: SCOPES.join(' '),
        callback: onTokenResponse,
        error_callback: onTokenError
      });
    });
  }
  function requestToken(opts, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var timer = null;
      pending = {
        resolve: function () { clearTimeout(timer); resolve(); },
        reject: function (e) { clearTimeout(timer); reject(e); }
      };
      if (timeoutMs) timer = setTimeout(function () {
        if (pending) { var p = pending; pending = null; p.reject(Object.assign(new Error('timeout'), { code: 'timeout' })); }
      }, timeoutMs);
      try { tokenClient.requestAccessToken(opts); }
      catch (e) { pending = null; clearTimeout(timer); reject(e); }
    });
  }
  function onTokenResponse(resp) {
    var p = pending; pending = null;
    if (!p) return;
    if (resp.error) {
      p.reject(Object.assign(new Error(resp.error_description || resp.error), { code: resp.error }));
      return;
    }
    var ok = true;
    try { ok = google.accounts.oauth2.hasGrantedAllScopes.apply(null, [resp].concat(SCOPES)); } catch (e) { ok = true; }
    if (!ok) { p.reject(Object.assign(new Error('scope'), { code: 'scope_missing' })); return; }
    S.token = resp.access_token;
    S.tokenExp = Date.now() + ((+resp.expires_in || 3600) - 90) * 1000;
    p.resolve();
  }
  function onTokenError(err) {
    var p = pending; pending = null;
    if (p) p.reject(Object.assign(new Error((err && (err.message || err.type)) || 'auth'), { code: err && err.type }));
  }
  function authMessage(e) {
    switch (e && e.code) {
      case 'popup_failed_to_open': return 'Jendela login diblokir browser. Izinkan popup untuk situs ini, lalu coba lagi.';
      case 'popup_closed': return 'Jendela login ditutup sebelum selesai. Silakan coba lagi.';
      case 'access_denied': return 'Akses ditolak. Pastikan email Anda sudah terdaftar (lihat Panduan, bagian "Test users") dan Anda menyetujui izin yang diminta.';
      case 'scope_missing': return 'Izin Google Sheets/Drive belum diberikan lengkap. Masuk lagi dan centang semua izin yang diminta.';
      default: return (e && e.message) || 'Login gagal. Silakan coba lagi.';
    }
  }
  function ensureToken() {
    if (S.token && Date.now() < S.tokenExp) return Promise.resolve();
    var hint = localStorage.getItem(KEY_HINT) || undefined;
    return initAuth().then(function () {
      return requestToken({ prompt: 'none', login_hint: hint }, 9000);
    }).catch(function () { throw AppError('auth', 'Sesi berakhir. Silakan masuk lagi.'); });
  }
  function gfetch(url, opts) {
    function go() {
      var o = Object.assign({}, opts);
      o.headers = Object.assign({ Authorization: 'Bearer ' + S.token }, o.headers);
      return fetch(url, o);
    }
    return ensureToken().then(go).then(function (r) {
      if (r.status !== 401) return r;
      S.tokenExp = 0;
      return ensureToken().then(go);
    });
  }
  function fetchUser() {
    return gfetch('https://www.googleapis.com/oauth2/v3/userinfo')
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { return { email: j.email || '(akun Google)', name: j.name || '' }; });
  }

  function signIn(accountChooser) {
    $('#btn-login').disabled = true;
    loginMsg('');
    return initAuth()
      .then(function () { return requestToken({ prompt: accountChooser ? 'select_account' : '' }); })
      .then(fetchUser)
      .then(function (u) {
        S.user = u;
        try { localStorage.setItem(KEY_HINT, u.email); } catch (e) { /* abaikan */ }
        return enterApp();
      })
      .catch(function (e) {
        showLogin(e && e.kind === 'network' ? e.message : authMessage(e), true);
      });
  }
  function logout() {
    try { localStorage.removeItem(KEY_HINT); } catch (e) { /* abaikan */ }
    S.token = null; S.tokenExp = 0; S.user = null;
    S.orders = []; S.items = []; S.error = null; S.detail = null; S.form = null;
    showLogin();
  }

  /* ---------------------------------------------------------- data */
  function fetchSheets() {
    var q = new URLSearchParams();
    q.append('ranges', "'" + CFG.SHEET_ORDER + "'");
    q.append('ranges', "'" + CFG.SHEET_ITEM + "'");
    q.set('valueRenderOption', 'UNFORMATTED_VALUE');
    q.set('dateTimeRenderOption', 'SERIAL_NUMBER');
    q.set('majorDimension', 'ROWS');
    var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(CFG.SPREADSHEET_ID) + '/values:batchGet?' + q.toString();
    return gfetch(url).then(function (r) {
      if (r.ok) return r.json().then(function (j) {
        var v = j.valueRanges || [];
        return { order: (v[0] && v[0].values) || [], item: (v[1] && v[1].values) || [] };
      });
      return r.json().catch(function () { return {}; }).then(function (j) {
        var em = (j.error && j.error.message) || '';
        var detail = JSON.stringify((j.error && j.error.details) || '');
        if (/has not been used|is disabled|SERVICE_DISABLED/i.test(em + detail))
          throw AppError('api-disabled', 'Google Sheets API belum diaktifkan di proyek Google Cloud Anda.');
        if (r.status === 400 && /Unable to parse range/i.test(em))
          throw AppError('schema', 'Tab "' + CFG.SHEET_ORDER + '" atau "' + CFG.SHEET_ITEM + '" tidak ditemukan. Periksa nama tab di config.js.');
        if (r.status === 404)
          throw AppError('notfound', 'Spreadsheet tidak ditemukan, atau akun ini tidak punya akses.');
        if (r.status === 403)
          throw AppError('noaccess', 'Akun ini belum diberi akses ke spreadsheet.');
        throw AppError('other', em || ('Gagal memuat data (HTTP ' + r.status + ').'));
      });
    }, function () {
      throw AppError('network', 'Tidak dapat terhubung ke Google. Periksa koneksi internet.');
    });
  }

  function refresh(manual) {
    if (S.loading) return Promise.resolve();
    S.loading = true;
    $('#btn-refresh').classList.add('busy');
    var src = S.source === 'demo' ? Promise.resolve(window.DEMO_DATA) : fetchSheets();
    return src.then(function (vals) {
      S.orders = L.parseOrders(vals.order);
      S.items = L.parseItems(vals.item);
      S.lastSync = new Date();
      S.error = null;
      banner(S.source === 'demo' ? '<strong>Mode demo.</strong> Data contoh dari file CSV, bukan dari Google Sheet.' : '');
      if (manual) toast('Data diperbarui');
    }).catch(function (e) {
      if (e && e.kind === 'auth') { showLogin(e.message, false); return; }
      var err = { kind: (e && e.kind) || 'other', msg: (e && e.message) || 'Terjadi kesalahan.' };
      if (S.orders.length && err.kind === 'network') {
        banner('Tidak dapat memuat ulang data (' + esc(err.msg) + ') Menampilkan data terakhir yang berhasil dimuat.');
      } else {
        S.error = err;
      }
    }).then(function () {
      S.loading = false;
      $('#btn-refresh').classList.remove('busy');
      if (!$('#app').hidden) { updateSyncInfo(); render(); }
    });
  }
  function updateSyncInfo() {
    $('#sync-info').textContent = S.lastSync
      ? 'Diperbarui ' + S.lastSync.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      : '';
  }

  function enterApp() {
    $('#app-title').textContent = CFG.APP_NAME || 'Rekap Penjualan';
    $('#user-email').textContent = S.user ? S.user.email : '';
    $('#btn-logout').hidden = S.source === 'demo';
    show('app');
    routeFromHash();
    render();
    return refresh(false);
  }

  /* ---------------------------------------------------------- tampilan: umum */
  function renderNav() {
    $('#nav').innerHTML = TABS.map(function (t) {
      return '<button type="button" data-tab="' + t.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        ICONS[t.id] + '</svg><span>' + t.label + '</span></button>';
    }).join('');
  }
  function routeFromHash() {
    var t = (location.hash || '').replace(/^#\/?/, '');
    S.tab = TABS.some(function (x) { return x.id === t; }) ? t : 'dashboard';
  }
  function render() {
    var view = $('#view');
    document.querySelectorAll('#nav button').forEach(function (b) {
      if (b.dataset.tab === S.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (S.error && !S.orders.length) { view.innerHTML = viewError(); return; }
    if (!S.lastSync) { view.innerHTML = '<div class="center"><div class="spinner"></div><p class="muted">Memuat data…</p></div>'; return; }
    if (S.tab === 'dashboard') view.innerHTML = viewDashboard();
    else if (S.tab === 'orders') { view.innerHTML = viewOrders(); paintOrders(); }
    else if (S.tab === 'items') { view.innerHTML = viewItems(); paintItems(); }
    else view.innerHTML = viewAnalisis();
    if (S.detail && !S.form) renderDrawer();
  }

  function viewError() {
    var e = S.error, title = 'Data tidak dapat dimuat', extra = '';
    if (e.kind === 'noaccess' || e.kind === 'notfound') {
      title = 'Akun ini belum punya akses';
      extra = '<p class="muted small">Masuk sebagai <strong>' + esc(S.user ? S.user.email : '') + '</strong>. Minta pemilik spreadsheet menambahkan email ini lewat tombol <em>Bagikan (Share)</em> di Google Sheet, atau masuk dengan akun lain.</p>';
    } else if (e.kind === 'api-disabled') {
      title = 'Google Sheets API belum aktif';
      extra = '<p class="muted small">Aktifkan "Google Sheets API" pada proyek Google Cloud yang sama dengan Client ID (lihat Panduan, Bagian 1).</p>';
    }
    return '<div class="card errbox"><h2>' + esc(title) + '</h2><p>' + esc(e.msg) + '</p>' + extra +
      '<div class="actions"><button class="btn primary" data-act="retry" type="button">Coba lagi</button>' +
      (S.source === 'demo' ? '' : '<button class="btn" data-act="switch-account" type="button">Ganti akun</button><button class="btn ghost" data-act="logout" type="button">Keluar</button>') +
      '</div></div>';
  }

  /* Kotak angka besar (jumlah & pendapatan) di atas daftar yang difilter */
  function statTiles(tiles) {
    return '<div class="statbar" role="status" aria-live="polite">' + tiles.map(function (t) {
      return '<div class="stat' + (t.primary ? ' primary' : '') + '"><div class="stat-k">' + esc(t.k) + '</div>' +
        '<div class="stat-v">' + esc(t.v) + '</div><div class="stat-s">' + esc(t.s) + '</div></div>';
    }).join('') + '</div>';
  }

  function groupBy(list, keyFn) {
    var m = {}, out = [];
    list.forEach(function (o) {
      var k = keyFn(o), g = m[k];
      if (!g) { g = m[k] = { key: k, count: 0, value: 0 }; out.push(g); }
      g.count++; g.value += o.nilai;
    });
    return out.sort(function (a, b) { return b.value - a.value; });
  }
  function barRows(groups, max, opts) {
    opts = opts || {};
    if (!groups.length) return '<p class="muted">Belum ada data.</p>';
    return '<div class="rows">' + groups.map(function (g) {
      var pct = max > 0 ? Math.max(g.value > 0 ? 1.5 : 0, g.value / max * 100) : 0;
      var cls = opts.status ? stMeta(g.key).cls : '';
      var name = opts.status ? stMeta(g.key).label : g.key;
      return '<div class="row-bar"><div class="line"><span class="name">' + esc(name) + '</span>' +
        '<span class="val" title="' + esc(rp(g.value)) + '">' + esc(opts.full ? rp(g.value) : rpShort(g.value)) +
        '<small>' + g.count + ' order</small></span></div>' +
        '<div class="track"><div class="fill ' + cls + '" style="width:' + pct.toFixed(1) + '%"></div></div></div>';
    }).join('') + '</div>';
  }

  /* ---------------------------------------------------------- tampilan: ringkasan */
  function viewDashboard() {
    var sm = L.summarize(S.orders);
    var live = S.orders.filter(function (o) { return !L.isCancel(o); });
    var statusGroups = sm.statuses.map(function (s) { return { key: s, count: sm.byStatus[s].count, value: sm.byStatus[s].value }; });
    var mkt = groupBy(live, function (o) { return o.marketing; }).slice(0, 6);
    var dae = groupBy(live, function (o) { return o.daerah; }).slice(0, 6);

    var h = '<h1 class="page-title">Ringkasan Penjualan</h1>';
    h += '<div class="kpis">' +
      kpi('Total Order', sm.total.count, rpShort(sm.total.value), rp(sm.total.value)) +
      kpi('Total Klik', sm.klik.count, rpShort(sm.klik.value) + ' · total dikurangi batal', rp(sm.klik.value), 'accent') +
      kpi('Batal', sm.cancel.count, rpShort(sm.cancel.value), rp(sm.cancel.value)) +
      kpi('Ongkir', rpShort(sm.ongkir), 'tanpa order batal', rp(sm.ongkir), '', true) +
      '</div>';

    h += '<div class="grid two">';
    h += '<section class="card"><div class="card-head"><h2>Per status</h2><span class="muted small">Nilai order</span></div>' +
      barRows(statusGroups, sm.total.value, { status: true, full: true }) + '</section>';
    h += '<section class="card"><div class="card-head"><h2>Tren per bulan order</h2>' +
      '<div class="seg" role="group" aria-label="Tampilan tren">' +
      '<button type="button" data-act="trend-mode" data-v="value" aria-pressed="' + (S.trendMode === 'value') + '">Nilai</button>' +
      '<button type="button" data-act="trend-mode" data-v="count" aria-pressed="' + (S.trendMode === 'count') + '">Jumlah</button></div></div>' +
      trendChart() + '</section>';
    h += '</div>';

    h += '<div class="grid two" style="margin-top:14px">';
    h += '<section class="card"><div class="card-head"><h2>Marketing</h2><span class="muted small">Nilai klik (tanpa batal)</span></div>' + barRows(mkt, mkt.length ? mkt[0].value : 0) + '</section>';
    h += '<section class="card"><div class="card-head"><h2>Daerah</h2><span class="muted small">Nilai klik (tanpa batal)</span></div>' + barRows(dae, dae.length ? dae[0].value : 0) + '</section>';
    h += '</div>';
    return h;
  }
  function kpi(label, big, sub, title, tone, isMoney) {
    return '<div class="kpi ' + (tone || '') + '" title="' + esc(title || '') + '"><div class="label">' + esc(label) + '</div>' +
      '<div class="big' + (isMoney ? ' m' : '') + '">' + esc(big) + '</div><div class="sub">' + esc(sub) + '</div></div>';
  }
  function trendChart() {
    var mo = L.monthly(S.orders, true).months;
    if (!mo.length) return '<p class="muted">Belum ada data bertanggal.</p>';
    var key = S.trendMode === 'count' ? 'count' : 'value';
    var max = mo.reduce(function (a, m) { return Math.max(a, m[key]); }, 0);
    return '<div class="trend" role="img" aria-label="Grafik batang per bulan">' + mo.map(function (m) {
      var hgt = max > 0 ? m[key] / max * 100 : 0;
      var label = key === 'count' ? String(m.count) : (m.value ? rpShort(m.value).replace('Rp ', '') : '0');
      return '<div class="col"><div class="bars"><div class="bar' + (m[key] ? '' : ' zero') + '" style="height:' + hgt.toFixed(1) + '%" title="' + esc(monthLong(m) + ': ' + m.count + ' order, ' + rp(m.value)) + '"></div></div>' +
        '<div class="v">' + esc(label) + '</div><div class="m">' + esc(monthShort(m)) + '</div></div>';
    }).join('') + '</div>';
  }

  /* ---------------------------------------------------------- tampilan: order */
  function uniq(list) {
    var seen = {}, out = [];
    list.forEach(function (v) { if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out.sort(function (a, b) { return a.localeCompare(b, 'id'); });
  }
  function optionsHtml(pairs, sel, allLabel) {
    return '<option value="">' + esc(allLabel) + '</option>' + pairs.map(function (p) {
      return '<option value="' + esc(p[0]) + '"' + (p[0] === sel ? ' selected' : '') + '>' + esc(p[1]) + '</option>';
    }).join('');
  }
  function same(list) { return list.map(function (v) { return [v, v]; }); }
  function statusPairs(list) {
    var present = {}; list.forEach(function (s) { present[s] = 1; });
    return L.statusList(S.orders).filter(function (s) { return present[s]; }).map(function (s) { return [s, stMeta(s).label]; });
  }

  function viewOrders() {
    var f = S.f.o;
    var months = L.monthly(S.orders, false).months.map(function (m) { return [m.key, monthLong(m)]; });
    return '<div class="titlebar"><h1 class="page-title">Daftar Order</h1>' +
      '<div class="title-btns"><button class="btn" type="button" data-act="upload-pdf">Upload PDF Pesanan</button>' +
      '<button class="btn primary" type="button" data-act="new-order">+ Order Baru</button></div></div>' +
      '<div class="filters f-orders">' +
      '<input class="search" type="search" data-f="o.q" value="' + esc(f.q) + '" placeholder="Cari ID, daerah, company, marketing, no. kontrak…" aria-label="Cari order">' +
      '<select data-f="o.status" aria-label="Status">' + optionsHtml(statusPairs(S.orders.map(function (o) { return o.status; })), f.status, 'Semua status') + '</select>' +
      '<select data-f="o.marketing" aria-label="Marketing">' + optionsHtml(same(uniq(S.orders.map(function (o) { return o.marketing; }))), f.marketing, 'Semua marketing') + '</select>' +
      '<select data-f="o.daerah" aria-label="Daerah">' + optionsHtml(same(uniq(S.orders.map(function (o) { return o.daerah; }))), f.daerah, 'Semua daerah') + '</select>' +
      '<select data-f="o.company" aria-label="Company">' + optionsHtml(same(uniq(S.orders.map(function (o) { return o.company; }))), f.company, 'Semua company') + '</select>' +
      '<select data-f="o.month" aria-label="Bulan order">' + optionsHtml(months, f.month, 'Semua bulan') + '</select>' +
      '<select data-f="o.sort" aria-label="Urutkan">' + optionsHtml([
        ['date_desc', 'Terbaru dulu'], ['date_asc', 'Terlama dulu'], ['value_desc', 'Nilai tertinggi'], ['value_asc', 'Nilai terendah']
      ], f.sort, 'Urutkan').replace('<option value="">Urutkan</option>', '') + '</select>' +
      '</div>' +
      '<div id="o-stats"></div>' +
      '<div class="resultbar"><span id="o-count" class="muted small"></span><span class="actions">' +
      '<button class="btn small" type="button" data-act="clear-o">Reset filter</button>' +
      '<button class="btn small" type="button" data-act="csv-orders">Unduh CSV</button></span></div>' +
      '<div id="o-results"></div>';
  }
  function filteredOrders() {
    var f = S.f.o, words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    var list = S.orders.filter(function (o) {
      if (f.status && o.status !== f.status) return false;
      if (f.marketing && o.marketing !== f.marketing) return false;
      if (f.daerah && o.daerah !== f.daerah) return false;
      if (f.company && o.company !== f.company) return false;
      if (f.month && (!o.orderDate || L.monthKey(o.orderDate) !== f.month)) return false;
      if (words.length) {
        var hay = (o.id + ' ' + o.daerah + ' ' + o.company + ' ' + o.marketing + ' ' + o.contractNo + ' ' + stMeta(o.status).label).toLowerCase();
        for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return false;
      }
      return true;
    });
    var by = {
      date_desc: function (a, b) { return (+b.orderDate || 0) - (+a.orderDate || 0) || (+b.no || 0) - (+a.no || 0); },
      date_asc: function (a, b) { return (+a.orderDate || 0) - (+b.orderDate || 0) || (+a.no || 0) - (+b.no || 0); },
      value_desc: function (a, b) { return b.nilai - a.nilai; },
      value_asc: function (a, b) { return a.nilai - b.nilai; }
    };
    return list.sort(by[f.sort] || by.date_desc);
  }
  function paintOrders() {
    var list = filteredOrders();
    var total = list.reduce(function (a, o) { return a + o.nilai; }, 0);
    var cancelled = list.filter(L.isCancel);
    var cancelVal = cancelled.reduce(function (a, o) { return a + o.nilai; }, 0);
    $('#o-stats').innerHTML = statTiles([
      { k: 'Jumlah Order', v: nf.format(list.length),
        s: 'dari ' + S.orders.length + ' order' + (cancelled.length ? ' · ' + cancelled.length + ' batal' : '') },
      { k: 'Total Pendapatan', v: rp(total - cancelVal), primary: true,
        s: cancelled.length
          ? (cancelled.length === list.length ? 'Semua order ini batal · nilai batal ' + rp(cancelVal) : 'Tanpa order batal (' + rp(cancelVal) + ')')
          : 'Semua order aktif' }
    ]);
    $('#o-count').textContent = 'Menampilkan ' + list.length + ' dari ' + S.orders.length + ' order';
    var today = new Date();
    $('#o-results').innerHTML = !list.length
      ? '<div class="card empty">Tidak ada order yang cocok dengan filter.</div>'
      : '<div class="table-wrap cards"><table class="tbl-cards tbl-orders"><thead><tr>' +
        '<th>Tanggal</th><th>ID Pesanan</th><th>Daerah</th><th>Company</th><th>Marketing</th><th>Status</th><th class="r">Total Nilai</th><th class="r">Ongkir</th>' +
        '</tr></thead><tbody>' + list.map(function (o) {
          var w = L.warnings(o, today).length ? '<span class="warn-chip" title="Periksa tanggal pada rincian">periksa tanggal</span>' : '';
          return '<tr data-open="' + esc(o.id) + '" tabindex="0">' +
            '<td class="c-date nowrap">' + dfmt(o.orderDate) + '</td>' +
            '<td class="c-id id">' + esc(o.id) + w + '</td>' +
            '<td class="c-daerah">' + esc(o.daerah) + '</td>' +
            '<td class="c-company">' + esc(o.company) + '</td>' +
            '<td class="c-mkt">' + esc(o.marketing) + '</td>' +
            '<td class="c-status">' + badge(o.status) + '</td>' +
            '<td class="c-val r num nowrap">' + rp(o.nilai) + '</td>' +
            '<td class="c-ong r num nowrap">' + (o.ongkir ? rp(o.ongkir) : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
  }
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadCsv() {
    var list = filteredOrders();
    var head = ['No', 'ID Pesanan', 'Daerah', 'Order Date', 'Company', 'Marketing', 'Status', 'Total Nilai', 'Total Ongkir', 'Nego Date', 'Agree Date', 'Contract No', 'Start Contract', 'End Contract'];
    var rows = list.map(function (o) {
      return [o.no, o.id, o.daerah, iso(o.orderDate), o.company, o.marketing, o.status, o.nilai, o.ongkir, iso(o.nego), iso(o.agree), o.contractNo, iso(o.start), iso(o.end)];
    });
    var csv = [head].concat(rows).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rekap-order-' + iso(new Date()) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    toast(list.length + ' order diunduh');
  }

  /* ---------------------------------------------------------- tampilan: item */
  function viewItems() {
    var f = S.f.i;
    return '<h1 class="page-title">Detail Item</h1>' +
      '<div class="filters">' +
      '<input class="search" type="search" data-f="i.q" value="' + esc(f.q) + '" placeholder="Cari nama barang, merk, type, ID…" aria-label="Cari item">' +
      '<select data-f="i.merk" aria-label="Merk">' + optionsHtml(same(uniq(S.items.map(function (i) { return i.merk; }))), f.merk, 'Semua merk') + '</select>' +
      '<select data-f="i.status" aria-label="Status">' + optionsHtml(statusPairs(S.items.map(function (i) { return i.status; })), f.status, 'Semua status') + '</select>' +
      '<select data-f="i.marketing" aria-label="Marketing">' + optionsHtml(same(uniq(S.items.map(function (i) { return i.marketing; }))), f.marketing, 'Semua marketing') + '</select>' +
      '</div>' +
      '<div id="i-stats"></div>' +
      '<div class="resultbar"><span id="i-count" class="muted small"></span>' +
      '<span class="actions"><button class="btn small" type="button" data-act="clear-i">Reset filter</button></span></div>' +
      '<section class="card" id="i-merk" style="margin-bottom:14px"></section>' +
      '<div id="i-results"></div>';
  }
  function filteredItems() {
    var f = S.f.i, words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    return S.items.filter(function (i) {
      if (f.merk && i.merk !== f.merk) return false;
      if (f.status && i.status !== f.status) return false;
      if (f.marketing && i.marketing !== f.marketing) return false;
      if (words.length) {
        var hay = (i.nama + ' ' + i.merk + ' ' + i.type + ' ' + i.id + ' ' + (i.daerah || '') + ' ' + (i.company || '')).toLowerCase();
        for (var k = 0; k < words.length; k++) if (hay.indexOf(words[k]) < 0) return false;
      }
      return true;
    });
  }
  function paintItems() {
    var list = filteredItems();
    var qty = list.reduce(function (a, i) { return a + i.qty; }, 0);
    $('#i-stats').innerHTML = statTiles([
      { k: 'Jumlah Item', v: nf.format(list.length), s: 'dari ' + S.items.length + ' baris item' },
      { k: 'Total Qty', v: nf.format(qty), s: 'unit barang', primary: true }
    ]);
    $('#i-count').textContent = 'Menampilkan ' + list.length + ' dari ' + S.items.length + ' item';

    var base = S.f.i.status ? list : list.filter(function (i) { return i.status !== L.CANCEL; });
    var m = {}, arr = [];
    base.forEach(function (i) {
      var g = m[i.merk] || (m[i.merk] = { merk: i.merk, qty: 0, lines: 0, orders: {} });
      if (g.lines === 0) arr.push(g);
      g.qty += i.qty; g.lines++; g.orders[i.id] = 1;
    });
    arr.sort(function (a, b) { return b.qty - a.qty; });
    $('#i-merk').innerHTML = '<div class="card-head"><h2>Qty per merk</h2><span class="muted small">' + (S.f.i.status ? 'mengikuti filter' : 'tanpa order batal') + '</span></div>' +
      (arr.length ? '<div class="table-wrap"><table><thead><tr><th>Merk</th><th class="r">Total qty</th><th class="r">Baris item</th><th class="r">Order</th></tr></thead><tbody>' +
        arr.map(function (g) {
          return '<tr><td>' + esc(g.merk) + '</td><td class="r num">' + nf.format(g.qty) + '</td><td class="r num">' + g.lines + '</td><td class="r num">' + Object.keys(g.orders).length + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted">Tidak ada item.</p>');

    $('#i-results').innerHTML = !list.length
      ? '<div class="card empty">Tidak ada item yang cocok dengan filter.</div>'
      : '<div class="table-wrap cards"><table class="tbl-cards tbl-items"><thead><tr>' +
        '<th>Nama Barang</th><th>Merk</th><th>Type</th><th class="r">Qty</th><th class="r">Nilai Barang</th><th class="r">Ongkir</th><th>Status</th><th>Marketing</th><th>ID Pesanan</th>' +
        '</tr></thead><tbody>' + list.map(function (i) {
          return '<tr data-open="' + esc(i.id) + '" tabindex="0">' +
            '<td class="c-nama">' + esc(i.nama) + '</td>' +
            '<td class="c-merk">' + esc(i.merk) + '<span class="only-m">' + (i.type ? ' · ' + esc(i.type) : '') + '</span></td>' +
            '<td class="c-type">' + esc(i.type) + '</td>' +
            '<td class="c-qty r num">' + nf.format(i.qty) + '</td>' +
            '<td class="c-val r num nowrap">' + (i.nilai ? rp(i.nilai) : '—') + '</td>' +
            '<td class="c-ong r num nowrap">' + (i.ongkir ? rp(i.ongkir) : '—') + '</td>' +
            '<td class="c-status">' + badge(i.status) + '</td>' +
            '<td class="c-mkt">' + esc(i.marketing) + '</td>' +
            '<td class="c-id id">' + esc(i.id) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
  }

  /* ---------------------------------------------------------- tampilan: analisis */
  function viewAnalisis() {
    var h = '<h1 class="page-title">Analisis</h1>' +
      '<div class="card-head"><div class="seg" role="group" aria-label="Tampilan angka">' +
      '<button type="button" data-act="ax-mode" data-v="count" aria-pressed="' + (S.axMode === 'count') + '">Jumlah order</button>' +
      '<button type="button" data-act="ax-mode" data-v="value" aria-pressed="' + (S.axMode === 'value') + '">Total nilai (Rp)</button></div></div>';
    h += xtab('Marketing × Status', 'Marketing', L.crossTab(S.orders, function (o) { return o.marketing; }));
    h += xtab('Daerah × Status', 'Daerah', L.crossTab(S.orders, function (o) { return o.daerah; }));
    h += xtab('Company × Status', 'Company', L.crossTab(S.orders, function (o) { return o.company; }));
    var mo = L.monthly(S.orders, false);
    var tc = 0, tv = 0;
    h += '<section class="card"><div class="card-head"><h2>Tren per bulan order</h2></div><div class="table-wrap"><table><thead><tr><th>Bulan</th><th class="r">Jumlah order</th><th class="r">Total nilai (Rp)</th></tr></thead><tbody>' +
      mo.months.map(function (m) {
        tc += m.count; tv += m.value;
        return '<tr><td>' + esc(monthLong(m)) + '</td><td class="r num">' + m.count + '</td><td class="r num">' + nf.format(m.value) + '</td></tr>';
      }).join('') +
      (mo.undated.count ? '<tr><td>(Tanpa tanggal order)</td><td class="r num">' + mo.undated.count + '</td><td class="r num">' + nf.format(mo.undated.value) + '</td></tr>' : '') +
      '</tbody><tfoot><tr><td>Total</td><td class="r num">' + (tc + mo.undated.count) + '</td><td class="r num">' + nf.format(tv + mo.undated.value) + '</td></tr></tfoot></table></div></section>';
    return h;
  }
  function xtab(title, first, ct) {
    var isVal = S.axMode === 'value';
    function c(x) { var n = isVal ? x.value : x.count; return n ? nf.format(n) : '–'; }
    function cls(x) { return (isVal ? x.value : x.count) ? 'r num' : 'r num zero'; }
    return '<section class="card"><div class="card-head"><h2>' + esc(title) + '</h2><span class="muted small">' + (isVal ? 'Total nilai, Rupiah' : 'Jumlah order') + '</span></div>' +
      '<div class="table-wrap"><table class="xtab"><thead><tr><th>' + esc(first) + '</th>' +
      ct.statuses.map(function (s) { return '<th class="r">' + esc(stMeta(s).label) + '</th>'; }).join('') + '<th class="r">Total</th></tr></thead><tbody>' +
      ct.rows.map(function (r) {
        return '<tr><td>' + esc(r.key) + '</td>' + ct.statuses.map(function (s) { return '<td class="' + cls(r.cells[s]) + '">' + c(r.cells[s]) + '</td>'; }).join('') +
          '<td class="r num"><strong>' + c(r.total) + '</strong></td></tr>';
      }).join('') +
      '</tbody><tfoot><tr><td>Total</td>' + ct.statuses.map(function (s) { return '<td class="r num">' + c(ct.colTotals[s]) + '</td>'; }).join('') +
      '<td class="r num">' + c(ct.grand) + '</td></tr></tfoot></table></div></section>';
  }

  /* ---------------------------------------------------------- rincian order (drawer) */
  function field(k, v, wide) { return '<div class="field' + (wide ? ' wide' : '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div></div>'; }
  function openDetail(id) {
    S.detail = id;
    renderDrawer();
    if (!(history.state && history.state.drawer)) history.pushState({ drawer: 1 }, '');
  }
  function closeDetail(fromPop) {
    if (!S.detail) return;
    S.detail = null;
    renderDrawer();
    if (!fromPop && history.state && history.state.drawer) history.back();
  }
  function renderDrawer() {
    var d = $('#drawer');
    var panel = $('.drawer-panel', d);
    if (S.form && window.AKM.form) {
      $('#drawer-body').innerHTML = window.AKM.form.html();
      panel.classList.add('with-foot');
      d.hidden = false;
      document.body.classList.add('lock');
      return;
    }
    panel.classList.remove('with-foot');
    var o = S.detail && S.orders.filter(function (x) { return x.id === S.detail; })[0];
    if (!o) { d.hidden = true; document.body.classList.remove('lock'); return; }
    var items = S.items.filter(function (i) { return i.id === o.id; }).sort(function (a, b) { return a.no - b.no; });
    var qty = items.reduce(function (a, i) { return a + i.qty; }, 0);
    var warns = L.warnings(o, new Date());
    $('#drawer-body').innerHTML =
      '<div class="drawer-head"><div>' + badge(o.status) + '<h2 id="drawer-title" style="margin-top:8px">' + esc(o.daerah) + '</h2><div class="id muted" style="margin-top:4px">' + esc(o.id) + '</div></div>' +
      '<div class="head-actions"><button class="btn small" type="button" data-act="edit-order">Edit</button>' +
      '<button class="icon-btn" type="button" data-act="close-detail" aria-label="Tutup"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div></div>' +
      '<div class="drawer-pad">' +
      '<div class="card"><div class="fields">' +
      field('Total nilai', '<span class="num">' + rp(o.nilai) + '</span>') +
      field('Total ongkir', '<span class="num">' + (o.ongkir ? rp(o.ongkir) : '—') + '</span>') +
      field('Company', esc(o.company), true) +
      field('Marketing', esc(o.marketing)) +
      field('Tanggal order', dfmt(o.orderDate)) +
      field('Tanggal nego', dfmt(o.nego)) +
      field('Tanggal setuju', dfmt(o.agree)) +
      field('Awal kontrak', dfmt(o.start)) +
      field('Akhir kontrak', dfmt(o.end)) +
      field('No. kontrak', o.contractNo ? '<span class="id">' + esc(o.contractNo) + '</span>' : '—', true) +
      (o.pdfUrl && /^https:\/\//.test(o.pdfUrl) ? field('Surat Pesanan (PDF)', '<a href="' + esc(o.pdfUrl) + '" target="_blank" rel="noopener">Buka PDF di Google Drive</a>', true) : '') +
      '</div></div>' +
      (warns.length ? '<div class="msg"><strong>Periksa tanggal:</strong> ' + esc(warns.join('; ')) + '. Biasanya karena format tanggal (bulan/hari) tertukar saat input di sheet.</div>' : '') +
      '<div><h2 style="margin:4px 0 8px">Item (' + items.length + ' baris · qty ' + nf.format(qty) + ')</h2>' +
      (items.length ? '<div style="display:grid;gap:8px">' + items.map(function (i) {
        return '<div class="item-card"><div class="t">' + esc(i.no + '. ' + i.nama) + '</div><div class="s"><span>' + esc(i.merk) + (i.type ? ' · ' + esc(i.type) : '') + '</span><span>Qty ' + nf.format(i.qty) + '</span>' +
          (i.nilai ? '<span>' + rp(i.nilai) + '</span>' : '') + (i.ongkir ? '<span>Ongkir ' + rp(i.ongkir) + '</span>' : '') + '</div></div>';
      }).join('') + '</div>' : '<p class="muted">Belum ada rincian item untuk order ini.</p>') + '</div>' +
      '</div>';
    d.hidden = false;
    document.body.classList.add('lock');
    $('#drawer-body .icon-btn').focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------- event */
  function bind() {
    $('#nav').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]');
      if (b) { location.hash = '#/' + b.dataset.tab; }
    });
    window.addEventListener('hashchange', function () {
      if (S.detail && !S.form) { S.detail = null; renderDrawer(); }
      routeFromHash(); render(); window.scrollTo(0, 0);
    });
    window.addEventListener('popstate', function () {
      if (S.skipPop) {                     // popstate akibat form ditutup lewat tombol
        S.skipPop = false;
        if (S.detail && !(history.state && history.state.drawer)) history.pushState({ drawer: 1 }, '');
        return;
      }
      if (S.form) {                        // tombol Back saat form terbuka
        if (!window.AKM.form.discard()) history.pushState({ drawer: 2 }, '');
        return;
      }
      if (S.detail) closeDetail(true);
    });

    $('#view').addEventListener('input', function (e) {
      var el = e.target.closest('[data-f]');
      if (!el) return;
      var p = el.dataset.f.split('.');
      S.f[p[0]][p[1]] = el.value;
      if (p[0] === 'o') paintOrders(); else paintItems();
    });

    document.addEventListener('click', function (e) {
      var act = e.target.closest('[data-act]');
      if (act) {
        var a = act.dataset.act;
        if (a === 'close-detail') { if (S.form) window.AKM.form.cancel(); else closeDetail(); }
        else if (a === 'new-order') window.AKM.form.open('new');
        else if (a === 'upload-pdf') window.AKM.form.open('new', null, { pickPdf: true });
        else if (a === 'edit-order') { if (S.detail) window.AKM.form.open('edit', S.detail); }
        else if (a === 'trend-mode') { S.trendMode = act.dataset.v; render(); }
        else if (a === 'ax-mode') { S.axMode = act.dataset.v; render(); }
        else if (a === 'clear-o') { S.f.o = { q: '', status: '', marketing: '', daerah: '', company: '', month: '', sort: 'date_desc' }; render(); }
        else if (a === 'clear-i') { S.f.i = { q: '', merk: '', status: '', marketing: '' }; render(); }
        else if (a === 'csv-orders') downloadCsv();
        else if (a === 'retry') { S.error = null; render(); refresh(true); }
        else if (a === 'switch-account') { logout(); }
        else if (a === 'logout') logout();
        return;
      }
      var row = e.target.closest('[data-open]');
      if (row) openDetail(row.dataset.open);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (S.form) window.AKM.form.cancel(); else if (S.detail) closeDetail(); }
      if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-open]')) openDetail(e.target.dataset.open);
    });

    $('#btn-login').addEventListener('click', function () {
      if (!isConfigured()) { loginMsg('Client ID belum diisi. Buka config.js dan ikuti PANDUAN.md, Bagian 1.', true); return; }
      signIn(true);
    });
    $('#btn-demo').addEventListener('click', startDemo);
    $('#btn-logout').addEventListener('click', logout);
    $('#btn-refresh').addEventListener('click', function () { refresh(true); });

    document.addEventListener('visibilitychange', maybeAutoRefresh);
    setInterval(maybeAutoRefresh, 60 * 1000);
  }
  function maybeAutoRefresh() {
    if (document.hidden || $('#app').hidden || S.loading || S.form || !S.lastSync) return;
    var mins = +CFG.AUTO_REFRESH_MINUTES || 5;
    if (Date.now() - S.lastSync.getTime() > mins * 60 * 1000) refresh(false);
  }

  /* ---------------------------------------------------------- mulai */
  function startDemo() {
    S.source = 'demo';
    S.user = { email: 'Mode demo', name: '' };
    enterApp();
  }
  function registerSW() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* abaikan */ });
    }
  }

  function boot() {
    $('#login-title').textContent = CFG.APP_NAME || 'Rekap Penjualan';
    renderNav();
    bind();
    registerSW();

    if (window.DEMO_DATA) { startDemo(); return; }

    if (!isConfigured()) {
      showLogin('Client ID Google belum diisi. Buka config.js dan ikuti PANDUAN.md, Bagian 1.', true);
      return;
    }
    var hint = null;
    try { hint = localStorage.getItem(KEY_HINT); } catch (e) { /* abaikan */ }
    if (!hint) { showLogin(); return; }

    // Pernah masuk sebelumnya: coba masuk otomatis tanpa layar login.
    initAuth()
      .then(function () { return requestToken({ prompt: 'none', login_hint: hint }, 9000); })
      .then(fetchUser)
      .then(function (u) { S.user = u; return enterApp(); })
      .catch(function () { showLogin(); });
  }

  /* Dipakai form.js (input/edit order) */
  window.AKM = {
    S: S, CFG: CFG, $: $, esc: esc, nf: nf, rp: rp, iso: iso, dfmt: dfmt, uniq: uniq, stMeta: stMeta,
    toast: toast, gfetch: gfetch, fetchSheets: fetchSheets, refresh: refresh,
    render: render, renderDrawer: renderDrawer, AppError: AppError, form: null
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

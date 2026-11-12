/* Form input & edit order (tampil di panel samping/bawah).
   Menyimpan ke Google Sheet lewat writer.js. Mode demo hanya mengubah data di memori. */
(function () {
  'use strict';

  var A = window.AKM, L = window.Logic, W = window.Writer;
  var S = A.S, esc = A.esc, nf = A.nf, $ = A.$;
  var STATUSES = L.STATUS_ORDER;
  var NEW = '__new__';
  var PLACEHOLDER = { daerah: '(Tanpa Daerah)', company: '(Tanpa Company)', marketing: L.NO_MKT, merk: '(Tanpa Merk)' };
  var FEATURE_NOTE = 'Hanya akun dengan peran Editor di Google Sheet yang dapat menyimpan.';
  var DEMO_NOTE = 'Mode demo: perubahan hanya di memori, tidak masuk ke Google Sheet.';

  /* ---------------------------------------------------------- pembantu */
  function digits(v) { return String(v == null ? '' : v).replace(/\D/g, '').slice(0, 13); }
  function fmtMoney(d) { return d ? nf.format(+d) : ''; }
  function numOrNull(d) { return d === '' || d == null ? null : +d; }
  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getMonth() === +m[2] - 1 ? d : null;
  }
  function clean(v, placeholder) { return v === placeholder ? '' : v; }
  function sortedItems(id) {
    return S.items.filter(function (x) { return x.id === id; }).sort(function (a, b) { return a.no - b.no; });
  }
  function fail(kind, msg) { var e = new Error(msg); e.kind = kind; return e; }

  /* ---------------------------------------------------------- model <-> isian form */
  function orderToForm(o) {
    return {
      id: o.id, status: o.status,
      company: clean(o.company, PLACEHOLDER.company), marketing: clean(o.marketing, PLACEHOLDER.marketing), daerah: clean(o.daerah, PLACEHOLDER.daerah),
      orderDate: A.iso(o.orderDate), nilai: o.nilai > 0 ? digits(Math.round(o.nilai)) : '', ongkir: o.ongkir > 0 ? digits(Math.round(o.ongkir)) : '',
      nego: A.iso(o.nego), agree: A.iso(o.agree), contractNo: o.contractNo || '', start: A.iso(o.start), end: A.iso(o.end), pdfUrl: o.pdfUrl || ''
    };
  }
  function itemToForm(i, orderStatus) {
    return {
      no: i.no, nama: i.nama, merk: clean(i.merk, PLACEHOLDER.merk), type: i.type, qty: i.qty ? String(i.qty) : '',
      nilai: i.nilai > 0 ? digits(Math.round(i.nilai)) : '', ongkir: i.ongkir > 0 ? digits(Math.round(i.ongkir)) : '',
      status: i.status, follow: i.status === orderStatus
    };
  }
  function blankItem(status) {
    return { no: null, nama: '', merk: '', type: '', qty: '1', nilai: '', ongkir: '', status: status, follow: true };
  }
  function origOrderModel(o) {
    return {
      id: o.id, daerah: clean(o.daerah, PLACEHOLDER.daerah), orderDate: o.orderDate, company: clean(o.company, PLACEHOLDER.company),
      marketing: clean(o.marketing, PLACEHOLDER.marketing), status: o.status, nilai: o.nilai, ongkir: o.ongkir,
      nego: o.nego, agree: o.agree, contractNo: o.contractNo, start: o.start, end: o.end, pdfUrl: o.pdfUrl || ''
    };
  }
  function origItemModel(i) {
    return { no: i.no, nama: i.nama, merk: clean(i.merk, PLACEHOLDER.merk), type: i.type, qty: i.qty, nilai: i.nilai, ongkir: i.ongkir, status: i.status };
  }
  function toModel(f) {
    var o = f.o;
    return {
      order: {
        id: o.id.trim(), daerah: o.daerah.trim(), orderDate: parseDate(o.orderDate), company: o.company.trim(), marketing: o.marketing.trim(),
        status: o.status, nilai: numOrNull(o.nilai), ongkir: numOrNull(o.ongkir), nego: parseDate(o.nego), agree: parseDate(o.agree),
        contractNo: o.contractNo.trim(), start: parseDate(o.start), end: parseDate(o.end), pdfUrl: (o.pdfUrl || '').trim()
      },
      items: f.items.filter(function (it) { return !isBlankNew(it); }).map(function (it) {
        return {
          no: it.no, nama: it.nama.trim(), merk: it.merk.trim(), type: it.type.trim(), qty: it.qty === '' ? null : +it.qty,
          nilai: numOrNull(it.nilai), ongkir: numOrNull(it.ongkir), status: it.status
        };
      })
    };
  }
  function isBlankNew(it) {
    return it.no == null && !it.nama.trim() && !it.merk.trim() && !it.type.trim() && !it.nilai && !it.ongkir;
  }

  /* ---------------------------------------------------------- buka / tutup */
  function open(mode, id, opts) {
    var f;
    if (mode === 'edit') {
      var o = S.orders.filter(function (x) { return x.id === id; })[0];
      if (!o) return;
      var its = sortedItems(id);
      f = {
        mode: 'edit', o: orderToForm(o), custom: {}, errors: {},
        items: its.map(function (i) { return itemToForm(i, o.status); }),
        orig: { order: o, items: its }
      };
    } else {
      f = {
        mode: 'new', custom: {}, errors: {},
        o: { id: '', status: 'MASIH NEGOSIASI', company: '', marketing: '', daerah: '', orderDate: A.iso(new Date()), nilai: '', ongkir: '', nego: '', agree: '', contractNo: '', start: '', end: '', pdfUrl: '' },
        items: [blankItem('MASIH NEGOSIASI')],
        orig: { order: null, items: [] }
      };
    }
    f.error = ''; f.saving = false; f.dirty = false; f.stage = ''; f.pdf = null;
    f.products = productIndex();
    S.form = f;
    history.pushState({ drawer: 2 }, '');
    A.renderDrawer();
    var panel = $('.drawer-panel'); if (panel) panel.scrollTop = 0;
    var first = $(mode === 'new' ? '#fo-id' : '#fo-status'); if (first) first.focus();
    if (opts && opts.pickPdf) { var inp = $('#fo-pdf'); if (inp) inp.click(); }
  }

  function closeForm(showId) {
    var inDrawer2 = history.state && history.state.drawer === 2;
    S.form = null;
    if (showId) S.detail = showId;
    A.renderDrawer();
    if (inDrawer2) { S.skipPop = true; history.back(); }
  }
  function confirmDiscard() {
    return !S.form.dirty || window.confirm('Buang perubahan yang belum disimpan?');
  }
  function cancel() {
    if (!S.form || S.form.saving) return;
    if (!confirmDiscard()) return;
    closeForm(null);
  }
  /* Dipanggil saat tombol Back browser ditekan; riwayat sudah mundur. false = batal menutup. */
  function discard() {
    if (!S.form) return true;
    if (S.form.saving || !confirmDiscard()) return false;
    S.form = null;
    A.renderDrawer();
    return true;
  }

  function rerender(focusSel) {
    var panel = $('.drawer-panel'), top = panel ? panel.scrollTop : 0;
    A.renderDrawer();
    panel = $('.drawer-panel'); if (panel) panel.scrollTop = top;
    if (focusSel) { var el = $(focusSel); if (el) el.focus(); }
  }

  /* ---------------------------------------------------------- daftar pilihan */
  function listOf(src, key) {
    var ph = PLACEHOLDER[key];
    return A.uniq(src.map(function (x) { return x[key]; }).filter(function (v) { return v && v !== ph; }));
  }
  function productIndex() {
    var map = {};
    S.items.forEach(function (i) { if (i.nama) map[i.nama.trim().toLowerCase()] = { merk: clean(i.merk, PLACEHOLDER.merk), type: i.type }; });
    return map;
  }

/* ---------------------------------------------------------- PDF surat pesanan */
  var MAX_PDF = 25 * 1024 * 1024;
  var pdfjsP = null;
  function loadPdfjs() {                                     // pdf.js dimuat hanya saat dipakai (±1,7 MB)
    if (!pdfjsP) {
      var base = new URL('vendor/', document.baseURI).href;
      pdfjsP = new Function('u', 'return import(u)')(base + 'pdf.min.mjs').then(function (m) {
        m.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
        return m;
      }).catch(function (e) { pdfjsP = null; throw e; });
    }
    return pdfjsP;
  }
  function sizeText(n) { return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function dateIso(d) { return d ? A.iso(d) : ''; }

  /* Isi form dari hasil baca PDF. Mengembalikan daftar catatan "perlu diperiksa". */
  function applyParsed(f, r) {
    var P = window.PdfParse, o = f.o, notes = [];
    var companies = listOf(S.orders, 'company'), daerahs = listOf(S.orders, 'daerah'), merks = listOf(S.items, 'merk');
    o.id = r.noSP; o.contractNo = r.noSP;
    o.status = STATUSES.indexOf('SUDAH KONTRAK') >= 0 ? 'SUDAH KONTRAK' : o.status;
    var c = P.matchCompany(r.penyedia, companies);
    if (c) o.company = c;
    else if (r.penyedia) { o.company = /^(pt|cv|ud)\b/i.test(r.penyedia) ? r.penyedia.toUpperCase() : 'PT. ' + r.penyedia.toUpperCase(); notes.push('Company "' + o.company + '" belum ada di daftar; akan dibuat sebagai company baru.'); }
    var dm = P.matchDaerah(r.wilayah, r.pemesan, daerahs);
    if (dm.value) o.daerah = dm.value;
    else if (r.wilayah) {
      o.daerah = P.suggestDaerah(r.wilayah);
      notes.push('Daerah "' + o.daerah + '" belum ada di daftar (dari "' + r.wilayah + '"); akan dibuat sebagai daerah baru. Pilih daerah yang sudah ada bila itu yang dimaksud.');
    }
    if (dm.value && dm.candidates.length > 1) notes.push('Ada beberapa daerah yang mirip dengan "' + r.wilayah + '". Periksa pilihan Daerah.');
    o.orderDate = dateIso(r.tanggalSP); o.agree = dateIso(r.tanggalSP); o.start = dateIso(r.tanggalSP); o.end = dateIso(r.tiba);
    o.nego = '';
    o.nilai = r.total != null ? digits(r.total) : '';
    o.ongkir = r.ongkir != null ? digits(r.ongkir) : '';
    o.marketing = '';
    f.custom = {};
    f.items = (r.items || []).map(function (it) {
      var hit = f.products[it.nama.trim().toLowerCase()];
      return {
        no: null, nama: it.nama, merk: hit && hit.merk ? hit.merk : P.guessMerk(it.nama, merks), type: hit ? (hit.type || '') : '',
        qty: it.qty >= 1 ? String(Math.round(it.qty)) : '', nilai: it.nilai > 0 ? digits(it.nilai) : '', ongkir: it.ongkir > 0 ? digits(it.ongkir) : '',
        status: o.status, follow: true
      };
    });
    if (!f.items.length) f.items = [blankItem(o.status)];
    notes.unshift('Pilih Marketing (tidak ada di PDF).');
    if (f.items.some(function (it) { return !it.merk; })) notes.push('Merk belum terisi untuk barang yang belum pernah ada di sheet; pilih Merk dan isi Type.');
    notes.push('Tanggal Order diisi sama dengan tanggal surat pesanan, Tanggal Nego dikosongkan. Ubah bila berbeda.');
    return notes.concat(r.warnings || []);
  }

  function handlePdf(file) {
    var f = S.form;
    if (!f || !file) return;
    var isPdf = /\.pdf$/i.test(file.name || '') || file.type === 'application/pdf';
    if (!isPdf) { f.pdf = { error: 'File harus berformat PDF.' }; rerender(); return; }
    if (file.size > MAX_PDF) { f.pdf = { error: 'Ukuran PDF terlalu besar (maksimal ' + sizeText(MAX_PDF) + ').' }; rerender(); return; }
    f.dirty = true; f.error = '';
    if (f.mode === 'edit') {                                  // order yang sudah ada: hanya melampirkan, isian tidak diubah
      f.pdf = { file: file, name: file.name, size: file.size, url: '', notes: [], attachOnly: true };
      rerender(); return;
    }
    f.pdf = { file: file, name: file.name, size: file.size, url: '', reading: true, notes: [] };
    rerender();
    loadPdfjs().then(function (lib) {
      return file.arrayBuffer().then(function (buf) { return window.PdfParse.readPdf(lib, buf); });
    }).then(function (res) {
      if (S.form !== f) return;
      var r = window.PdfParse.parseSP(res.lines);
      if (!r.ok) { f.pdf = { file: file, name: file.name, size: file.size, reading: false, error: (r.warnings && r.warnings[0]) || 'PDF tidak dikenali.', notes: [] }; rerender(); return; }
      var dup = window.Logic.findSameOrder(S.orders, r.noSP, r.noSP);
      if (dup) { f.pdf = { error: 'Order ini sudah ada di sheet dengan ID ' + dup.id + ' (baris ' + dup.row + '). Buka order tersebut lalu lampirkan PDF dari tombol Edit.', notes: [] }; rerender(); return; }
      var notes = applyParsed(f, r);
      f.pdf = { file: file, name: file.name, size: file.size, url: '', notes: notes, filled: true, pages: res.pages };
      f.errors = {};
      rerender();
    }).catch(function (e) {
      if (S.form !== f) return;
      var msg = /Failed to fetch|import|Load failed|NetworkError/i.test((e && e.message) || '') ? 'Pembaca PDF gagal dimuat. Periksa koneksi internet lalu coba lagi.' : 'PDF tidak bisa dibaca (' + ((e && e.message) || 'kesalahan tidak dikenal') + '). Isi form secara manual.';
      f.pdf = { file: file, name: file.name, size: file.size, reading: false, error: msg, notes: [] };
      rerender();
    });
  }

  function pdfCard(f) {
    var p = f.pdf, h = '<section class="card pdf-card"><h3 class="sec">Surat Pesanan (PDF)</h3>' +
      '<input id="fo-pdf" type="file" accept="application/pdf,.pdf" hidden>';
    var existing = f.o.pdfUrl;
    if (existing && !(p && p.file)) h += '<p class="small" style="margin:0 0 8px">Tersimpan di Google Drive: <a href="' + esc(existing) + '" target="_blank" rel="noopener">buka PDF</a></p>';
    if (p && p.reading) h += '<p class="small" role="status">Membaca ' + esc(p.name) + '…</p>';
    else if (p && p.file) {
      h += '<p class="small" style="margin:0 0 6px"><strong>' + esc(p.name) + '</strong> · ' + sizeText(p.size) + '</p>';
      if (p.filled) h += '<p class="small ok-note" role="status">Form terisi otomatis dari PDF. Periksa semua isian sebelum menyimpan.</p>';
      else if (p.attachOnly) h += '<p class="small muted">Saat disimpan, PDF diunggah ke Google Drive dan tautannya dicatat di kolom "' + esc(A.CFG.PDF_COLUMN_NAME || 'Link PDF') + '". Isian order tidak diubah.</p>';
      if (S.source === 'demo') h += '<p class="small muted">Mode demo: PDF tidak diunggah ke Drive.</p>';
      else if (p.filled) h += '<p class="small muted">PDF diunggah ke Google Drive saat Anda menekan Simpan.</p>';
    }
    if (p && p.error) h += '<p class="small err-note" role="alert">' + esc(p.error) + '</p>';
    if (p && p.notes && p.notes.length) h += '<ul class="pdf-notes">' + p.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
    var has = p && (p.file || p.reading);
    h += '<div class="pdf-actions"><button type="button" class="btn" data-fa="pick-pdf"' + (f.saving || (p && p.reading) ? ' disabled' : '') + '>' +
      (has ? 'Ganti PDF…' : (f.mode === 'new' ? 'Pilih PDF untuk isi otomatis…' : (existing ? 'Ganti PDF…' : 'Lampirkan PDF…'))) + '</button>' +
      (p && p.file && !p.url && !f.saving ? '<button type="button" class="btn ghost" data-fa="rm-pdf">Lepas PDF</button>' : '') + '</div>';
    if (f.mode === 'new' && !has) h += '<p class="fh">Unggah Surat Pesanan E-Katalog (PDF): ID, company, daerah, tanggal, total, ongkir dan barang terisi otomatis, dan file-nya disimpan ke Google Drive.</p>';
    return h + '</section>';
  }

  /* ---------------------------------------------------------- HTML */
  function fld(id, label, inner, o) {
    o = o || {};
    return '<div class="ff' + (o.wide ? ' wide' : '') + '"><label class="fl" for="' + id + '">' + esc(label) +
      (o.req ? '<b class="req" aria-hidden="true"> *</b>' : '') + '</label>' + inner +
      (o.hint ? '<div class="fh">' + esc(o.hint) + '</div>' : '') + '</div>';
  }
  function bad(f, key) { return f.errors[key] ? ' aria-invalid="true"' : ''; }
  function textInput(id, attrs, value, type, extra) {
    return '<input id="' + id + '" type="' + (type || 'text') + '" ' + attrs + ' value="' + esc(value) + '" autocomplete="off"' + (extra || '') + '>';
  }
  function moneyInput(id, attrs, digitStr, f, key) {
    return '<span class="money"><i aria-hidden="true">Rp</i><input id="' + id + '" type="text" inputmode="numeric" autocomplete="off" data-money="1" ' + attrs +
      ' value="' + esc(fmtMoney(digitStr)) + '" placeholder="0"' + bad(f, key) + '></span>';
  }
  function statusSelect(id, attrs, val) {
    var list = STATUSES.indexOf(val) < 0 && val ? [val].concat(STATUSES) : STATUSES;
    return '<select id="' + id + '" ' + attrs + '>' + list.map(function (s) {
      return '<option value="' + esc(s) + '"' + (s === val ? ' selected' : '') + '>' + esc(A.stMeta(s).label) + '</option>';
    }).join('') + '</select>';
  }
  /* Pilihan dropdown + opsi "Tambah baru…" (muncul kolom ketik) */
  function picker(f, id, attrs, customKey, list, val, noun, errKey) {
    var custom = !!f.custom[customKey] || (val && list.indexOf(val) < 0);
    var h = '<select id="' + id + '" data-pick="' + customKey + '" ' + attrs + bad(f, errKey) + '><option value="">— Pilih ' + esc(noun) + ' —</option>' +
      list.map(function (v) { return '<option value="' + esc(v) + '"' + (!custom && v === val ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') +
      '<option value="' + NEW + '"' + (custom ? ' selected' : '') + '>+ Tambah ' + esc(noun) + ' baru…</option></select>';
    if (custom) h += '<input id="' + id + '-new" class="ff-new" type="text" ' + attrs + ' value="' + esc(val) + '" placeholder="Ketik nama ' + esc(noun) + ' baru" autocomplete="off"' + bad(f, errKey) + '>';
    return h;
  }

  function itemHtml(f, it, i, merks) {
    var p = 'fi-' + i + '-', a = function (k) { return 'data-fi="' + k + '" data-i="' + i + '"'; };
    return '<div class="item-edit">' +
      '<div class="item-edit-head"><strong>Item ' + (i + 1) + '</strong>' +
      (it.no == null
        ? '<button type="button" class="btn small ghost" data-fa="rm-item" data-i="' + i + '">Hapus</button>'
        : '<span class="muted small">No. ' + it.no + ' · sudah ada di sheet</span>') + '</div>' +
      '<div class="fgrid">' +
      fld(p + 'nama', 'Nama Barang', textInput(p + 'nama', a('nama') + ' list="dl-nama"' + bad(f, 'i' + i + 'nama'), it.nama), { wide: true, req: true }) +
      fld(p + 'merk', 'Merk', picker(f, p + 'merk', a('merk'), 'i' + i + 'merk', merks, it.merk, 'merk', 'i' + i + 'merk')) +
      fld(p + 'type', 'Type', textInput(p + 'type', a('type'), it.type)) +
      fld(p + 'qty', 'Qty', textInput(p + 'qty', a('qty') + ' inputmode="numeric" min="1" step="1"' + bad(f, 'i' + i + 'qty'), it.qty, 'number'), { req: true }) +
      fld(p + 'status', 'Status Item', statusSelect(p + 'status', a('status'), it.status)) +
      fld(p + 'nilai', 'Nilai Barang (Rp)', moneyInput(p + 'nilai', a('nilai'), it.nilai, f, 'i' + i + 'nilai')) +
      fld(p + 'ongkir', 'Ongkir (Rp)', moneyInput(p + 'ongkir', a('ongkir'), it.ongkir, f, 'i' + i + 'ongkir')) +
      '</div></div>';
  }

  function html() {
    var f = S.form, o = f.o, ao = function (k) { return 'data-fo="' + k + '"'; };
    var companies = listOf(S.orders, 'company'), mkts = listOf(S.orders, 'marketing'), daerahs = listOf(S.orders, 'daerah'), merks = listOf(S.items, 'merk');
    var names = A.uniq(S.items.map(function (i) { return (i.nama || '').trim(); }));
    var isNew = f.mode === 'new';

    return '<div class="drawer-head"><div><h2 id="drawer-title">' + (isNew ? 'Order Baru' : 'Edit Order') + '</h2>' +
      '<div class="muted small" style="margin-top:3px">' + (isNew ? 'Isi data order, lalu simpan ke Google Sheet.' : esc(o.id)) + '</div></div>' +
      '<button class="icon-btn" type="button" data-fa="cancel" aria-label="Tutup"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>' +

      '<div class="drawer-pad">' + pdfCard(f) +
      '<section class="card"><h3 class="sec">Data Order</h3><div class="fgrid">' +
      fld('fo-id', 'ID Pesanan', textInput('fo-id', ao('id') + (isNew ? '' : ' disabled') + bad(f, 'id') + ' spellcheck="false" autocapitalize="characters"', o.id), { wide: true, req: true, hint: isNew ? 'Contoh: EP-01M59TSSZ0RBFH4AJC8Z7Q9XW8 (tanpa spasi)' : 'ID tidak dapat diubah.' }) +
      fld('fo-status', 'Status', statusSelect('fo-status', ao('status'), o.status), { req: true }) +
      fld('fo-orderDate', 'Tanggal Order', textInput('fo-orderDate', ao('orderDate') + bad(f, 'orderDate'), o.orderDate, 'date'), { req: isNew }) +
      fld('fo-company', 'Company', picker(f, 'fo-company', ao('company'), 'company', companies, o.company, 'company', 'company'), { wide: true, req: true }) +
      fld('fo-marketing', 'Marketing', picker(f, 'fo-marketing', ao('marketing'), 'marketing', mkts, o.marketing, 'marketing', 'marketing'), { req: true }) +
      fld('fo-daerah', 'Daerah', picker(f, 'fo-daerah', ao('daerah'), 'daerah', daerahs, o.daerah, 'daerah', 'daerah'), { req: true }) +
      fld('fo-nilai', 'Total Nilai (Rp)', moneyInput('fo-nilai', ao('nilai'), o.nilai, f, 'nilai'), { req: isNew }) +
      fld('fo-ongkir', 'Total Ongkir (Rp)', moneyInput('fo-ongkir', ao('ongkir'), o.ongkir, f, 'ongkir')) +
      fld('fo-nego', 'Tanggal Nego', textInput('fo-nego', ao('nego'), o.nego, 'date')) +
      fld('fo-agree', 'Tanggal Setuju', textInput('fo-agree', ao('agree'), o.agree, 'date')) +
      fld('fo-contractNo', 'No. Kontrak', textInput('fo-contractNo', ao('contractNo'), o.contractNo), { wide: true }) +
      fld('fo-start', 'Awal Kontrak', textInput('fo-start', ao('start') + bad(f, 'start'), o.start, 'date')) +
      fld('fo-end', 'Akhir Kontrak', textInput('fo-end', ao('end') + bad(f, 'end'), o.end, 'date')) +
      '</div></section>' +

      '<section class="card"><h3 class="sec">Item Barang</h3>' +
      '<datalist id="dl-nama">' + names.map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('') + '</datalist>' +
      '<div class="items-edit">' + f.items.map(function (it, i) { return itemHtml(f, it, i, merks); }).join('') + '</div>' +
      '<button type="button" class="btn" data-fa="add-item" style="margin-top:10px">+ Tambah Item</button>' +
      (isNew ? '' : '<p class="muted small" style="margin-top:10px">Item yang sudah ada dapat diubah, tetapi tidak dapat dihapus dari aplikasi. Untuk menghapus, hapus barisnya langsung di Google Sheet.</p>') +
      '</section></div>' +

      '<div class="form-foot"><div class="form-msg' + (f.error ? ' err' : '') + '" role="alert">' + esc(f.error || (f.saving && f.stage) || (S.source === 'demo' ? DEMO_NOTE : FEATURE_NOTE)) + '</div>' +
      '<div class="form-btns"><button type="button" class="btn" data-fa="cancel"' + (f.saving ? ' disabled' : '') + '>Batal</button>' +
      '<button type="button" class="btn primary" data-fa="save"' + (f.saving ? ' disabled' : '') + '>' + (f.saving ? 'Menyimpan…' : 'Simpan') + '</button></div></div>';
  }

  /* ---------------------------------------------------------- validasi */
  function validate(f) {
    var m = toModel(f), miss = [], errs = {}, extra = [];
    function req(key, label, ok) { if (!ok) { miss.push(label); errs[key] = 1; } }
    req('id', 'ID Pesanan', !!m.order.id);
    if (m.order.id && /\s/.test(m.order.id)) { errs.id = 1; extra.push('ID Pesanan tidak boleh mengandung spasi.'); }
    req('company', 'Company', !!m.order.company);
    req('marketing', 'Marketing', !!m.order.marketing);
    req('daerah', 'Daerah', !!m.order.daerah);
    if (f.mode === 'new') {
      req('orderDate', 'Tanggal Order', !!m.order.orderDate);
      req('nilai', 'Total Nilai', m.order.nilai != null);
    }
    if (m.order.start && m.order.end && m.order.end < m.order.start) { errs.end = 1; extra.push('Akhir kontrak tidak boleh lebih awal dari awal kontrak.'); }
    var k = 0;
    f.items.forEach(function (it, i) {
      if (isBlankNew(it)) return;
      k++;
      if (!it.nama.trim()) { errs['i' + i + 'nama'] = 1; miss.push('Nama Barang (Item ' + (i + 1) + ')'); }
      var q = it.qty === '' ? NaN : +it.qty;
      if (!(q >= 1) || Math.floor(q) !== q) { errs['i' + i + 'qty'] = 1; miss.push('Qty (Item ' + (i + 1) + ') minimal 1'); }
    });
    f.errors = errs;
    var msg = [];
    if (miss.length) msg.push('Lengkapi: ' + miss.join(', ') + '.');
    return msg.concat(extra).join(' ');
  }

  /* ---------------------------------------------------------- simpan */
  function apiError(r, fallback) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      var em = (j.error && j.error.message) || '';
      if (r.status === 403) return fail('readonly', 'Akun ini tidak punya izin mengubah spreadsheet. Minta pemilik menjadikan Anda Editor lewat tombol Bagikan (Share) di Google Sheet.');
      if (r.status === 404) return fail('notfound', 'Spreadsheet tidak ditemukan.');
      return fail('other', em || (fallback + ' (HTTP ' + r.status + ').'));
    });
  }
  function getJson(url, what) {
    return A.gfetch(url).then(function (r) {
      if (r.ok) return r.json();
      return apiError(r, what).then(function (e) { throw e; });
    }, function (e) {
      if (e && e.kind) throw e;
      throw fail('network', 'Tidak dapat terhubung ke Google. Periksa koneksi internet.');
    });
  }
  function sheetMeta(base) {
    return getJson(base + '?fields=' + encodeURIComponent('sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'), 'Gagal membaca info sheet').then(function (j) {
      var out = {};
      (j.sheets || []).forEach(function (s) {
        var p = s.properties || {};
        if (p.title === A.CFG.SHEET_ORDER) out.order = { sheetId: p.sheetId, rowCount: (p.gridProperties || {}).rowCount, columnCount: (p.gridProperties || {}).columnCount };
        if (p.title === A.CFG.SHEET_ITEM) out.item = { sheetId: p.sheetId, rowCount: (p.gridProperties || {}).rowCount };
      });
      if (!out.order || !out.item) throw fail('schema', 'Tab "' + A.CFG.SHEET_ORDER + '" atau "' + A.CFG.SHEET_ITEM + '" tidak ditemukan. Periksa nama tab di config.js.');
      return out;
    });
  }
  /* Kolom mana yang berisi rumus pada baris data terakhir (tidak boleh ditimpa) */
  function probe(base, ov, iv) {
    var q = new URLSearchParams(), want = [];
    if (ov.length >= 2) { q.append('ranges', "'" + A.CFG.SHEET_ORDER + "'!A" + ov.length + ':ZZ' + ov.length); want.push('order'); }
    if (iv.length >= 2) { q.append('ranges', "'" + A.CFG.SHEET_ITEM + "'!A" + iv.length + ':ZZ' + iv.length); want.push('item'); }
    var out = { order: {}, item: {} };
    if (!want.length) return Promise.resolve(out);
    q.set('valueRenderOption', 'FORMULA');
    return getJson(base + '/values:batchGet?' + q.toString(), 'Gagal membaca rumus sheet').then(function (j) {
      (j.valueRanges || []).forEach(function (vr, n) {
        var row = (vr.values && vr.values[0]) || [];
        row.forEach(function (v, c) { if (typeof v === 'string' && v.charAt(0) === '=') out[want[n]][c] = true; });
      });
      return out;
    });
  }

  function saveSheets(f, m) {
    var base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(A.CFG.SPREADSHEET_ID);
    return A.fetchSheets().then(function (fresh) {
      return Promise.all([sheetMeta(base), probe(base, fresh.order, fresh.item)]).then(function (r) {
        var plan = W.plan({
          mode: f.mode, order: m.order, orig: f.orig.order ? origOrderModel(f.orig.order) : null,
          items: m.items, origItems: f.orig.items.map(origItemModel), pdfColumnName: A.CFG.PDF_COLUMN_NAME,
          orderValues: fresh.order, itemValues: fresh.item, sheets: r[0], formula: r[1]
        });
        if (!plan.requests.length) return { nochange: true };
        return A.gfetch(base + ':batchUpdate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: plan.requests })
        }).then(function (resp) {
          if (resp.ok) return { saved: true };
          return apiError(resp, 'Gagal menyimpan').then(function (e) { throw e; });
        }, function (e) {
          if (e && e.kind) throw e;
          throw fail('network', 'Tidak dapat terhubung ke Google. Data belum tersimpan; coba lagi.');
        });
      });
    });
  }

  /* Mode demo: ubah data di memori saja */
  function saveDemo(f, m) {
    var o = m.order, cur = S.orders.filter(function (x) { return x.id === o.id; })[0];
    var changedHead = false;
    if (f.mode === 'new') {
      if (cur) return Promise.reject(fail('conflict', 'ID Pesanan "' + o.id + '" sudah ada.'));
      var no = S.orders.reduce(function (a, x) { return Math.max(a, +x.no || 0); }, 0) + 1;
      S.orders.push({
        row: S.orders.length + 2, no: no, id: o.id, daerah: o.daerah, orderDate: o.orderDate, company: o.company, marketing: o.marketing,
        status: o.status, nilai: o.nilai || 0, ongkir: o.ongkir || 0, nego: o.nego, agree: o.agree, contractNo: o.contractNo, start: o.start, end: o.end
      });
    } else {
      if (!cur) return Promise.reject(fail('stale', 'Order tidak ditemukan.'));
      changedHead = cur.status !== o.status || cur.marketing !== (o.marketing || L.NO_MKT);
      ['daerah', 'orderDate', 'company', 'marketing', 'status', 'nego', 'agree', 'contractNo', 'start', 'end'].forEach(function (k) { cur[k] = o[k]; });
      cur.nilai = o.nilai || 0; cur.ongkir = o.ongkir || 0;
    }
    var mine = S.items.filter(function (x) { return x.id === o.id; });
    var maxNo = mine.reduce(function (a, x) { return Math.max(a, x.no || 0); }, 0);
    m.items.forEach(function (it) {
      if (it.no == null) {
        S.items.push({ row: S.items.length + 2, id: o.id, no: ++maxNo, nama: it.nama, merk: it.merk || '(Tanpa Merk)', type: it.type, qty: it.qty, nilai: it.nilai || 0, ongkir: it.ongkir || 0, statusInduk: o.status, status: it.status, marketing: o.marketing });
      } else {
        var ex = mine.filter(function (x) { return x.no === it.no; })[0];
        if (ex) { ex.nama = it.nama; ex.merk = it.merk || '(Tanpa Merk)'; ex.type = it.type; ex.qty = it.qty; ex.nilai = it.nilai || 0; ex.ongkir = it.ongkir || 0; ex.status = it.status; }
      }
    });
    if (changedHead) S.items.forEach(function (x) { if (x.id === o.id) { x.statusInduk = o.status; x.marketing = o.marketing; } });
    return Promise.resolve({ saved: true, demo: true });
  }

  /* Muat ulang data sheet; jika muat ulang lain sedang berjalan, tunggu dulu (refresh() akan melewatinya). */
  function reload() {
    return new Promise(function (resolve) {
      var tries = 0;
      (function go() {
        if (S.loading && tries++ < 12) { setTimeout(go, 400); return; }
        resolve(A.refresh(false));
      })();
    });
  }

  function save() {
    var f = S.form;
    if (!f || f.saving) return;
    var err = validate(f);
    if (err) { f.error = err; rerender(); var bad1 = $('[aria-invalid="true"]'); if (bad1) bad1.focus(); return; }
    f.error = ''; f.saving = true;
    var demo = S.source === 'demo', needUpload = !demo && f.pdf && f.pdf.file && !f.pdf.url;
    f.stage = needUpload ? 'Mengunggah PDF ke Google Drive…' : 'Menyimpan…'; rerender();
    var up = needUpload ? A.drive.upload(f.pdf.file, 'Surat Pesanan ' + f.o.id.trim() + '.pdf').then(function (r) { f.pdf.url = r.url; f.o.pdfUrl = r.url; }) : Promise.resolve();
    var run = up.then(function () {
      var m = toModel(f);
      if (needUpload) { f.stage = 'Menyimpan ke Google Sheet…'; if (S.form === f) rerender(); }
      return demo ? saveDemo(f, m) : saveSheets(f, m);
    });
    var m = toModel(f);
    run.then(function (res) {
      if (res.nochange) { A.toast('Tidak ada perubahan untuk disimpan'); closeForm(m.order.id); return; }
      var after = res.demo ? Promise.resolve(A.render()) : reload();
      return after.then(function () {
        if (!res.demo && f.mode === 'new' && !S.orders.some(function (x) { return x.id === m.order.id; })) {
          A.toast('Tersimpan, tetapi order belum terlihat. Muat ulang dan periksa sheet.');
        } else {
          A.toast(res.demo ? 'Mode demo: tersimpan di memori saja, tidak masuk ke Google Sheet.' : (f.mode === 'new' ? 'Order baru tersimpan' : 'Perubahan tersimpan'));
        }
        closeForm(m.order.id);
        A.render();
      });
    }).catch(function (e) {
      f.saving = false;
      f.error = ((f.pdf && f.pdf.url && !(e && e.kind === 'drive-api') ? 'PDF sudah tersimpan di Google Drive, tetapi data belum masuk ke Sheet. ' : '') + ((e && e.message) || 'Gagal menyimpan. Coba lagi.'));
      if (S.form === f) rerender();
    });
  }

  /* ---------------------------------------------------------- event (dipasang sekali pada panel) */
  function ref(el) {
    if (el.dataset.fi != null) return { item: true, i: +el.dataset.i, k: el.dataset.fi };
    return { item: false, k: el.dataset.fo };
  }
  function setVal(r, v) {
    var f = S.form;
    if (r.item) f.items[r.i][r.k] = v; else f.o[r.k] = v;
  }
  function formatMoneyField(el) {
    var pos = el.selectionStart, before = el.value.slice(0, pos).replace(/\D/g, '').length;
    var d = digits(el.value);
    el.value = fmtMoney(d);
    var n = 0, i = 0;
    for (; i < el.value.length && n < before; i++) if (/\d/.test(el.value[i])) n++;
    try { el.setSelectionRange(i, i); } catch (e) { /* abaikan */ }
    return d;
  }

  function onInput(e) {
    var f = S.form, el = e.target;
    if (!f || !el || !el.closest || el.tagName === 'SELECT') return;
    var t = el.closest('[data-fo],[data-fi]');
    if (!t) return;
    var r = ref(t);
    var v = t.dataset.money ? formatMoneyField(t) : t.value;
    setVal(r, v);
    f.dirty = true;
    if (f.errors) delete f.errors[r.item ? 'i' + r.i + r.k : r.k];
  }

  function onChange(e) {
    var f = S.form, el = e.target;
    if (!f || !el || !el.closest) return;
    if (el.id === 'fo-pdf') { var fl = el.files && el.files[0]; el.value = ''; if (fl) handlePdf(fl); return; }
    var t = el.closest('[data-fo],[data-fi]');
    if (!t) return;
    var r = ref(t);
    f.dirty = true;
    if (t.tagName === 'SELECT') {
      if (t.dataset.pick) {                                  // pilihan dropdown + "Tambah baru"
        if (t.value === NEW) { f.custom[t.dataset.pick] = true; setVal(r, ''); rerender('#' + t.id + '-new'); }
        else { f.custom[t.dataset.pick] = false; setVal(r, t.value); if (f.errors) delete f.errors[r.item ? 'i' + r.i + r.k : r.k]; rerender(); }
        return;
      }
      setVal(r, t.value);
      if (!r.item && r.k === 'status') {                      // item yang "ikut" status order ikut berubah
        f.items.forEach(function (it) { if (it.follow) it.status = t.value; });
        rerender();
      } else if (r.item && r.k === 'status') {
        f.items[r.i].follow = false;
      }
      return;
    }
    if (r.item && r.k === 'nama') {                          // isi otomatis merk & type dari barang yang sudah pernah ada
      var hit = f.products[t.value.trim().toLowerCase()], it = f.items[r.i];
      if (hit && it.no == null) {
        var changed = false;
        if (!it.merk && hit.merk) { it.merk = hit.merk; changed = true; }
        if (!it.type && hit.type) { it.type = hit.type; changed = true; }
        if (changed) rerender('#fi-' + r.i + '-qty');
      }
    }
  }

  function onClick(e) {
    var b = e.target && e.target.closest && e.target.closest('[data-fa]');
    var f = S.form;
    if (!b || !f) return;
    var a = b.dataset.fa;
    if (a === 'cancel') cancel();
    else if (a === 'save') save();
    else if (a === 'pick-pdf') { var inp = $('#fo-pdf'); if (inp) inp.click(); }
    else if (a === 'rm-pdf') { f.pdf = null; rerender(); }
    else if (a === 'add-item') { f.items.push(blankItem(f.o.status)); f.dirty = true; rerender('#fi-' + (f.items.length - 1) + '-nama'); }
    else if (a === 'rm-item') {
      var i = +b.dataset.i;
      if (f.items[i] && f.items[i].no == null) { f.items.splice(i, 1); f.dirty = true; rerender(); }
    }
  }

  var drawer = $('#drawer');
  drawer.addEventListener('click', onClick);
  drawer.addEventListener('input', onInput);
  drawer.addEventListener('change', onChange);

  A.form = { open: open, cancel: cancel, discard: discard, html: html, _validate: validate, _toModel: toModel, _save: save };
})();

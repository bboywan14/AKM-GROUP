/* Penyusun perubahan Google Sheet untuk input/edit order.
   Tidak menyentuh jaringan maupun DOM: menerima data sheet terbaru + isian form,
   menghasilkan daftar permintaan `spreadsheets.batchUpdate` (atomik: semua berhasil atau tidak sama sekali).

   Prinsip keselamatan (sheet ini dipakai bisnis dan berisi rumus):
   - Edit hanya menulis sel yang BENAR-BENAR diubah pengguna.
   - Kolom turunan (mis. "Status Induk (auto)", "Bulan Order") yang berisi rumus tidak pernah ditimpa.
   - Teks ditulis sebagai teks biasa (stringValue), sehingga tidak bisa menjadi rumus.
   - Baris baru dibuat dengan menyalin baris terakhir (rumus + format + validasi), lalu semua kolom
     non-rumus dikosongkan dan diisi ulang, sehingga tidak ada sisa nilai dari baris yang disalin. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic.js'));
  else root.Writer = factory(root.Logic);
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  var MONEY_FMT = { type: 'CURRENCY', pattern: '"Rp "#,##0' };
  var DATE_FMT = { type: 'DATE', pattern: 'm/d/yyyy' };
  var MONTH_FMT = { type: 'DATE', pattern: 'mmm-yy' };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fail(kind, msg) { var e = new Error(msg); e.kind = kind; return e; }
  function isoOf(d) {
    return d ? d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) : '';
  }
  function serial(d) {
    return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
  }

  /* ---------- sel ---------- */
  function text(s) {
    s = s == null ? '' : String(s).trim();
    return s === '' ? { cell: {}, mask: 'userEnteredValue' } : { cell: { userEnteredValue: { stringValue: s } }, mask: 'userEnteredValue' };
  }
  function integer(n) {
    return n == null || n === '' ? { cell: {}, mask: 'userEnteredValue' } : { cell: { userEnteredValue: { numberValue: +n } }, mask: 'userEnteredValue' };
  }
  function money(n) {
    return n == null || n === ''
      ? { cell: {}, mask: 'userEnteredValue' }
      : { cell: { userEnteredValue: { numberValue: +n }, userEnteredFormat: { numberFormat: MONEY_FMT } }, mask: 'userEnteredValue,userEnteredFormat.numberFormat' };
  }
  function date(d) {
    return !d
      ? { cell: {}, mask: 'userEnteredValue' }
      : { cell: { userEnteredValue: { numberValue: serial(d) }, userEnteredFormat: { numberFormat: DATE_FMT } }, mask: 'userEnteredValue,userEnteredFormat.numberFormat' };
  }
  function like(sample, v) {
    if (typeof sample === 'string') return text(String(v));
    if (typeof sample === 'boolean') return { cell: { userEnteredValue: { boolValue: !!v } }, mask: 'userEnteredValue' };
    return integer(v);
  }
  var MAKE = { text: text, money: money, date: date, number: integer };

  function put(reqs, sheetId, row, col, c) {
    reqs.push({ updateCells: { start: { sheetId: sheetId, rowIndex: row - 1, columnIndex: col }, rows: [{ values: [c.cell] }], fields: c.mask } });
  }
  function same(a, b, type) {
    if (type === 'date') return isoOf(a) === isoOf(b);
    if (type === 'money' || type === 'number') return (+a || 0) === (+b || 0);
    return String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim();
  }

  /* ---------- kolom ---------- */
  function cols(values, defs) {
    var idx = L.buildIndex((values && values[0]) || []), out = {};
    Object.keys(defs).forEach(function (k) { out[k] = L.findCol.apply(null, [idx].concat(defs[k])); });
    return out;
  }
  var ORDER_COLS = {
    no: ['no'], id: ['id pesanan'], daerah: ['daerah'], orderDate: ['order date'], bulan: ['bulan order'],
    company: ['company'], marketing: ['marketing'], status: ['status'], nilai: ['total nilai'], ongkir: ['total ongkir'],
    nego: ['nego date'], agree: ['agree date'], contractNo: ['contract no'], start: ['start contract'], end: ['end contract'],
    visible: ['_visible'], pdfUrl: ['link pdf', 'tautan pdf']
  };
  var ITEM_COLS = {
    id: ['id pesanan'], no: ['no item'], nama: ['nama barang'], merk: ['merk'], type: ['type'], qty: ['qty'],
    nilai: ['nilai barang'], ongkir: ['ongkir'], statusInduk: ['status induk (auto)', 'status induk'],
    status: ['status item (editable)', 'status item'], marketing: ['marketing (dari master)', 'marketing'],
    daerah: ['daerah'], company: ['company']
  };
  var ORDER_FIELDS = [
    ['daerah', 'text', 'Daerah'], ['orderDate', 'date', 'Order Date'], ['company', 'text', 'Company'],
    ['marketing', 'text', 'Marketing'], ['status', 'text', 'Status'], ['nilai', 'money', 'Total Nilai'],
    ['ongkir', 'money', 'Total Ongkir'], ['nego', 'date', 'Nego Date'], ['agree', 'date', 'Agree Date'],
    ['contractNo', 'text', 'Contract No'], ['start', 'date', 'Start Contract'], ['end', 'date', 'End Contract']
  ];
  var ITEM_FIELDS = [
    ['nama', 'text', 'Nama Barang'], ['merk', 'text', 'Merk'], ['type', 'text', 'Type'], ['qty', 'number', 'Qty'],
    ['nilai', 'money', 'Nilai Barang'], ['ongkir', 'money', 'Ongkir'], ['status', 'text', 'Status Item (editable)']
  ];

  function need(cmap, key, sheet, label) {
    if (cmap[key] < 0) throw fail('schema', 'Kolom "' + label + '" tidak ditemukan di sheet "' + sheet + '".');
    return cmap[key];
  }

  /* Baris baru: salin baris terakhir (rumus/format/validasi), kosongkan kolom non-rumus, lalu isi. */
  function prepNewRow(reqs, sheet, values, row, written, formulaCols) {
    var last = values.length;
    var ncols = Math.max((values[0] || []).length, (values[last - 1] || []).length);
    if (sheet.rowCount != null && sheet.rowCount < row) {
      reqs.push({ appendDimension: { sheetId: sheet.sheetId, dimension: 'ROWS', length: row - sheet.rowCount } });
    }
    if (last >= 2) {
      reqs.push({
        copyPaste: {
          source: { sheetId: sheet.sheetId, startRowIndex: last - 1, endRowIndex: last, startColumnIndex: 0, endColumnIndex: ncols },
          destination: { sheetId: sheet.sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 0, endColumnIndex: ncols },
          pasteType: 'PASTE_NORMAL', pasteOrientation: 'NORMAL'
        }
      });
      for (var c = 0; c < ncols; c++) {
        if (written[c] || formulaCols[c]) continue;
        put(reqs, sheet.sheetId, row, c, text(''));
      }
    }
  }

  /**
   * ctx = {
   *   mode: 'new'|'edit',
   *   order: model, orig: model|null,          // model: {id,daerah,orderDate:Date|null,company,marketing,status,nilai:number|null,ongkir,nego,agree,contractNo,start,end}
   *   items: [{no:number|null,nama,merk,type,qty,nilai,ongkir,status}], origItems: [{no,...}],
   *   orderValues, itemValues,                 // nilai mentah terbaru dari sheet (UNFORMATTED_VALUE), baris pertama = header
   *   sheets: {order:{sheetId,rowCount}, item:{sheetId,rowCount}},
   *   formula: {order:{<kolom>:true}, item:{<kolom>:true}}   // kolom yang berisi rumus pada baris terakhir
   * }
   * return { requests, orderRow, itemRows:[...], changed }
   */
  function plan(ctx) {
    var reqs = [], isNew = ctx.mode === 'new';
    var o = ctx.order, orig = ctx.orig || {};
    var ov = ctx.orderValues || [], iv = ctx.itemValues || [];
    var oc = cols(ov, ORDER_COLS), ic = cols(iv, ITEM_COLS);
    var oF = (ctx.formula && ctx.formula.order) || {}, iF = (ctx.formula && ctx.formula.item) || {};
    var oSheet = ctx.sheets.order, iSheet = ctx.sheets.item;
    var SO = 'Master Order', SI = 'Detail Item';
    need(oc, 'id', SO, 'ID Pesanan'); need(ic, 'id', SI, 'ID Pesanan');

    var orders = L.parseOrders(ov), fresh = L.parseItems(iv);
    var existing = orders.filter(function (x) { return x.id === o.id; })[0];
    if (isNew && existing) throw fail('conflict', 'ID Pesanan "' + o.id + '" sudah ada di sheet.');
    if (isNew) {                           // sheet mencampur penulisan "EP-xxxx" dan "xxxx": anggap sama
      var same1 = L.findSameOrder(orders, o.id, o.contractNo);
      if (same1) throw fail('conflict', 'Order ini sudah ada di sheet dengan ID "' + same1.id + '" (baris ' + same1.row + '). Buka order tersebut untuk mengedit.');
    }
    if (!isNew && !existing) throw fail('stale', 'Order "' + o.id + '" tidak ditemukan lagi di sheet. Muat ulang data lalu coba lagi.');

    /* ===== Master Order ===== */
    var oRow = isNew ? Math.max(ov.length, 1) + 1 : existing.row;
    var oLast = ov[ov.length - 1] || [];
    var ow = [];                       // {col, c}
    var oWritten = {};
    function oadd(col, c) { ow.push({ col: col, c: c }); oWritten[col] = true; }

    if (isNew) oadd(need(oc, 'id', SO, 'ID Pesanan'), text(o.id));

    /* Tautan PDF di Drive. Kolom dibuat otomatis di sebelah kanan kolom terakhir bila belum ada (tidak menggeser kolom lain). */
    var pdfName = ctx.pdfColumnName || 'Link PDF';
    if (o.pdfUrl && (isNew || !same(o.pdfUrl, orig.pdfUrl, 'text'))) {
      var pc = oc.pdfUrl;
      if (pc < 0) {
        pc = (ov[0] || []).length;
        for (var rr = 1; rr < ov.length; rr++) {
          if (ov[rr] && ov[rr][pc] !== undefined && ov[rr][pc] !== '') throw fail('schema', 'Kolom setelah "' + String((ov[0] || [])[pc - 1] || '') + '" sudah berisi data tanpa judul. Beri judul "' + pdfName + '" pada kolom kosong di tab "' + SO + '", lalu coba lagi.');
        }
        if (oSheet.columnCount != null && oSheet.columnCount <= pc) {
          reqs.push({ appendDimension: { sheetId: oSheet.sheetId, dimension: 'COLUMNS', length: pc + 1 - oSheet.columnCount } });
        }
        if (pc >= 1) {
          reqs.push({
            copyPaste: {
              source: { sheetId: oSheet.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: pc - 1, endColumnIndex: pc },
              destination: { sheetId: oSheet.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: pc, endColumnIndex: pc + 1 },
              pasteType: 'PASTE_FORMAT', pasteOrientation: 'NORMAL'
            }
          });
        }
        put(reqs, oSheet.sheetId, 1, pc, text(pdfName));
      }
      oadd(pc, text(o.pdfUrl));
    }
    var statusChanged = false, mktChanged = false, dateChanged = false, headChanged = false;
    ORDER_FIELDS.forEach(function (f) {
      var k = f[0], type = f[1];
      var changed = isNew || !same(o[k], orig[k], type);
      if (!changed) return;
      var v = o[k];
      if (isNew && (v == null || v === '') && oc[k] < 0) return;       // kolom opsional tidak ada & tidak diisi
      oadd(need(oc, k, SO, f[2]), MAKE[type](v));
      if (k === 'status') statusChanged = true;
      if (k === 'marketing') mktChanged = true;
      if (k === 'orderDate') dateChanged = true;
      if (k === 'status' || k === 'marketing' || k === 'daerah' || k === 'company') headChanged = true;
    });

    if (isNew) {
      if (oc.no >= 0 && !oF[oc.no]) {
        var mx = 0;
        for (var r = 1; r < ov.length; r++) { var nv = ov[r] && ov[r][oc.no]; if (typeof nv === 'number' && nv > mx) mx = nv; }
        oadd(oc.no, like(oLast[oc.no], mx + 1));
      }
      if (oc.visible >= 0 && !oF[oc.visible]) oadd(oc.visible, like(oLast[oc.visible], 1));
    }
    if (oc.bulan >= 0 && !oF[oc.bulan] && (isNew || dateChanged)) {
      var sample = isNew ? oLast[oc.bulan] : (ov[oRow - 1] || [])[oc.bulan];
      var d = o.orderDate;
      if (!d) oadd(oc.bulan, text(''));
      else if (typeof sample === 'number') {
        oadd(oc.bulan, { cell: { userEnteredValue: { numberValue: serial(new Date(d.getFullYear(), d.getMonth(), 1)) }, userEnteredFormat: { numberFormat: MONTH_FMT } }, mask: 'userEnteredValue,userEnteredFormat.numberFormat' });
      } else oadd(oc.bulan, text(MON[d.getMonth()] + '-' + String(d.getFullYear()).slice(-2)));
    }

    if (isNew) prepNewRow(reqs, oSheet, ov, oRow, oWritten, oF);
    ow.forEach(function (w) { put(reqs, oSheet.sheetId, oRow, w.col, w.c); });

    /* ===== Detail Item ===== */
    var itemRows = [];
    var nextRow = Math.max(iv.length, 1) + 1;
    var iLast = iv[iv.length - 1] || [];
    var mine = fresh.filter(function (x) { return x.id === o.id; });
    var maxNo = mine.reduce(function (a, x) { return Math.max(a, x.no || 0); }, 0);
    var touchedRows = {};

    function derived(writeList, written) {
      if (ic.statusInduk >= 0 && !iF[ic.statusInduk]) { writeList.push({ col: ic.statusInduk, c: text(o.status) }); written[ic.statusInduk] = true; }
      if (ic.marketing >= 0 && !iF[ic.marketing]) { writeList.push({ col: ic.marketing, c: text(o.marketing) }); written[ic.marketing] = true; }
      if (ic.daerah >= 0 && !iF[ic.daerah]) { writeList.push({ col: ic.daerah, c: text(o.daerah) }); written[ic.daerah] = true; }
      if (ic.company >= 0 && !iF[ic.company]) { writeList.push({ col: ic.company, c: text(o.company) }); written[ic.company] = true; }
    }

    (ctx.items || []).forEach(function (it) {
      var list = [], written = {};
      function add(col, c) { list.push({ col: col, c: c }); written[col] = true; }
      if (it.no == null) {
        var row = nextRow++;
        var no = ++maxNo;
        add(need(ic, 'id', SI, 'ID Pesanan'), text(o.id));
        if (ic.no >= 0) add(ic.no, integer(no));
        ITEM_FIELDS.forEach(function (f) {
          if (ic[f[0]] < 0) { if (f[0] === 'nama' || f[0] === 'qty') need(ic, f[0], SI, f[2]); return; }
          add(ic[f[0]], MAKE[f[1]](it[f[0]]));
        });
        derived(list, written);
        prepNewRow(reqs, iSheet, iv, row, written, iF);
        list.forEach(function (w) { put(reqs, iSheet.sheetId, row, w.col, w.c); });
        itemRows.push(row);
        touchedRows[row] = 1;
      } else {
        var cur = mine.filter(function (x) { return x.no === it.no; })[0];
        if (!cur) throw fail('stale', 'Item no. ' + it.no + ' pada order ini tidak ditemukan lagi di sheet. Muat ulang data lalu coba lagi.');
        var o0 = (ctx.origItems || []).filter(function (x) { return x.no === it.no; })[0] || {};
        ITEM_FIELDS.forEach(function (f) {
          if (same(it[f[0]], o0[f[0]], f[1])) return;
          add(need(ic, f[0], SI, f[2]), MAKE[f[1]](it[f[0]]));
        });
        if (headChanged) derived(list, written);
        list.forEach(function (w) { put(reqs, iSheet.sheetId, cur.row, w.col, w.c); });
        if (list.length) touchedRows[cur.row] = 1;
      }
    });

    /* Item lama milik order ini yang tidak ada di form tetap ikut diperbarui status induk/marketing/daerah/company-nya */
    if (!isNew && headChanged) {
      mine.forEach(function (cur) {
        if (touchedRows[cur.row]) return;
        var list = [], written = {};
        derived(list, written);
        list.forEach(function (w) { put(reqs, iSheet.sheetId, cur.row, w.col, w.c); });
      });
    }

    return { requests: reqs, orderRow: oRow, itemRows: itemRows, changed: reqs.length > 0, isNew: isNew };
  }

  return { plan: plan, serial: serial, MONEY_FMT: MONEY_FMT };
});

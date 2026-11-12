/* Logika inti: membaca baris Google Sheet -> objek, lalu menghitung rekap.
   Tidak menyentuh DOM, jadi bisa diuji di Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATUS_ORDER = [
    'SUDAH KONTRAK',
    'MASIH NEGOSIASI',
    'CANCEL ORDER',
    'BARANG SUDAH DITERIMA',
    'SUDAH KIRIM',
    'DIKIRIM SEBAGIAN'
  ];
  var CANCEL = 'CANCEL ORDER';
  var NO_MKT = '(Belum Diisi)';

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
  function str(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

  /* "Rp 1,557,600" / "Rp6,127,000" / 1557600 / "" -> angka */
  function money(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (v == null) return 0;
    var s = String(v).trim();
    if (!s) return 0;
    var neg = /^\(/.test(s) || /^-/.test(s) || /^Rp\s*-/.test(s);
    var d = s.replace(/[^\d]/g, '');
    return d ? (neg ? -1 : 1) * parseInt(d, 10) : 0;
  }

  /* Serial Google Sheets, "m/d/yyyy" atau "yyyy-mm-dd" -> Date (jam lokal 00:00) */
  function toDate(v) {
    if (v === '' || v == null) return null;
    if (typeof v === 'number') {
      var u = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
      return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
    }
    var s = String(v).trim();
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      var d = new Date(+m[3], +m[1] - 1, +m[2]);
      return d.getMonth() === +m[1] - 1 ? d : null;
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    return null;
  }

  function buildIndex(header) {
    var idx = {};
    (header || []).forEach(function (h, i) { var k = norm(h); if (k && !(k in idx)) idx[k] = i; });
    return idx;
  }
  function findCol(idx) {
    var names = Array.prototype.slice.call(arguments, 1), i, k;
    for (i = 0; i < names.length; i++) if (names[i] in idx) return idx[names[i]];
    for (i = 0; i < names.length; i++) for (k in idx) if (k.indexOf(names[i]) === 0) return idx[k];
    return -1;
  }
  function need(idx, sheet, label) {
    var cols = Array.prototype.slice.call(arguments, 3);
    var c = findCol.apply(null, [idx].concat(cols));
    if (c < 0) {
      var e = new Error('Kolom "' + label + '" tidak ditemukan di sheet "' + sheet + '".');
      e.kind = 'schema';
      throw e;
    }
    return c;
  }
  function cell(r, i) { return i < 0 || i == null ? '' : (r[i] == null ? '' : r[i]); }
  function nonEmpty(r) { return r && r.some(function (c) { return String(c == null ? '' : c).trim() !== ''; }); }

  function parseOrders(values) {
    var head = (values && values[0]) || [];
    var idx = buildIndex(head);
    var c = {
      no: findCol(idx, 'no'),
      id: need(idx, 'Master Order', 'ID Pesanan', 'id pesanan'),
      daerah: findCol(idx, 'daerah'),
      orderDate: findCol(idx, 'order date'),
      company: findCol(idx, 'company'),
      marketing: findCol(idx, 'marketing'),
      status: need(idx, 'Master Order', 'Status', 'status'),
      nilai: need(idx, 'Master Order', 'Total Nilai', 'total nilai'),
      ongkir: findCol(idx, 'total ongkir'),
      nego: findCol(idx, 'nego date'),
      agree: findCol(idx, 'agree date'),
      contractNo: findCol(idx, 'contract no'),
      start: findCol(idx, 'start contract'),
      end: findCol(idx, 'end contract'),
      visible: findCol(idx, '_visible'),
      pdfUrl: findCol(idx, 'link pdf', 'tautan pdf')
    };
    var out = [];
    (values || []).slice(1).forEach(function (r, ri) {
      if (!nonEmpty(r)) return;
      var vis = c.visible >= 0 ? norm(cell(r, c.visible)) : '1';
      if (vis === '0' || vis === 'false') return;
      var id = str(cell(r, c.id));
      if (!id) return;
      out.push({
        row: ri + 2,
        no: cell(r, c.no),
        id: id,
        daerah: str(cell(r, c.daerah)) || '(Tanpa Daerah)',
        orderDate: toDate(cell(r, c.orderDate)),
        company: str(cell(r, c.company)) || '(Tanpa Company)',
        marketing: str(cell(r, c.marketing)) || NO_MKT,
        status: str(cell(r, c.status)).toUpperCase() || '(TANPA STATUS)',
        nilai: money(cell(r, c.nilai)),
        ongkir: money(cell(r, c.ongkir)),
        nego: toDate(cell(r, c.nego)),
        agree: toDate(cell(r, c.agree)),
        contractNo: str(cell(r, c.contractNo)),
        pdfUrl: str(cell(r, c.pdfUrl)),
        start: toDate(cell(r, c.start)),
        end: toDate(cell(r, c.end))
      });
    });
    return out;
  }

  function parseItems(values) {
    var head = (values && values[0]) || [];
    var idx = buildIndex(head);
    var c = {
      id: need(idx, 'Detail Item', 'ID Pesanan', 'id pesanan'),
      no: findCol(idx, 'no item'),
      nama: findCol(idx, 'nama barang'),
      merk: findCol(idx, 'merk'),
      type: findCol(idx, 'type'),
      qty: findCol(idx, 'qty'),
      nilai: findCol(idx, 'nilai barang'),
      ongkir: findCol(idx, 'ongkir'),
      statusInduk: findCol(idx, 'status induk'),
      status: findCol(idx, 'status item'),
      marketing: findCol(idx, 'marketing'),
      daerah: findCol(idx, 'daerah'),
      company: findCol(idx, 'company')
    };
    var out = [];
    (values || []).slice(1).forEach(function (r, ri) {
      if (!nonEmpty(r)) return;
      var id = str(cell(r, c.id));
      if (!id) return;
      var induk = str(cell(r, c.statusInduk)).toUpperCase();
      var st = str(cell(r, c.status)).toUpperCase() || induk;
      out.push({
        row: ri + 2,
        id: id,
        no: +cell(r, c.no) || 0,
        nama: str(cell(r, c.nama)),
        merk: str(cell(r, c.merk)) || '(Tanpa Merk)',
        type: str(cell(r, c.type)),
        qty: money(cell(r, c.qty)),
        nilai: money(cell(r, c.nilai)),
        ongkir: money(cell(r, c.ongkir)),
        statusInduk: induk,
        status: st,
        marketing: str(cell(r, c.marketing)) || NO_MKT,
        daerah: str(cell(r, c.daerah)),
        company: str(cell(r, c.company))
      });
    });
    unifyCase(out, 'merk', '(Tanpa Merk)');
    return out;
  }

  /* Merk sering diketik dengan huruf besar/kecil berbeda ("Nus-medika" vs "NUS-MEDIKA").
     Untuk tampilan dan rekap, samakan ke ejaan yang paling sering dipakai. Sheet tidak diubah. */
  function unifyCase(list, key, skip) {
    var seen = {};
    list.forEach(function (x) {
      var v = x[key];
      if (!v || v === skip) return;
      var k = v.toLowerCase(), g = seen[k] || (seen[k] = {});
      g[v] = (g[v] || 0) + 1;
    });
    var best = {};
    Object.keys(seen).forEach(function (k) {
      var spellings = Object.keys(seen[k]);
      spellings.sort(function (a, b) { return seen[k][b] - seen[k][a] || (a < b ? -1 : 1); });
      best[k] = spellings[0];
    });
    list.forEach(function (x) {
      var v = x[key];
      if (v && v !== skip) x[key] = best[v.toLowerCase()];
    });
  }

  function isCancel(o) { return o.status === CANCEL; }

  function statusList(orders) {
    var list = STATUS_ORDER.slice();
    orders.forEach(function (o) { if (list.indexOf(o.status) < 0) list.push(o.status); });
    return list;
  }

  function summarize(orders) {
    var total = { count: orders.length, value: 0 };
    var cancel = { count: 0, value: 0 };
    var ongkir = 0;
    var ids = {};
    var byStatus = {};
    statusList(orders).forEach(function (s) { byStatus[s] = { count: 0, value: 0 }; });
    orders.forEach(function (o) {
      total.value += o.nilai;
      ids[o.id] = 1;
      byStatus[o.status].count++;
      byStatus[o.status].value += o.nilai;
      if (isCancel(o)) { cancel.count++; cancel.value += o.nilai; }
      else ongkir += o.ongkir;
    });
    return {
      total: total,
      cancel: cancel,
      klik: { count: total.count - cancel.count, value: total.value - cancel.value },
      ongkir: ongkir,
      uniqueIds: Object.keys(ids).length,
      byStatus: byStatus,
      statuses: statusList(orders)
    };
  }

  /* Tabel silang: baris = keyFn(order), kolom = status */
  function crossTab(orders, keyFn) {
    var statuses = statusList(orders);
    var rows = {};
    var colTotals = {};
    statuses.forEach(function (s) { colTotals[s] = { count: 0, value: 0 }; });
    var grand = { count: 0, value: 0 };
    orders.forEach(function (o) {
      var k = keyFn(o);
      var r = rows[k];
      if (!r) {
        r = rows[k] = { key: k, cells: {}, total: { count: 0, value: 0 } };
        statuses.forEach(function (s) { r.cells[s] = { count: 0, value: 0 }; });
      }
      r.cells[o.status].count++; r.cells[o.status].value += o.nilai;
      r.total.count++; r.total.value += o.nilai;
      colTotals[o.status].count++; colTotals[o.status].value += o.nilai;
      grand.count++; grand.value += o.nilai;
    });
    var list = Object.keys(rows).map(function (k) { return rows[k]; });
    list.sort(function (a, b) {
      var an = a.key === NO_MKT ? 1 : 0, bn = b.key === NO_MKT ? 1 : 0;
      if (an !== bn) return an - bn;
      return b.total.count - a.total.count || b.total.value - a.total.value || (a.key < b.key ? -1 : 1);
    });
    return { statuses: statuses, rows: list, colTotals: colTotals, grand: grand };
  }

  function monthKey(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }

  /* Tren bulanan. fill=true menambahkan bulan kosong di antara bulan pertama & terakhir */
  function monthly(orders, fill) {
    var map = {}, undated = { count: 0, value: 0 };
    orders.forEach(function (o) {
      if (!o.orderDate) { undated.count++; undated.value += o.nilai; return; }
      var k = monthKey(o.orderDate);
      var m = map[k] || (map[k] = { key: k, year: o.orderDate.getFullYear(), month: o.orderDate.getMonth(), count: 0, value: 0 });
      m.count++; m.value += o.nilai;
    });
    var keys = Object.keys(map).sort();
    if (fill && keys.length) {
      var f = map[keys[0]], l = map[keys[keys.length - 1]];
      var y = f.year, mo = f.month, out = [];
      while (y < l.year || (y === l.year && mo <= l.month)) {
        var kk = y + '-' + ('0' + (mo + 1)).slice(-2);
        out.push(map[kk] || { key: kk, year: y, month: mo, count: 0, value: 0 });
        mo++; if (mo > 11) { mo = 0; y++; }
      }
      return { months: out, undated: undated };
    }
    return { months: keys.map(function (k) { return map[k]; }), undated: undated };
  }

  /* Pencocokan order yang sama. Di sheet, ID kadang ditulis "EP-xxxx", kadang "xxxx", dan kadang TERPOTONG
     (nomor lengkapnya ada di kolom Contract No). Dua order dianggap sama bila ID-nya sama setelah awalan "EP-" dibuang,
     atau salah satu hanyalah potongan awal dari yang lain (minimal 15 karakter), atau Contract No-nya sama dengan ID itu. */
  function baseId(id) { return String(id == null ? '' : id).replace(/\s+/g, '').toUpperCase().replace(/^#?EP-/, ''); }
  function sameId(a, b) {
    a = baseId(a); b = baseId(b);
    if (!a || !b) return false;
    if (a === b) return true;
    var s = a.length <= b.length ? a : b, l = a.length <= b.length ? b : a;
    return s.length >= 15 && l.indexOf(s) === 0;
  }
  function findSameOrder(orders, id, contractNo) {
    for (var i = 0; i < (orders || []).length; i++) {
      var x = orders[i];
      if (sameId(x.id, id) || sameId(x.contractNo, id) || (contractNo && (sameId(x.id, contractNo) || sameId(x.contractNo, contractNo)))) return x;
    }
    return null;
  }

  /* Peringatan kewajaran tanggal (data input manual sering tertukar format d/m vs m/d) */
  function warnings(o, today) {
    var w = [];
    today = today || new Date();
    if (o.start && o.end && o.end < o.start) w.push('Akhir kontrak lebih awal dari awal kontrak');
    if (o.orderDate && o.orderDate > today) w.push('Tanggal order ada di masa depan');
    if (o.agree && o.agree > today) w.push('Tanggal setuju ada di masa depan');
    return w;
  }

  return {
    STATUS_ORDER: STATUS_ORDER, CANCEL: CANCEL, NO_MKT: NO_MKT,
    norm: norm, buildIndex: buildIndex, findCol: findCol, money: money, toDate: toDate, parseOrders: parseOrders, parseItems: parseItems,
    isCancel: isCancel, statusList: statusList, summarize: summarize,
    crossTab: crossTab, monthly: monthly, monthKey: monthKey, warnings: warnings,
    baseId: baseId, sameId: sameId, findSameOrder: findSameOrder
  };
});

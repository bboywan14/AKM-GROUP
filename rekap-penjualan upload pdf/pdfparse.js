/* Pembaca Surat Pesanan E-Katalog (PDF) -> data order.
   Dua bagian:
   1) readPdf(): membaca teks PDF per baris (memakai pdf.js, dimuat hanya saat dipakai).
   2) parseSP(): murni teks, mengubah baris-baris menjadi isian order + item. Tidak menyentuh jaringan/DOM,
      sehingga bisa diuji di Node.
   Hasil selalu ditinjau pengguna di form sebelum disimpan; parser hanya mengisi, tidak menyimpan. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PdfParse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BULAN = { jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6, agu: 7, agt: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11 };
  var BULAN_PANJANG = { januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5, juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11 };

  function money(s) {                         // "Rp46.884.685,00" -> 46884685
    var m = /([\d.]+)(?:,(\d{1,2}))?/.exec(String(s || '').replace(/\s/g, ''));
    if (!m) return null;
    var n = parseInt(m[1].replace(/\./g, ''), 10);
    return isNaN(n) ? null : n;
  }
  function num(s) {                           // "4,00" -> 4 ; "2.700,00" -> 2700
    var t = String(s || '').replace(/\./g, '').replace(',', '.');
    var n = parseFloat(t);
    return isNaN(n) ? null : n;
  }
  function monthIdx(w) {
    w = String(w || '').toLowerCase();
    if (BULAN_PANJANG[w] != null) return BULAN_PANJANG[w];
    return BULAN[w.slice(0, 3)] != null ? BULAN[w.slice(0, 3)] : null;
  }
  function mkDate(d, mon, y) {
    var m = monthIdx(mon);
    if (m == null) return null;
    var dt = new Date(+y, m, +d);
    return dt.getMonth() === m ? dt : null;
  }
  function squash(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function cols(line) { return String(line).trim().split(/\s{2,}/).map(squash); }

  /* ------------------------------------------------------------ teks PDF -> baris */
  /* items: hasil pdf.js getTextContent().items pada satu halaman. */
  function linesFromItems(items) {
    var rows = [];
    items.forEach(function (it) {
      if (!it || typeof it.str !== 'string' || !it.transform) return;
      var y = it.transform[5], x = it.transform[4], w = it.width || 0;
      var row = null;
      for (var i = 0; i < rows.length; i++) if (Math.abs(rows[i].y - y) <= 2.5) { row = rows[i]; break; }
      if (!row) { row = { y: y, parts: [] }; rows.push(row); }
      row.parts.push({ x: x, w: w, s: it.str });
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    return rows.map(function (r) {
      r.parts.sort(function (a, b) { return a.x - b.x; });
      var out = '', end = null;
      r.parts.forEach(function (p) {
        if (!p.s) return;
        if (end != null) {
          var gap = p.x - end;
          out += gap > 8 ? '   ' : (gap > 1 ? ' ' : '');
        }
        out += p.s; end = p.x + p.w;
      });
      return out.replace(/\s+$/, '');
    }).filter(function (l) { return l.trim() !== ''; });
  }

  /* pdfjs: modul pdf.js yang sudah dimuat; data: ArrayBuffer/Uint8Array. Hanya halaman depan (sebelum "Lampiran") dibaca. */
  function readPdf(pdfjs, data, maxPages) {
    var task = pdfjs.getDocument({ data: data instanceof Uint8Array ? data : new Uint8Array(data), isEvalSupported: false });
    return task.promise.then(function (doc) {
      var limit = Math.min(doc.numPages, maxPages || 8), all = [];
      function page(n) {
        if (n > limit) return Promise.resolve();
        return doc.getPage(n).then(function (p) { return p.getTextContent(); }).then(function (tc) {
          var ls = linesFromItems(tc.items);
          if (n > 1 && /^Lampiran$/i.test(squash(ls[0] || ''))) return;       // sisa dokumen = syarat & ketentuan
          all = all.concat(ls);
          return page(n + 1);
        });
      }
      return page(1).then(function () { var pages = doc.numPages; try { task.destroy(); } catch (e) { /* abaikan */ } return { lines: all, pages: pages }; });
    });
  }

  /* ------------------------------------------------------------ parser */
  function parseSP(lines) {
    var warn = [], res = { ok: false, warnings: warn };
    lines = (lines || []).map(function (l) { return String(l); });
    // buang pengulangan kop halaman
    var seenHead = false;
    lines = lines.filter(function (l) {
      var t = squash(l);
      if (/^Halaman\s+\d+\s*\/\s*\d+$/i.test(t)) return false;
      if (/^Surat Pesanan$/i.test(t)) { if (seenHead) return false; seenHead = true; return false; }
      return true;
    });
    var text = lines.join('\n');

    var mNo = /No\.\s*Surat Pesanan\s*:\s*#?\s*(EP-[A-Z0-9]+)/i.exec(text);
    if (!mNo) { warn.push('Nomor Surat Pesanan tidak ditemukan. Pastikan ini PDF Surat Pesanan E-Katalog.'); return res; }
    res.noSP = mNo[1].toUpperCase();

    var mTgl = /Tanggal Surat Pesanan\s*:\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i.exec(text);
    res.tanggalSP = mTgl ? mkDate(mTgl[1], mTgl[2], mTgl[3]) : null;
    if (!res.tanggalSP) warn.push('Tanggal Surat Pesanan tidak terbaca.');

    /* Pemesan & Penyedia (dua kolom berdampingan) */
    var iHead = -1;
    for (var i = 0; i < lines.length; i++) if (/^\s*Pemesan\s{2,}Penyedia\s*$/.test(lines[i]) || (/^\s*Pemesan\b/.test(lines[i]) && /\bPenyedia\s*$/.test(lines[i]))) { iHead = i; break; }
    var pemesan = [], penyedia = [];
    if (iHead >= 0) {
      for (var j = iHead + 1; j < lines.length; j++) {
        var c = cols(lines[j]);
        if (/Nama Penanggung Jawab/i.test(lines[j]) && /^Nama Penanggung Jawab/i.test(c[0] || '')) break;
        if (/^Informasi Pembayaran/i.test(squash(lines[j]))) break;
        if (/Nama Penanggung Jawab/i.test(lines[j])) {                    // baris kiri kosong? atau kolom kiri berisi nama alamat
          var left = (c[0] || '');
          if (!/Nama Penanggung Jawab/i.test(left)) pemesan.push(left);
          break;
        }
        if (c.length >= 2) { pemesan.push(c[0]); penyedia.push(c[1]); }
        else if (c.length === 1) pemesan.push(c[0]);
      }
    }
    res.pemesan = pemesan[0] || '';
    res.wilayah = pemesan.slice(1).join(' ');
    res.penyedia = penyedia[0] || '';
    if (!res.pemesan) warn.push('Nama pemesan tidak terbaca.');
    if (!res.penyedia) warn.push('Nama penyedia (company) tidak terbaca.');
    var mNpwp = /Divisi \/ Unit Kerja\s*:\s*(.+?)(?:\s{2,}|$)/.exec(text);
    res.unit = mNpwp && mNpwp[1] !== '-' ? squash(mNpwp[1]) : '';

    /* Total */
    var mTot = /^\s*Estimasi Total Pembayaran\s+Rp\s?([\d.,]+)\s*$/m.exec(text);
    res.total = mTot ? money(mTot[1]) : null;
    if (res.total == null) { var mT2 = /Pembayaran Termin 1\s+Rp\s?([\d.,]+)/.exec(text); res.total = mT2 ? money(mT2[1]) : null; }
    if (res.total == null) warn.push('Total pembayaran tidak terbaca.');
    var mTr = /Total Transaksi\s+Rp\s?([\d.,]+)/.exec(text), mPpn = /Total PPN\s+Rp\s?([\d.,]+)/.exec(text);
    res.totalTransaksi = mTr ? money(mTr[1]) : null;
    res.totalPPN = mPpn ? money(mPpn[1]) : null;
    res.ppnRate = res.totalTransaksi && res.totalPPN != null ? Math.round(res.totalPPN / res.totalTransaksi * 10000) / 10000 : null;

    /* Ongkir (jumlah semua pengiriman, sebelum pajak) */
    var ong = 0, hasOng = false, re = /Ongkos Kirim\s*\([^)]*\)\s+Rp\s?([\d.,]+)/g, mo;
    while ((mo = re.exec(text))) { ong += money(mo[1]) || 0; hasOng = true; }
    res.ongkirDasar = hasOng ? ong : null;

    /* Tanggal tiba -> akhir kontrak */
    var tiba = /Permintaan Tiba\s*:\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:\s*-\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4}))?/i.exec(text);
    res.tiba = tiba ? (tiba[4] ? mkDate(tiba[4], tiba[5], tiba[6]) : mkDate(tiba[1], tiba[2], tiba[3])) : null;
    var m2 = /Permintaan Tiba\s*:\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i.exec(text);
    if (!res.tiba && m2) res.tiba = mkDate(m2[1], m2[2], m2[3]);
    res.negosiasi = /Ringkasan Pesanan\s+Melalui Negosiasi/i.test(text);

    /* Barang: blok di antara "Ringkasan Pesanan" dan "Ringkasan Pembayaran" */
    var a = -1, b = lines.length;
    for (var k = 0; k < lines.length; k++) {
      if (a < 0 && /^\s*Ringkasan Pesanan\b/.test(lines[k])) a = k;
      else if (a >= 0 && /^\s*Ringkasan Pembayaran\b/.test(lines[k])) { b = k; break; }
    }
    var items = [];
    if (a >= 0) {
      var blocks = [], cur = null;
      for (var n = a + 1; n < b; n++) {
        var t = squash(lines[n]);
        if (/^Nama Produk\b/i.test(t)) continue;
        if (/^(Barang|Jasa)\b/.test(t)) { cur = []; blocks.push(cur); }
        if (cur) cur.push(lines[n]);
      }
      blocks.forEach(function (bl) {
        var price = null, qty = null, berat = null, nameParts = [], afterUnit = false;
        bl.forEach(function (ln, idx) {
          var t = squash(ln);
          if (idx === 0 && /^(Barang|Jasa)\b/.test(t)) {                 // baris label (Barang, Pre Order, PDN)
            var pm = /Rp\s?([\d.]+,\d{2})\s+([\d.]+,\d{2})/.exec(t);
            if (pm) { price = money(pm[1]); qty = num(pm[2]); }
            return;
          }
          var pm2 = /Rp\s?([\d.]+,\d{2})\s+([\d.]+,\d{2})\s*$/.exec(t);
          if (pm2) {                                                     // harga + jumlah (mungkin satu baris dengan nama)
            price = money(pm2[1]); qty = num(pm2[2]);
            var rest = squash(t.replace(pm2[0], ''));
            if (rest && !afterUnit) nameParts.push(rest);
            return;
          }
          var um = /^([\d.]+,\d{2})\s+(?:unit|pcs|buah|set|paket|lot|unit\/set)\b.*?(?:\(\s*([\d.]+)\s*gr\s*\))?$/i.exec(t);
          if (um) { afterUnit = true; if (um[2]) berat = parseInt(um[2].replace(/\./g, ''), 10); if (qty == null) qty = num(um[1]); return; }
          if (afterUnit) return;                                         // catatan, golongan PPN, tautan snapshot
          if (/^https?:\/\//i.test(t)) return;
          nameParts.push(t);
        });
        var nama = squash(nameParts.join(' '));
        if (nama) items.push({ nama: nama, qty: qty, hargaSatuan: price, beratGram: berat });
      });
    }
    if (!items.length) warn.push('Daftar barang tidak terbaca. Isi barang secara manual.');
    items.forEach(function (it) {
      if (!(it.qty >= 1)) warn.push('Jumlah barang "' + it.nama + '" tidak terbaca.');
      if (!(it.hargaSatuan > 0)) warn.push('Harga barang "' + it.nama + '" tidak terbaca.');
    });
    res.items = items;

    /* ---- Nilai (termasuk PPN), selaras dengan cara sheet mencatat: Total Nilai = Estimasi Total Pembayaran;
       Ongkir = ongkos kirim + PPN-nya; nilai barang = sisanya, dibagi sesuai harga. Pembulatan: sisa ke item terakhir. */
    var rate = res.ppnRate != null ? res.ppnRate : 0;
    res.ongkir = res.ongkirDasar != null ? Math.round(res.ongkirDasar * (1 + rate)) : null;
    var barangTotal = res.total != null ? res.total - (res.ongkir || 0) : null;
    var sub = items.map(function (it) { return (it.hargaSatuan || 0) * (it.qty || 0); });
    var subSum = sub.reduce(function (x, y) { return x + y; }, 0);
    items.forEach(function (it, ix) { it.nilai = null; it.ongkir = null; });
    if (barangTotal != null && subSum > 0) {
      var used = 0;
      items.forEach(function (it, ix) {
        if (ix === items.length - 1) it.nilai = barangTotal - used;
        else { it.nilai = Math.round(barangTotal * sub[ix] / subSum); used += it.nilai; }
      });
    }
    if (res.ongkir != null && items.length) {
      var wSum = items.reduce(function (x, it) { return x + (it.beratGram || 0); }, 0), usedO = 0;
      items.forEach(function (it, ix) {
        if (ix === items.length - 1) it.ongkir = res.ongkir - usedO;
        else {
          var share = wSum > 0 ? (it.beratGram || 0) / wSum : 1 / items.length;
          it.ongkir = Math.round(res.ongkir * share); usedO += it.ongkir;
        }
      });
    }
    // cek silang: harga satuan x qty (+PPN) harus cocok dengan total
    if (res.totalTransaksi != null && res.ongkirDasar != null && subSum > 0 && Math.abs(subSum + res.ongkirDasar - res.totalTransaksi) > 2) {
      warn.push('Jumlah harga barang + ongkir tidak sama dengan Total Transaksi di PDF. Periksa nilai barang.');
    }
    res.ok = true;
    return res;
  }

  /* ------------------------------------------------------------ pencocokan dengan data yang sudah ada di sheet */
  function key(s) {
    return String(s || '').toLowerCase().replace(/\b(pt|cv|ud|tbk)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, '');
  }
  function regionKey(s) {
    return String(s || '').toLowerCase().replace(/\b(kabupaten|kab|kota|provinsi|prov)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, '');
  }
  function nameKey(s) {
    return String(s || '').toLowerCase()
      .replace(/\b(rumah sakit umum daerah|rumah sakit umum|rumah sakit|rsud|rsu|dinas kesehatan|dinkes|puskesmas|pemerintah|pemkab|kabupaten|kab|kota)\b\.?/g, ' ')
      .replace(/[^a-z0-9]+/g, '');
  }
  /* Company: nama penyedia di PDF ("ARITEK KARYA MANDIRI") -> "PT. ARITEK KARYA MANDIRI" di sheet */
  function matchCompany(penyedia, list) {
    var k = key(penyedia);
    if (!k) return '';
    var hit = (list || []).filter(function (c) { return key(c) === k; })[0] ||
      (list || []).filter(function (c) { var ck = key(c); return ck && (ck.indexOf(k) >= 0 || k.indexOf(ck) >= 0); })[0];
    return hit || '';
  }
  /* Daerah: cocokkan nama wilayah ("Kab. Lampung Timur"); bila beberapa cocok, pilih yang memuat nama instansi pemesan. */
  function matchDaerah(wilayah, pemesan, list) {
    var rk = regionKey(wilayah);
    if (!rk) return { value: '', candidates: [] };
    var cands = (list || []).filter(function (d) { return regionKey(d).indexOf(rk) >= 0; });
    var pk = nameKey(pemesan);
    var best = pk ? cands.filter(function (d) { return regionKey(d).indexOf(pk) >= 0; }) : [];
    var pick = best.length === 1 ? best[0] : (cands.length === 1 ? cands[0] : (best[0] || ''));
    return { value: pick, candidates: cands };
  }
  function suggestDaerah(wilayah) {
    var w = squash(wilayah).replace(/^kab\.?\s+/i, 'Kabupaten ').replace(/^prov\.?\s+/i, 'Provinsi ');
    return w.toUpperCase();
  }
  /* Merk: kata pertama nama barang bila sama dengan merk yang sudah dikenal */
  function guessMerk(nama, merkList) {
    var first = squash(nama).split(' ')[0] || '', fk = key(first);
    if (!fk) return '';
    return (merkList || []).filter(function (m) { return key(m) === fk; })[0] || '';
  }

  return {
    readPdf: readPdf, linesFromItems: linesFromItems, parseSP: parseSP,
    matchCompany: matchCompany, matchDaerah: matchDaerah, suggestDaerah: suggestDaerah, guessMerk: guessMerk,
    _money: money
  };
});

/* Unggah file PDF Surat Pesanan ke Google Drive pengguna.
   Memakai izin "drive.file": aplikasi hanya dapat melihat/mengubah file yang DIA SENDIRI buat,
   bukan seluruh isi Drive pengguna. Folder dibuat otomatis (nama di config.js). */
(function () {
  'use strict';

  var A = window.AKM, CFG = A.CFG;
  var FOLDER_MIME = 'application/vnd.google-apps.folder';
  var API = 'https://www.googleapis.com/drive/v3/';
  var UP = 'https://www.googleapis.com/upload/drive/v3/files';
  var folderId = null;

  function fail(kind, msg) { var e = new Error(msg); e.kind = kind; return e; }
  function q(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

  function apiError(r, what) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      var err = j.error || {}, em = err.message || '', reason = ((err.errors || [])[0] || {}).reason || '';
      if (r.status === 403 && (reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(em))) {
        return fail('drive-api', 'Google Drive API belum diaktifkan di proyek Google Cloud. Aktifkan "Google Drive API" (lihat Panduan, Bagian 1 langkah 2), lalu coba lagi.');
      }
      if (r.status === 403 && /insufficient|scope/i.test(em + reason)) {
        return fail('scope', 'Izin Google Drive belum diberikan. Pilih "Ganti akun" lalu masuk lagi dan centang izin Google Drive.');
      }
      if (r.status === 403 && /quota|storage/i.test(em + reason)) return fail('quota', 'Penyimpanan Google Drive penuh.');
      return fail('other', what + ' (HTTP ' + r.status + (em ? ': ' + em : '') + ').');
    });
  }
  function netErr() { return fail('network', 'Tidak dapat terhubung ke Google Drive. Periksa koneksi internet; data belum tersimpan.'); }
  function call(url, opts, what) {
    return A.gfetch(url, opts).then(function (r) {
      if (r.ok) return r.json();
      return apiError(r, what).then(function (e) { throw e; });
    }, function (e) { if (e && e.kind) throw e; throw netErr(); });
  }

  function ensureFolder() {
    if (folderId) return Promise.resolve(folderId);
    var name = CFG.DRIVE_FOLDER_NAME || 'AKM GROUP - PDF Pesanan';
    var qs = "mimeType='" + FOLDER_MIME + "' and name='" + q(name) + "' and trashed=false";
    return call(API + 'files?q=' + encodeURIComponent(qs) + '&fields=' + encodeURIComponent('files(id,name)') + '&pageSize=1&spaces=drive', null, 'Gagal mencari folder Drive').then(function (j) {
      if (j.files && j.files[0]) { folderId = j.files[0].id; return folderId; }
      return call(API + 'files?fields=id', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, mimeType: FOLDER_MIME })
      }, 'Gagal membuat folder Drive').then(function (c) { folderId = c.id; return folderId; });
    });
  }

  function findSame(parent, name) {
    var qs = "'" + q(parent) + "' in parents and name='" + q(name) + "' and trashed=false and mimeType='application/pdf'";
    return call(API + 'files?q=' + encodeURIComponent(qs) + '&fields=' + encodeURIComponent('files(id,webViewLink,size)') + '&pageSize=1', null, 'Gagal memeriksa file di Drive').then(function (j) { return (j.files || [])[0] || null; });
  }

  function share(id) {
    if (!CFG.DRIVE_SHARE_ANYONE) return Promise.resolve();
    return call(API + 'files/' + encodeURIComponent(id) + '/permissions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' })
    }, 'Gagal mengatur akses file').then(function () { });
  }

  /* file: File/Blob PDF. Mengembalikan {id, url, reused}. File dengan nama yang sama di folder dipakai ulang (tidak dobel). */
  function upload(file, name) {
    name = name || file.name || 'surat-pesanan.pdf';
    return ensureFolder().then(function (parent) {
      return findSame(parent, name).then(function (hit) {
        if (hit && (hit.size == null || +hit.size === file.size)) return { id: hit.id, url: hit.webViewLink || ('https://drive.google.com/file/d/' + hit.id + '/view'), reused: true };
        var boundary = 'akm' + Math.random().toString(36).slice(2) + Date.now();
        var meta = JSON.stringify({ name: name, parents: [parent], mimeType: 'application/pdf' });
        var body = new Blob([
          '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n' +
          '--' + boundary + '\r\nContent-Type: application/pdf\r\n\r\n', file, '\r\n--' + boundary + '--'
        ]);
        return call(UP + '?uploadType=multipart&fields=' + encodeURIComponent('id,webViewLink'), {
          method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: body
        }, 'Gagal mengunggah PDF ke Drive').then(function (j) {
          return share(j.id).then(function () { return { id: j.id, url: j.webViewLink || ('https://drive.google.com/file/d/' + j.id + '/view'), reused: false }; });
        });
      });
    });
  }

  A.drive = { upload: upload, _ensureFolder: ensureFolder };
})();

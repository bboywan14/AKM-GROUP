/* ============================================================
   PENGATURAN APLIKASI — hanya file ini yang perlu Anda ubah.
   Langkah mendapatkan GOOGLE_CLIENT_ID ada di PANDUAN.md (Bagian 1).
   ============================================================ */
window.APP_CONFIG = {
  APP_NAME: 'AKM GROUP',

  // Client ID OAuth dari Google Cloud Console (jenis: Web application)
  GOOGLE_CLIENT_ID: 'ISI_CLIENT_ID_ANDA.apps.googleusercontent.com',

  // ID spreadsheet: bagian antara /d/ dan /edit pada URL Google Sheet
  SPREADSHEET_ID: '1ydGLRByW_8m-iXgE61_HAYpS_8j1Zl8C_Cjj8CFH2Rw',

  // Nama tab di Google Sheet (harus sama persis)
  SHEET_ORDER: 'Master Order',
  SHEET_ITEM: 'Detail Item',

  // Data dimuat ulang otomatis setiap N menit saat aplikasi sedang dibuka
  AUTO_REFRESH_MINUTES: 5,

  // Folder Google Drive untuk file PDF Surat Pesanan (dibuat otomatis di Drive pengguna yang mengunggah)
  DRIVE_FOLDER_NAME: 'AKM GROUP - PDF Pesanan',

  // false = hanya pengunggah yang bisa membuka PDF di Drive-nya (aman).
  // true  = siapa pun yang memegang tautannya bisa membuka (tautan tidak bisa ditebak, tetapi tidak dibatasi akun).
  DRIVE_SHARE_ANYONE: false,

  // Nama kolom tautan PDF di tab Master Order (dibuat otomatis di kolom paling kanan bila belum ada)
  PDF_COLUMN_NAME: 'Link PDF'
};

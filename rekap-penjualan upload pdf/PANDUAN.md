# Panduan Setup — AKM GROUP (Rekap Penjualan)

Aplikasi ini adalah **satu aplikasi web (PWA)**. Satu kode yang sama berjalan di **Windows, Android, dan iPhone/iPad**, dan bisa dipasang seperti aplikasi biasa (ikon di desktop / layar utama).

## Cara kerjanya

1. Pengguna menekan **Masuk dengan Google** dan memilih akun Gmail.
2. Aplikasi membaca dan (untuk Editor) menulis Google Sheet **dengan izin akun itu sendiri**.
3. Jika akun belum diberi akses ke sheet, data tidak akan muncul.

Artinya, **mengatur siapa yang boleh membuka atau mengubah = mengatur akses di Google Sheet** (tombol *Bagikan / Share*):

| Peran di Google Sheet | Di aplikasi |
|---|---|
| **Pelihat (Viewer)** | Bisa melihat semua rekap. Menekan Simpan akan menampilkan pesan "tidak punya izin mengubah". |
| **Editor** | Bisa melihat **dan** menambah/mengubah order. |

Data tidak disimpan di server mana pun maupun di perangkat. Semua perubahan langsung masuk ke Google Sheet Anda.

Total ada 3 langkah awal (sekali saja, sekitar 20 menit): **(1)** buat Client ID, **(2)** taruh aplikasi di hosting, **(3)** tambahkan pengguna.

---

## 1. Membuat Client ID Google (gratis, sekali saja)

Buka <https://console.cloud.google.com> dan masuk dengan akun Gmail pemilik spreadsheet. Nama menu di Google kadang berubah sedikit, tetapi urutannya sama.

1. **Buat proyek**: klik pemilih proyek di bagian atas, **New Project**, beri nama `AKM GROUP`, **Create**.
2. **Aktifkan Sheets API dan Drive API**: menu **APIs & Services → Library**, cari **Google Sheets API**, klik **Enable**. Ulangi untuk **Google Drive API** (dipakai untuk menyimpan PDF Surat Pesanan; lihat Bagian 5A).
3. **Atur layar izin (OAuth consent screen)**: menu **APIs & Services → OAuth consent screen** (di tampilan baru bernama *Google Auth Platform*).
   - *User type*: **External** (atau **Internal** jika Anda memakai Google Workspace dan semua pengguna satu organisasi; dengan Internal, langkah "Test users" di bawah tidak diperlukan).
   - Isi nama aplikasi (`AKM GROUP`), email dukungan, dan email kontak developer. Anda juga dapat mengunggah logo AKM di sini.
   - *Scopes / Data Access*: tambahkan **`.../auth/spreadsheets`**, **`.../auth/drive.file`**, dan `.../auth/userinfo.email`. (Izin `spreadsheets` diperlukan agar Editor bisa menyimpan order. Izin `drive.file` hanya memberi akses ke file yang **dibuat aplikasi ini sendiri**, bukan ke seluruh isi Google Drive Anda. Jika Anda sebelumnya mendaftarkan `spreadsheets.readonly`, tambahkan yang baru.)
   - *Audience*: biarkan status **Testing**, lalu tambahkan semua Gmail yang akan memakai aplikasi di **Test users** (maksimal 100).
4. **Buat Client ID**: **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - *Application type*: **Web application**.
   - *Authorized JavaScript origins*: isi alamat hosting Anda dari Bagian 2, misalnya `https://akm-group.netlify.app` (tanpa garis miring di akhir dan tanpa path). Untuk uji coba di komputer sendiri bisa ditambah `http://localhost:8080`.
   - *Authorized redirect URIs*: **kosongkan**.
   - Klik **Create**, lalu salin **Client ID** (berakhiran `.apps.googleusercontent.com`).
5. Buka file **`config.js`**, ganti nilai `GOOGLE_CLIENT_ID` dengan Client ID tadi. Client ID bukan rahasia, jadi aman berada di kode aplikasi.

> **Urutan praktis:** lakukan Bagian 2 lebih dulu untuk mendapatkan alamat hosting, lalu kembali ke langkah 4 untuk mengisi *Authorized JavaScript origins*. Setelah `config.js` diisi, unggah ulang file tersebut.

> **Pengguna lama:** karena izin bertambah (tulis ke Sheet dan simpan file ke Drive), setiap pengguna akan diminta menyetujui ulang satu kali saat membuka aplikasi versi ini. Pada layar izin, **centang semua kotak**, termasuk Google Drive.

---

## 2. Menaruh aplikasi di hosting (harus HTTPS)

Salah satu cara berikut sudah cukup. Semuanya gratis untuk kebutuhan ini.

**Netlify (paling mudah, tanpa instalasi)**
1. Buka <https://app.netlify.com/drop>.
2. Seret **seluruh folder aplikasi** (yang berisi `index.html`, `app.js`, dll.) ke halaman tersebut.
3. Anda mendapat alamat seperti `https://nama-acak.netlify.app`. Gunakan alamat ini di *Authorized JavaScript origins* (Bagian 1, langkah 4).

**GitHub Pages**
1. Buat repositori baru di GitHub, unggah semua file aplikasi.
2. **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root**.
3. Alamatnya `https://USERNAME.github.io/NAMA-REPO`. Untuk *Authorized JavaScript origins* cukup tulis `https://USERNAME.github.io` (tanpa nama repo).

**Penting:** jangan menaruh file lain yang berisi data penjualan di hosting yang sama. Aplikasi ini sendiri tidak memuat data apa pun; data hanya diambil setelah login.

---

## 3. Menambah atau mencabut pengguna

Ada **dua tempat** yang perlu diatur selama aplikasi berstatus *Testing*:

| Tempat | Fungsi | Cara |
|---|---|---|
| **Google Sheet** | Menentukan siapa yang boleh melihat / mengubah data | Buka sheet → **Bagikan / Share** → masukkan Gmail → peran **Pelihat** (hanya melihat) atau **Editor** (boleh input/edit) |
| **Google Cloud → OAuth consent screen → Test users** | Mengizinkan akun itu memakai aplikasi login ini | **Add users** → masukkan Gmail yang sama |

Untuk **mencabut akses**, hapus Gmail tersebut dari Share di Google Sheet. Itu cukup untuk menghentikan data muncul. Hapus juga dari Test users agar rapi.

**Catatan layar peringatan:** saat pertama masuk, Google dapat menampilkan *"Google hasn't verified this app"*. Ini normal untuk aplikasi buatan sendiri. Pengguna klik **Advanced → Go to AKM GROUP (unsafe)** lalu **Continue**. Pada status *Testing*, Google bisa meminta persetujuan ulang secara berkala. Jika ingin lebih jarang, ubah *Audience* menjadi **In production**. Aplikasi tanpa verifikasi tetap dibatasi sekitar 100 pengguna. Dengan Google Workspace + *Internal*, peringatan ini tidak muncul.

---

## 4. Memasang di perangkat

Buka alamat hosting di browser, masuk sekali, lalu pasang:

- **Windows** (Chrome atau Edge): klik ikon **Install** di ujung kanan kolom alamat, atau menu **⋮ → Apps → Install this site as an app**.
- **Android** (Chrome): menu **⋮ → Install app** (atau **Add to Home screen**).
- **iPhone / iPad** (**harus Safari**): tombol **Bagikan → Add to Home Screen**.

Jika login dari ikon layar utama di iPhone terasa bermasalah (jendela login tidak muncul), buka aplikasi lewat **tab Safari** biasa. Pastikan pop-up tidak diblokir untuk situs ini.

---

## 5. Input dan edit order

**Order baru:** tab **Order → + Order Baru**. Isi data lalu **Simpan**.
**Edit order:** ketuk sebuah order, lalu tombol **Edit**.

- **Status, Company, Marketing, Daerah, dan Merk** berupa pilihan (dropdown) yang diambil dari data yang sudah ada. Jika belum ada, pilih **+ Tambah … baru** lalu ketik namanya.
- **Item barang** dapat ditambah dan diubah. Ketik nama barang yang pernah ada, maka Merk dan Type terisi otomatis. Item yang sudah tersimpan **tidak dapat dihapus dari aplikasi**; hapus barisnya langsung di Google Sheet.
- Saat Status order diubah, Status item yang mengikuti order ikut berubah.
- Satu kali Simpan menulis semuanya sekaligus: kalau gagal, tidak ada data setengah tersimpan.
- Sebelum menulis, aplikasi membaca ulang sheet: ID ganda ditolak, dan saat mengedit hanya sel yang benar-benar Anda ubah yang ditulis. Tidak ada penguncian penuh, jadi bila dua orang menyimpan **order baru pada detik yang sama**, keduanya bisa menulis ke baris yang sama. Itu jarang terjadi; simpan bergantian untuk aman.

**Cara aplikasi menjaga rumus di sheet Anda:**
- Baris baru dibuat dengan **menyalin baris terakhir** (rumus, format, dan validasi ikut), lalu kolom isian diganti nilai baru dan sisa nilai lama dikosongkan.
- Kolom berisi **rumus** (mis. Status Induk, Marketing dari Master, Bulan Order) **tidak pernah ditimpa**.
- Edit hanya menulis sel yang **berubah**.
- Teks yang Anda ketik selalu disimpan sebagai teks biasa. Awalan seperti `=` tidak dapat menjadi rumus.
- Total Nilai dan Ongkir disimpan sebagai angka berformat `Rp`.
- Aplikasi **tidak menghapus apa pun** di sheet.

**Sebelum dipakai sungguhan, uji dulu pada salinan sheet.** Aplikasi tidak dapat melihat rumus sheet Anda sebelum dipakai, jadi lakukan sekali:
1. Google Sheet → **File → Buat salinan**.
2. Ganti `SPREADSHEET_ID` di `config.js` dengan ID salinan, unggah ulang.
3. Buat satu order uji dengan 2 item, lalu edit statusnya. Periksa di sheet bahwa Dashboard dan Analisis ikut berubah dengan benar dan kolom berumus terisi.
4. Jika sudah sesuai, kembalikan `SPREADSHEET_ID` ke sheet asli.

Jika terjadi kesalahan, pulihkan lewat **File → Riwayat versi** di Google Sheet.

> **Perhatian:** jika tab *Master Order* ternyata terisi **otomatis dari tab lain** (misalnya satu rumus `QUERY`/`ARRAYFORMULA` di baris 2 yang mengambil dari tab *Data Asli*), jangan input dari aplikasi. Baris yang ditambah manual dapat bertabrakan dengan rumus itu. Gunakan salinan sheet untuk memastikan lebih dulu.

## 5A. Upload PDF Surat Pesanan (isi otomatis + simpan ke Google Drive)

Aplikasi dapat membaca **Surat Pesanan E-Katalog (PDF)** dan mengisi form order otomatis, lalu menyimpan file PDF-nya ke Google Drive.

1. Tab **Order → Upload PDF Pesanan** (atau **+ Order Baru → Pilih PDF untuk isi otomatis**), pilih file PDF.
2. Dalam beberapa detik form terisi: ID/No. Kontrak, Company, Daerah, tanggal, Total Nilai, Ongkir, dan daftar barang (Merk dan Type terisi bila barangnya sudah pernah ada di sheet).
3. **Periksa isiannya**, lalu **pilih Marketing** (tidak tertulis di PDF) dan lengkapi yang diminta catatan di bawah kotak PDF.
4. **Simpan**: PDF diunggah ke Drive, lalu data masuk ke Master Order dan Detail Item. Tautan PDF tercatat di kolom **Link PDF** (dibuat otomatis di kolom paling kanan Master Order bila belum ada; kolom lain tidak bergeser). Di detail order muncul tautan **Buka PDF di Google Drive**.

**Yang perlu diketahui:**
- Pembacaan PDF berlangsung **di perangkat Anda**; isi PDF tidak dikirim ke server mana pun selain Google (Drive) saat Simpan. Pembaca PDF dimuat saat pertama dipakai, jadi butuh internet.
- Yang dibaca hanya halaman depan Surat Pesanan; lampiran syarat dan ketentuan diabaikan.
- Status otomatis **SUDAH KONTRAK**. Tanggal Order, Setuju, dan Mulai Kontrak diisi sama dengan tanggal Surat Pesanan, Akhir Kontrak diisi dari *Permintaan Tiba*, Tanggal Nego dikosongkan. Ubah di form bila berbeda.
- **Total Nilai** = *Estimasi Total Pembayaran* (sudah termasuk PPN). **Ongkir** = ongkos kirim ditambah PPN-nya. Nilai barang = Total dikurangi Ongkir (dibagi sesuai harga bila barangnya lebih dari satu).
- Company dan Daerah dicocokkan dengan daftar yang sudah ada di sheet. Jika tidak ada yang cocok, aplikasi membuatnya sebagai baru dan memberi catatan; periksa agar tidak muncul penulisan ganda.
- **Pencegah duplikat:** jika order itu sudah ada di sheet, PDF ditolak dengan pesan yang menyebut barisnya. Pencocokan memperhitungkan ID yang ditulis tanpa `EP-` atau **terpotong**, dan membandingkan juga kolom Contract No. Untuk order yang sudah ada, buka order tersebut, tekan **Edit**, lalu **Lampirkan PDF…**: hanya tautan PDF yang ditambahkan, isian lain tidak berubah.
- Folder Drive **`AKM GROUP - PDF Pesanan`** dibuat otomatis di Drive **orang yang mengunggah**. File bernama `Surat Pesanan EP-….pdf`. Mengunggah file yang sama dua kali tidak membuat salinan ganda.
- **Siapa yang bisa membuka PDF?** Secara bawaan hanya pengunggah (`DRIVE_SHARE_ANYONE: false` di `config.js`). Jika anggota tim lain perlu membuka dari tautan, ada dua cara: bagikan folder itu dari Google Drive ke Gmail mereka, atau ubah `DRIVE_SHARE_ANYONE` menjadi `true` (siapa pun yang memegang tautannya bisa membuka).
- Jika PDF berupa **hasil scan/foto** (bukan teks), aplikasi tidak dapat membacanya dan menyarankan isi manual; PDF tetap dapat dilampirkan lewat Edit.
- Format yang diuji: Surat Pesanan E-Katalog v6 (satu atau beberapa barang). Jika format berubah dan ada isian yang tidak terbaca, aplikasi menampilkan peringatan dan Anda dapat mengisi manual.

**Mode demo** (file `pratinjau-pribadi.html`): perubahan hanya tersimpan di memori dan hilang saat halaman ditutup. Tidak ada yang masuk ke Google Sheet.

---

## 6. Jika Google Sheet berubah

- **Nama tab** harus sama dengan `SHEET_ORDER` dan `SHEET_ITEM` di `config.js` (`Master Order` dan `Detail Item`).
- **Kolom wajib** di Master Order: `ID Pesanan`, `Status`, `Total Nilai`. Kolom lain (Daerah, Order Date, Company, Marketing, Total Ongkir, Nego Date, Agree Date, Contract No, Start Contract, End Contract) bersifat opsional. Urutan kolom bebas, yang dicocokkan adalah **judul kolomnya**. Jangan mengganti judul kolom tanpa memberi tahu.
- Baris dengan kolom `_visible` bernilai `0` tidak ditampilkan.
- Status baru (di luar enam status yang ada) otomatis muncul di aplikasi.
- Nilai uang boleh berupa angka atau teks seperti `Rp 1,557,600` atau `Rp6,127,000`; keduanya terbaca.
- Data dimuat ulang otomatis tiap 5 menit (ubah di `AUTO_REFRESH_MINUTES`), atau dengan tombol muat ulang.

---

## 7. Pemecahan masalah

| Pesan / gejala | Penyebab dan solusi |
|---|---|
| "Client ID Google belum diisi" | `config.js` belum diubah, atau belum diunggah ulang ke hosting. |
| Error `redirect_uri_mismatch` / `origin_mismatch` | Alamat hosting belum ada di *Authorized JavaScript origins* atau penulisannya berbeda (harus sama persis, tanpa `/` di akhir). |
| `access_denied` / "app is being tested" | Gmail belum ditambahkan ke **Test users**. |
| "Akun ini belum punya akses" | Gmail belum di-*Share* ke Google Sheet. |
| "Akun ini tidak punya izin mengubah spreadsheet" | Akun berperan Pelihat, atau sel diproteksi. Jadikan **Editor** lewat Share, atau cabut proteksi range di Google Sheet. |
| "Izin Google Sheets belum diberikan lengkap" | Saat masuk, centang semua izin yang diminta. Pastikan scope `.../auth/spreadsheets` terdaftar di OAuth consent screen. |
| "ID Pesanan … sudah ada di sheet" | ID itu sudah dipakai order lain. Cari di tab Order lalu gunakan Edit. |
| "Google Sheets API belum diaktifkan" | Ulangi Bagian 1, langkah 2, pada proyek yang sama dengan Client ID. |
| "Google Drive API belum diaktifkan" | Bagian 1, langkah 2: aktifkan **Google Drive API** pada proyek yang sama. Tidak ada data yang tertulis ke Sheet saat ini terjadi. |
| "Izin Google Drive belum diberikan" | Tekan **Ganti akun**, masuk lagi, dan centang izin Google Drive. Pastikan scope `.../auth/drive.file` terdaftar di OAuth consent screen. |
| "Order ini sudah ada di sheet…" saat upload PDF | Order itu sudah tercatat (mungkin dengan ID tanpa `EP-` atau terpotong). Buka order tersebut → Edit → Lampirkan PDF. |
| "Nomor Surat Pesanan tidak ditemukan" | File bukan Surat Pesanan E-Katalog, atau berupa scan. Isi form manual. |
| "PDF sudah tersimpan di Google Drive, tetapi data belum masuk ke Sheet" | Unggahan ke Drive berhasil tetapi penulisan Sheet gagal. Perbaiki penyebab yang tertulis di pesan lalu tekan Simpan lagi; PDF tidak akan terunggah dobel. |
| "Tab … tidak ditemukan" | Nama tab di sheet berbeda dari `config.js`. |
| Jendela login tidak muncul | Pop-up diblokir browser. Izinkan pop-up untuk situs ini. |
| Perubahan kode tidak terlihat | Tutup lalu buka lagi aplikasinya. Aplikasi mengambil versi terbaru saat online. |

---

## 8. Isi folder

| File | Fungsi |
|---|---|
| `index.html`, `styles.css`, `app.js`, `logic.js` | Aplikasi (tampilan dan perhitungan rekap) |
| `form.js`, `writer.js` | Form input/edit order dan penyusun perubahan ke Google Sheet |
| `pdfparse.js`, `drive.js`, `vendor/` | Pembaca PDF Surat Pesanan, unggah ke Google Drive, dan pustaka pdf.js (lisensi Apache 2.0 di `vendor/LICENSE-pdfjs.txt`) |
| `config.js` | **Satu-satunya file yang perlu Anda ubah** |
| `manifest.webmanifest`, `sw.js`, `icons/` | Agar bisa dipasang seperti aplikasi; `icons/logo.png` adalah logo AKM |
| `PANDUAN.md` | Panduan ini |

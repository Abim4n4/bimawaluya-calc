# 🔌 Bima Waluya Link Budget

Aplikasi web ringan untuk menghitung **link power budget** jaringan FTTH (GPON/EPON/XGS-PON) langsung dari browser — tanpa backend, tanpa build step. Dibuat supaya teman-teman teknisi bisa cek kelayakan link di lapangan hanya dengan HP/laptop dan koneksi (atau bahkan offline setelah dibuka sekali).

**[Live demo →](#)** *(isi setelah deploy ke Vercel)*

![status](https://img.shields.io/badge/stack-HTML%2FCSS%2FJS-blue) ![deploy](https://img.shields.io/badge/deploy-Vercel-black)

---

## ✨ Fitur

- Model perhitungan **bertahap (staged)** mengikuti jalur fisik nyata di lapangan:
  `SFP/OLT → patchcord → OTB → feeder → ODC (IN/OUT) → distribusi → ODP (IN/OUT) → kabel drop → ONT`
- **Estimasi ideal vs konservatif** — selain angka sesuai spec datasheet, ada **buffer ketidakpastian lapangan (%)** yang bisa diatur untuk memperhitungkan kondisi nyata (konektor kotor, kabel tertekuk, sambungan tidak konsisten, kabel non-standar). Status LULUS/GAGAL ditentukan dari skenario konservatif ini, bukan angka ideal semata
- **Deteksi overload** — selain cek daya terlalu lemah, kalkulator juga cek daya **terlalu kuat** yang berisiko merusak fotodetektor ONT
- Preset teknologi umum (GPON, XG-PON, XGS-PON, EPON, 10G-EPON) dengan nilai Tx/Rx tipikal
- Perhitungan redaman lengkap per segmen: patchcord OLT, OTB, kabel feeder, splitter ODC, kabel distribusi, splitter ODP, dan kabel drop (DC) ke rumah pelanggan
- **Timeline checkpoint** menampilkan daya (dBm) di tiap titik ukur — tinggal dicocokkan langsung dengan pembacaan OPM di lapangan (SFP OUT, OTB, ODC IN/OUT, ODP IN/OUT, ONT)
- Gauge visual model "power meter" dengan **dua penanda** (ideal & konservatif) yang menunjukkan posisi daya terima terhadap sensitivitas dan batas overload
- Status **LULUS / MARGINAL / GAGAL / OVERLOAD** otomatis
- Form **accordion per tahap** dengan ikon, status yang selalu kelihatan (sticky header, bisa diklik untuk lompat ke hasil)
- Tombol **salin hasil sebagai teks** — siap ditempel ke laporan/WhatsApp grup, termasuk pembacaan tiap checkpoint dan perbandingan ideal vs konservatif
- Input tersimpan otomatis di browser (localStorage), jadi tidak perlu ketik ulang tiap buka halaman
- 100% client-side — data pengukuran tidak dikirim ke server manapun

## 🧮 Cara perhitungan

Daya dihitung mengalir tahap demi tahap, sama seperti tim OSP mengukur pakai OPM dari OLT sampai ke rumah pelanggan:

```
SFP OUT (OLT)
  − redaman patchcord OLT→OTB
  − redaman OTB (pigtail/adaptor)
= OTB

OTB
  − (panjang feeder × koefisien redaman)
  − (jumlah sambungan feeder × redaman per sambungan)
= ODC — IN

ODC — IN
  − insertion loss splitter ODC
  − (jumlah konektor ODC × redaman per konektor)
= ODC — OUT

ODC — OUT
  − (panjang kabel distribusi × koefisien redaman)
  − (jumlah sambungan distribusi × redaman per sambungan)
= ODP — IN

ODP — IN
  − insertion loss splitter ODP
  − (jumlah konektor ODP × redaman per konektor)
= ODP — OUT

ODP — OUT
  − (panjang kabel drop/DC dalam meter × koefisien redaman per meter)
  − (jumlah konektor drop × redaman per konektor)
= ONT — daya ideal (sesuai spec datasheet)

Total redaman konservatif = Total redaman ideal × (1 + faktor ketidakpastian lapangan%)
ONT — daya konservatif   = Tx SFP − total redaman konservatif

Margin (dipakai untuk status) = daya konservatif − sensitivitas Rx ONT
Overload (dipakai untuk status) = daya ideal dibandingkan batas maksimum ONT

Status:
  daya ideal > batas maksimum ONT   → OVERLOAD (berisiko merusak ONT)
  margin < 0                        → GAGAL   (di bawah sensitivitas penerima)
  0 ≤ margin < margin keamanan      → MARGINAL
  margin ≥ margin keamanan          → LULUS
```

**Kenapa dua skenario (ideal & konservatif)?** Kondisi kabel/splitter/konektor di lapangan hampir selalu punya redaman ekstra dibanding spec datasheet (karena aging, kualitas pemasangan, kelembaban, dll) — faktor ini nyaris selalu **menambah** redaman, bukan mengurangi. Karena itu:
- Cek **GAGAL/MARGINAL/LULUS** pakai skenario **konservatif** (worst-case redaman) — supaya keputusan lapangan lebih realistis
- Cek **OVERLOAD** pakai skenario **ideal** (redaman paling minim) — karena ini kebalikannya, kasus terburuk untuk overload adalah saat redaman senyatanya sedikit

Nilai default (Tx SFP per preset, koefisien redaman per panjang gelombang, insertion loss splitter, redaman OTB/konektor, faktor ketidakpastian) adalah **nilai tipikal untuk perencanaan**, bukan angka baku mutlak. Selalu sesuaikan dengan datasheet SFP/ONT dan splitter yang benar-benar dipakai, serta hasil ukur OPM aktual di lapangan pada tiap titik (OTB, ODC, ODP).

## 📁 Struktur proyek

```
bimawaluya-calc/
├── index.html        # struktur halaman
├── css/style.css      # styling (tema panel instrumen gelap)
├── js/script.js        # logika kalkulasi & interaksi
└── README.md
```

Murni HTML/CSS/JS vanilla — tidak ada dependency, tidak perlu `npm install`.

## 🚀 Menjalankan di lokal

Cukup buka `index.html` langsung di browser, atau jalankan server statis sederhana:

```bash
# opsi 1: Python
python3 -m http.server 8000

# opsi 2: Node (npx)
npx serve .
```

Lalu buka `http://localhost:8000`.

## ☁️ Deploy

### 1. Push ke GitHub

```bash
cd bimawaluya-calc
git init
git add .
git commit -m "Initial commit: kalkulator link budget FTTH"
git branch -M main
git remote add origin https://github.com/USERNAME/bimawaluya-calc.git
git push -u origin main
```

Ganti `USERNAME` dan nama repo sesuai punya kamu. Buat dulu repo kosong di GitHub kalau belum ada (tanpa README/gitignore bawaan, supaya tidak konflik saat push pertama).

### 2. Deploy ke Vercel

**Lewat dashboard (paling mudah):**
1. Buka [vercel.com/new](https://vercel.com/new) dan login/hubungkan akun GitHub.
2. Pilih repo `bimawaluya-calc` yang baru di-push.
3. Framework preset: pilih **Other** (proyek ini situs statis biasa, tidak perlu build command).
4. Klik **Deploy**. Selesai dalam hitungan detik.

**Lewat CLI:**
```bash
npm i -g vercel
cd bimawaluya-calc
vercel        # ikuti prompt untuk deploy preview
vercel --prod # deploy ke production
```

Setiap kali push ke branch `main`, Vercel otomatis build ulang & deploy (CI/CD bawaan).

## 🛠️ Kustomisasi

- **Tambah preset teknologi baru** → edit objek `PRESETS` di `js/script.js`.
- **Ubah nilai default splitter** → edit `SPLITTER_LOSS_TABLE` (tipikal) atau `SPLITTER_LOSS_TABLE_MAX` (maksimum/konservatif) di `js/script.js`. Atau langsung dari UI: pilih mode "Tipikal / Maksimum" lalu edit manual field insertion loss-nya — perubahan manual selalu didahulukan, tidak tertimpa kecuali kamu ganti rasio/mode lagi.
- **Ganti warna/tema** → semua token warna ada di bagian `:root` pada `css/style.css`.

## 📄 Lisensi

© rhd03 2026 — bebas dipakai, dimodifikasi, dan disebarluaskan untuk keperluan internal tim/perusahaan.

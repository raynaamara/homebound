# Mempublikasikan paket HOMEBOUND ke GitHub

Paket ini berisi source aplikasi, data siap pakai, dokumentasi teknis dan demo final. Lisensi yang dipilih: **Apache-2.0**, pemegang hak cipta **HOMEBOUND contributors**. Data NASA, musik dan materi pihak ketiga tetap mengikuti ketentuannya sendiri.

**Belum ada repository online, commit, atau push yang dibuat oleh paket ini.**

## 1. Ekstrak dan periksa

Ekstrak ZIP. Di dalam folder `homebound` harus langsung terlihat:

```text
README.md
LICENSE
NOTICE
THIRD_PARTY_NOTICES.md
RELEASE_MANIFEST.json
.gitignore
.gitattributes
decision-model/
data/
docs/
```

Jangan mengunggah seluruh folder kerja lama. Jangan memasukkan `node_modules`, `dist`, `deploy`, file `.env`, file Office `~$`, atau draft internal. Jangan mengubah akhir baris seluruh repository: pemeriksaan data memakai hash byte yang persis.

## 2. Pilihan paling mudah: GitHub Desktop

1. Masuk ke GitHub Desktop dengan akun GitHub yang akan memiliki repository.
2. Pilih **File -> New repository**.
3. Isi nama **homebound**, deskripsi singkat, dan pilih lokasi induk yang belum berisi repository bernama sama.
4. Jangan membuat README, `.gitignore`, atau lisensi tambahan: semuanya sudah tersedia dalam paket.
5. Buat repository lokal kosong tersebut.
6. Salin **isi** folder hasil ekstraksi `homebound` ke folder repository yang baru dibuat. Jangan menyalin folder luarnya sehingga menjadi `homebound/homebound`.
7. Pastikan `.gitignore` dan `.gitattributes` ikut tersalin. Di Windows Explorer aktifkan **View -> Show -> Hidden items** bila perlu.
8. Kembali ke Desktop. Pada **Changes**, pastikan source, data, docs dan kedua dotfile terlihat; pastikan tidak ada folder hasil build/dependensi.
9. Isi ringkasan commit, misalnya `Publish HOMEBOUND source and final demos`, lalu **Commit**.
10. Pilih **Publish repository**. Pastikan **Keep this code private** tidak dicentang jika akan dibagikan secara publik.
11. Selesaikan publikasi, kemudian **View on GitHub**.

## 3. Alternatif: Git di PowerShell

Gunakan Git dan Node/npm yang sudah terpasang. Buka PowerShell di folder hasil ekstraksi `homebound`.

```powershell
git init
git branch -M main
git add .
git status --short
git commit -m "Publish HOMEBOUND source and final demos"
```

Di GitHub, buat repository **Public** yang kosong: jangan menambahkan README, `.gitignore`, atau lisensi otomatis. Salin URL HTTPS repository tersebut, kemudian jalankan:

```powershell
$repoUrl = Read-Host "Tempel URL HTTPS repository GitHub kosong"
git remote add origin $repoUrl
git push -u origin main
```

Gunakan mekanisme login Git/GitHub yang resmi. Jangan menyimpan password atau token di source, README, atau URL remote.

## 4. Verifikasi sebelum dibagikan

- Repository bisa dibuka dalam jendela privat tanpa login.
- README tampil dan tautan relatif ke deck, video, data serta lisensi bisa diakses.
- `decision-model/src`, `decision-model/tests` dan data pendamping benar-benar ada; bukan hanya hasil build.
- Jalankan urutan instalasi/pengujian pada [README utama](../README.md). Hasil build adalah `decision-model/deploy`; folder itu tidak perlu di-commit.
- Lisensi, [pemberitahuan pihak ketiga](../THIRD_PARTY_NOTICES.md) dan [credit musik](demo/HOMEBOUND_App_Demo_Music_Credit_EN.txt) tetap ada.
- Tidak ada draft submission, data pribadi, credential, unduhan NASA besar atau rekaman musik penuh.

Untuk submission, situs aplikasi tetap menjadi tautan **Final Project**, video publik menjadi **Project Demo**, dan GitHub dapat ditambahkan sebagai tautan source. Jika video sudah diunggah, tambahkan URL watch YouTube yang benar; jangan menggunakan tautan Studio atau URL contoh.

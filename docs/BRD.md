# BRD — Business Requirements Document (open-delegate)

> **SSoT boundary (binding).** Berkas ini memiliki **WHY & WHAT (level bisnis)**: tujuan, registri aktor, glosarium domain, aturan global.
> Berkas ini **tidak** memiliki alur fungsional per modul, katalog validasi, atau kriteria penerimaan — itu hidup di [PRD](./PRD.md).
> Detail implementasi (kontrak tool, diagnosis) hidup di kode dan berkas yang dirujuk [README](../README.md), [RUNBOOK](../RUNBOOK.md).

- Repo: `open-delegate` — plugin Cursor berupa jembatan MCP yang mendelegasikan kerja ke sesi OpenCode background; lisensi MIT; npm `@verbalize/open-delegate` (belum terbit saat dokumen ini ditulis — instal via clone + `register:local`).
- Repo ini **tooling IDE, bukan aplikasi end-user**: tidak ada pengguna akhir di luar pengguna Cursor sendiri, tidak ada akun, tidak ada peran login.
- Kontrak tool dan galat yang menghadap agen: `skills/ode-delegate/reference/`; playbook operasi manusia: [RUNBOOK](../RUNBOOK.md).

## 1. Ringkasan eksekutif & tujuan sistem

Menjalankan model flagship lewat delegate bawaan Cursor itu mahal. open-delegate mengalihkan kerja ke alternatif OpenCode yang lebih murah (paket gratis Zen, open-weights, OpenRouter menengah/murah) dengan eksekusi nyata: Cursor "mendelegasikan" seperti tool native, tetapi OpenCode yang mengerjakan — instal sepele, kebijakan model terjaga, lifecycle terbatas, teks galat nyata, dan setiap sesi punya URL `opencode serve` live.

Nilai yang disediakan (alur di [PRD](./PRD.md)):

1. **Handoff OpenCode nyata** — spawn `opencode serve` per sesi, bukan simulasi.
2. **Kebijakan model terjaga** — default / force / allow / deny di level MCP plus aturan routing soft always-on.
3. **Lifecycle terjaga** — bounded waits, tanpa proses background bocor, teks galat nyata.
4. **Live preview** — setiap sesi mengembalikan URL-nya sendiri.
5. **Diagnosis tanpa tebakan** — `ode_diagnostics` melaporkan pid, URL, path log, dan event internal.

Di luar lingkup (non-tujuan eksplisit): IDE selain Cursor; kualitas flagship; remapping slug Cursor; routing persona otomatis; menggantikan delegate native untuk model Cursor-native di luar force list.

## 2. Aktor & matriks peran

Tidak ada peran login end-user. Aktor di bawah adalah peran operasional.

| Aktor | Sifat | Kemampuan |
|---|---|---|
| Pengguna Cursor | Manusia di IDE Cursor | Memanggil `ode_delegate` / `ode_await` / `ode_cancel` / `ode_transcript` / `ode_diagnostics`; membuka URL sesi live |
| Bridge MCP | Proses plugin open-delegate | Memiliki lifecycle `opencode serve`; menegakkan kebijakan model; mencatat event internal |
| Sesi OpenCode | Proses `opencode serve` per delegasi | Mengeksekusi kerja; bertahan hidup meski koneksi MCP host di-reload |
| Host MCP Cursor | Sistem Cursor sendiri | Pemilik pesan `Connection stopped` / timeout koneksi — bukan kode repo ini |
| Pemelihara | Manusia rilis | `build`, `test`, `e2e`, `refresh:models`, `validate:skill`, publikasi npm/Marketplace |

## 3. Glosarium domain

| Istilah | Arti di repo ini (PRD wajib memakai ulang, tidak mendefinisikan ulang) |
|---|---|
| Delegasi | Pemanggilan `ode_delegate` yang men-spawn satu `opencode serve` dan mendaftarkannya |
| `runtimeKey` | Kunci sesi di `sessionRegistry`; identitas untuk `await`/`cancel`/`transcript` |
| Kebijakan model | Daftar default / force / allow / deny + aturan routing soft always-on di `modelPolicy.ts` |
| Bounded waits | Penantian berbatas; tidak ada proses background yang dibiarkan bocor |
| Galat sisi host | Pesan koneksi dari host MCP Cursor, bukan dari bridge; penanganannya reload window |

## 4. Aturan global & batas

1. **Hanya Cursor.** Tidak ada dukungan IDE lain; instal resmi hanya registrasi plugin lokal Cursor.
2. **Kualitas flagship bukan target.** Opus/Sonnet dan sejenisnya di luar default kurasi; repo ini menghemat biaya, bukan mengejar kualitas tertinggi.
3. **Teks galat nyata.** Kegagalan melaporkan sebab sebenarnya (biner hilang, model ditolak kebijakan, sesi mati) — tidak ada pesan generik yang menutupi.
4. **Bridge memiliki lifecycle sesi.** Shutdown bersih bridge membuang `opencode serve` yang dimilikinya; reconnect sisi host tidak membunuh sesi yang selamat.
5. **String host bukan string repo.** Pesan `Connection stopped`/timeout koneksi milik Cursor; diagnosisnya reload window lalu `ode_diagnostics`, bukan debug bridge.
6. **Gate rilis mengikat.** `build` + `test:unit` + `e2e` + `validate:skill` hijau sebelum publikasi; daftar model konsisten dengan `MODELS_GROUND_TRUTH.md`.

# PRD — Product Requirements Document (open-delegate)

> **SSoT boundary (binding).** Berkas ini memiliki **HOW (perilaku fungsional & sistem)**: alur per modul, jalur positif/negatif, kondisi percabangan, kasus tepi, aturan validasi, kriteria penerimaan.
> Berkas ini **tidak** memiliki definisi peran, glosarium domain, atau aturan global — itu kanonis di [BRD](./BRD.md) dan **ditaut, tidak diulang**.
> Detail implementasi (kontrak tool, kode galat) hidup di kode dan berkas yang dirujuk [README](../README.md), [RUNBOOK](../RUNBOOK.md), `skills/ode-delegate/reference/`.

- Repo: `@verbalize/open-delegate` v0.2.0-alpha — plugin Cursor (hanya Cursor) berupa jembatan MCP yang mendelegasikan kerja ke sesi OpenCode background yang tak terlihat, lewat lima tool MCP.
- Prasyarat: Cursor, Node.js ≥ 18.17, CLI `opencode` di `PATH` (atau `OPEN_DELEGATE_OPENCODE_BIN`), dan minimal satu model yang bisa dipakai OpenCode (`opencode auth login` atau model gratis seperti `opencode/deepseek-v4-flash-free`).
- Non-tujuan: mendukung IDE selain Cursor; mengejar kualitas flagship (Opus/Sonnet/di luar default kurasi); remapping slug Cursor; routing persona otomatis.

---

## MOD-001 — Delegasi sesi (`DEL`)

**Gambaran & pemetaan sumber.** `src/tools/delegate.ts` (~16KB), `src/sessionRegistry.ts`, `src/runtime.ts`, `src/runtimeManager.ts`, `src/opencodeHelpers.ts`, `src/modelPolicy.ts`, `src/modelAvailability.ts`, `src/configSpec.ts`, `src/context.ts`. Setiap sesi mendapat `opencode serve` sendiri dengan URL live untuk dibuka langsung.

**Aktor & prasyarat.** `pengguna Cursor` memanggil tool MCP. Prasyarat: CLI opencode terpecahkan (`src/binaryResolve.ts`), model tersedia menurut kebijakan model.

**Alur positif.**
1. Pengguna memanggil `ode_delegate` dengan prompt dan runtime; bridge mem-spawn `opencode serve` dan mendaftarkannya di `sessionRegistry` dengan `runtimeKey`.
2. Respons mengembalikan URL sesi live; pengguna bisa membuka dan memantau langsung.
3. Batas tunggu terbatas (bounded waits); tidak ada proses background yang bocor — lifecycle dijaga bridge.

**Alur negatif.** Biner opencode tidak ketemu → galat teks nyata yang menyebut variabel `OPEN_DELEGATE_OPENCODE_BIN`. Model tidak tersedia → penolakan kebijakan model dengan alternatif. Sesi mati → `ode_await`/`ode_transcript` melaporkan status, bukan menggantung selamanya.

**Kondisi & percabangan.** Kebijakan model MCP: daftar default / force / allow / deny + aturan routing soft always-on (lihat [BRD §5](./BRD.md#5-aturan-global--batas)).

**Kasus tepi.** Instalasi opencode dingin pertama (resolusi `npx`, pemindaian antivirus) membuat `ode_delegate` pertama lambat — diagnosis di RUNBOOK, bukan bug bridge.

**Kriteria penerimaan.**
- Ketika `ode_delegate` dipanggil dengan model yang diizinkan, maka sesi terdaftar dengan `runtimeKey` dan URL live yang bisa dibuka.
- Ketika bridge dimatikan bersih, maka semua `opencode serve` yang dimilikinya ikut dibersihkan (tidak ada proses yatim).

---

## MOD-002 — Tunggu, batal, transkrip (`AWT`)

**Gambaran & pemetaan sumber.** `src/tools/await.ts`, `src/tools/cancel.ts`, `src/tools/transcript.ts`, `src/tools/diagnostics.ts`, `src/mcpResult.ts`, `src/log.ts`.

**Alur positif.**
1. `ode_await` menunggu sesi dengan batas waktu; selesai → hasil dikembalikan ke Cursor.
2. `ode_cancel` membatalkan sesi berjalan dan membersihkan prosesnya.
3. `ode_transcript` mengambil transkrip sesi untuk kelanjutan konteks.
4. `ode_diagnostics` melaporkan pid bridge, setiap pid/url/log `opencode serve` yang live, dan ~50 event internal terakhir tanpa tebakan.

**Alur negatif.** `runtimeKey` tidak dikenal → galat yang menyebut kunci yang diminta dan daftar kunci live. Sesi sudah mati → status dilaporkan, bukan error menumpuk.

**Kriteria penerimaan.**
- Ketika koneksi MCP host terputus lalu window di-reload, maka sesi yang `opencode serve`-nya selamat tetap bisa dijangkau `ode_await`/`ode_transcript`.
- Ketika `ode_diagnostics` dipanggil, maka keluarannya memuat pid, URL, dan path log setiap sesi live.

---

## MOD-003 — Aturan routing Cursor (`RTE`)

**Gambaran & pemetaan sumber.** `rules/open-delegate-routing.mdc`, `skills/ode-delegate/` (kontrak tool dan referensi galat, divalidasi `npm run validate:skill` via `scripts/validate-skill.mjs`).

**Alur positif.** Cursor me-routing tugas delegasi ke tool `ode_*` sesuai aturan `.mdc`; model force-list selalu lewat OpenCode, model Cursor-native tetap memakai delegate bawaan.

**Alur negatif.** String `Connection stopped` / `Timed out waiting for connection` berasal dari host MCP Cursor sendiri, bukan dari kode ini (grep membuktikan tidak ada di sumber) → penanganannya reload window, lihat RUNBOOK.

**Kriteria penerimaan.**
- Ketika skill berubah, maka `npm run validate:skill` hijau sebelum rilis.
- Ketika host Cursor melaporkan timeout koneksi, maka dokumentasi menunjuk ke reload window, bukan ke perbaikan bridge.

---

## MOD-004 — Build, uji, rilis (`BLD`)

**Gambaran & pemetaan sumber.** `package.json` (`build` via `scripts/build.mjs`, `test:unit` via `vitest run tests/unit`, `test:integration` dengan `--no-file-parallelism`, `e2e` via `scripts/e2e-smoke.mjs`, `refresh:models` via `scripts/refresh-models.mjs`, `register:local` via `scripts/register-local-plugin.mjs`), `models/` (`MODELS_GROUND_TRUTH.md`, `ode-models.default.json`), `tests/`.

**Kriteria penerimaan.**
- Ketika `npm run build` + `npm run test:unit` + `e2e` hijau, maka gate rilis RUNBOOK terpenuhi dan paket layak `prepublishOnly`.
- Ketika daftar model di-refresh, maka hasilnya konsisten dengan `MODELS_GROUND_TRUTH.md`.

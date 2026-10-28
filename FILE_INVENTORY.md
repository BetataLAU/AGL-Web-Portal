# FILE_INVENTORY — 專案檔案清單（自動產生）

> ⚠️ 本檔案由 `scripts/sync-project-state.js` 自動產生，**請勿手動編輯**。
> 更新方式：執行 `npm run sync`。
> 最後更新：2026/10/28 下午12:57:08

## 🔄 Git 變更狀態

```
M CLAUDE.md
M FILE_INVENTORY.md
M PROJECT_MAP.md
M README.md
M WORKSPACE_STATE.md
D bp3d/constraints.js
D bp3d/extreme-points.js
D bp3d/ga-lns.js
D bp3d/ga-lns/chromosome.js
D bp3d/ga-lns/evolve.js
D bp3d/ga-lns/fitness.js
D bp3d/ga-lns/init.js
D bp3d/ga-lns/search.js
D bp3d/geometries.js
D bp3d/solver.js
D bp3d/uld-definitions.js
M data/templates/shipper-role-summary-2026.xlsx
M database.db
M db/database.js
M db/db-dump.sql
M db/sessions.db
M docs/README.md
D docs/archive/uld-packing-prd-v2.txt
D docs/archive/uld-packing-spec-deepseek.md
D docs/research/bpp-research-2026-08-20.txt
D docs/research/github-repos-2026-08-20.txt
D public/css/packing.css
D public/css/uld-packing-3d.css
D public/css/uld-packing-modal.css
D public/css/uld-packing-solve.css
D public/css/uld-packing.css
M public/index.html
M public/js/auth.js
D public/js/packing/packing-main.js
D public/js/packing/packing-viewer.js
D public/js/uld-packing/calc.js
D public/js/uld-packing/dragger.js
D public/js/uld-packing/main.js
D public/js/uld-packing/project.js
D public/js/uld-packing/solve-ui.js
D public/js/uld-packing/state.js
D public/js/uld-packing/ui.js
D public/js/uld-packing/viewer-controller.js
D public/js/uld-packing/viewer.js
D public/packing.html
D public/uld-packing.html
M routes/auth/auth-router.js
D routes/packing-pdf.js
D routes/packing-projects.js
D routes/packing-solutions.js
D routes/packing-solve.js
D routes/packing.js
D scripts/fetch-bpp-research.py
D scripts/fetch-github-repos.py
M scripts/fix-nav-order.js
D scripts/solve-worker.js
D scripts/test-bp3d.js
D scripts/test-galms.js
M scripts/test-nav-order-frontend.js
M scripts/test-nav-order.js
D scripts/test-packing-api.js
D scripts/test-packing-projects.js
D scripts/test-q7-api.js
M server.js
D utils/color-assigner.js
```

## 📁 檔案清單（共 208 個檔案）

### (根目錄)

- `.clineignore`（461 B）
- `.gitignore`（642 B）
- `CLAUDE.md`（39.7 KB）
- `Dockerfile`（1.3 KB）
- `PROJECT_MAP.md`（13.7 KB）
- `README.md`（20.3 KB）
- `WORKSPACE_STATE.md`（37.4 KB）
- `package.json`（750 B）
- `server.js`（6.3 KB）

### data/templates

- `data/templates/cainiao-sli-eli-template.xlsm`（214.7 KB）
- `data/templates/cainiao-sli-eli-template.xlsx`（93.7 KB）
- `data/templates/shipper-role-summary-2026.xlsx`（629.0 KB）
- `data/templates/sli-eli-blank-meta.json`（1.2 KB）
- `data/templates/sli-eli-blank.pdf`（114.0 KB）
- `data/templates/sli-eli-fieldmap.default.json`（13.7 KB）
- `data/templates/sli-eli-fieldmap.json`（13.7 KB）

### data/test-p2

- `data/test-p2/analyze-geometry.py`（2.5 KB）
- `data/test-p2/annots-probe.py`（3.0 KB）
- `data/test-p2/bitmap-p0-200.pdf`（53.8 KB）
- `data/test-p2/bitmap-p0-300.pdf`（87.5 KB）
- `data/test-p2/bitmap-p0-400.pdf`（128.8 KB）
- `data/test-p2/bitmap-p1-200.pdf`（56.5 KB）
- `data/test-p2/bitmap-p1-300.pdf`（102.8 KB）
- `data/test-p2/bitmap-p1-400.pdf`（160.2 KB）
- `data/test-p2/bitmap-probe.py`（1.7 KB）
- `data/test-p2/breakdown-probe.py`（2.9 KB）
- `data/test-p2/clean.pdf`（143.4 KB）
- `data/test-p2/date-check.py`（425 B）
- `data/test-p2/font-probe.py`（3.0 KB）
- `data/test-p2/gid-probe.py`（2.8 KB）
- `data/test-p2/glyph-probe.py`（1.5 KB）
- `data/test-p2/hinting-probe.py`（2.8 KB）
- `data/test-p2/list-fieldmap.py`（746 B）
- `data/test-p2/noannots-clean.pdf`（143.4 KB）
- `data/test-p2/noannots.pdf`（143.4 KB）
- `data/test-p2/opt-a.pdf`（279.9 KB）
- `data/test-p2/opt-b.pdf`（286.2 KB）
- `data/test-p2/opt.pdf`（281.4 KB）
- `data/test-p2/opt2.pdf`（208.3 KB）
- `data/test-p2/opt3.pdf`（143.1 KB）
- `data/test-p2/opt4.pdf`（123.4 KB）
- `data/test-p2/overlay-check.pdf`（132.1 KB）
- `data/test-p2/stream-probe.py`（1.6 KB）
- `data/test-p2/subset-probe.py`（1.9 KB）
- `data/test-p2/ttf-tables-probe.py`（1.4 KB）
- `data/test-p2/verify-build.py`（2.7 KB）
- `data/test-p2/verify-fieldmap.py`（2.5 KB）
- `data/test-p2/verify-output.py`（1.6 KB）

### data/test-p3

- `data/test-p3/apply-calibration.js`（4.7 KB）
- `data/test-p3/baseline-model.json`（156 B）
- `data/test-p3/ink-bbox.py`（1.7 KB）
- `data/test-p3/measure-baseline-delta.py`（2.6 KB）
- `data/test-p3/measure-refs.py`（3.7 KB）
- `data/test-p3/measure-wrap.py`（3.8 KB）
- `data/test-p3/mine-065-49876385.pdf`（124.6 KB）
- `data/test-p3/probe-diff-regions.py`（1.8 KB）
- `data/test-p3/probe-font-dict.py`（1.4 KB）
- `data/test-p3/probe-font-floor.py`（2.2 KB）
- `data/test-p3/probe-font-floor2.py`（2.6 KB）
- `data/test-p3/probe-line-extents.py`（1.4 KB）
- `data/test-p3/probe-mine-vs-ideal.py`（1.8 KB）
- `data/test-p3/probe-shift.py`（1.8 KB）
- `data/test-p3/probe-span-size.py`（1.2 KB）
- `data/test-p3/probe-text-pos.py`（2.1 KB）
- `data/test-p3/probe-visual.py`（1.8 KB）
- `data/test-p3/ref-065-49011480.pdf`（544.9 KB）
- `data/test-p3/ref-065-49011491.pdf`（544.9 KB）
- `data/test-p3/ref-065-49011502.pdf`（544.9 KB）
- `data/test-p3/ref-065-49876374.pdf`（542.9 KB）
- `data/test-p3/ref-065-49876385.pdf`（536.5 KB）
- `data/test-p3/try-customname.js`（1.6 KB）

### db

- `db/database.js`（13.1 KB）
- `db/db-dump.sql`（140.5 KB）

### docs

- `docs/README.md`（2.2 KB）

### docs/design

- `docs/design/order-system-design.md`（9.6 KB）
- `docs/design/xls-pdf-parallel-prd.md`（19.0 KB）
- `docs/design/xls-sli-eli-overlay-prd.md`（65.0 KB）

### public

- `public/index.html`（22.6 KB）
- `public/login.html`（8.5 KB）
- `public/sli-eli-layout.html`（6.2 KB）
- `public/users.html`（31.5 KB）

### public/css

- `public/css/animations.css`（4.9 KB）
- `public/css/base.css`（3.8 KB）
- `public/css/components.css`（7.4 KB）
- `public/css/dbviewer.css`（15.6 KB）
- `public/css/layout.css`（18.6 KB）
- `public/css/orders.css`（33.7 KB）
- `public/css/pallet.css`（31.9 KB）
- `public/css/sli-eli-layout.css`（9.4 KB）
- `public/css/xls-booking.css`（20.8 KB）

### public/css/utils

- `public/css/utils/autocomplete.css`（842 B）
- `public/css/utils/cbm-calculator.css`（3.2 KB）
- `public/css/utils/modal.css`（2.7 KB）
- `public/css/utils/time-picker.css`（3.3 KB）

### public/js

- `public/js/animations.js`（10.1 KB）
- `public/js/auth.js`（25.6 KB）
- `public/js/chat.js`（1.7 KB）
- `public/js/contours.js`（18.7 KB）
- `public/js/dbviewer.js`（42.8 KB）
- `public/js/main.js`（13.9 KB）
- `public/js/orders.js`（418 B）
- `public/js/pallet.js`（6.1 KB）
- `public/js/skills.js`（1.0 KB）
- `public/js/sli-eli-layout-editor.js`（16.9 KB）
- `public/js/sli-eli-layout-main.js`（10.9 KB）
- `public/js/sli-eli-layout-state.js`（10.7 KB）
- `public/js/theme.js`（5.2 KB）
- `public/js/xls-booking-assign.js`（3.0 KB）
- `public/js/xls-booking-grid.js`（8.6 KB）
- `public/js/xls-booking-preview.js`（16.2 KB）
- `public/js/xls-booking-standard.js`（25.1 KB）
- `public/js/xls-booking-state.js`（7.5 KB）
- `public/js/xls-booking-upload.js`（2.6 KB）
- `public/js/xls-booking-workflow.js`（13.4 KB）

### public/js/orders

- `public/js/orders/api.js`（3.8 KB）
- `public/js/orders/constants.js`（1.3 KB）
- `public/js/orders/formController.js`（53.7 KB）
- `public/js/orders/formatters.js`（14.7 KB）
- `public/js/orders/highlight.js`（1.8 KB）
- `public/js/orders/listController.js`（18.9 KB）
- `public/js/orders/state.js`（3.9 KB）
- `public/js/orders/validation.js`（784 B）

### public/js/orders/components

- `public/js/orders/components/cbmModal.js`（846 B）
- `public/js/orders/components/companyAutocomplete.js`（4.5 KB）
- `public/js/orders/components/companyCard.js`（10.7 KB）
- `public/js/orders/components/duplicateModal.js`（5.6 KB）
- `public/js/orders/components/noteTemplates.js`（10.3 KB）
- `public/js/orders/components/powerItemsEditor.js`（4.5 KB）

### public/js/pallet

- `public/js/pallet/api.js`（5.2 KB）
- `public/js/pallet/bookingModal.js`（13.9 KB）
- `public/js/pallet/bookingsController.js`（12.0 KB）
- `public/js/pallet/dragController.js`（12.0 KB）
- `public/js/pallet/formatters.js`（5.4 KB）
- `public/js/pallet/planActions.js`（17.5 KB）
- `public/js/pallet/planCardRenderer.js`（13.8 KB）
- `public/js/pallet/planDupUtils.js`（1.8 KB）
- `public/js/pallet/planModal.js`（13.8 KB）
- `public/js/pallet/planSorting.js`（2.1 KB）
- `public/js/pallet/plansController.js`（3.7 KB）
- `public/js/pallet/state.js`（4.7 KB）

### public/js/utils

- `public/js/utils/api.js`（2.0 KB）
- `public/js/utils/autocomplete.js`（4.0 KB）
- `public/js/utils/cbm-calculator.js`（7.5 KB）
- `public/js/utils/clipboard-utils.js`（1.5 KB）
- `public/js/utils/datetime-utils.js`（1.4 KB）
- `public/js/utils/hawb-utils.js`（1.8 KB）
- `public/js/utils/mawb-utils.js`（2.3 KB）
- `public/js/utils/modal.js`（3.5 KB）
- `public/js/utils/time-picker.js`（4.6 KB）

### routes

- `routes/contours.js`（3.4 KB）
- `routes/dbviewer.js`（11.4 KB）
- `routes/pallet.js`（35.4 KB）
- `routes/skills.js`（377 B）
- `routes/xls-booking-helpers.js`（5.6 KB）
- `routes/xls-booking-layout.js`（23.8 KB）
- `routes/xls-booking.js`（15.1 KB）

### routes/auth

- `routes/auth/auth-router.js`（13.7 KB）
- `routes/auth/helpers.js`（2.6 KB）
- `routes/auth/middleware.js`（1.7 KB）
- `routes/auth/users-router.js`（16.4 KB）

### routes/orders

- `routes/orders/companies.js`（5.3 KB）
- `routes/orders/index.js`（1.1 KB）
- `routes/orders/note-templates.js`（2.0 KB）
- `routes/orders/orders-router.js`（21.3 KB）
- `routes/orders/utils.js`（7.3 KB）

### scripts

- `scripts/analyze-xls.py`（1.7 KB）
- `scripts/build-sli-eli-blank.py`（41.5 KB）
- `scripts/db-export.js`（5.4 KB）
- `scripts/db-import.js`（3.3 KB）
- `scripts/excel-to-pdf.py`（1.8 KB）
- `scripts/fill-sli-eli.py`（1.6 KB）
- `scripts/fix-nav-order.js`（5.8 KB）
- `scripts/install-hooks.js`（2.9 KB）
- `scripts/merge-pdf.py`（1.5 KB）
- `scripts/pdf-charset.js`（5.9 KB）
- `scripts/pdf-cjk-font.js`（8.4 KB）
- `scripts/seed-admin.js`（2.6 KB）
- `scripts/sli-eli-blank-widen-fonts.js`（12.3 KB）
- `scripts/sli-eli-diff.py`（5.3 KB）
- `scripts/sli-eli-font-optimize.py`（18.8 KB）
- `scripts/sli-eli-generate.py`（15.2 KB）
- `scripts/sli-eli-overlay.js`（41.5 KB）
- `scripts/sync-project-state.js`（6.3 KB）
- `scripts/test-a4-integration.js`（4.5 KB）
- `scripts/test-auth.js`（3.1 KB）
- `scripts/test-cnee-lookup.js`（9.6 KB）
- `scripts/test-customer-isolation.js`（7.0 KB）
- `scripts/test-login-lockout.js`（3.4 KB）
- `scripts/test-nav-hierarchy.js`（7.5 KB）
- `scripts/test-nav-order-frontend.js`（6.6 KB）
- `scripts/test-nav-order.js`（4.3 KB）
- `scripts/test-p4-engine.js`（9.5 KB）
- `scripts/test-pdf-a4.js`（2.7 KB）
- `scripts/test-sli-eli-charset.js`（17.1 KB）
- `scripts/test-sli-eli-layout-frontend.js`（9.7 KB）
- `scripts/test-sli-eli-layout.js`（9.8 KB）
- `scripts/test-sli-eli-overlay.js`（10.7 KB）
- `scripts/test-sli-generate.py`（3.1 KB）
- `scripts/test-xls-preview-formula.js`（6.7 KB）
- `scripts/test-xls-standard-cols.js`（10.5 KB）
- `scripts/test-xls-standard-fields.js`（13.0 KB）
- `scripts/test-zip-naming.js`（5.5 KB）
- `scripts/xls-cnee.js`（4.5 KB）
- `scripts/xls-exceljs-guard.js`（3.4 KB）
- `scripts/xls-report.js`（8.9 KB）
- `scripts/xls-sli-eli.js`（11.9 KB）
- `scripts/xls-utils.js`（9.2 KB）
- `scripts/xls-workflow.js`（39.2 KB）


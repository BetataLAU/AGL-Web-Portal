# FILE_INVENTORY — 專案檔案清單（自動產生）

> ⚠️ 本檔案由 `scripts/sync-project-state.js` 自動產生，**請勿手動編輯**。
> 更新方式：執行 `npm run sync`。
> 最後更新：2026/9/23 下午3:51:52

## 🔄 Git 變更狀態

```
M .clineignore
M .gitignore
M CLAUDE.md
M FILE_INVENTORY.md
M PROJECT_MAP.md
M README.md
M WORKSPACE_STATE.md
M data/templates/shipper-role-summary-2026.xlsx
M db/sessions.db
A  docs/README.md
RM deepseek_text_20260820_ba683e.txt -> docs/archive/uld-packing-prd-v2.txt
RM "AIR FREIGHT 3D ULD PACKING SYSTEM - SPECIFICATION & PROMPT FOR DEEPSEEK.md" -> docs/archive/uld-packing-spec-deepseek.md
RM ORDER_SYSTEM_PLAN.md -> docs/design/order-system-design.md
RM docs/PRD-xls-pdf-parallel.md -> docs/design/xls-pdf-parallel-prd.md
R  scripts/research-output.txt -> docs/research/bpp-research-2026-08-20.txt
R  scripts/github-repos-output.txt -> docs/research/github-repos-2026-08-20.txt
M scripts/fetch-bpp-research.py
M scripts/fetch-github-repos.py
M scripts/sync-project-state.js
```

## 📁 檔案清單（共 175 個檔案）

### (根目錄)

- `.clineignore`（461 B）
- `.gitignore`（578 B）
- `CLAUDE.md`（18.4 KB）
- `Dockerfile`（738 B）
- `PROJECT_MAP.md`（14.7 KB）
- `README.md`（20.2 KB）
- `WORKSPACE_STATE.md`（5.8 KB）
- `package.json`（715 B）
- `server.js`（7.2 KB）

### bp3d

- `bp3d/constraints.js`（8.2 KB）
- `bp3d/extreme-points.js`（9.5 KB）
- `bp3d/ga-lns.js`（5.2 KB）
- `bp3d/geometries.js`（8.3 KB）
- `bp3d/solver.js`（12.6 KB）
- `bp3d/uld-definitions.js`（11.0 KB）

### bp3d/ga-lns

- `bp3d/ga-lns/chromosome.js`（3.9 KB）
- `bp3d/ga-lns/evolve.js`（2.4 KB）
- `bp3d/ga-lns/fitness.js`（6.7 KB）
- `bp3d/ga-lns/init.js`（2.1 KB）
- `bp3d/ga-lns/search.js`（3.5 KB）

### data/templates

- `data/templates/cainiao-sli-eli-template.xlsm`（214.7 KB）
- `data/templates/cainiao-sli-eli-template.xlsx`（93.7 KB）
- `data/templates/shipper-role-summary-2026.xlsx`（541.5 KB）

### db

- `db/database.js`（15.0 KB）
- `db/db-dump.sql`（150.8 KB）

### docs

- `docs/README.md`（2.2 KB）

### docs/archive

- `docs/archive/uld-packing-prd-v2.txt`（19.3 KB）
- `docs/archive/uld-packing-spec-deepseek.md`（4.8 KB）

### docs/design

- `docs/design/order-system-design.md`（9.6 KB）
- `docs/design/xls-pdf-parallel-prd.md`（18.2 KB）

### docs/research

- `docs/research/bpp-research-2026-08-20.txt`（12.3 KB）
- `docs/research/github-repos-2026-08-20.txt`（5.7 KB）

### public

- `public/index.html`（22.0 KB）
- `public/login.html`（8.5 KB）
- `public/packing.html`（7.2 KB）
- `public/uld-packing.html`（14.8 KB）
- `public/users.html`（31.5 KB）

### public/css

- `public/css/animations.css`（4.9 KB）
- `public/css/base.css`（3.8 KB）
- `public/css/components.css`（7.4 KB）
- `public/css/dbviewer.css`（15.6 KB）
- `public/css/layout.css`（16.3 KB）
- `public/css/orders.css`（33.7 KB）
- `public/css/packing.css`（7.8 KB）
- `public/css/pallet.css`（31.9 KB）
- `public/css/uld-packing-3d.css`（1.6 KB）
- `public/css/uld-packing-modal.css`（4.3 KB）
- `public/css/uld-packing-solve.css`（2.1 KB）
- `public/css/uld-packing.css`（9.6 KB）
- `public/css/xls-booking.css`（18.4 KB）

### public/css/utils

- `public/css/utils/autocomplete.css`（842 B）
- `public/css/utils/cbm-calculator.css`（3.2 KB）
- `public/css/utils/modal.css`（2.7 KB）
- `public/css/utils/time-picker.css`（3.3 KB）

### public/js

- `public/js/animations.js`（10.1 KB）
- `public/js/auth.js`（25.4 KB）
- `public/js/chat.js`（1.7 KB）
- `public/js/contours.js`（18.7 KB）
- `public/js/dbviewer.js`（42.8 KB）
- `public/js/main.js`（13.9 KB）
- `public/js/orders.js`（418 B）
- `public/js/pallet.js`（6.1 KB）
- `public/js/skills.js`（1.0 KB）
- `public/js/theme.js`（5.2 KB）
- `public/js/xls-booking-assign.js`（3.0 KB）
- `public/js/xls-booking-grid.js`（8.6 KB）
- `public/js/xls-booking-preview.js`（16.2 KB）
- `public/js/xls-booking-standard.js`（13.1 KB）
- `public/js/xls-booking-state.js`（5.8 KB）
- `public/js/xls-booking-upload.js`（2.6 KB）
- `public/js/xls-booking-workflow.js`（11.1 KB）

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

### public/js/packing

- `public/js/packing/packing-main.js`（17.4 KB）
- `public/js/packing/packing-viewer.js`（14.0 KB）

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

### public/js/uld-packing

- `public/js/uld-packing/calc.js`（2.7 KB）
- `public/js/uld-packing/dragger.js`（12.3 KB）
- `public/js/uld-packing/main.js`（19.5 KB）
- `public/js/uld-packing/project.js`（2.8 KB）
- `public/js/uld-packing/solve-ui.js`（7.6 KB）
- `public/js/uld-packing/state.js`（1.5 KB）
- `public/js/uld-packing/ui.js`（11.2 KB）
- `public/js/uld-packing/viewer-controller.js`（5.5 KB）
- `public/js/uld-packing/viewer.js`（17.8 KB）

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
- `routes/packing-pdf.js`（8.9 KB）
- `routes/packing-projects.js`（17.7 KB）
- `routes/packing-solutions.js`（3.7 KB）
- `routes/packing-solve.js`（6.5 KB）
- `routes/packing.js`（3.5 KB）
- `routes/pallet.js`（35.4 KB）
- `routes/skills.js`（377 B）
- `routes/xls-booking-helpers.js`（5.2 KB）
- `routes/xls-booking.js`（13.7 KB）

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
- `scripts/cleanup-test-data.js`（1.1 KB）
- `scripts/db-export.js`（5.4 KB）
- `scripts/db-import.js`（3.3 KB）
- `scripts/excel-to-pdf.py`（1.8 KB）
- `scripts/fetch-bpp-research.py`（5.5 KB）
- `scripts/fetch-github-repos.py`（1.6 KB）
- `scripts/fill-sli-eli.py`（1.6 KB）
- `scripts/fix-nav-order.js`（4.4 KB）
- `scripts/generate-dummy-orders.js`（14.3 KB）
- `scripts/install-hooks.js`（2.9 KB）
- `scripts/merge-pdf.py`（1.5 KB）
- `scripts/seed-admin.js`（2.6 KB）
- `scripts/sli-eli-generate.py`（7.2 KB）
- `scripts/solve-worker.js`（1.1 KB）
- `scripts/sync-project-state.js`（6.3 KB）
- `scripts/test-auth.js`（3.1 KB）
- `scripts/test-bp3d.js`（14.3 KB）
- `scripts/test-cnee-lookup.js`（9.4 KB）
- `scripts/test-customer-isolation.js`（7.0 KB）
- `scripts/test-galms.js`（8.0 KB）
- `scripts/test-login-lockout.js`（3.4 KB）
- `scripts/test-nav-order-frontend.js`（6.7 KB）
- `scripts/test-nav-order.js`（4.3 KB）
- `scripts/test-openpyxl-bridge.py`（1.3 KB）
- `scripts/test-packing-api.js`（5.7 KB）
- `scripts/test-packing-projects.js`（7.1 KB）
- `scripts/test-q7-api.js`（2.6 KB）
- `scripts/test-sli-generate.py`（1.6 KB）
- `scripts/test-xls-workflow.js`（4.6 KB）
- `scripts/verify-dummy-orders.js`（3.8 KB）
- `scripts/verify-import.js`（1.3 KB）
- `scripts/xls-cnee.js`（4.5 KB）
- `scripts/xls-report.js`（8.9 KB）
- `scripts/xls-sli-eli.js`（8.3 KB）
- `scripts/xls-utils.js`（5.1 KB）
- `scripts/xls-workflow.js`（23.4 KB）

### utils

- `utils/color-assigner.js`（3.5 KB）


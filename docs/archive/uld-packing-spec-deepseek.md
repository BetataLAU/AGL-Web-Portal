# AIR FREIGHT 3D ULD PACKING SYSTEM - SPECIFICATION & PROMPT FOR DEEPSEEK

## 1. System Overview
Build a Web Application for **Air Freight ULD (Unit Load Device) 3D Cargo Packing & Spatial Optimization**.
The app will take an input cargo list, automatically calculate an optimized 3D layout considering air-cargo-specific physical & safety constraints, and render an interactive 3D step-by-step loading plan on the browser.

---

## 2. Core Constraints & Physics Logic

The solver engine MUST support and validate the following constraints:

1. **Air Freight ULD Geometries & Contours:**
   - **Rectangular ULDs:** Standard dimensions for lower/main deck pallets.
   - **Cut-off Corner / Tilted ULDs (e.g., AKE / LD3):** Asymmetric bottom/side slants.
   - **Contour Profiles (e.g., PMC with Q6/Q7 Contour):** Top or lateral clearance limits.
   - **Net Clearance Margin:** Safety offset ($20\text{--}50\text{ mm}$) along the ULD boundaries for netting and tie-down straps.

2. **Cargo Packing Constraints:**
   - **Orientation Control:** Flags per cargo (`allow_rotation_x`, `allow_rotation_y`, `allow_rotation_z`, `must_stay_upright`).
   - **Stackability:** Flags (`is_stackable: boolean`, `max_stack_weight`).
   - **Heavy-First (Weight Distribution):** Heavier/denser cargo placed at lower levels to protect lighter goods.
   - **Bottom Support Ratio:** A minimum of $70\%\text{--}80\%$ of a cargo's bottom area must rest on the floor or on another item's top face (no floating cargo).

3. **Weight & Balance Limits:**
   - **Maximum Gross Weight:** Total cargo weight $\le \text{ULD Payload limit}$.
   - **Floor Load Limit:** Weight per unit area $\le \text{Max Floor Pressure } (\text{kg/m}^2)$.
   - **Center of Gravity (CoG):** Total cargo CoG along X/Y axes must remain within $\pm 10\%$ of the ULD geometry center.

---

## 3. Technology Stack Requirements

- **Frontend:**
  - Framework: React.js or Vue.js (TypeScript preferred) + Tailwind CSS.
  - 3D Engine: **Three.js** (WebGL).
  - Excel Processing: `xlsx` / `papaparse` for file parsing.
- **Backend (API / Solver Engine):**
  - Framework: Python 3.10+ (**FastAPI**).
  - Algorithm Base: Extended 3D-BPP (e.g., modified `py3dbp` or custom Extreme Point / Space Splitting Heuristics).
  - Geometry Check: Fast 3D Vertex-Plane & Boundary Inequality checks for ULD contours.
- **Communication:** RESTful JSON API.

---

## 4. Geometry & Collision Detection Specification

### A. AKE (LD3) Profile Model
Represent AKE $Y\text{-}Z$ cross-section as an Extruded Polygon along the $X$-axis:
- $W_{\text{bottom}} = 1562\text{ mm}$, $W_{\text{top}} = 2007\text{ mm}$, $H_{\text{total}} = 1600\text{ mm}$, $H_{\text{tilt}} = 410\text{ mm}$, $L = 1534\text{ mm}$.

### B. Boundary & Collision Checks
1. **Cargo-to-Cargo Intersect:** Axis-Aligned Bounding Box (AABB) overlap check.
2. **Cargo-to-Contour Intersection:**
   - Define all ULD angled boundary faces as 3D Plane Equations: $A \cdot x + B \cdot y + C \cdot z + D \le 0$.
   - A candidate cargo placement $(x, y, z, l, w, h)$ is **valid** if and only if ALL **8 vertices** satisfy every ULD boundary plane equation.

---

## 5. Software Architecture & API Data Schema

### `POST /api/v1/pack-uld`

#### Request Payload (JSON)
```json
{
  "uld_spec": {
    "type": "AKE",
    "contour_type": "LD3_STANDARD",
    "max_weight_kg": 1588,
    "max_floor_pressure_kg_m2": 1000,
    "net_clearance_mm": 30
  },
  "cargo_list": [
    {
      "id": "PKG-001",
      "length_mm": 500,
      "width_mm": 400,
      "height_mm": 300,
      "weight_kg": 12.5,
      "quantity": 10,
      "is_stackable": true,
      "allow_tilt": false
    }
  ]
}
```

---

## 6. 實作對照（2026-09-23 補記）

本文件為 2026-08-20 交給 DeepSeek 的**一次性開發規格 prompt**（歷史文件），實際落地時技術棧與範圍已不同，保留作需求來源。

| 本文規格 | 實際實作 |
|----------|----------|
| 後端 Python 3.10+ / FastAPI + 3D-BPP 演算法 | 無獨立後端服務：Node.js `bp3d/` 引擎（`geometries` / `uld-definitions` / `constraints` / `extreme-points` / `solver`）+ `bp3d/ga-lns/`（GA-LNS 啟發式） |
| 前端 React / Vue + TypeScript + Tailwind | 原生 JS + HTML + CSS（無框架、無 build step）：`public/packing.html`、`public/js/packing/`、`public/js/uld-packing/` |
| 3D 引擎 Three.js | 同樣使用 Three.js |
| API `POST /api/v1/pack-uld` | `POST /api/packing/pack-uld`（另有 `packing-projects` / `packing-solutions` / `packing-pdf` / `pallet` 系列，皆需登入） |
| 約束：支撐率 70–80%、CoG ±10%、Net Clearance 20–50mm | 已實作：預設支撐率 70%、CoG ±10%、Net Clearance 30mm（可用 API options 調整） |

> 現行說明請見根目錄 `README.md`、`PROJECT_MAP.md` §3.5 與 `CLAUDE.md`。
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
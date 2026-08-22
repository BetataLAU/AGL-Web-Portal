/**
 * public/js/uld-packing/dragger.js
 * 3D 貨物拖拽引擎：選取、水平拖拽（XY 平面）、磁吸吸附、碰撞回彈。
 *
 * 座標轉換：
 *   three（X,Y,Z）= bp3d（X=深度, Y=寬度, Z=高度）的映射
 *     three.x = data.x + data.l/2 - uld.l/2 + uldCenterX
 *     three.z = data.y + data.w/2 - uld.w/2
 *     three.y = data.z + data.h/2
 *   反向轉換供存檔。
 */
(function (global) {
  'use strict';

  const SNAP_DISTANCE_MM = 20; // 2cm 磁吸距離

  class UldDragController {
    /**
     * @param {object} viewer UldPackingViewer 實例
     * @param {object} opts { onDragStart, onDragEnd, onDragChange }
     */
    constructor(viewer, opts = {}) {
      this.viewer = viewer;
      this.opts = opts;
      this.enabled = false;
      this.dragging = null; // { mesh, item, offsetX, offsetZ, origX, origZ }
      this.overlapping = []; // 重疊中的 mesh

      // 綁定指標事件
      this._onPointerDown = this._onPointerDown.bind(this);
      this._onPointerMove = this._onPointerMove.bind(this);
      this._onPointerUp = this._onPointerUp.bind(this);

      this._attach();
    }

    _attach() {
      const canvas = this.viewer.renderer.domElement;
      canvas.addEventListener('pointerdown', this._onPointerDown);
      canvas.addEventListener('pointermove', this._onPointerMove);
      canvas.addEventListener('pointerup', this._onPointerUp);
    }

    setEnabled(on) {
      this.enabled = on;
      if (!on && this.dragging) {
        this._endDrag();
      }
      this.viewer.renderer.domElement.style.cursor = on ? 'grab' : 'default';
      this.viewer.controls.enabled = !on;
    }

    // ===== 指標事件 =====
    _onPointerDown(e) {
      if (!this.enabled || this.dragging) return;

      const hit = this._raycast(e);
      if (!hit) return;
      const mesh = hit.object;

      // 找出對應 cargo（含 three 座標）
      const cargo = this.viewer.cargoMeshes.find((c) => c.mesh === mesh);
      if (!cargo) return;

      // 記錄拖拽起點
      const item = cargo.item;
      const uld = this._findUld(item.uldId);
      const uldCenter = this._findUldCenter(item.uldId);
      const offsetX = mesh.position.x - e.offsetXInScene;
      // 使用 camera plane 計算拖拽位移
      this.dragging = {
        mesh,
        cargo,
        item,
        uld,
        uldCenter,
        pointerStart: { clientX: e.clientX, clientY: e.clientY },
        posStart: mesh.position.clone(),
      };

      this.viewer.renderer.domElement.style.cursor = 'grabbing';
      // 半透明化其他貨物
      this.viewer.cargoMeshes.forEach((c) => {
        if (c.mesh !== mesh) {
          c.mesh.material.opacity = 0.35;
          c.mesh.userData._dragDimmed = true;
        }
      });

      if (this.opts.onDragStart) this.opts.onDragStart(item);
    }

    _onPointerMove(e) {
      if (!this.enabled || !this.dragging) return;

      // 依相機平面計算位移
      const rect = this.viewer.renderer.domElement.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const vec = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(this.viewer.camera);
      const dir = vec.sub(this.viewer.camera.position).normalize();

      // 與水平面（y = 貨物高度中心）求交
      const planeY = this.dragging.posStart.y;
      const t = (planeY - this.viewer.camera.position.y) / dir.y;
      if (t <= 0) return;
      const worldHit = this.viewer.camera.position.clone().add(dir.clone().multiplyScalar(t));

      // 新位置（three XZ = 資料 XY）
      const newX = worldHit.x;
      const newZ = worldHit.z;

      // 範圍限制（不可超出 ULD 底部水平範圍）
      const uld = this.dragging.uld;
      const uldCenter = this.dragging.uldCenter;
      const item = this.dragging.item;
      const minX = uldCenter - uld.l / 2 + item.l / 2;
      const maxX = uldCenter + uld.l / 2 - item.l / 2;
      const minZ = -uld.w / 2 + item.w / 2;
      const maxZ = uld.w / 2 - item.w / 2;

      let x = Math.max(minX, Math.min(maxX, newX));
      let z = Math.max(minZ, Math.min(maxZ, newZ));

      // 磁吸吸附（與其他貨物邊界）
      const snapped = this._snap(x, z, item, this.dragging.uldId);
      if (snapped) {
        x = snapped.x;
        z = snapped.z;
      }

      // 碰撞檢查
      const overlaps = this._checkOverlap(x, z, item, this.dragging.uldId);
      this.overlapping = overlaps;
      this.dragging.mesh.position.set(x, this.dragging.posStart.y, z);

      // 視覺：重疊時半透明紅
      const mat = this.dragging.mesh.material;
      if (overlaps.length > 0) {
        mat.color.set(0xef4444);
        mat.opacity = 0.5;
      } else {
        mat.color.set(this.dragging.cargo.mesh.userData._origColor || 0x38bdf8);
        mat.opacity = 0.92;
      }

      if (this.opts.onDragChange) {
        // 回報 bp3d 座標
        const bp = this._threeToBp(x, z, this.dragging.posStart.y, item, this.dragging.uld, this.dragging.uldCenter);
        this.opts.onDragChange(bp, overlaps.length > 0);
      }
    }

    _onPointerUp() {
      if (!this.dragging) return;

      const wasOverlapping = this.overlapping.length > 0;

      // 還原其他貨物透明度
      this.viewer.cargoMeshes.forEach((c) => {
        if (c.mesh.userData._dragDimmed) {
          c.mesh.material.opacity = 0.92;
          c.mesh.userData._dragDimmed = false;
        }
      });

      if (wasOverlapping) {
        // 碰撞 → 彈回原位
        this.dragging.mesh.position.copy(this.dragging.posStart);
        this.dragging.mesh.material.color.set(this.dragging.cargo.mesh.userData._origColor || 0x38bdf8);
        this.dragging.mesh.material.opacity = 0.92;
      }

      const finalBp = this._threeToBp(
        this.dragging.mesh.position.x,
        this.dragging.mesh.position.z,
        this.dragging.mesh.position.y,
        this.dragging.item,
        this.dragging.uld,
        this.dragging.uldCenter
      );

      const item = this.dragging.item;
      const moved = !this.dragging.mesh.position.equals(this.dragging.posStart);

      if (this.opts.onDragEnd) {
        this.opts.onDragEnd(item, finalBp, !wasOverlapping && moved);
      }

      this.dragging = null;
      this.overlapping = [];
      this.viewer.renderer.domElement.style.cursor = this.enabled ? 'grab' : 'default';
    }

    // ===== 工具 =====
    _raycast(e) {
      const rect = this.viewer.renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.viewer.camera);

      // 放大碰撞體 8%（Raycaster 精準度優化；用較大 box 近似）
      const meshes = this.viewer.cargoMeshes.map((c) => {
        const m = c.mesh;
        const origScale = m.scale.x;
        m.scale.setScalar(1.08);
        return m;
      });
      const hits = raycaster.intersectObjects(meshes, false);
      // 還原 scale
      this.viewer.cargoMeshes.forEach((c) => c.mesh.scale.set(1, 1, 1));
      return hits.length > 0 ? hits[0] : null;
    }

    _findUld(uldId) {
      const sol = this.viewer.solution;
      const uld = this.viewer.uldInfos && this.viewer.uldInfos.find((u) => u.id === uldId);
      if (uld) return { l: uld.l, w: uld.w };
      return { l: 3175, w: 2438 };
    }

    _findUldCenter(uldId) {
      // 由 renderProject 時的排列重算
      const ulds = this.viewer.uldInfos || [];
      const totalL = ulds.reduce((s, u) => s + u.l, 0);
      const gap = 800;
      const total = totalL + (ulds.length - 1) * gap;
      let offset = -total / 2;
      for (const u of ulds) {
        const center = offset + u.l / 2;
        if (u.id === uldId) return center;
        offset += u.l + gap;
      }
      return 0;
    }

    /** 磁吸：與其他貨物與 ULD 邊界的距離 <2cm 時吸附 */
    _snap(x, z, item, uldId) {
      let best = null;
      let bestDist = SNAP_DISTANCE_MM;

      const myLeft = x - item.l / 2;
      const myRight = x + item.l / 2;
      const myFront = z - item.w / 2;
      const myBack = z + item.w / 2;

      // 與 ULD 邊界
      const uld = this._findUld(uldId);
      const uldCenter = this._findUldCenter(uldId);
      const candidatesL = [
        { d: myRight - (uldCenter + uld.l / 2), axis: 'x', sign: 1 },  // 右超
        { d: (uldCenter - uld.l / 2) - myLeft, axis: 'x', sign: -1 },  // 左超
        { d: myBack - uld.w / 2, axis: 'z', sign: 1 },
        { d: -uld.w / 2 - myFront, axis: 'z', sign: -1 },
      ];
      for (const c of candidatesL) {
        if (c.d > 0 && c.d < bestDist) {
          bestDist = c.d;
          best = { axis: c.axis, dir: c.sign };
        }
      }

      // 與其他貨物邊界
      this.viewer.cargoMeshes.forEach((c) => {
        if (c.uldId !== uldId) return;
        if (c.mesh === this.dragging.mesh) return;
        const o = c.item;
        const ox = c.mesh.position.x;
        const oz = c.mesh.position.z;
        const oLeft = ox - o.l / 2;
        const oRight = ox + o.l / 2;
        const oFront = oz - o.w / 2;
        const oBack = oz + o.w / 2;

        // X 向吸附（我的右緣 → 他左緣 或 我左緣 → 他右緣）
        const dxRight = myRight - oLeft; const dxLeft = myLeft - oRight;
        // Z 向吸附（我後緣 → 他前緣 或 我前緣 → 他後緣）
        const dzBack = myBack - oFront; const dzFront = myFront - oBack;

        if (Math.abs(dxRight) < bestDist) { bestDist = Math.abs(dxRight); best = { axis: 'x', dir: 1, val: oLeft - item.l / 2 }; }
        if (Math.abs(dxLeft) < bestDist) { bestDist = Math.abs(dxLeft); best = { axis: 'x', dir: -1, val: oRight + item.l / 2 }; }
        if (Math.abs(dzBack) < bestDist) { bestDist = Math.abs(dzBack); best = { axis: 'z', dir: 1, val: oFront - item.w / 2 }; }
        if (Math.abs(dzFront) < bestDist) { bestDist = Math.abs(dzFront); best = { axis: 'z', dir: -1, val: oBack + item.w / 2 }; }
      });

      if (!best) return null;

      // 套用吸附（only 吸附最接近的軸）
      let nx = x;
      let nz = z;
      if (best.axis === 'x' && best.val !== undefined) nx = best.val;
      if (best.axis === 'z' && best.val !== undefined) nz = best.val;

      // 再次限制在 ULD 內
      const minX = uldCenter - uld.l / 2 + item.l / 2;
      const maxX = uldCenter + uld.l / 2 - item.l / 2;
      const minZ = -uld.w / 2 + item.w / 2;
      const maxZ = uld.w / 2 - item.w / 2;
      nx = Math.max(minX, Math.min(maxX, nx));
      nz = Math.max(minZ, Math.min(maxZ, nz));

      return { x: nx, z: nz };
    }

    /** 碰撞檢查：與同 ULD 其他貨物在 XYZ 均重疊 */
    _checkOverlap(x, z, item, uldId) {
      const results = [];
      this.viewer.cargoMeshes.forEach((c) => {
        if (c.uldId !== uldId || c.mesh === this.dragging.mesh) return;
        const o = c.item;
        const ox = c.mesh.position.x;
        const oz = c.mesh.position.z;
        // 同 z 層才檢查（水平拖拽不變更高度）
        const sameLayer = Math.abs(c.mesh.position.y - this.dragging.mesh.position.y) < 1;
        if (!sameLayer) return;

        const overlapX = Math.min(x + item.l / 2, ox + o.l / 2) > Math.max(x - item.l / 2, ox - o.l / 2);
        const overlapZ = Math.min(z + item.w / 2, oz + o.w / 2) > Math.max(z - item.w / 2, oz - o.w / 2);
        if (overlapX && overlapZ) results.push(c);
      });
      return results;
    }

    /** three (x,z,y) → bp3d (x, y, z) */
    _threeToBp(tx, tz, ty, item, uld, uldCenter) {
      return {
        x: tx - item.l / 2 + uld.l / 2 - uldCenter,
        y: tz - item.w / 2 + uld.w / 2,
        z: ty - item.h / 2,
      };
    }

    destroy() {
      const canvas = this.viewer.renderer.domElement;
      canvas.removeEventListener('pointerdown', this._onPointerDown);
      canvas.removeEventListener('pointermove', this._onPointerMove);
      canvas.removeEventListener('pointerup', this._onPointerUp);
    }
  }

  global.UldDragController = UldDragController;
})(window);
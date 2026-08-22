/**
 * public/js/uld-packing/viewer.js
 * 多 ULD 3D 渲染器：顯示專案所有 ULD 與 GA-LNS 產生的方案。
 *
 * 座標（與 bp3d 相同）：內部資料 X=深度、Y=寬度、Z=高度、原點=ULD底部中心
 * Three.js 映射：three.x = data.x + data.l/2 - uld.l/2；three.y = data.z + data.h/2；three.z = data.y + data.w/2 - uld.w/2
 * 多 ULD 排列：沿 Three.js X 軸（深度方向）等距排列，間距 = ULD 寬度 + 500mm
 */
(function (global) {
  'use strict';

  const CUSTOMER_COLORS = {}; // customerId -> color
  const ULD_GAP = 800; // 多 ULD 之間距（mm）

  class UldPackingViewer {
    constructor(container) {
      this.container = container;
      this.scene = null;
      this.camera = null;
      this.renderer = null;
      this.controls = null;
      this.rootGroup = null;
      this.cargoMeshes = [];
      this.uldTotalWidth = 0;
      this.animation = { step: 0, playing: false, timer: null, speed: 1 };
      this.tooltip = null;
      this.filter = null; // 'size' | 'weight' | 'custom'
      this.onCargoClick = null;

      this._init();
      this._onResize = this._onResize.bind(this);
      window.addEventListener('resize', this._onResize);
    }

    _init() {
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0b1120);

      const w = this.container.clientWidth || 900;
      const h = this.container.clientHeight || 600;
      this.camera = new THREE.PerspectiveCamera(50, w / h, 1, 50000);
      this.camera.position.set(4000, 3500, 6000);

      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.renderer.setSize(w, h);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.container.appendChild(this.renderer.domElement);

      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.15;

      // 燈光
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(4000, 6000, 3000);
      this.scene.add(dir);
      const dir2 = new THREE.DirectionalLight(0x88aaff, 0.3);
      dir2.position.set(-3000, 1000, -4000);
      this.scene.add(dir2);

      // 地面網格
      const grid = new THREE.GridHelper(12000, 40, 0x334155, 0x1e293b);
      grid.position.y = -2;
      this.scene.add(grid);

      // 視窗內 tooltip
      this.tooltip = document.createElement('div');
      this.tooltip.className = 'up3d-tooltip';
      this.tooltip.style.display = 'none';
      document.body.appendChild(this.tooltip);

      this._loop();
    }

    _loop() {
      requestAnimationFrame(() => this._loop());
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    }

    _onResize() {
      const w = this.container.clientWidth || 900;
      const h = this.container.clientHeight || 600;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }

    /**
     * 渲染多 ULD 場景（從專案資料建立）。
     * @param {object} project 專案（ulds + customers）
     * @param {object} solution GA-LNS 方案（可選；null = 只顯示 ULD）
     */
    renderProject(project, solution) {
      this.clear();

      // 快照供拖拽控制器使用
      this.uldInfos = (project.ulds || []).map((u) => ({
        id: u.id,
        l: u.l || 3175,
        w: u.w || 2438,
        h: u.h || 3000,
      }));
      this.solution = solution;

      // 建立客戶色卡對照
      if (project.customers) {
        project.customers.forEach((c) => { CUSTOMER_COLORS[c.id] = c.color_code || '#94a3b8'; });
      }

      const ulds = project.ulds || [];
      if (ulds.length === 0) return;

      this.rootGroup = new THREE.Group();
      const totalL = ulds.reduce((sum, u) => sum + (u.l || 3000), 0);
      const gapCount = ulds.length - 1;
      this.uldTotalWidth = totalL + gapCount * ULD_GAP;
      let offsetX = -this.uldTotalWidth / 2;

      ulds.forEach((uld, ui) => {
        const uldCenter = offsetX + (uld.l || 3000) / 2;
        const group = new THREE.Group();
        group.position.x = uldCenter;
        this._buildUldLines(group, uld);
        this.rootGroup.add(group);
        offsetX += (uld.l || 3000) + ULD_GAP;
      });

      this.scene.add(this.rootGroup);

      // 方案貨物
      if (solution && solution.placedItems) {
        const itemsByUld = {};
        solution.placedItems.forEach((p) => {
          if (!itemsByUld[p.uldId]) itemsByUld[p.uldId] = [];
          itemsByUld[p.uldId].push(p);
        });

        let offset = -this.uldTotalWidth / 2;
        ulds.forEach((uld) => {
          const list = itemsByUld[uld.id] || [];
          const uldCenter = offset + (uld.l || 3000) / 2;
          list.forEach((p) => {
            const mesh = this._buildCargoMesh(p, uld, uldCenter);
            this.scene.add(mesh);
            this.cargoMeshes.push({ mesh, item: p, uldId: uld.id });
          });
          offset += (uld.l || 3000) + ULD_GAP;
        });
      }

      this._addInteractions();
      this.setView3D();
      this._updateFilter();
    }

    /** 建立 ULD 線框（深藍底面/橙頂部/橙紅虛線斜線） */
    _buildUldLines(group, uld) {
      const l = uld.l || 3000;
      const w = uld.w || 2438;
      const h = uld.h || 3000;
      const cfg = uld.contour_config || {};

      // 矩形箱體（簡化：斜切 ULD 僅以矩形框顯示 + 頂部標記線）
      const geo = new THREE.BoxGeometry(l, h, w);
      const edges = new THREE.EdgesGeometry(geo);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x1a5276 });
      const line = new THREE.LineSegments(edges, lineMat);
      line.position.y = h / 2;
      group.add(line);

      // 半透明箱體
      const boxMat = new THREE.MeshBasicMaterial({
        color: 0x1a5276,
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
      });
      const box = new THREE.Mesh(geo, boxMat);
      box.position.y = h / 2;
      group.add(box);

      // 底部輪廓（深藍實線，3px 感）
      const bottomPts = [
        new THREE.Vector3(-l / 2, 0, -w / 2),
        new THREE.Vector3(l / 2, 0, -w / 2),
        new THREE.Vector3(l / 2, 0, w / 2),
        new THREE.Vector3(-l / 2, 0, w / 2),
        new THREE.Vector3(-l / 2, 0, -w / 2),
      ];
      const bottomGeo = new THREE.BufferGeometry().setFromPoints(bottomPts);
      const bottomMat = new THREE.LineBasicMaterial({ color: 0x1a5276 });
      group.add(new THREE.Line(bottomGeo, bottomMat));

      // 頂部輪廓（橙色實線）
      const topPts = [
        new THREE.Vector3(-l / 2, h, -w / 2),
        new THREE.Vector3(l / 2, h, -w / 2),
        new THREE.Vector3(l / 2, h, w / 2),
        new THREE.Vector3(-l / 2, h, w / 2),
        new THREE.Vector3(-l / 2, h, -w / 2),
      ];
      const topGeo = new THREE.BufferGeometry().setFromPoints(topPts);
      const topMat = new THREE.LineBasicMaterial({ color: 0xe67e22 });
      group.add(new THREE.Line(topGeo, topMat));

      // 若為斜切 ULD：畫橙色斜線（由側面輪廓近似）
      if (cfg.profileKey) {
        this._buildContourSideLines(group, l, w, h, cfg);
      }

      // 尺寸標註最上方
      const dim = `${(l / 1000).toFixed(2)}m × ${(w / 1000).toFixed(2)}m × ${(h / 1000).toFixed(2)}m`;
      const label = this._makeLabel(dim, '#e67e22');
      label.position.set(0, h + 150, 0);
      group.add(label);
    }

    /** 斜切面虛線標示 */
    _buildContourSideLines(group, l, w, h, cfg) {
      const profile = this._guessProfile(cfg, w, h);
      if (!profile) return;

      const pts = [];
      for (const [y, z] of profile) {
        pts.push(new THREE.Vector3(-l / 2, z, y - w / 2));
        pts.push(new THREE.Vector3(l / 2, z, y - w / 2));
        pts.push(new THREE.Vector3(l / 2, z, y - w / 2));
      }
      // 斜切段（非底部/頂部的斜邊）
      const slashMat = new THREE.LineDashedMaterial({
        color: 0xd35400,
        dashSize: 30,
        gapSize: 20,
        linewidth: 1,
      });
      const n = profile.length;
      for (let i = 0; i < n; i++) {
        const [y1, z1] = profile[i];
        const [y2, z2] = profile[(i + 1) % n];
        // 只在斜邊（z 不同）畫
        if (Math.abs(z1 - z2) > 10) {
          const segGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-l / 2, z1, y1 - w / 2),
            new THREE.Vector3(-l / 2, z2, y2 - w / 2),
            new THREE.Vector3(l / 2, z2, y2 - w / 2),
            new THREE.Vector3(l / 2, z1, y1 - w / 2),
          ]);
          const seg = new THREE.Line(segGeo, slashMat);
          seg.computeLineDistances();
          group.add(seg);
        }
      }
    }

    /** 由 contour_config 預估側面輪廓（mm→數值直接使用） */
    _guessProfile(cfg, w, h) {
      if (!cfg.baseW || !cfg.maxHeightMm) return null;
      // 使用 bp3d profileKey 的頂點（y 為 mm，原點於 ULD 中心）
      try {
        const stored = global.PROFILE_CACHE && global.PROFILE_CACHE[cfg.profileKey];
        if (stored) return stored;
      } catch (e) { /* ignore */ }
      return null;
    }

    /** 建立貨物 mesh */
    _buildCargoMesh(item, uld, uldCenter) {
      const color = CUSTOMER_COLORS[item.customerId] || '#38bdf8';
      const c = new THREE.Color(color);
      const geo = new THREE.BoxGeometry(item.l, item.h, item.w);
      const mat = new THREE.MeshPhongMaterial({
        color: c,
        transparent: true,
        opacity: 0.92,
        specular: 0x333333,
        shininess: 18,
      });
      const mesh = new THREE.Mesh(geo, mat);

      // three 座標（含 ULD 偏移）
      const x = uldCenter + item.x + item.l / 2 - uld.l / 2;
      const y = item.z + item.h / 2;
      const z = item.y + item.w / 2 - uld.w / 2;
      mesh.position.set(x, y, z);

      // 邊框
      const edges = new THREE.EdgesGeometry(geo);
      const edgeMat = new THREE.LineBasicMaterial({ color: 0x0f172a });
      const edgeLine = new THREE.LineSegments(edges, edgeMat);
      mesh.add(edgeLine);

      mesh.userData = {
        id: item.id,
        customerId: item.customerId,
        l: item.l, w: item.w, h: item.h,
        weightKg: item.weightKg,
        uldId: item.uldId,
        baseY: y,
      };
      mesh.userData._origColor = c.getHex();

      return mesh;
    }

    /** 建立文字標籤（canvas 紋理） */
    _makeLabel(text, color) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 512, 64);
      ctx.font = 'bold 28px Arial';
      ctx.textAlign = 'center';
      ctx.fillStyle = color || '#ffffff';
      ctx.fillText(text, 256, 42);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(1200, 150, 1);
      return sprite;
    }

    // ===== 互動 =====
    _addInteractions() {
      const canvas = this.renderer.domElement;

      // 滑鼠移動 → tooltip
      canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));

      // 點擊 → 顯示詳情
      canvas.addEventListener('click', (e) => {
        const hit = this._raycast(e);
        if (hit && this.onCargoClick) {
          this.onCargoClick(hit.userData);
        }
      });
    }

    _raycast(e) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.camera);
      const meshes = this.cargoMeshes.map((c) => c.mesh);
      const hits = raycaster.intersectObjects(meshes, false);
      return hits.length > 0 ? hits[0].object : null;
    }

    _onPointerMove(e) {
      const hit = this._raycast(e);
      if (hit) {
        const d = hit.userData;
        this.tooltip.style.display = 'block';
        this.tooltip.style.left = `${e.clientX + 14}px`;
        this.tooltip.style.top = `${e.clientY + 10}px`;
        this.tooltip.innerHTML = `
          <div class="tt-title">📦 ${d.id}</div>
          <div>尺寸: ${(d.l / 10).toFixed(0)}×${(d.w / 10).toFixed(0)}×${(d.h / 10).toFixed(0)} cm</div>
          <div>重量: ${d.weightKg} kg</div>`;
        this.renderer.domElement.style.cursor = 'pointer';
      } else {
        this.tooltip.style.display = 'none';
        this.renderer.domElement.style.cursor = 'default';
      }
    }

    /** 透視濾鏡：尺寸/重量/客戶 標籤 */
    setFilter(mode) {
      this.filter = mode;
      this._updateFilter();
    }

    _updateFilter() {
      if (!this.filter) {
        // 移除既有標籤（sphere sprites 由 cargoMeshes 附屬時另行處理）
        this.cargoMeshes.forEach((c) => {
          if (c.mesh.userData._labelSprite) {
            c.mesh.remove(c.mesh.userData._labelSprite);
            c.mesh.userData._labelSprite = null;
          }
        });
        return;
      }
      this.cargoMeshes.forEach((c) => {
        const d = c.mesh.userData;
        let text = '';
        if (this.filter === 'size') text = `${(d.l / 10).toFixed(0)}×${(d.w / 10).toFixed(0)}×${(d.h / 10).toFixed(0)}`;
        else if (this.filter === 'weight') text = `${d.weightKg}kg`;
        else if (this.filter === 'custom') text = `C${d.customerId}`;

        if (c.mesh.userData._labelSprite) {
          c.mesh.remove(c.mesh.userData._labelSprite);
        }
        const sprite = this._makeLabel(text, '#ffffff');
        sprite.position.set(0, d.h / 2 + 150, 0);
        sprite.scale.set(700, 90, 1);
        c.mesh.add(sprite);
        c.mesh.userData._labelSprite = sprite;
      });
    }

    // ===== 動畫（組裝流程） =====
    play() {
      if (this.cargoMeshes.length === 0 || this.animation.playing) return;
      this.animation.playing = true;
      this.animation.step = 0;
      this._playLoop();
    }

    _playLoop() {
      if (!this.animation.playing) return;
      const cargo = this.cargoMeshes[this.animation.step];
      if (cargo) {
        cargo.mesh.material.opacity = 0.3;
        const reveal = () => {
          cargo.mesh.material.opacity = 0.92;
          this.animation.step++;
          if (this.animation.step >= this.cargoMeshes.length) {
            this.animation.playing = false;
            if (this.onStepChange) this.onStepChange(-1);
            return;
          }
          this.animation.timer = setTimeout(this._playLoop.bind(this), 400 / this.animation.speed);
        };
        this.animation.timer = setTimeout(reveal, 400 / this.animation.speed);
      }
    }

    pause() {
      this.animation.playing = false;
      if (this.animation.timer) clearTimeout(this.animation.timer);
    }

    stepForward() {
      if (this.animation.step < this.cargoMeshes.length) {
        const cargo = this.cargoMeshes[this.animation.step];
        cargo.mesh.material.opacity = 0.92;
        this.animation.step++;
        if (this.onStepChange) this.onStepChange(this.animation.step);
      }
    }

    stepBackward() {
      if (this.animation.step > 0) {
        this.animation.step--;
        const cargo = this.cargoMeshes[this.animation.step];
        cargo.mesh.material.opacity = 0.3;
        if (this.onStepChange) this.onStepChange(this.animation.step);
      }
    }

    resetAnimation() {
      this.animation.playing = false;
      if (this.animation.timer) clearTimeout(this.animation.timer);
      this.animation.step = 0;
      this.cargoMeshes.forEach((c) => { c.mesh.material.opacity = 0.92; });
      if (this.onStepChange) this.onStepChange(-1);
    }

    /** 爆炸視圖：沿 Y 軸分離所有貨物 */
    explode() {
      this.cargoMeshes.forEach((c) => {
        c.mesh.position.y = c.mesh.userData.baseY + 800;
      });
    }

    restorePositions() {
      this.cargoMeshes.forEach((c) => {
        c.mesh.position.y = c.mesh.userData.baseY;
      });
    }

    // ===== 視角 =====
    setView3D() {
      this.camera.position.set(this.uldTotalWidth * 0.9, 3500, 6000);
      this.controls.target.set(0, 1000, 0);
      this.controls.update();
    }

    setViewTop() {
      this.camera.position.set(0, 10000, 0);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }

    setViewSide() {
      this.camera.position.set(0, 2000, this.uldTotalWidth * 0.9);
      this.controls.target.set(0, 1000, 0);
      this.controls.update();
    }

    clear() {
      if (this.rootGroup) {
        this.scene.remove(this.rootGroup);
        this.rootGroup = null;
      }
      this.cargoMeshes.forEach((c) => { this.scene.remove(c.mesh); });
      this.cargoMeshes = [];
      this.animation = { step: 0, playing: false, timer: null, speed: 1 };
      this.uldInfos = null;
      this.solution = null;
    }

    destroy() {
      window.removeEventListener('resize', this._onResize);
      if (this.tooltip && this.tooltip.parentNode) this.tooltip.parentNode.removeChild(this.tooltip);
      if (this.renderer) {
        this.renderer.dispose();
        if (this.renderer.domElement.parentNode) {
          this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
      }
    }
  }

  global.UldPackingViewer = UldPackingViewer;
  global.PROFILE_CACHE = global.PROFILE_CACHE || {};
})(window);
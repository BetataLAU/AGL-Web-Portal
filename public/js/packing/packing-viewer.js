/**
 * public/js/packing/packing-viewer.js
 * Three.js 3D 渲染器：ULD 線框 + 貨物 Box + 逐步裝載動畫。
 *
 * 座標映射：
 *   內部資料（solver）: X=深度, Y=寬度, Z=高度, 原點=ULD底部中心
 *   Three.js:          X=右, Y=上, Z=前
 *   => three.x = data.x + data.l/2 - uld.l/2
 *      three.y = data.z + data.h/2
 *      three.z = data.y + data.w/2 - uld.w/2
 */
(function (global) {
  'use strict';

  class PackingViewer {
    /**
     * @param {HTMLElement} container 3D 容器元素
     */
    constructor(container) {
      this.container = container;
      this.scene = null;
      this.camera = null;
      this.renderer = null;
      this.controls = null;
      this.uldGroup = null;
      this.cargoMeshes = [];
      this.rafId = null;
      this.animating = false;
      this.playState = 'stopped'; // stopped | playing | paused
      this.currentStep = 0;
      this.speed = 1;
      this.sequence = [];
      this.callbacks = { onStepChange: null };

      this._init();
      this._onResize = this._onResize.bind(this);
      window.addEventListener('resize', this._onResize);
    }

    _init() {
      // 場景
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0f172a);

      // 相機
      const w = this.container.clientWidth || 800;
      const h = this.container.clientHeight || 600;
      this.camera = new THREE.PerspectiveCamera(50, w / h, 1, 20000);
      this.camera.position.set(3500, 3000, 4500);

      // 渲染器
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setSize(w, h);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.container.appendChild(this.renderer.domElement);

      // 控制器
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.15;
      this.controls.target.set(0, 500, 0);

      // 燈光
      const ambient = new THREE.AmbientLight(0xffffff, 0.6);
      this.scene.add(ambient);
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(3000, 5000, 2000);
      this.scene.add(dirLight);
      const dirLight2 = new THREE.DirectionalLight(0x88aaff, 0.3);
      dirLight2.position.set(-2000, 1000, -3000);
      this.scene.add(dirLight2);

      // 地面格線
      const grid = new THREE.GridHelper(6000, 20, 0x334155, 0x1e293b);
      grid.position.y = -2;
      this.scene.add(grid);

      // 動畫迴圈
      this._loop();
    }

    _loop() {
      this.rafId = requestAnimationFrame(() => this._loop());
      this.controls.update();
      this._updateAnimation();
      this.renderer.render(this.scene, this.camera);
    }

    _onResize() {
      const w = this.container.clientWidth || 800;
      const h = this.container.clientHeight || 600;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }

    /**
     * 清除場景中 ULD 與貨物
     */
    clear() {
      if (this.uldGroup) {
        this.scene.remove(this.uldGroup);
        this.uldGroup = null;
      }
      for (const cargo of this.cargoMeshes) {
        this.scene.remove(cargo.mesh);
      }
      this.cargoMeshes = [];
      this.sequence = [];
      this.currentStep = 0;
      this.playState = 'stopped';
      this._updateStepIndicator();
    }

    /**
     * 渲染 ULD 線框。
     * @param {object} uldInfo {l, w, h, profile, geometryType, name}
     */
    renderUld(uldInfo) {
      this.clear();
      this.uldGroup = new THREE.Group();

      if (uldInfo.geometryType === 'rectangular' || !uldInfo.profile) {
        this._buildRectUldLines(uldInfo.l, uldInfo.w, uldInfo.h);
      } else {
        this._buildProfileUldLines(uldInfo.l, uldInfo.profile);
      }

      this.scene.add(this.uldGroup);
      // 調整相機目標至 ULD 中心
      this.controls.target.set(0, uldInfo.h * 0.4, 0);
    }

    /** 矩形 ULD 線框（半透明箱體） */
    _buildRectUldLines(l, w, h) {
      // 半透明實體（方便看輪廓）
      const geo = new THREE.BoxGeometry(l, h, w);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
      });
      const box = new THREE.Mesh(geo, mat);
      box.position.y = h / 2;
      this.uldGroup.add(box);

      // 邊框線
      const edges = new THREE.EdgesGeometry(geo);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 1 });
      const line = new THREE.LineSegments(edges, lineMat);
      line.position.y = h / 2;
      this.uldGroup.add(line);

      // 底部標記線（中心十字）
      const crossMat = new THREE.LineBasicMaterial({ color: 0x7dd3fc });
      const crossPoints = [
        new THREE.Vector3(-50, 0, -w / 2), new THREE.Vector3(50, 0, -w / 2),
        new THREE.Vector3(0, 0, -w / 2), new THREE.Vector3(0, 0, w / 2),
      ];
      const crossGeo = new THREE.BufferGeometry().setFromPoints(crossPoints);
      this.uldGroup.add(new THREE.Line(crossGeo, crossMat));
    }

    /** 斜切 / 輪廓 ULD 線框 */
    _buildProfileUldLines(l, profile) {
      // profile = Array<[y, z]>，逆時針
      const n = profile.length;
      const halfL = l / 2;

      // 前後兩個端面（X = ±halfL）
      const frontPoints = [];
      const backPoints = [];
      for (const [y, z] of profile) {
        frontPoints.push(new THREE.Vector3(-halfL, z, y));
        backPoints.push(new THREE.Vector3(halfL, z, y));
      }

      const lineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8 });
      // 端面輪廓
      const frontGeo = new THREE.BufferGeometry().setFromPoints([...frontPoints, frontPoints[0]]);
      this.uldGroup.add(new THREE.Line(frontGeo, lineMat));
      const backGeo = new THREE.BufferGeometry().setFromPoints([...backPoints, backPoints[0]]);
      this.uldGroup.add(new THREE.Line(backGeo, lineMat));

      // 縱向連接線
      const connectorPoints = [];
      for (let i = 0; i < n; i++) {
        connectorPoints.push(frontPoints[i], backPoints[i]);
      }
      const connGeo = new THREE.BufferGeometry().setFromPoints(connectorPoints);
      this.uldGroup.add(new THREE.LineSegments(connGeo, lineMat));

      // 半透明實體填充（使用 ShapeGeometry 做端面）
      const shape = new THREE.Shape();
      profile.forEach(([y, z], i) => {
        if (i === 0) shape.moveTo(y, z);
        else shape.lineTo(y, z);
      });
      shape.closePath();
      const shapeGeo = new THREE.ShapeGeometry(shape);
      const faceMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const frontFace = new THREE.Mesh(shapeGeo, faceMat);
      frontFace.position.x = -halfL;
      this.uldGroup.add(frontFace);
      const backFace = new THREE.Mesh(shapeGeo, faceMat);
      backFace.position.x = halfL;
      backFace.rotation.y = Math.PI;
      this.uldGroup.add(backFace);
    }

    /**
     * 設定裝載順序並建立貨物 mesh（初始隱藏）。
     * @param {Array<object>} sequence solver 輸出的 sequence[]
     * @param {object} uldInfo {l, w, h}
     */
    setSequence(sequence, uldInfo) {
      this.clear();
      if (this.uldGroup) this.scene.remove(this.uldGroup);
      this.uldGroup = null;
      this.sequence = sequence || [];
      this.uldInfo = uldInfo;
      this.currentStep = 0;

      const colors = this._getLayerColor(uldInfo.h);

      this.sequence.forEach((step, i) => {
        const color = colors(step.z);
        const geo = new THREE.BoxGeometry(step.l, step.h, step.w);
        const mat = new THREE.MeshPhongMaterial({
          color,
          transparent: true,
          opacity: 0.9,
          specular: 0x222222,
          shininess: 20,
        });
        const mesh = new THREE.Mesh(geo, mat);

        // 目標位置（three 座標）
        const targetX = step.x + step.l / 2 - uldInfo.l / 2;
        const targetY = step.z + step.h / 2;
        const targetZ = step.y + step.w / 2 - uldInfo.w / 2;

        // 出發位置：從 ULD 外上方（動畫飛行路徑）
        const startY = targetY + 2000 + (i % 3) * 300;
        const startX = targetX + (i % 2 === 0 ? -3 : 3) * uldInfo.l;
        const startZ = targetZ + (i % 3 === 1 ? -3 : 3) * uldInfo.w;

        mesh.position.set(startX, startY, startZ);
        mesh.visible = false;

        // 邊框
        const edges = new THREE.EdgesGeometry(geo);
        const edgeMat = new THREE.LineBasicMaterial({ color: 0x1e293b, linewidth: 1 });
        const edgeLine = new THREE.LineSegments(edges, edgeMat);
        mesh.add(edgeLine);

        // 觸發器（點擊顯示資訊）
        mesh.userData = { id: step.id, stepIndex: i, target: new THREE.Vector3(targetX, targetY, targetZ), start: mesh.position.clone() };

        this.scene.add(mesh);
        this.cargoMeshes.push({ mesh, step: i + 1, targetX, targetY, targetZ });
      });

      this._addRaycaster();
      this._updateStepIndicator();
    }

    /** 依高度分配顏色（地面層/中層/高層） */
    _getLayerColor(maxH) {
      return (z) => {
        const ratio = maxH > 0 ? z / maxH : 0;
        if (ratio < 0.33) return 0xf59e0b; // 地面層 - 橙
        if (ratio < 0.66) return 0x22c55e; // 中層 - 綠
        return 0xef4444; // 高層 - 紅
      };
    }

    /** Raycaster：點擊貨物顯示資訊 */
    _addRaycaster() {
      if (this._raycaster) return;
      this._raycaster = new THREE.Raycaster();
      this._mouse = new THREE.Vector2();
      const canvas = this.renderer.domElement;
      canvas.addEventListener('click', (event) => {
        const rect = canvas.getBoundingClientRect();
        this._mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this._mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this._raycaster.setFromCamera(this._mouse, this.camera);
        const meshes = this.cargoMeshes.map((c) => c.mesh).filter((m) => m.visible);
        const hits = this._raycaster.intersectObjects(meshes, false);
        if (hits.length > 0) {
          const hit = hits[0].object;
          const step = this.sequence.find((s) => s.id === hit.userData.id);
          if (step && global.showCargoInfo) {
            global.showCargoInfo(step);
          }
        }
      });
    }

    /**
     * 開始播放動畫。
     * @param {number} speed 播放速度倍率
     */
    play(speed = 1) {
      if (this.sequence.length === 0) return;
      this.speed = speed;
      // 全部先設為隱藏，從頭播放
      this.cargoMeshes.forEach((c) => { c.mesh.visible = false; });
      this.currentStep = 0;
      this.playState = 'playing';
      this._lastFrameStamp = null;
      this._updateStepIndicator();
      if (this.callbacks.onStepChange) this.callbacks.onStepChange(0, this.sequence.length);
    }

    pause() {
      if (this.playState === 'playing') {
        this.playState = 'paused';
      }
    }

    resume() {
      if (this.playState === 'paused') {
        this.playState = 'playing';
        this._lastFrameStamp = null;
      }
    }

    reset() {
      this.cargoMeshes.forEach((c) => { c.mesh.visible = false; });
      this.currentStep = 0;
      this.playState = 'stopped';
      this._updateStepIndicator();
      if (this.callbacks.onStepChange) this.callbacks.onStepChange(0, this.sequence.length);
    }

    /** 動畫更新（每 frame 呼叫） */
    _updateAnimation() {
      if (this.playState !== 'playing' || this.sequence.length === 0) return;

      const now = performance.now();
      if (this._lastFrameStamp === null) {
        this._lastFrameStamp = now;
        return;
      }
      const dt = Math.min((now - this._lastFrameStamp) / 1000, 0.1);
      this._lastFrameStamp = now;

      // 每件貨物飛入時間 0.8 秒（可乘 1/speed）
      const animDuration = 0.8 / this.speed;
      const stepDt = dt / animDuration;

      // 找出目前正在飛入的貨物
      const cargo = this.cargoMeshes[this.currentStep];
      if (cargo) {
        cargo.mesh.visible = true;
        cargo.mesh.position.lerp(
          new THREE.Vector3(cargo.targetX, cargo.targetY, cargo.targetZ),
          Math.min(stepDt * 3, 1) // 加速 easing
        );
        const pos = cargo.mesh.position;
        const dist = pos.distanceTo(new THREE.Vector3(cargo.targetX, cargo.targetY, cargo.targetZ));
        if (dist < 5) {
          this.currentStep++;
          this._updateStepIndicator();
          if (this.callbacks.onStepChange) this.callbacks.onStepChange(this.currentStep, this.sequence.length);
          if (this.currentStep >= this.sequence.length) {
            this.playState = 'stopped';
          }
        }
      }
    }

    _updateStepIndicator() {
      const indicator = document.getElementById('step-indicator');
      if (indicator) {
        indicator.textContent = `${Math.min(this.currentStep, this.sequence.length)} / ${this.sequence.length}`;
      }
    }

    /** 視角切換：3D 視角 */
    setView3D() {
      this.camera.position.set(3500, 3000, 4500);
      this.controls.target.set(0, 500, 0);
    }

    /** 視線切換：俯視圖 */
    setViewTop() {
      this.camera.position.set(0, 8000, 0);
      this.controls.target.set(0, 0, 0);
    }

    destroy() {
      window.removeEventListener('resize', this._onResize);
      cancelAnimationFrame(this.rafId);
      if (this.renderer) {
        this.renderer.dispose();
        if (this.renderer.domElement.parentNode) {
          this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
      }
    }
  }

  global.PackingViewer = PackingViewer;
})(window);
/**
 * bp3d/ga-lns.js
 * Hybrid GA-LNS 求解器主入口。
 *
 * 模組結構：
 *   bp3d/ga-lns/
 *     chromosome.js    — 編碼、族群、交叉、突變
 *     fitness.js       — decode、統計、適應度
 *     search.js        — 非支配排序、LNS
 *     init.js          — 專案資料正規化
 *     evolve.js        — GA 演化迴圈
 *
 * 流程：正規化 → GA 演化（60% 進度）→ LNS 精修（→90%）→ Pareto 篩選 → 輸出
 */
'use strict';

const { createRng } = require('./ga-lns/chromosome');
const { evaluatePopulation } = require('./ga-lns/fitness');
const { fastNonDominatedSort, lnsImprove } = require('./ga-lns/search');
const { normalizeItems, resolveUlDs } = require('./ga-lns/init');
const { evolve } = require('./ga-lns/evolve');

// ===== 預設參數 =====
const DEFAULTS = {
  populationSize: 40,
  maxGenerations: 60,
  mutationRate: 0.2,
  crossoverRate: 0.8,
  tournamentSize: 3,
  eliteCount: 4,
  lnsIterations: 20,
  lnsDestroyRatio: 0.25,
  minSupportRatio: 0.7,
  cogToleranceRatio: 0.1,
  solutionCount: 5,
};

/**
 * 主求解：GA 演化 + LNS 精修 + Pareto 非支配篩選。
 * @param {object} project { id, ulds: [...], items: [...] }
 * @param {object} userOptions 覆寫預設參數
 * @param {Function|null} onProgress 回調 (0~100)
 * @param {Function|null} shouldStop 回調 () => boolean（true = 取消）
 * @returns {object} 方案結構
 */
function solveMultiUld(project, userOptions = {}, onProgress = null, shouldStop = null) {
  const options = { ...DEFAULTS, ...userOptions };
  const rng = createRng(options.seed);
  const items = normalizeItems(project.items || []);
  const uldInfos = resolveUlDs(project.ulds || []);

  if (uldInfos.length === 0) throw new Error('專案沒有 ULD');
  if (items.length === 0) throw new Error('專案沒有貨物');

  const startedAt = Date.now();

  // GA 演化（0~60%）
  const finalEval = evolve(items, uldInfos, options, rng, (pct) => {
    if (onProgress) onProgress(pct);
  });
  if (shouldStop && shouldStop()) {
    return buildCancelResult(startedAt, project, items.length, uldInfos.length);
  }

  // LNS 精修（60~90%）
  const topCandidates = finalEval
    .slice()
    .sort((a, b) => a.fitness - b.fitness)
    .slice(0, options.solutionCount * 2);

  const lnsResults = topCandidates.map((cand) => lnsImprove(cand, items, uldInfos, options, rng));
  if (shouldStop && shouldStop()) {
    return buildCancelResult(startedAt, project, items.length, uldInfos.length);
  }
  if (onProgress) onProgress(90);

  // Pareto 非支配篩選
  const allPool = lnsResults.concat(finalEval);
  const fronts = fastNonDominatedSort(allPool);
  const pareto = fronts[0].map((idx) => allPool[idx]);

  // 依體積利用率排序取前 solutionCount
  const solutions = pareto
    .sort((a, b) => b.stats.volumeUtilization - a.stats.volumeUtilization)
    .slice(0, options.solutionCount);

  if (onProgress) onProgress(100);

  return {
    success: true,
    elapsedMs: Date.now() - startedAt,
    projectId: project.id || null,
    uldCount: uldInfos.length,
    itemCount: items.length,
    solutions: solutions.map((s) => buildSolution(s, uldInfos)),
  };
}

/** 取消時的回傳 */
function buildCancelResult(startedAt, project, itemCount, uldCount) {
  return {
    success: false,
    cancelled: true,
    elapsedMs: Date.now() - startedAt,
    projectId: project.id || null,
    uldCount,
    itemCount,
    solutions: [],
  };
}

/** 將評估個體轉為對外方案結構 */
function buildSolution(s, uldInfos) {
  return {
    fitness: Number(s.fitness.toFixed(4)),
    stats: {
      placedCount: s.stats.placedCount,
      unplacedCount: s.stats.unplacedCount,
      volumeUtilization: Number(s.stats.volumeUtilization.toFixed(1)),
      weightUtilization: Number(s.stats.weightUtilization.toFixed(1)),
      totalWeightKg: Number(s.stats.totalWeight.toFixed(1)),
      totalWeightCapacityKg: Number(s.stats.totalWeightCapacity.toFixed(1)),
      cog: {
        x: Number(s.stats.cog.x.toFixed(1)),
        y: Number(s.stats.cog.y.toFixed(1)),
        z: Number(s.stats.cog.z.toFixed(1)),
      },
      floorPressureOk: !s.stats.floorViolation,
      maxFloorPressureKgM2: Number(s.stats.maxFloorPressure.toFixed(1)),
    },
    ulds: uldInfos.map((u) => ({
      id: u.id,
      label: u.label,
      uld_type: u.uld_type,
      l: u.l,
      w: u.w,
      h: u.h,
      maxWeightKg: u.maxWeightKg,
    })),
    placedItems: s.placedByUld.flatMap((list, ui) =>
      list.map((p) => ({
        id: p.id,
        groupId: p.groupId,
        customerId: p.customerId,
        uldId: uldInfos[ui].id,
        x: Number(p.x.toFixed(1)),
        y: Number(p.y.toFixed(1)),
        z: Number(p.z.toFixed(1)),
        l: Number(p.l.toFixed(1)),
        w: Number(p.w.toFixed(1)),
        h: Number(p.h.toFixed(1)),
        weightKg: Number(p.weightKg.toFixed(1)),
      }))
    ),
    unplaced: s.unplaced.map((u) => ({ id: u.id })),
  };
}

module.exports = {
  solveMultiUld,
  DEFAULTS,
  // 測試用
  normalizeItems,
  resolveUlDs,
  evaluatePopulation,
  fastNonDominatedSort,
  createRng,
};
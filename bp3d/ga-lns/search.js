/**
 * bp3d/ga-lns/search.js
 * Pareto 非支配排序 + LNS（Large Neighborhood Search）局部精修。
 */
'use strict';

const { cloneChromosome } = require('./chromosome');
const { decodeChromosome, computeStats, fitness } = require('./fitness');

/**
 * a 是否支配 b（多目標：fitness、體積利用率、未放置數）。
 */
function dominates(a, b) {
  const aTargets = [a.fitness, -a.stats.volumeUtilization, a.stats.unplacedCount];
  const bTargets = [b.fitness, -b.stats.volumeUtilization, b.stats.unplacedCount];
  let better = false;
  for (let i = 0; i < 3; i++) {
    if (aTargets[i] > bTargets[i]) return false;
    if (aTargets[i] < bTargets[i]) better = true;
  }
  return better;
}

/**
 * 快速非支配排序（NSGA-II 風格），回傳層級索引陣列。
 * @returns {Array<Array<number>>} fronts（每層為 pop 索引陣列）
 */
function fastNonDominatedSort(pop) {
  const fronts = [[]];
  const dominationCount = new Array(pop.length).fill(0);
  const dominatedSet = pop.map(() => []);

  for (let i = 0; i < pop.length; i++) {
    for (let j = 0; j < pop.length; j++) {
      if (i === j) continue;
      if (dominates(pop[i], pop[j])) {
        dominatedSet[i].push(j);
      } else if (dominates(pop[j], pop[i])) {
        dominationCount[i]++;
      }
    }
    if (dominationCount[i] === 0) fronts[0].push(i);
  }

  let rank = 0;
  while (fronts[rank] && fronts[rank].length > 0) {
    const next = [];
    for (const idx of fronts[rank]) {
      for (const j of dominatedSet[idx]) {
        dominationCount[j]--;
        if (dominationCount[j] === 0) next.push(j);
      }
    }
    rank++;
    if (next.length > 0) fronts.push(next);
  }
  return fronts;
}

/**
 * LNS 精修：反覆 destroy（隨機移除 n 件）+ repair（貪婪重放）。
 * @param {object} candidate 已評估個體 {chromosome, placedByUld, unplaced, stats, fitness}
 * @param {Array} items 貨物
 * @param {Array} uldInfos ULD
 * @param {object} options 參數
 * @param {Function} rng 亂數
 * @returns {object} 精修後的個體
 */
function lnsImprove(candidate, items, uldInfos, options, rng) {
  let current = candidate;
  let currentFitness = candidate.fitness;

  for (let iter = 0; iter < options.lnsIterations; iter++) {
    // destroy：隨機移除 n 件
    const n = Math.max(2, Math.floor(items.length * options.lnsDestroyRatio));
    const removedIdx = new Set();
    const orderCopy = current.chromosome.order.slice();
    for (let k = 0; k < n && orderCopy.length > 0; k++) {
      const i = Math.floor(rng() * orderCopy.length);
      removedIdx.add(orderCopy.splice(i, 1)[0]);
    }

    // repair：被移除的亂序放回（排最前面讓貪婪先處理）
    const newOrder = [...orderCopy];
    const fixList = [...removedIdx].sort(() => rng() - 0.5);
    fixList.forEach((idx) => newOrder.push(idx));

    const newChrom = {
      order: newOrder,
      uldAssign: current.chromosome.uldAssign.slice(),
      rotation: current.chromosome.rotation.slice(),
    };

    const { placedByUld, unplaced } = decodeChromosome(newChrom, items, uldInfos, options);
    const stats = computeStats(placedByUld, unplaced, items, uldInfos);
    const f = fitness(stats, items.length);

    if (f < currentFitness) {
      current = { chromosome: newChrom, placedByUld, unplaced, stats, fitness: f };
      currentFitness = f;
    }
  }
  return current;
}

module.exports = {
  dominates,
  fastNonDominatedSort,
  lnsImprove,
};
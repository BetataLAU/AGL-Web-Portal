/**
 * bp3d/ga-lns/chromosome.js
 * 染色體編碼、初始族群、交叉與突變操作。
 *
 * 基因編碼：
 *   { order: [itemIdx...], uldAssign: [uldIdx...], rotation: [rotIdx...] }
 *   - order:     貨物放置順序（排列）
 *   - uldAssign: 每件貨物分配的 ULD 索引
 *   - rotation:  每件貨物使用旋轉方向索引（0 = 原始方向）
 */
'use strict';

/**
 * 產生多維度硬體亂數（LCG，可注入種子供測試）。
 * @param {number} seed 種子（0 或省略 → 以時間為種子）
 * @returns {Function} () => [0, 1)
 */
function createRng(seed) {
  let s = seed || (Date.now() % 2147483647);
  if (s === 0) s = 1;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * 隨機染色體（Fisher-Yates 排列 + 隨機 ULD 指派）。
 */
function randomChromosome(itemCount, uldCount, rng) {
  const order = [];
  for (let i = 0; i < itemCount; i++) order.push(i);
  for (let i = itemCount - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const uldAssign = [];
  const rotation = [];
  for (let i = 0; i < itemCount; i++) {
    uldAssign.push(Math.floor(rng() * uldCount));
    rotation.push(0);
  }
  return { order, uldAssign, rotation };
}

/**
 * 複製染色體（防止突變改到原物件）。
 */
function cloneChromosome(chrom) {
  return {
    order: chrom.order.slice(),
    uldAssign: chrom.uldAssign.slice(),
    rotation: chrom.rotation.slice(),
  };
}

/**
 * 初始族群：第一隻以密度遞減（重貨優先）+ round-robin ULD 分配為種子，其餘隨機。
 */
function initialPopulation(populationSize, items, uldCount, rng) {
  const pop = [];

  const densityOrder = items
    .map((it, idx) => ({ idx, density: it.density }))
    .sort((a, b) => b.density - a.density)
    .map((x) => x.idx);
  const seed = { order: densityOrder.slice(), uldAssign: [], rotation: [] };
  for (let i = 0; i < items.length; i++) {
    seed.uldAssign.push(i % uldCount);
    seed.rotation.push(0);
  }
  pop.push(seed);

  while (pop.length < populationSize) {
    pop.push(randomChromosome(items.length, uldCount, rng));
  }
  return pop;
}

/**
 * Order Crossover（OX）：保留父一的一段子序列，其餘以父二順序填補。
 */
function orderCrossover(p1, p2, rng) {
  const n = p1.length;
  const child = new Array(n).fill(-1);
  const a = Math.floor(rng() * n);
  const b = Math.floor(rng() * n);
  const start = Math.min(a, b);
  const end = Math.max(a, b);

  const seg = new Set();
  for (let i = start; i <= end; i++) {
    child[i] = p1[i];
    seg.add(p1[i]);
  }

  let fillIdx = 0;
  for (let i = 0; i < n; i++) {
    const val = p2[(end + 1 + i) % n];
    if (seg.has(val)) continue;
    while (child[fillIdx] !== -1) fillIdx++;
    child[fillIdx] = val;
  }
  return child;
}

/**
 * 均勻交叉（用於 uldAssign / rotation）。
 */
function uniformCrossover(a, b, rng) {
  const child = [];
  for (let i = 0; i < a.length; i++) {
    child.push(rng() < 0.5 ? a[i] : b[i]);
  }
  return child;
}

/**
 * 突變：order 交換/插入 + 隨機重指派 ULD。
 */
function mutate(chrom, itemCount, uldCount, rng, rate) {
  const c = cloneChromosome(chrom);

  if (rng() < rate) {
    const i = Math.floor(rng() * itemCount);
    const j = Math.floor(rng() * itemCount);
    if (rng() < 0.5) {
      [c.order[i], c.order[j]] = [c.order[j], c.order[i]];
    } else {
      const [moved] = c.order.splice(i, 1);
      c.order.splice(j, 0, moved);
    }
  }

  if (rng() < rate) {
    const i = Math.floor(rng() * itemCount);
    c.uldAssign[i] = Math.floor(rng() * uldCount);
  }

  return c;
}

module.exports = {
  createRng,
  randomChromosome,
  cloneChromosome,
  initialPopulation,
  orderCrossover,
  uniformCrossover,
  mutate,
};
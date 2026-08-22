/**
 * bp3d/ga-lns/evolve.js
 * GA 演化主迴圈：選擇、交叉、突變、精英保留。
 */
'use strict';

const { initialPopulation, orderCrossover, uniformCrossover, mutate } = require('./chromosome');
const { evaluatePopulation } = require('./fitness');

/**
 * 執行 GA 演化。
 * @param {Array} items 貨物
 * @param {Array} uldInfos ULD
 * @param {object} options 參數（populationSize、maxGenerations、mutationRate...）
 * @param {Function} rng 亂數
 * @param {Function|null} onProgress 回調 (0~60 的 GA 進度)
 * @returns {Array} 最終族群（已評估個體）
 */
function evolve(items, uldInfos, options, rng, onProgress) {
  let population = initialPopulation(options.populationSize, items, uldInfos.length, rng);

  for (let gen = 0; gen < options.maxGenerations; gen++) {
    const evaluated = evaluatePopulation(population, items, uldInfos, options);

    // 精英保留
    const sorted = evaluated.slice().sort((a, b) => a.fitness - b.fitness);
    const elites = sorted.slice(0, Math.min(options.eliteCount, sorted.length));
    const nextPop = elites.map((e) => ({ ...e.chromosome }));

    // 錦標賽選擇 + 交叉 + 突變
    const pick = () => {
      let bestLocal = null;
      for (let k = 0; k < options.tournamentSize; k++) {
        const cand = evaluated[Math.floor(rng() * evaluated.length)];
        if (!bestLocal || cand.fitness < bestLocal.fitness) bestLocal = cand;
      }
      return bestLocal.chromosome;
    };

    while (nextPop.length < options.populationSize) {
      const p1 = pick();
      const p2 = pick();
      let child;
      if (rng() < options.crossoverRate) {
        child = {
          order: orderCrossover(p1.order, p2.order, rng),
          uldAssign: uniformCrossover(p1.uldAssign, p2.uldAssign, rng),
          rotation: uniformCrossover(p1.rotation, p2.rotation, rng),
        };
      } else {
        child = {
          order: p1.order.slice(),
          uldAssign: p1.uldAssign.slice(),
          rotation: p1.rotation.slice(),
        };
      }
      child = mutate(child, items.length, uldInfos.length, rng, options.mutationRate);
      nextPop.push(child);
    }

    population = nextPop;
    if (onProgress) onProgress(Math.round(((gen + 1) / options.maxGenerations) * 60));
  }

  return evaluatePopulation(population, items, uldInfos, options);
}

module.exports = { evolve };
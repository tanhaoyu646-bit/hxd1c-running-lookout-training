export function shuffled(values, random = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function selectCandidateNames({ correct, alternate = '', assets, recentOptions = [], random = Math.random }) {
  const chosen = [];
  const add = (name) => {
    if (name && name !== correct && assets.includes(name) && !chosen.includes(name)) chosen.push(name);
  };
  // 进站阶段必须保留另一条进路线作为业务干扰项；其余干扰项优先避开
  // 最近两题出现过的图片，避免连续题目总是显示同几条运行线。
  add(alternate);
  const recent = new Set(recentOptions.flat());
  const fresh = shuffled(assets.filter((name) => name !== correct && name !== alternate && !recent.has(name)), random);
  fresh.forEach(add);
  if (chosen.length < 2) shuffled(assets.filter((name) => name !== correct && name !== alternate), random).forEach(add);
  return shuffled([correct, ...chosen.slice(0, 2)], random);
}

export function visibleSignalCount(activeStage, completed, signalCount) {
  return completed ? signalCount : Math.min(signalCount, Math.max(0, activeStage + 1));
}

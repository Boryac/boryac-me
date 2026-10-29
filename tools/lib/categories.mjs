/**
 * 分类目录（catalogue）—— 从**实际数据**算出来，不手写。
 *
 * 为什么必须算：`catalogue` 是三维档案架的栏位表（每栏从第几页开始、有几条）。
 * 手写数字与数据集一脱钩，界面上就会出现「第 13 页起是体验与界面，但第 13 页
 * 其实是别的东西」——而且不会报错，只会看起来怪。所以这里只认两件事：
 *   · 分类名与顺序来自 `tools/categories.json` 的 `categories`（**名字不得改**，
 *     content-b 的新增条目依赖这九个名字）；
 *   · 计数与起始页来自 `tools/archives-d/*.json` 的真实顺序（即图版页序）。
 *
 * `sectionPage` 取该分类**第一条**档案的图版页码（1 起）；数据里还没有的分类给 `null`，
 * 不编一个"预计页码"出来。
 */

/**
 * @param {Array<{id:string, category:string}>} records 按图版顺序排列的档案
 * @param {string[]} categories 分类名（有序）
 * @returns {Array<{name:string, sectionPage:number|null, count:number}>}
 */
export function buildCatalogue(records, categories) {
  const count = new Map(categories.map((name) => [name, 0]));
  const firstPage = new Map();

  records.forEach((record, index) => {
    const name = record?.category;
    if (!count.has(name)) return; // 数据里出现未登记的分类：不算进任何栏，由调用方报错
    count.set(name, count.get(name) + 1);
    if (!firstPage.has(name)) firstPage.set(name, index + 1);
  });

  return categories.map((name) => ({
    name,
    sectionPage: firstPage.get(name) ?? null,
    count: count.get(name),
  }));
}

/** 数据里出现了 `categories` 没登记的分类名（会导致这些档案落不进任何栏位）。 */
export function unknownCategories(records, categories) {
  const known = new Set(categories);
  return [...new Set(records.map((r) => r?.category).filter((c) => c && !known.has(c)))];
}

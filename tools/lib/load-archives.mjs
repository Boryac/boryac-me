/**
 * 档案数据加载器：优先读 `tools/archives-d/*.json`（每条一个文件，便于并行改写），
 * 目录不存在时回落到旧的单文件 `tools/archives.json`。
 *
 * 为什么要拆：18 条档案要多人并行重写，单文件必然写冲突。拆成一条一个文件后，
 * 每条档案只有一个写入者，`X-00N.json` 的文件名顺序即 `id` 顺序。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export function archivesDir(root) {
  return path.join(root, "tools", "archives-d");
}

export function loadArchives(root) {
  const dir = archivesDir(root);
  if (existsSync(dir)) {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    if (files.length) {
      return files.map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
    }
  }
  return JSON.parse(readFileSync(path.join(root, "tools", "archives.json"), "utf8"));
}

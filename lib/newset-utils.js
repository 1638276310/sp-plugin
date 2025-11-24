/**
 * 最新合集底层工具
 * 远程拉取 7fep.27l4l.com 分页合集
 * @author  寂寞沙洲冷  QV：1638276310
 */
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);

const DATA_DIR = path.join(process.cwd(), "data", "sp-plugin");
const CACHE_FILE = path.join(DATA_DIR, "newset-cache.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

/**
 * 下载指定分页 HTML
 * @private
 * @param {number} page 页码
 * @returns {Promise<string>} html
 */
async function downloadPage(page) {
  const url = `https://7fep.27l4l.com/thread.php?fid=3&page=${page}`;
  const tmp = path.join(DATA_DIR, `newset_${page}.html`);
  await execAsync(`curl -s -L -o "${tmp}" "${url}"`);
  return fs.readFileSync(tmp, "utf8");
}

/**
 * 解析 HTML 提取合集
 * @private
 * @param {string} html
 * @returns {{title:string,tid:string}[]}
 */
function parsePage(html) {
  const tidReg =
    /<a href="read\.php\?tid=(\d+)"[^>]*class="subject"[^>]*>([^<]+)<\/a>/gi;
  const res = [];
  let m;
  while ((m = tidReg.exec(html)) !== null) {
    res.push({ tid: m[1], title: m[2].trim() });
  }
  return res;
}

/**
 * 刷新本地缓存（可定时调用）
 * @returns {Promise<boolean>} 成功true
 */
export async function refreshLatestSets() {
  try {
    const all = [];
    for (let p = 1; p <= 5; p++) all.push(...parsePage(await downloadPage(p)));
    fs.writeFileSync(CACHE_FILE, JSON.stringify(all, null, 2));
    logger.mark(`[newset-utils] 已刷新 ${all.length} 条合集`);
    return true;
  } catch (e) {
    logger.error("[newset-utils] 刷新失败", e);
    return false;
  }
}

/**
 * 读取本地缓存
 * @returns {{title:string,tid:string}[]}
 */
function readCache() {
  if (!fs.existsSync(CACHE_FILE)) return [];
  return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
}

/**
 * 按页码返回（每页 30 条）
 * @param {number} page
 * @returns {{title:string,tid:string}[]}
 */
export async function fetchSetByPage(page) {
  const cache = readCache();
  const PAGE_SIZE = 30;
  const start = (page - 1) * PAGE_SIZE;
  return cache.slice(start, start + PAGE_SIZE);
}

/**
 * 随机返回一条
 * @returns {{title:string,tid:string}|null}
 */
export async function randomOneSet() {
  const cache = readCache();
  if (!cache.length) return null;
  return cache[Math.floor(Math.random() * cache.length)];
}

/* 启动时自动拉一次 */
(async () => {
  await refreshLatestSets();
})();

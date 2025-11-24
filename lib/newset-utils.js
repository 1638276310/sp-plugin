/**
 * 最新合集底层工具 —— axios 版
 * 远程拉取 7fep.27l4l.com 分页合集
 * @author  寂寞沙洲冷  QV：1638276310
 */
import fs from "fs";
import path from "path";
import axios from "axios";

const DATA_DIR = path.join(process.cwd(), "data", "sp-plugin");
const CACHE_FILE = path.join(DATA_DIR, "newset-cache.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

const client = axios.create({
  timeout: 10000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
  },
});

/**
 * 下载指定分页 HTML
 * @private
 * @param {number} page
 * @returns {Promise<string>}
 */
async function downloadPage(page) {
  const url = `https://cvkz.23und.com/thread.php?fid=3&page=${page}`;
  const { data } = await client.get(url);
  return data;
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
 * @returns {Promise<boolean>}
 */
export async function refreshLatestSets() {
  try {
    const all = [];
    for (let p = 1; p <= 5; p++) {
      const html = await downloadPage(p);
      all.push(...parsePage(html));
    }
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
  const PAGE_SIZE = 53;
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

/**
 * 最新合集底层工具 —— Puppeteer 版
 * 绕过反爬，真实浏览器拿渲染后 HTML
 * @author  寂寞沙洲冷  QV：1638276310
 */
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";

const DATA_DIR = path.join(process.cwd(), "data", "sp-plugin");
const CACHE_FILE = path.join(DATA_DIR, "newset-cache.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

/* 浏览器实例缓存 */
let browserInstance = null;

async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browserInstance;
}

/* 下载一页（真实浏览器） */
async function downloadPage(page) {
  const browser = await getBrowser();
  const pageObj = await browser.newPage();
  await pageObj.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  // 拦截无用资源，加速
  await pageObj.setRequestInterception(true);
  pageObj.on("request", (req) => {
    if (["stylesheet", "font", "image"].includes(req.resourceType()))
      req.abort();
    else req.continue();
  });

  const url = `https://cvkz.23und.com/thread.php?fid=3&page=${page}`;
  await pageObj.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  // 等帖子标题出现
  await pageObj.waitForSelector("a.subject", { timeout: 15000 });

  const html = await pageObj.content(); // 完整渲染后 HTML
  await pageObj.close();
  // 调试落盘
  fs.writeFileSync(path.join(DATA_DIR, `debug-page${page}.html`), html, "utf8");
  return html;
}

/* 解析 HTML 提取合集 */
function parsePage(html) {
  const tidReg =
    /<a\s+href="read\.php\?tid=(\d+)"[^>]*class="subject"[^>]*>([^<]+)<\/a>/gi;
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
    logger.mark(`[newset-puppeteer] 已刷新 ${all.length} 条合集`);
    return true;
  } catch (e) {
    logger.error("[newset-puppeteer] 刷新失败", e);
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
 * 按页码返回（每页 53 条）
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

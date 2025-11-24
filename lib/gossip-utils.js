/**
 * 718吃瓜套件 - 通用免权限版
 * Windows / Linux 普通用户均可直接运行
 * 原理：自动解析最佳 IP → 直连 + Host 头，无需修改系统文件
 * @author 寂寞沙洲冷 QV：1638276310
 */
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);

/* ---------- 1. 常量 ---------- */
const DATA_DIR = path.join(process.cwd(), "data", "sp-plugin");
const RULES_FILE = path.join(DATA_DIR, "gossip-rules.json");
const IDS_FILE = path.join(DATA_DIR, "gossip-ids.json");

const DOMAIN = "cdn.jsdelivr.net";
const REMOTE_RULES_URL = `https://${DOMAIN}/gh/1638276310/718@main/gossip-rules.json`;
const REMOTE_IDS_URL = `https://${DOMAIN}/gh/1638276310/718@main/gossip-ids.json`;

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- 2. 解析最佳 IP ---------- */
async function resolveBestIP(host, timeout = 3) {
  const cmd =
    process.platform === "win32"
      ? `nslookup ${host} | findstr /R "^Address: ^Addresses:"`
      : `nslookup ${host} | awk '/^Address: / {print $2}'`;
  try {
    const { stdout } = await execAsync(cmd, { timeout: timeout * 1000 });
    const ips = stdout
      .split(/\s+/)
      .filter((s) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s));
    if (!ips.length) throw new Error("No IP");
    let best = ips[0];
    let min = 9999;
    for (const ip of ips.slice(0, 3)) {
      const ping =
        process.platform === "win32"
          ? `ping -n 1 -w 1000 ${ip}`
          : `ping -c 1 -W 1 ${ip}`;
      try {
        const start = Date.now();
        await execAsync(ping, { timeout: 1500 });
        const rtt = Date.now() - start;
        if (rtt < min) {
          min = rtt;
          best = ip;
        }
      } catch {
        /* 超时 */
      }
    }
    return best;
  } catch (e) {
    logger.warn(`[gossip-utils] 解析 ${host} 失败，fallback 104.16.88.20`);
    return "104.16.88.20";
  }
}

/* ---------- 3. 下载文件 ---------- */
async function downloadFile(url, dest) {
  const ip = await resolveBestIP(DOMAIN);
  const urlIP = url.replace(DOMAIN, ip);
  const cmd = `curl -s -L --max-time 30 -o "${dest}" -H "Host: ${DOMAIN}" "${urlIP}"`;
  try {
    await execAsync(cmd);
    return true;
  } catch (e) {
    logger.error(`[gossip-utils] 下载失败: ${url}`, e);
    return false;
  }
}

/* ---------- 4. 初始化拉取 ---------- */
(async () => {
  const ok1 = await downloadFile(REMOTE_RULES_URL, RULES_FILE);
  const ok2 = await downloadFile(REMOTE_IDS_URL, IDS_FILE);
  logger.mark(`[gossip-utils] 远程规则拉取完成: rules=${ok1}, ids=${ok2}`);
})();

/* ---------- 5. 业务函数 ---------- */
export async function readRules() {
  try {
    if (!fs.existsSync(RULES_FILE)) return [];
    return JSON.parse(fs.readFileSync(RULES_FILE, "utf8"));
  } catch (e) {
    logger.error("[gossip-utils] 读取规则文件失败", e);
    return [];
  }
}

export async function readIds() {
  try {
    if (!fs.existsSync(IDS_FILE)) return [];
    return JSON.parse(fs.readFileSync(IDS_FILE, "utf8"));
  } catch (e) {
    logger.error("[gossip-utils] 读取 IDS 文件失败", e);
    return [];
  }
}

export async function fetchVideoById(videoId) {
  const rules = await readRules();
  const rule = rules.find((r) => String(r.id) === String(videoId));
  if (!rule) return null;
  return {
    id: String(rule.id),
    title: rule.title || `吃瓜-${rule.id}`,
    videoUrls: rule.m3u8 ? [rule.m3u8] : [],
    images: rule.images || [],
    articleContent: rule.texts || [],
  };
}

export async function searchArticlesByKeyword(kw) {
  const rules = await readRules();
  const kwLower = kw.toLowerCase();
  return rules
    .filter((r) => (r.title || "").toLowerCase().includes(kwLower))
    .slice(0, 30)
    .map((r) => ({ id: String(r.id), title: r.title || `吃瓜-${r.id}` }));
}

export async function fetchPastArticles(count = 10) {
  const rules = await readRules();
  return rules
    .slice(-count)
    .reverse()
    .map((r) => ({ id: String(r.id), title: r.title || `吃瓜-${r.id}` }));
}

export async function refreshArticleIds() {
  const ok1 = await downloadFile(REMOTE_RULES_URL, RULES_FILE);
  const ok2 = await downloadFile(REMOTE_IDS_URL, IDS_FILE);
  logger.mark(`[gossip-utils] 手动刷新完成: rules=${ok1}, ids=${ok2}`);
  return ok1 && ok2;
}

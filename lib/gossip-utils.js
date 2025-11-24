/**
 * 718吃瓜套件 - 远程规则版
 * 不再爬站，全部读远程 JSON
 * @author 寂寞沙洲冷 QV：1638276310
 */
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);

const DATA_DIR = path.join(process.cwd(), "data", "sp-plugin");
const RULES_FILE = path.join(DATA_DIR, "gossip-rules.json");
const IDS_FILE = path.join(DATA_DIR, "gossip-ids.json");

const REMOTE_RULES_URL =
  "https://www.mengxix.top/TRSS/gossip/gossip-rules.json";
const REMOTE_IDS_URL = "https://www.mengxix.top/TRSS/gossip/gossip-ids.json";

fs.mkdirSync(DATA_DIR, { recursive: true });

async function downloadFile(url, dest) {
  try {
    await execAsync(`curl -s -L -o "${dest}" "${url}"`);
    return true;
  } catch (e) {
    logger.error(`[gossip-utils] 下载失败: ${url}`, e);
    return false;
  }
}

(async () => {
  const ok1 = await downloadFile(REMOTE_RULES_URL, RULES_FILE);
  const ok2 = await downloadFile(REMOTE_IDS_URL, IDS_FILE);
  logger.mark(`[gossip-utils] 远程规则拉取完成: rules=${ok1}, ids=${ok2}`);
})();

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

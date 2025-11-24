/**
 * 718吃瓜套件 - 自动 git pull 版
 * #更新吃瓜 会执行 git pull 拉取远程最新规则
 * @author 寂寞沙洲冷 QV：1638276310
 */
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);

/* ---------- 1. 路径常量 ---------- */
const DATA_DIR = path.join(process.cwd(), "data");
const REPO_DIR = path.join(DATA_DIR, "sp-plugin"); // 真实仓库目录

/* ---------- 2. 确保仓库已克隆 ---------- */
(async () => {
  const gitFolder = path.join(REPO_DIR, ".git");
  if (!fs.existsSync(gitFolder)) {
    // 首次自动克隆
    const repoUrl = "https://github.com/1638276310/718.git";
    logger.mark("[gossip-utils] 首次运行，自动克隆仓库...");
    try {
      await execAsync(`git clone ${repoUrl} sp-plugin`, { cwd: DATA_DIR });
      logger.mark("[gossip-utils] 克隆完成");
    } catch (e) {
      logger.error("[gossip-utils] 克隆失败", e);
    }
  }
})();

/* ---------- 3. 业务函数 ---------- */
export async function readRules() {
  try {
    const file = path.join(REPO_DIR, "gossip-rules.json");
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    logger.error("[gossip-utils] 读取规则文件失败", e);
    return [];
  }
}

export async function readIds() {
  try {
    const file = path.join(REPO_DIR, "gossip-ids.json");
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, "utf8"));
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

/* ---------- 4. #更新吃瓜 入口 ---------- */
export async function refreshArticleIds() {
  logger.mark("[gossip-utils] 开始 git pull 更新规则...");
  try {
    // 拉取最新代码
    const { stdout } = await execAsync("git pull --ff-only", { cwd: REPO_DIR });
    logger.mark(`[gossip-utils] git pull 完成：${stdout}`);
    return true;
  } catch (e) {
    logger.error("[gossip-utils] git pull 失败", e);
    return false;
  }
}

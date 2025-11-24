/**
 * 插件名称：手动更新合集
 * 触发正则：^#?(更新|刷新)合集\s*([\d\-]*)$
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

/* 下载单页 HTML */
async function downloadPage(page) {
  const url = `https://cvkz.23und.com/thread.php?fid=3&page=${page}`;
  const { data } = await client.get(url);
  return data;
}

/* 解析 HTML 提取合集 */
function parsePage(html) {
  const tidReg =
    /<a href="read\.php\?tid=(\d+)"[^>]*class="subject"[^>]*>([^<]+)<\/a>/gi;
  const res = [];
  let m;
  while ((m = tidReg.exec(html)) !== null) {
    res.push({
      tid: m[1],
      title: m[2].trim(),
      url: `https://cvkz.23und.com/read.php?tid=${m[1]}`,
    });
  }
  return res;
}

export class NewSetManualUpdate extends plugin {
  constructor() {
    super({
      name: "手动更新合集",
      dsc: "手动刷新本地合集缓存",
      event: "message",
      rule: [
        {
          reg: "^#?(更新|刷新)合集\\s*([\\d\\-]*)$",
          fnc: "manualUpdate",
        },
      ],
    });
  }

  async manualUpdate() {
    const raw = this.e.msg.match(/^#?(更新|刷新)合集\s*([\d\-]*)$/)[2];
    let pages = [];

    if (!raw) {
      pages = [1, 2, 3, 4, 5]; // 默认 1-5
    } else if (raw.includes("-")) {
      const [start, end] = raw.split("-").map(Number);
      for (let i = start; i <= end; i++) pages.push(i);
    } else {
      pages = [Number(raw)];
    }

    await this.e.reply(`开始手动更新合集，页码：${pages.join(",")} …`, false, {
      at: true,
    });

    const all = [];
    try {
      for (const p of pages) {
        const html = await downloadPage(p);
        all.push(...parsePage(html));
      }
      fs.writeFileSync(CACHE_FILE, JSON.stringify(all, null, 2));
      await this.e.reply(`合集更新完成！共 ${all.length} 条`, false, {
        at: true,
      });
    } catch (e) {
      logger.error("[newset-manual] 更新失败", e);
      await this.e.reply("合集更新失败，请查看日志", false, { at: true });
    }
  }
}

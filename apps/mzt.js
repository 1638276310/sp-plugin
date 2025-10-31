import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/118.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

export class mztPlugin extends plugin {
  constructor() {
    super({
      name: "mzt图片提取插件",
      dsc: "从妹子图网站提取妹子的图片",
      event: "message",
      priority: -Infinity,
      rule: [
        { reg: "^#?写真馆(\\d+)$", fnc: "processmztRequest" },
        { reg: "^#?更新写真(ID|id)$", fnc: "fetchAllmztArticleIds" },
        { reg: "^#?随机写真$", fnc: "randommztRequest" },
      ],
    });

    this.mztIds = [];
    this.loadmztIds();
  }

  getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  async loadmztIds() {
    try {
      const filePath = path.join(
        process.cwd(),
        "data",
        "sp-plugin",
        "mztids.json"
      );
      if (fs.existsSync(filePath)) {
        this.mztIds = JSON.parse(fs.readFileSync(filePath, "utf8"));
        logger.info(`成功加载 ${this.mztIds.length} 个写真ID`);
      } else {
        logger.info("写真ID文件不存在，将在下次更新时创建");
      }
    } catch (error) {
      logger.error("加载写真ID失败:", error);
    }
  }

  async randommztRequest(e) {
    if (this.mztIds.length === 0) {
      await e.reply("写真ID列表为空，请先使用 #更新写真ID", true);
      return;
    }
    const randomId =
      this.mztIds[Math.floor(Math.random() * this.mztIds.length)];
    // 只在这里提示一次，并带上 ID
    await e.reply(`写真ID：${randomId} 正在搜索，请稍等...`, false, {
      at: true,
      recallMsg: 60,
    });
    // 调用时不重复提示
    await this.processmztRequest({ ...e, msg: `#写真馆${randomId}` }, true);
  }

  async processmztRequest(e, skipTip = false) {
    if (!skipTip) {
      await e.reply("正在搜索，请稍等...", false, { at: true, recallMsg: 60 });
    }
    const match = e.msg.match(/^#?写真馆(\d+)$/);
    if (!match) return;

    const articleId = match[1];
    const baseUrl = `https://kkmzt.com/photo/${articleId}`;

    try {
      const browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: "new",
      });
      const page = await browser.newPage();
      await page.setUserAgent(this.getRandomUserAgent());
      await page.goto(baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      let articleTitle = "未知标题";
      let publishTime = "未知时间";
      try {
        articleTitle = await page.$eval(
          "h1.uk-article-title.uk-text-truncate",
          (el) => el.textContent.trim()
        );
      } catch {}
      try {
        publishTime = await page.$eval("time", (el) => el.textContent.trim());
      } catch {}

      const imageUrls = new Set();
      let imageCount = 0;

      const collect = async () => {
        const imgs = await page.$$eval('img[referrerpolicy="origin"]', (els) =>
          els.map((i) => i.src)
        );
        for (const url of imgs) {
          if (imageCount >= 20) break;
          if (!imageUrls.has(url)) {
            imageUrls.add(url);
            imageCount++;
            logger.info(`找到图片 (${imageCount}): ${url}`);
          }
        }
      };

      await collect();
      while (imageCount < 20) {
        const nextBtn = await page.$(
          'div.uk-position-center-right.uk-overlay.uk-overlay-default.f-swich[action="next"]'
        );
        if (!nextBtn) break;
        await nextBtn.click();
        await new Promise((r) => setTimeout(r, 1000));
        await collect();
      }

      await browser.close();
      const uniqueImageUrls = Array.from(imageUrls);
      if (uniqueImageUrls.length === 0) {
        await e.reply("没有找到任何图片，请稍后再试。", true);
        return;
      }

      const messages = [
        {
          message: `📌 文章标题: ${articleTitle}`,
          nickname: e.user_id.toString(),
          user_id: e.user_id,
        },
        {
          message: `⏰ 发布时间: ${publishTime}`,
          nickname: e.user_id.toString(),
          user_id: e.user_id,
        },
        {
          message: `🆔 文章ID: ${articleId}`,
          nickname: e.user_id.toString(),
          user_id: e.user_id,
        },
        ...uniqueImageUrls.map((url) => ({
          message: segment.image(url),
          nickname: e.user_id.toString(),
          user_id: e.user_id,
        })),
      ];

      if (e.bot?.version?.app_name === "NapCat.Onebot") {
        const nodes = messages.map((msg) => {
          const content = [];
          const msgArray = Array.isArray(msg.message)
            ? msg.message
            : [msg.message];
          for (const item of msgArray) {
            if (typeof item === "string") {
              content.push({ type: "text", data: { text: item } });
            } else if (item?.type === "image") {
              const fileUrl =
                item.data?.file || item.data?.url || item.file || "";
              content.push(
                fileUrl
                  ? { type: "image", data: { file: fileUrl } }
                  : { type: "text", data: { text: "[图片解析失败]" } }
              );
            } else {
              content.push({
                type: "text",
                data: { text: "不支持的消息类型" },
              });
            }
          }
          return {
            type: "node",
            data: { nickname: msg.nickname, user_id: msg.user_id, content },
          };
        });
        const body = {
          group_id: e.group_id,
          user_id: e.user_id,
          message: nodes,
          news: [{ text: "QQ/VX：1638276310" }],
          prompt: "QQ/VX：1638276310",
          summary: "QQ/VX：1638276310",
          source: "QQ/VX：1638276310",
        };
        if (e.isGroup) await e.bot.sendApi("send_group_forward_msg", body);
        else await e.bot.sendApi("send_private_forward_msg", body);
      } else {
        const forwardMsg = await Bot.makeForwardMsg(messages);
        await e.reply(forwardMsg);
      }
    } catch (error) {
      logger.error(`操作失败：${error.message}`);
      await e.reply("连接网页失败，请稍后再试", true);
    }
  }

  async fetchAllmztArticleIds(e) {
    if (e && !e.isMaster) {
      e.reply("仅主人可用", true);
      return true;
    }
    if (e)
      await e.reply("开始增量更新写真ID列表，这可能需要几分钟时间...", true);
    else logger.info("[定时任务] 开始自动增量更新写真ID");

    const baseUrl = "https://kkmzt.com/photo/";
    const existSet = new Set(this.mztIds);
    let newlyAdded = 0;
    let browser;
    let pageNo = 1;
    let stop = false;

    try {
      browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: "new",
      });
      const page = await browser.newPage();
      await page.setUserAgent(this.getRandomUserAgent());

      while (!stop) {
        const url = pageNo === 1 ? baseUrl : `${baseUrl}page/${pageNo}/`;
        logger.info(`[增量] 拉取列表页 ${url}`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

        const pageIds = await page.$$eval("a.uk-inline.u-thumb-v", (links) =>
          links
            .map((link) => {
              const m = link.href.match(/\/photo\/(\d+)\/?$/);
              return m ? m[1] : null;
            })
            .filter(Boolean)
        );
        if (pageIds.length === 0) break;

        const allExists = pageIds.every((id) => existSet.has(id));
        if (allExists) {
          logger.info("[增量] 本页ID已全部存在，终止翻页");
          stop = true;
        } else {
          for (const id of pageIds) {
            if (!existSet.has(id)) {
              existSet.add(id);
              this.mztIds.unshift(id);
              newlyAdded++;
            }
          }
        }
        await new Promise((r) => setTimeout(r, 800));
        pageNo++;
      }
      await browser.close();

      const filePath = path.join(
        process.cwd(),
        "data",
        "sp-plugin",
        "mztids.json"
      );
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(this.mztIds), "utf8");
      logger.info(`文章ID已保存到 ${filePath}`);

      const msg = `增量更新完成！新增 ${newlyAdded} 个ID，当前总计 ${this.mztIds.length} 个`;
      if (e) await e.reply(msg, true);
      else logger.info(`[定时任务] ${msg}`);
    } catch (error) {
      logger.error("增量更新失败:", error);
      if (e) await e.reply(`更新失败: ${error.message}`, true);
      else logger.error(`[定时任务] 增量更新失败: ${error.message}`);
    } finally {
      if (browser) await browser.close();
    }
  }
}

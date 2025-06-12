import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

export class MZTPlugin extends plugin {
  constructor() {
    super({
      name: "MZT图片提取插件",
      dsc: "从妹子图网站提取妹子的图片",
      event: "message",
      priority: -Infinity,
      rule: [
        {
          reg: "^#?写真馆(\\d+)$",
          fnc: "processMZTRequest",
        },
        {
          reg: "^#?更新写真ID$",
          fnc: "fetchAllMZTArticleIds",
        },
        {
          reg: "^#?更新潮拍ID$",
          fnc: "fetchAllBeautyArticleIds",
        },
      ],
    });
  }

  async processMZTRequest(e) {
    await e.reply("正在搜索，请稍等...", false, { at: true, recallMsg: 60 });
    const match = e.msg.match(/^#?妹子图(\d+)$/);
    if (!match) return;

    const articleId = match[1];
    const baseUrl = `https://kkmzt.com/photo/${articleId}`;

    try {
      const browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: "new",
      });
      const page = await browser.newPage();

      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      await page.goto(baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      const imageUrls = new Set();
      let imageCount = 0;

      let pageImages = await page.$$eval(
        'img[referrerpolicy="origin"]',
        (imgs) => imgs.map((img) => img.src)
      );
      if (pageImages.length > 0) {
        for (const imgUrl of pageImages) {
          if (imageCount >= 20) break;
          imageUrls.add(imgUrl);
          imageCount++;
          console.log(`找到图片 (${imageCount}): ${imgUrl}`);
        }
      } else {
        console.log("在初始页面上未找到符合条件的图片");
      }

      while (imageCount < 20) {
        const nextButton = await page.$(
          'div.uk-position-center-right.uk-overlay.uk-overlay-default.f-swich[action="next"]'
        );
        if (!nextButton) {
          console.log("未找到下一页按钮，结束爬取");
          break;
        }

        console.log("点击了下一页按钮，等待1秒...");
        await nextButton.click();
        await new Promise((resolve) => setTimeout(resolve, 1000));

        pageImages = await page.$$eval('img[referrerpolicy="origin"]', (imgs) =>
          imgs.map((img) => img.src)
        );

        if (pageImages.length > 0) {
          for (const imgUrl of pageImages) {
            if (imageCount >= 20) break;
            if (!imageUrls.has(imgUrl)) {
              imageUrls.add(imgUrl);
              imageCount++;
              console.log(`找到图片 (${imageCount}): ${imgUrl}`);
            }
          }
        } else {
          console.log("在新页面上未找到符合条件的图片元素");
        }
      }

      await browser.close();
      const uniqueImageUrls = Array.from(imageUrls);
      console.log(`总共获取到 ${uniqueImageUrls.length} 张不重复的图片`);

      if (uniqueImageUrls.length === 0) {
        await e.reply("没有找到任何图片，请稍后再试。", true);
        return;
      }

      const messages = uniqueImageUrls.map((url) => ({
        message: segment.image(url),
        nickname: e.user_id.toString(),
        user_id: e.user_id,
      }));

      const forwardMsg = await Bot.makeForwardMsg(messages);
      await e.reply(forwardMsg);
    } catch (error) {
      console.error(`操作失败：${error.message}`);
      await e.reply("连接网页失败，请稍后再试", true);
    }
  }

  async fetchAllMZTArticleIds(e) {
    await e.reply("开始更新写真ID列表，这可能需要几分钟时间...", true);
    const baseUrl = "https://kkmzt.com/photo/";
    const allIds = [];
    let browser;

    try {
      browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: "new",
      });
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      await page.goto(baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      let totalPages = 1;
      const pagination = await page.$("ul.uk-pagination");
      if (pagination) {
        const lastPageElement = await pagination.$("li:nth-last-child(2)");
        if (lastPageElement) {
          const lastPageText = await lastPageElement.evaluate((el) =>
            el.textContent?.trim()
          );
          if (lastPageText && !isNaN(lastPageText)) {
            totalPages = parseInt(lastPageText);
          }
        }
      }
      console.log(`检测到总页数: ${totalPages}`);

      for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
        const pageUrl =
          currentPage === 1 ? baseUrl : `${baseUrl}page/${currentPage}/`;
        if (currentPage > 1) {
          await page.goto(pageUrl, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
        }

        const pageIds = await page.$$eval("a.uk-inline.u-thumb-v", (links) =>
          links
            .map((link) => {
              const match = link.href.match(/\/photo\/(\d+)\/?$/);
              return match ? match[1] : null;
            })
            .filter(Boolean)
        );

        allIds.push(...pageIds);
        console.log(
          `第 ${currentPage}/${totalPages} 页完成，收集到 ${pageIds.length} 个ID`
        );

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      const uniqueIds = [...new Set(allIds)];
      const filePath = path.join(
        process.cwd(),
        "data",
        "sp-plugin",
        "mztids.json"
      );

      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, "[]", "utf8");
      }

      fs.writeFileSync(filePath, JSON.stringify(uniqueIds), "utf8");
      console.log(`文章ID已保存到 ${filePath}`);

      await e.reply(`ID收集完成！共获取 ${uniqueIds.length} 个唯一ID`, true);
    } catch (error) {
      console.error("ID收集失败:", error);
      await e.reply(`ID收集失败: ${error.message}`, true);
    } finally {
      if (browser) await browser.close();
    }
  }

  async fetchAllBeautyArticleIds(e) {
    await e.reply("开始更新潮拍ID列表，这可能需要几分钟时间...", true);
    const baseUrl = "https://kkmzt.com/beauty/";
    const allIds = [];
    let browser;

    try {
      browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: "new",
      });
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      await page.goto(baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      let totalPages = 1;
      const pagination = await page.$("ul.uk-pagination");
      if (pagination) {
        const lastPageElement = await pagination.$("li:nth-last-child(2)");
        if (lastPageElement) {
          const lastPageText = await lastPageElement.evaluate((el) =>
            el.textContent?.trim()
          );
          if (lastPageText && !isNaN(lastPageText)) {
            totalPages = parseInt(lastPageText);
          }
        }
      }
      console.log(`检测到总页数: ${totalPages}`);

      for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
        const pageUrl =
          currentPage === 1 ? baseUrl : `${baseUrl}page/${currentPage}/`;
        if (currentPage > 1) {
          await page.goto(pageUrl, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
        }

        const pageIds = await page.$$eval(
          "div.uk-article h2.uk-margin-remove a",
          (links) =>
            links
              .map((link) => {
                const match = link.href.match(/\/beauty\/(\d+)\/?$/);
                return match ? match[1] : null;
              })
              .filter(Boolean)
        );

        allIds.push(...pageIds);
        console.log(
          `第 ${currentPage}/${totalPages} 页完成，收集到 ${pageIds.length} 个潮拍ID`
        );

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      const uniqueIds = [...new Set(allIds)];
      const filePath = path.join(
        process.cwd(),
        "data",
        "sp-plugin",
        "beautyids.json"
      );

      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, "[]", "utf8");
      }

      fs.writeFileSync(filePath, JSON.stringify(uniqueIds), "utf8");
      console.log(`潮拍ID已保存到 ${filePath}`);

      await e.reply(
        `潮拍ID收集完成！共获取 ${uniqueIds.length} 个唯一ID`,
        true
      );
    } catch (error) {
      console.error("潮拍ID收集失败:", error);
      await e.reply(`潮拍ID收集失败: ${error.message}`, true);
    } finally {
      if (browser) await browser.close();
    }
  }
}

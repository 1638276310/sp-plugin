import puppeteer from "puppeteer";

const DEFAULT_HEADERS = {
  Accept: "*/*",
  "Accept-Encoding": "gzip, deflate",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  "X-Requested-With": "XMLHttpRequest",
};

export class Cao extends plugin {
  constructor() {
    super({
      name: "Y:磁力草",
      dsc: "磁力草",
      event: "message",
      priority: "-Infinity",
      rule: [
        {
          reg: "^#?磁力草(.*)$",
          fnc: "MagnetLinkcao",
        },
      ],
    });
  }

  async MagnetLinkcao(e) {
    // if (!e.isGroup) return;
    const match = e.msg.match(/^#?磁力草\s*(\S+)(?:\s+(\S+))?$/);
    if (!match) {
      return;
    }
    await e.reply("正在搜索，请稍等...", false, { at: true, recallMsg: 60 });
    const userInput = match[1];
    const sortOrder = match[2];
    let orderParam = "";
    if (sortOrder) {
      switch (sortOrder) {
        case "热度":
          orderParam = "&order=fangwen";
          break;
        case "大小":
          orderParam = "&order=length";
          break;
      }
    }
    const searchQuery = `search.php?name=${encodeURIComponent(
      userInput
    )}&page=1${orderParam}`;

    // 多域名尝试列表
    const domains = ["https://www.cilicao.xyz", "https://www.cilicao.me"];

    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true,
    });

    let success = false;
    let results = [];

    for (const domain of domains) {
      const url = `${domain}/${searchQuery}`;
      const page = await browser.newPage();

      try {
        // 动态设置请求头
        await page.setExtraHTTPHeaders({
          ...DEFAULT_HEADERS,
          Host: new URL(domain).hostname,
          Origin: domain,
          Referer: `${domain}/list.php`,
        });

        await page.goto(url, {
          waitUntil: "load",
          timeout: 150000,
        });

        const searchResults = await page.$$(
          ".card.border-dashed.border-2.mb-2"
        );

        if (!searchResults.length) {
          logger.warn(`在 ${domain} 未找到结果`);
          await page.close();
          continue;
        }

        // 处理搜索结果
        for (let element of searchResults) {
          try {
            const magnetA = await element.$("a[onclick]");
            if (!magnetA) continue;

            const onclickData = await magnetA.evaluate((a) =>
              a.getAttribute("onclick")
            );
            const match = onclickData.match(/xiangqing\('(\d)','(\w{64})'\)/);

            if (!match) continue;

            const sjk = match[1];
            const hash = match[2];
            const formData = new URLSearchParams();
            formData.append("typenum", 4);
            formData.append("md5hash", hash);
            formData.append("sjk", sjk);

            const response = await fetch(`${domain}/ajax2.php`, {
              method: "POST",
              headers: {
                ...DEFAULT_HEADERS,
                Host: new URL(domain).hostname,
                Origin: domain,
                Referer: url,
              },
              body: formData,
            });

            const data = await response.json();
            if (data.code !== 1) {
              continue;
            }

            const trueMagnetLink = `magnet:?xt=urn:btih:${data.info_hash}`;
            const title = await element.$eval("h5.card-title a", (el) =>
              el.innerText.trim()
            );
            let details = "";
            const detailsElement = await element.$("p.card-text.mb-1");
            if (detailsElement) {
              details = await detailsElement.evaluate((el) =>
                el.innerText.replace(/\|/g, "\n").trim()
              );
            }
            const message = `${title}\r\r${trueMagnetLink}\r\r${details}`;
            results.push({
              user_id: e.user_id,
              nickname: e.user_id,
              message,
            });
          } catch (error) {
            logger.error(`处理单个元素错误: ${error.toString()}`);
          }
        }

        if (results.length > 0) {
          success = true;
          await page.close();
          break; // 成功获取结果，跳出循环
        }
      } catch (error) {
        logger.error(`在域名 ${domain} 上出现错误：${error.toString()}`);
      } finally {
        if (!page.isClosed()) {
          await page.close();
        }
      }
    }

    await browser.close();

    if (!success) {
      await this.reply("所有域名均无搜索结果");
    } else if (results.length === 0) {
      await this.reply("未找到有效的磁力链接");
    } else {
      const forwardMsg = await Bot.makeForwardMsg(results);
      await e.reply(forwardMsg);
    }
  }
}

/**
 * 插件名称：吃瓜搜索
 * 触发正则：^#?吃瓜搜索\s*(\S+)$
 * @author AI-Assistant
 */

import { searchArticlesByKeyword } from "../lib/gossip-utils.js";
import { readIds } from "../lib/gossip-utils.js";

export class GossipSearch extends plugin {
  constructor() {
    super({
      name: "吃瓜搜索",
      dsc: "按关键词搜索文章",
      event: "message",
      rule: [
        {
          reg: "^#?吃瓜搜索\\s*(\\S+)$",
          fnc: "search",
        },
      ],
    });
  }

  async search() {
    const kw = this.e.msg.match(/^#?吃瓜搜索\s*(\S+)$/)[1].trim();
    await this.e.reply(`正在搜索“${kw}”...`, false, { at: true });

    const list = await searchArticlesByKeyword(kw);
    if (!list.length)
      return this.e.reply("未找到相关文章", false, { at: true });

    const { excludedIds } = await readIds();
    const nodes = [
      {
        user_id: this.e.user_id,
        nickname: this.e.sender.nickname,
        message: [`🔍包含关键词“${kw}”的搜索结果：`],
      },
    ];
    list.forEach((it, i) => {
      const st = excludedIds.includes(it.id) ? " (已失效)" : "";
      nodes.push({
        user_id: this.e.user_id,
        nickname: this.e.sender.nickname,
        message: [`${i + 1}. ${it.title}${st}\n📌ID: ${it.id}`],
      });
    });

    /* ===== NapCat 原样开始 ===== */
    if (this.e.bot?.version?.app_name === "NapCat.Onebot") {
      const ncNodes = [];
      for (const node of nodes) {
        const messages = Array.isArray(node.message)
          ? node.message
          : [node.message];
        const content = [];
        for (const item of messages) {
          if (typeof item === "string") {
            content.push({ type: "text", data: { text: item } });
          } else if (item?.type === "image") {
            content.push({ type: "image", data: { file: item.data.file } });
          } else if (item?.type === "video") {
            content.push({ type: "video", data: { file: item.data.file } });
          } else {
            content.push({ type: "text", data: { text: "不支持的消息类型" } });
          }
        }
        ncNodes.push({
          type: "node",
          data: {
            nickname: this.e.sender.nickname,
            user_id: this.e.user_id,
            content: content,
          },
        });
      }
      const requestBody = {
        group_id: this.e.group_id,
        user_id: this.e.user_id,
        message: ncNodes,
        news: [{ text: "QQ/VX：1638276310" }],
        prompt: "QQ/VX：1638276310",
        summary: `QQ/VX：1638276310`,
        source: "QQ/VX：1638276310",
      };
      if (this.e.isGroup) {
        await this.e.bot.sendApi("send_group_forward_msg", requestBody);
      } else {
        await this.e.bot.sendApi("send_private_forward_msg", requestBody);
      }
      return;
    }
    /* ===== NapCat 原样结束 ===== */

    await this.e.reply(await Bot.makeForwardMsg(nodes));
  }
}

/**
 * 插件名称：吃瓜搜索
 * 触发正则：^#?吃瓜搜索\s*(\S+)$
 * @author 寂寞沙洲冷 QV：1638276310
 */
import { searchArticlesByKeyword } from "../lib/gossip-utils.js";

export class GossipSearch extends plugin {
  constructor() {
    super({
      name: "吃瓜搜索",
      dsc: "按关键词搜索文章",
      event: "message",
      rule: [{ reg: "^#?吃瓜搜索\\s*(\\S+)$", fnc: "search" }],
    });
  }

  async search() {
    const kw = this.e.msg.match(/^#?吃瓜搜索\s*(\S+)$/)[1].trim();
    await this.e.reply(`正在搜索“${kw}”...`, false, { at: true });
    const list = await searchArticlesByKeyword(kw);
    if (!list.length)
      return this.e.reply("未找到相关文章", false, { at: true });

    const nodes = [
      {
        user_id: this.e.user_id,
        nickname: this.e.sender.nickname,
        message: [`🔍包含关键词“${kw}”的搜索结果：`],
      },
    ];
    list.forEach((it, i) => {
      nodes.push({
        user_id: this.e.user_id,
        nickname: this.e.sender.nickname,
        message: [`${i + 1}. ${it.title}\n📌ID: ${it.id}`],
      });
    });

    if (this.e.bot?.version?.app_name === "NapCat.Onebot") {
      const ncNodes = nodes.map((node) => ({
        type: "node",
        data: {
          nickname: this.e.sender.nickname,
          user_id: this.e.user_id,
          content: Array.isArray(node.message)
            ? node.message.map((m) => ({ type: "text", data: { text: m } }))
            : [{ type: "text", data: { text: node.message } }],
        },
      }));
      const body = {
        group_id: this.e.group_id,
        user_id: this.e.user_id,
        message: ncNodes,
        news: [{ text: "QQ/VX：1638276310" }],
        prompt: "QQ/VX：1638276310",
        summary: `QQ/VX：1638276310`,
        source: "QQ/VX：1638276310",
      };
      return await this.e.bot.sendApi(
        this.e.isGroup ? "send_group_forward_msg" : "send_private_forward_msg",
        body
      );
    }
    await this.e.reply(await Bot.makeForwardMsg(nodes));
  }
}

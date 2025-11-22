/**
 * 插件名称：吃瓜往期
 * 触发正则：^#?吃瓜(\d+)个往期$
 * @author 寂寞沙洲冷 QV：1638276310
 */
import { fetchPastArticles } from "../lib/gossip-utils.js";

export class GossipPast extends plugin {
  constructor() {
    super({
      name: "吃瓜往期",
      dsc: "获取最新 N 篇往期文章",
      event: "message",
      rule: [{ reg: "^#?吃瓜(\\d+)个往期$", fnc: "past" }],
    });
  }
  async past() {
    const n = parseInt(this.e.msg.match(/^#?吃瓜(\d+)个往期$/)[1]);
    await this.e.reply(`正在获取前 ${n} 个往期文章...`, false, { at: true });
    const list = await fetchPastArticles(n);
    if (!list.length) return this.e.reply("获取失败", false, { at: true });
    const nodes = [
      {
        user_id: this.e.user_id,
        nickname: this.e.sender.nickname,
        message: [`以下是 ${list.length} 个往期文章：`],
      },
    ];
    list.forEach((it, i) => {
      nodes.push({
        user_id: this.e.user_id,
        nickname: this.e.sender.nickname,
        message: [`${i + 1}. 📝标题: ${it.title}\n🆔ID: ${it.id}`],
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

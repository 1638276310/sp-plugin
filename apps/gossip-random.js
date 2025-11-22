/**
 * 插件名称：随机吃瓜
 * 触发正则：^#?随机吃瓜$
 * @author 寂寞沙洲冷 QV：1638276310
 */
import { readIds } from "../lib/gossip-utils.js";
import { fetchVideoById } from "../lib/gossip-utils.js";

export class GossipRandom extends plugin {
  constructor() {
    super({
      name: "随机吃瓜",
      dsc: "随机挑一篇未失效的文章",
      event: "message",
      rule: [{ reg: "^#?随机吃瓜$", fnc: "random" }],
    });
  }
  async random() {
    const ids = await readIds();
    if (!ids.length) return this.e.reply("暂无可用视频", false, { at: true });
    const id = ids[Math.floor(Math.random() * ids.length)];
    await this.e.reply(`随机选中 ${id}，正在获取...`, false, { at: true });
    const data = await fetchVideoById(id);
    if (!data) return this.e.reply("获取失败", false, { at: true });
    const nodes = [
      {
        user_id: this.e.user_id,
        nickname: this.e.sender.nickname,
        message: [
          `✅随机视频获取成功！\n🆔文章ID: ${data.id}\n📝标题: ${data.title}\n📅发布时间: ${data.publishTime}`,
        ],
      },
    ];
    if (data.videoUrls.length) {
      nodes.push({
        user_id: this.e.user_id,
        nickname: this.e.sender.nickname,
        message: ["🔗视频地址列表:"],
      });
      data.videoUrls.forEach((u) =>
        nodes.push({
          user_id: this.e.user_id,
          nickname: this.e.sender.nickname,
          message: [u],
        })
      );
    }
    if (data.articleContent.length) {
      nodes.push({
        user_id: this.e.user_id,
        nickname: this.e.sender.nickname,
        message: ["📖文章内容:"],
      });
      data.articleContent.forEach((t) =>
        nodes.push({
          user_id: this.e.user_id,
          nickname: this.e.sender.nickname,
          message: [t],
        })
      );
    }
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

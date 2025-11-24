/**
 * 插件名称：最新合集列表
 * 触发正则：^#?最新合集(\d+)页$
 * @author  寂寞沙洲冷  QV：1638276310
 */
import { fetchSetByPage } from "../lib/newset-utils.js";

export class NewSetList extends plugin {
  constructor() {
    super({
      name: "最新合集列表",
      dsc: "分页获取合集标题与链接",
      event: "message",
      rule: [{ reg: "^#?最新合集(\\d+)页$", fnc: "showList" }],
    });
  }

  async showList() {
    const page = parseInt(this.e.msg.match(/^#?最新合集(\d+)页$/)[1]);
    await this.e.reply(`正在获取第 ${page} 页合集，请稍候…`, false, {
      at: true,
    });

    const list = await fetchSetByPage(page);
    if (!list.length) return this.e.reply("本页暂无数据", false, { at: true });

    const nodes = [
      {
        type: "node",
        data: {
          user_id: this.e.user_id,
          nickname: this.e.sender.nickname,
          content: [
            {
              type: "text",
              data: { text: `第 ${page} 页合集（共 ${list.length} 条）` },
            },
          ],
        },
      },
    ];
    list.forEach((it) => {
      nodes.push({
        type: "node",
        data: {
          user_id: this.e.user_id,
          nickname: this.e.sender.nickname,
          content: [
            {
              type: "text",
              data: {
                text: `标题：${it.title}\n链接：https://7fep.27l4l.com/read.php?tid=${it.tid}`,
              },
            },
          ],
        },
      });
    });

    const body = {
      [this.e.isGroup ? "group_id" : "user_id"]: this.e.isGroup
        ? this.e.group_id
        : this.e.user_id,
      messages: nodes,
      news: [{ text: "最新合集列表" }],
      prompt: "最新合集列表",
      summary: `第 ${page} 页，共 ${list.length} 条`,
      source: "最新合集插件",
    };

    try {
      await this.e.bot.sendApi(
        this.e.isGroup ? "send_group_forward_msg" : "send_private_forward_msg",
        body
      );
    } catch (err) {
      logger.error("[newset-list] 发送转发消息失败：", err);
      await this.e.reply(`第 ${page} 页获取失败，请稍后再试`, false, {
        at: true,
      });
    }
  }
}

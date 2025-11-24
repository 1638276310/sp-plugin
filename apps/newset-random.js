/**
 * 插件名称：随机合集
 * 触发正则：^#?随机合集$
 * @author  寂寞沙洲冷  QV：1638276310
 */
import { randomOneSet } from "../lib/newset-utils.js";

export class NewSetRandom extends plugin {
  constructor() {
    super({
      name: "随机合集",
      dsc: "随机推送一条合集",
      event: "message",
      rule: [{ reg: "^#?随机合集$", fnc: "random" }],
    });
  }

  async random() {
    await this.e.reply("正在抽取随机合集…", false, { at: true });
    const item = await randomOneSet();
    if (!item)
      return this.e.reply("暂无数据，请先刷新合集", false, { at: true });

    const nodes = [
      {
        type: "node",
        data: {
          user_id: this.e.user_id,
          nickname: this.e.sender.nickname,
          content: [
            {
              type: "text",
              data: {
                text: `🎲随机合集\n标题：${item.title}\n链接：https://7fep.27l4l.com/read.php?tid=${item.tid}`,
              },
            },
          ],
        },
      },
    ];

    const body = {
      [this.e.isGroup ? "group_id" : "user_id"]: this.e.isGroup
        ? this.e.group_id
        : this.e.user_id,
      messages: nodes,
      news: [{ text: "随机合集" }],
      prompt: "随机合集",
      summary: "随机推送一条合集",
      source: "最新合集插件",
    };

    try {
      await this.e.bot.sendApi(
        this.e.isGroup ? "send_group_forward_msg" : "send_private_forward_msg",
        body
      );
    } catch (err) {
      logger.error("[newset-random] 发送转发消息失败：", err);
      await this.e.reply("随机合集推送失败", false, { at: true });
    }
  }
}

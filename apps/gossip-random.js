/**
 * 插件名称：随机吃瓜
 * 触发正则：^#?随机吃瓜$
 * @author AI-Assistant
 */

import { readIds } from '../lib/gossip-utils.js'
import { fetchVideoById } from '../lib/gossip-utils.js'

export class GossipRandom extends plugin {
  constructor() {
    super({
      name: '随机吃瓜',
      dsc: '随机挑一篇未失效的文章',
      event: 'message',
      rule: [
        {
          reg: '^#?随机吃瓜$',
          fnc: 'random'
        }
      ]
    })
  }

  /**
   * 主入口：随机 ID -> 解析 -> 转发
   */
  async random() {
    const { articleIds, excludedIds } = await readIds()
    const ok = articleIds.filter(id => !excludedIds.includes(id))
    if (!ok.length) return this.e.reply('暂无可用视频', false, { at: true })

    const id = ok[Math.floor(Math.random() * ok.length)]
    await this.e.reply(`随机选中 ${id}，正在获取...`, false, { at: true })

    const data = await fetchVideoById(id)
    if (!data) return this.e.reply('获取失败', false, { at: true })

    const nodes = [
      {
        user_id: this.e.user_id,
        nickname: this.e.sender.nickname,
        message: [
          `✅随机视频获取成功！\n🆔文章ID: ${data.id}\n📝标题: ${data.title}\n📅发布时间: ${data.publishTime}`
        ]
      }
    ]
    if (data.videoUrls.length) {
      nodes.push({ user_id: this.e.user_id, nickname: this.e.sender.nickname, message: ['🔗视频地址列表:'] })
      data.videoUrls.forEach(u => nodes.push({ user_id: this.e.user_id, nickname: this.e.sender.nickname, message: [u] }))
    }
    if (data.articleContent.length) {
      nodes.push({ user_id: this.e.user_id, nickname: this.e.sender.nickname, message: ['📖文章内容:'] })
      data.articleContent.forEach(t => nodes.push({ user_id: this.e.user_id, nickname: this.e.sender.nickname, message: [t] }))
    }
    await this.e.reply(await Bot.makeForwardMsg(nodes))
  }
}
/**
 * 插件名称：吃瓜往期
 * 触发正则：^#?吃瓜(\d+)个往期$
 * @author AI-Assistant
 */

import { fetchPastArticles } from '../lib/gossip-utils.js'
import { readIds } from '../lib/gossip-utils.js'

export class GossipPast extends plugin {
  constructor() {
    super({
      name: '吃瓜往期',
      dsc: '获取最新 N 篇往期文章',
      event: 'message',
      rule: [
        {
          reg: '^#?吃瓜(\\d+)个往期$',
          fnc: 'past'
        }
      ]
    })
  }

  /**
   * 主入口：N -> 抓取列表 -> 转发
   */
  async past() {
    const n = parseInt(this.e.msg.match(/^#?吃瓜(\d+)个往期$/)[1])
    await this.e.reply(`正在获取前 ${n} 个往期文章...`, false, { at: true })

    const list = await fetchPastArticles(n)
    if (!list.length) return this.e.reply('获取失败', false, { at: true })

    const { excludedIds } = await readIds()
    const nodes = [
      {
        user_id: this.e.user_id,
        nickname: this.e.sender.nickname,
        message: [`以下是 ${list.length} 个往期文章：`]
      }
    ]
    list.forEach((it, i) => {
      const st = excludedIds.includes(it.id) ? ' (已失效)' : ''
      nodes.push({
        user_id: this.e.user_id,
        nickname: this.e.sender.nickname,
        message: [`${i + 1}. 📝标题: ${it.title}${st}\n🆔ID: ${it.id}`]
      })
    })
    await this.e.reply(await Bot.makeForwardMsg(nodes))
  }
}
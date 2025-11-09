/**
 * 插件名称：吃瓜搜索
 * 触发正则：^#?吃瓜搜索\s*(\S+)$
 * @author AI-Assistant
 */

import { searchArticlesByKeyword } from '../lib/gossip-utils.js'
import { readIds } from '../lib/gossip-utils.js'

export class GossipSearch extends plugin {
  constructor() {
    super({
      name: '吃瓜搜索',
      dsc: '按关键词搜索文章',
      event: 'message',
      rule: [
        {
          reg: '^#?吃瓜搜索\\s*(\\S+)$',
          fnc: 'search'
        }
      ]
    })
  }

  /**
   * 主入口：关键词 -> 搜索 -> 转发列表
   */
  async search() {
    const kw = this.e.msg.match(/^#?吃瓜搜索\s*(\S+)$/)[1].trim()
    await this.e.reply(`正在搜索“${kw}”...`, false, { at: true })

    const list = await searchArticlesByKeyword(kw)
    if (!list.length) return this.e.reply('未找到相关文章', false, { at: true })

    const { excludedIds } = await readIds()
    const nodes = [
      {
        user_id: this.e.user_id,
        nickname: this.e.sender.nickname,
        message: [`🔍包含关键词“${kw}”的搜索结果：`]
      }
    ]
    list.forEach((it, i) => {
      const st = excludedIds.includes(it.id) ? ' (已失效)' : ''
      nodes.push({
        user_id: this.e.user_id,
        nickname: this.e.sender.nickname,
        message: [`${i + 1}. ${it.title}${st}\n📌ID: ${it.id}`]
      })
    })
    await this.e.reply(await Bot.makeForwardMsg(nodes))
  }
}
/**
 * 插件名称：吃瓜更新
 * 触发正则：^(#)?更新吃瓜(ID|id)$
 * @author AI-Assistant
 */

import plugin from '../../../lib/plugins/plugin.js'
import { refreshArticleIds } from './lib/gossip-utils.js'

export class GossipUpdate extends plugin {
  constructor() {
    super({
      name: '吃瓜更新',
      dsc: '重新生成文章 ID 列表',
      event: 'message',
      rule: [
        {
          reg: '^(#)?更新吃瓜(ID|id)$',
          fnc: 'update'
        }
      ]
    })
  }

  /**
   * 主入口：校验权限 -> 刷新 -> 回复结果
   */
  async update() {
    if (!this.e.isMaster) return this.e.reply('仅主人可用', true)

    await this.e.reply('正在更新文章 ID 列表...', false, { at: true })
    const ok = await refreshArticleIds()
    await this.e.reply(ok ? '文章 ID 更新成功！' : '更新失败，请稍后重试', false, { at: true })
  }
}
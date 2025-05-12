import plugin from '../../../lib/plugins/plugin.js';

export class sphelp extends plugin {
    constructor() {
        super({
            name: '涩批帮助',
            dsc: '获取涩批插件帮助',
            event: 'message',
            priority: '5001',
            rule: [
                {
                    reg: '^#?sp帮助$', 
                    fnc: 'sp_help'
                }
            ]
        });
    }
async sp_help(e) {
    try {
        await this.reply([segment.image("https://ps.ssl.qhimg.com/t027f53f1cdfbdeef2c.jpg")]);
    } catch (error) {
        console.error('发送图片消息时出错:', error);
    }
}
}
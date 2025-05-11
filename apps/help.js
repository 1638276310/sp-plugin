import plugin from '../../../lib/plugins/plugin.js';

export class sp_help extends plugin {
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
        await this.reply(
                    await e.reply([segment.image("./config/help.png"), "涩批帮助"])
        )
    }
}
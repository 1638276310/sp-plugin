import plugin from '../../../lib/plugins/plugin.js';
import { segment } from 'oicq';
import fs from 'fs';
import path from 'path';

export class example extends plugin {
    constructor() {
        super({
            name: '23图',
            dsc: '二刺螈和三次元',
            event: 'message',
            priority: 78000,
            rule: [
                {
                    reg: '^(#?)(2|2次元|二|二刺螈|二次元)图$',
                    fnc: 'Picture'
                },
                {
                    reg: '^(#?)(3|3次元|三|三刺螈|三次元|)图$',
                    fnc: 'Video'
                },
            ]
        })
    }

    async P2(e) {
        try {
            const filePath = './plugins/kkp-plugin/config/23tu.json';
            const data = fs.readFileSync(filePath, 'utf8');
            const jsonData = JSON.parse(data);
            const P2 = jsonData.P2 || [];

            const randomIndex = Math.floor(Math.random() * P2.length);
            await e.reply("正在探索二刺螈中...");
            await e.reply(segment.image(P2[randomIndex]));
            return true;
        } catch (error) {
            e.reply("请求失败，请稍后再试");
            return true;
        }
    }

    async P3(e) {
        try {
            const filePath = './plugins/kkp-plugin/config/23tu.json';
            const data = fs.readFileSync(filePath, 'utf8');
            const jsonData = JSON.parse(data);
            const P3 = jsonData.P3 || [];

            const randomIndex = Math.floor(Math.random() * P3.length);
            await e.reply("正在探索三次元中...");
            await e.reply(segment.video(P3[randomIndex]));
            return true;
        } catch (error) {
            e.reply("请求失败，请稍后再试");
            return true;
        }
    }
}
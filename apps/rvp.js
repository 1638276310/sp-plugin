import plugin from '../../../lib/plugins/plugin.js';
import { segment } from 'oicq';

export class example extends plugin {
	constructor() {
		super({
			name: '我爱涩涩',
			dsc: '发送随机图片和视频',
			event: 'message',
			priority: 5000,
			rule: [
                {
					reg: '^(#?)rvp随机图$',
					fnc: 'Picture'
				},
                {
					reg: '^(#?)rvp随机视频$',
					fnc: 'Video'
				},
			]
		})
	}




    async Picture(e) {
        try {
            const Picture_apis = [
			'https://api.r10086.com/樱道随机图片api接口.php?图片系列=少女写真1',
            'http://api.yujn.cn/api/r18.php',
            'https://imgapi.cn/cos.php',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=萝莉',
            'https://api.yujn.cn/api/gzl_ACG.php?type=image&form=pc',
            'http://api.yujn.cn/api/yht.php',
            'http://api.yujn.cn/api/sese.php',
            'https://moe.jitsu.top/api?sort=all',
            'https://moe.jitsu.top/api?sort=mp',
            'https://moe.jitsu.top/api?sort=pc',
            'https://moe.jitsu.top/api?sort=1080',
            'https://moe.jitsu.top/api?sort=setu',
            'https://moe.jitsu.top/api?sort=furry',
            'https://image.anosu.top/pixiv/direct?r18=1&keyword=touhou',
            'http://se.csnmb.com/API/ql.php',
            'https://image.anosu.top/pixiv/direct?r18=1',
            'http://se.csnmb.com/API/tu.php',
            'https://api.suyanw.cn/api/ksxjj.php',
            'http://api.yujn.cn/api/jk.php',
            'https://t.alcy.cc/mp',
            'https://api.suyanw.cn/api/jk.php',
            'https://api.suyanw.cn/api/hs.php',
            'https://moe.jitsu.top/api/?sort=r18&size=small&type=602',
            'http://api.yujn.cn/api/baisi.php',
            'https://api.qtkj.love/api/yttp.php',
            'https://api.suyanw.cn/api/ys.php',
            'https://api.suyanw.cn/api/meitui.php',
            'https://api.qtkj.love/api/Cosplay.php',
            'https://api.suyanw.cn/api/mcapi.php',
            'https://api.suyanw.cn/api/mao.php',
            'https://t.mwm.moe/pc',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=动漫综合1',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=动漫综合2',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=动漫综合3',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=动漫综合4',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=动漫综合5',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=动漫综合6',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=动漫综合7',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=动漫综合8',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=动漫综合9',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=动漫综合10',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=动漫综合11',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=动漫综合12',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=动漫综合13',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=动漫综合14',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=动漫综合15',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=动漫综合16',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=动漫综合17',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=动漫综合18',
            'https://api.r10086.com/樱道随机图片api接口.php?自适应图片系列=赛马娘',
            'https://api.r10086.com/樱道随机图片api接口.php?自适应图片系列=Fate',
            'https://api.r10086.com/樱道随机图片api接口.php?自适应图片系列=为美好世界献上祝福',
            'https://api.r10086.com/樱道随机图片api接口.php?自适应图片系列=某科学的超电磁炮',
            'https://api.r10086.com/樱道随机图片api接口.php?自适应图片系列=原神',
            'https://api.r10086.com/樱道随机图片api接口.php?自适应图片系列=缘之空',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=猫娘1',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=物语系列1',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=物语系列2',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=少女前线1',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=明日方舟1',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=明日方舟2',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=重装战姬1',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=P站系列2',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=P站系列4',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=CG系列1',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=CG系列2',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=CG系列3',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=CG系列4',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=CG系列5',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=守望先锋',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=王者荣耀',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=少女写真1',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=少女写真2',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=少女写真3',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=少女写真4',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=少女写真5',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=少女写真6',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=死库水萝莉',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=萝莉',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=极品美女图片',
            'https://api.r10086.com/樱道随机图片api接口.php?图片系列=日本COS中国COS',
            ];

            const randomIndex = Math.floor(Math.random() * Picture_apis.length);
            await e.reply("正在探索未知领域中...")
            await e.reply(segment.image(Picture_apis[randomIndex]));
            return true;
        }catch (error) {
            e.reply("请求失败，请稍后再试");
            return true;
        }
    }

	async Video(e) {
		try {
			const video_apis = [
			    'http://api.yujn.cn/api/zzxjj.php',
                'http://jx.kkdy.xyz/xjj.php',
                'http://api.yujn.cn/api/xjj.php',
                //'https://sucai.03023.net/angry_uncle/meinv.php',
                'https://api.521002.xyz/video?sp=mv&type=video',
                'http://api.yujn.cn/api/dmsp.php',
                'https://api.521002.xyz/video?sp=xjj&type=video',
                'https://api.521002.xyz/video?sp=hssp&type=video',
                'https://api.521002.xyz/video?sp=bssp&type=video',
                'https://api.521002.xyz/video?sp=loli&type=video',
                'https://api.521002.xyz/video?sp=jpyz&type=video',
                'https://api.521002.xyz/video?sp=zyxl&type=video',
                'https://api.521002.xyz/video?sp=ycyy&type=video',
                'https://api.521002.xyz/video?sp=slxl&type=video',
                'https://api.521002.xyz/video?sp=hbss&type=video',
                'https://v2.api-m.com/api/meinv?return=302',
                'http://api.yujn.cn/api/chuanda.php',
                'http://api.yujn.cn/api/jjy.php',
                'http://api.yujn.cn/api/wmsc.php',
                'http://api.yujn.cn/api/qttj.php',
                'http://api.yujn.cn/api/sqxl.php',
                'https://api.yujn.cn/api/nvda.php?type=video',
                'https://api.yviii.com/video/suiji.php',
                'https://www.cunshao.com/666666/api/web.php',
                ''
			];

			const randomIndex = Math.floor(Math.random() * video_apis.length);
            await e.reply("正在探索未知领域中...")
			await e.reply(segment.video(video_apis[randomIndex]));
			return true;
		}catch (error) {
			e.reply("请求失败，请稍后再试");
			return true;
		}
	}
}

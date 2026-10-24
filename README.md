# 安装说明

## 安装

Gitee源（国内首推）
```bash
git clone https://gitee.com/q1638276310/sp-plugin.git ./plugins/sp-plugin/
```

Github源（国外推荐）
```bash
git clone https://github.com/1638276310/sp-plugin.git ./plugins/sp-plugin/
```

SSH源（需配置SSH密钥）
```bash
git clone git@gitee.com:q1638276310/sp-plugin.git ./plugins/sp-plugin/   #Gitee SSH
git clone git@github.com:1638276310/sp-plugin.git ./plugins/sp-plugin/   #GitHub SSH
```

## 安装依赖

```bash
pnpm i --filter=sp-plugin
```

## 开源协议声明
本项目基于 [所有二刺螈都得死——kkp-plugin](https://gitee.com/dungeonmaster/kkp-plugin) 二次开发。
- 原项目采用 AFL (Academic Free License) 3.0 开源协议。
- 本项目在继承原代码的基础上进行了修改与扩展，新增部分代码采用 MIT 协议。
- 请您在参考、使用或分发本项目时，遵守上述两种协议的规定，尤其必须保留原项目的所有版权声明与归属信息。


## 说明

- 本插件兼容Miao-Yunzai/Trss-Yunzai
- 兼容ICQQ（OICQ）、NCQQ
- 妹子图（mzt.js）支持 `#写真馆` / `#潮拍馆`：优先调用美之图 APP 全量图片接口
  （mTLS 客户端证书 `config/mzt_client.pem`，随仓库附带），失败时自动回退网页接口 /
  浏览器（写真馆网页端仅前 20 张预览）。证书来自官方 APK，仅用于访问图片接口；
  若本仓库公开，该证书也会随之公开。
- 妹子图 403 相关配置（`apps/mzt.js` 顶部 `MZT_CONFIG`，常量即配置）：
  - `mzt_proxy`: 直连与浏览器统一 http/https 代理（如 `http://127.0.0.1:7890`），空=直连；
  - `mzt_ua`: 覆盖统一浏览器 UA，空=内置 Chrome/124（已移除随机混合 UA）；
  - `mzt_cf_wait`: 浏览器打开文章页后等待 Cloudflare 挑战的最长秒数，默认 8；
  - `mzt_app_cert`: 自定义 mTLS 证书路径，空= `config/mzt_client.pem`。
- 修复后的抓取链路：统一浏览器头并复用文章页 Cookies → APP / 网页 / 浏览器 / 文章页首图
  多级降级；代理同时作用于接口与图片下载；日志 `[mzt] stage=... status=... cf-ray=...`
  便于定位，URL 已去掉 `sign`，不打印 Cookie/证书/HTML。
- 独立诊断（不依赖 Bot 启动）：
  `node plugins/sp-plugin/tools/mzt_diag.js --id 171317 [--site https://kkmzt.com] [--proxy http://127.0.0.1:7890] [--json]`

## 相关项目

- **AstrBot 版涩批插件 astrbot_plugin_sp**：<https://github.com/1638276310/astrbot_plugin_sp.git>

## 如果您对本插件有更好的代码建议，请提交Issues或Pull Requests

## Future

- mzt.js 已接入美之图 APP 全量图片接口（mTLS + AES-CBC，同步自 AstrBot 版），后续继续跟进站点接口变化。

## ✨ 功能    欢迎加群991639461

![帮助图](config/help.jpg)


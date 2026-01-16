import { createRequire } from 'module'
import _ from 'lodash'
import { Restart } from '../../other/restart.js'
import common from "../../../lib/common/common.js"

const require = createRequire(import.meta.url)
const { exec, execSync } = require('child_process')

// 是否在更新中
let uping = false

/**
 * sp-plugin更新插件类
 * 提供sp插件的更新功能，包括常规更新、强制更新、获取更新日志等
 * @class Update
 * @extends plugin
 */
export class Update extends plugin {
    /**
     * 构造函数
     * 初始化插件名称、描述、事件、优先级和规则
     * @constructor
     */
    constructor() {
        super({
            name: '更新sp插件',
            dsc: '更新sp-plugin插件',
            event: 'message',
            priority: 10,
            rule: [
                {
                    reg: '^#*(sp|涩批|色批|色胚|涩胚)(插件)?(强制)?更新$',
                    fnc: 'update'
                }
            ]
        })
    }

    /**
     * 更新主函数
     * 处理更新命令，检查更新状态和git安装，执行更新操作
     * @async
     * @returns {Promise<void>}
     */
    async update() {
        /** 检查是否正在更新中 */
        if (uping) {
            await this.reply('已有命令更新中..请勿重复操作')
            return
        }

        /** 检查git安装 */
        if (!(await this.checkGit())) return

        const isForce = this.e.msg.includes('强制')
        /** 执行更新 */
        await this.runUpdate(isForce)

        /** 是否需要重启 */
        if (this.isUp) {
            setTimeout(() => this.restart(), 2000)
        }
    }

    /**
     * 重启Bot
     * 调用Restart类进行重启操作
     */
    restart() {
        new Restart(this.e).restart()
    }

    /**
     * sp-plugin更新函数
     * 执行具体的git更新操作，包括常规更新和强制更新
     * @async
     * @param {boolean} isForce - 是否为强制更新
     * @returns {Promise<boolean>} 更新是否成功
     */
    async runUpdate(isForce) {
        const _path = './plugins/sp-plugin/'
        let command = `git -C ${_path} pull --no-rebase`

        if (isForce) {
            command = `git -C ${_path} reset --hard origin && ${command}`
            this.e.reply('正在执行强制更新操作，放弃本地修改...')
        } else {
            this.e.reply('正在执行更新操作，请稍等...')
        }

        /** 获取上次提交的commitId，用于获取日志时判断新增的更新日志 */
        this.oldCommitId = await this.getcommitId('sp-plugin')

        uping = true
        let ret = await this.execSync(command)
        uping = false

        if (ret.error) {
            logger.mark(`${this.e.logFnc} 更新失败：sp-plugin`)
            this.gitErr(ret.error, ret.stdout)
            return false
        }

        /** 获取插件提交的最新时间 */
        let time = await this.getTime('sp-plugin')

        if (/(Already up[ -]to[ -]date|已经是最新的)/.test(ret.stdout)) {
            await this.reply(`sp-plugin已经是最新版本\n最后更新时间：${time}`)
        } else {
            await this.reply(`sp-plugin更新成功！\n最后更新时间：${time}`)
            this.isUp = true
            /** 获取组件的更新日志 */
            let log = await this.getLog('sp-plugin')
            if (log) await this.reply(log)
        }

        logger.mark(`${this.e.logFnc} 最后更新时间：${time}`)
        return true
    }

    /**
     * 获取插件的更新日志
     * 通过git log命令获取最近20条提交日志
     * @async
     * @param {string} plugin - 插件名称
     * @returns {Promise<string|boolean>} 更新日志或false
     */
    async getLog(plugin = '') {
        let cm = `cd ./plugins/${plugin}/ && git log -20 --oneline --pretty=format:"%h||[%cd]  %s" --date=format:"%F %T"`
        let logAll

        try {
            logAll = await execSync(cm, { encoding: 'utf-8' })
        } catch (error) {
            logger.error(error.toString())
            this.reply(error.toString())
            return false
        }

        if (!logAll) return false

        logAll = logAll.split('\n')
        let log = []

        for (let str of logAll) {
            str = str.split('||')
            if (str[0] == this.oldCommitId) break
            if (str[1].includes('Merge branch')) continue
            log.push(str[1])
        }

        let line = log.length
        if (line <= 0) return ''

        let end = '更多详细信息，请前往gitee查看\nhttps://gitee.com/1638276310/sp-plugin'
        log = await common.makeForwardMsg(this.e, [log.join('\n\n'), end], `${plugin}更新日志，共${line}条`)
        return log
    }

    /**
     * 获取上次提交的commitId
     * 通过git rev-parse命令获取短commitId
     * @async
     * @param {string} plugin - 插件名称
     * @returns {Promise<string>} commitId
     */
    async getcommitId(plugin = '') {
        let cm = `git -C ./plugins/${plugin}/ rev-parse --short HEAD`
        let commitId = await execSync(cm, { encoding: 'utf-8' })
        commitId = _.trim(commitId)
        return commitId
    }

    /**
     * 获取本次更新插件的最后一次提交时间
     * 通过git log命令获取最近一次提交的时间
     * @async
     * @param {string} plugin - 插件名称
     * @returns {Promise<string>} 提交时间
     */
    async getTime(plugin = '') {
        let cm = `cd ./plugins/${plugin}/ && git log -1 --oneline --pretty=format:"%cd" --date=format:"%m-%d %H:%M"`
        let time = ''

        try {
            time = await execSync(cm, { encoding: 'utf-8' })
            time = _.trim(time)
        } catch (error) {
            logger.error(error.toString())
            time = '获取时间失败'
        }

        return time
    }

    /**
     * 处理更新失败的相关函数
     * 根据不同的错误类型提供相应的错误提示
     * @async
     * @param {string} err - 错误信息
     * @param {string} stdout - 标准输出
     * @returns {Promise<void>}
     */
    async gitErr(err, stdout) {
        let msg = '更新失败！'
        let errMsg = err.toString()
        stdout = stdout.toString()

        if (errMsg.includes('Timed out')) {
            let remote = errMsg.match(/'(.+?)'/g)[0].replace(/'/g, '')
            await this.reply(msg + `\n连接超时：${remote}`)
            return
        }

        if (/Failed to connect|unable to access/g.test(errMsg)) {
            let remote = errMsg.match(/'(.+?)'/g)[0].replace(/'/g, '')
            await this.reply(msg + `\n连接失败：${remote}`)
            return
        }

        if (errMsg.includes('be overwritten by merge')) {
            await this.reply(
                msg +
                `存在冲突：\n${errMsg}\n` +
                '请解决冲突后再更新，或者执行#sp强制更新，放弃本地修改'
            )
            return
        }

        if (stdout.includes('CONFLICT')) {
            await this.reply([
                msg + '存在冲突\n',
                errMsg,
                stdout,
                '\n请解决冲突后再更新，或者执行#sp强制更新，放弃本地修改'
            ])
            return
        }

        await this.reply([errMsg, stdout])
    }

    /**
     * 异步执行git相关命令
     * 使用child_process.exec执行命令
     * @async
     * @param {string} cmd - git命令
     * @returns {Promise<Object>} 执行结果对象
     */
    async execSync(cmd) {
        return new Promise((resolve, reject) => {
            exec(cmd, { windowsHide: true }, (error, stdout, stderr) => {
                resolve({ error, stdout, stderr })
            })
        })
    }

    /**
     * 检查git是否安装
     * 通过执行git --version命令检查git是否可用
     * @async
     * @returns {Promise<boolean>} git是否安装
     */
    async checkGit() {
        let ret = await execSync('git --version', { encoding: 'utf-8' })
        if (!ret || !ret.includes('git version')) {
            await this.reply('请先安装git')
            return false
        }
        return true
    }
}
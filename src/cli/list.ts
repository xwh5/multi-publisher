/**
 * list 命令 —— 回读平台状态（草稿 / 粉丝）。
 *
 * 为什么要有它：运营回盘需要「数字」，而这些数字之前只能开浏览器手点页面。
 * 现在走只读 API，一条命令拿到，直接可回填 metrics 表。
 */
import { ConfigStore } from '../config.js'
import { emitSuccess, emitFailure, formatTable } from './output.js'

const TOUT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'

async function toutiaoCookieHeader(): Promise<string> {
  const cookies = await ConfigStore.getToutiaoCookies()
  if (!cookies || Object.keys(cookies).length === 0) {
    throw new Error('未配置头条 cookie（先跑 mpub login -p toutiao）')
  }
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

async function listToutiaoDrafts(count: number): Promise<Record<string, unknown>[]> {
  const cookie = await toutiaoCookieHeader()
  const res = await fetch(
    `https://mp.toutiao.com/mp/agw/creator_center/draft_list?type=0&count=${count}&app_id=1231`,
    {
      headers: {
        cookie,
        referer: 'https://mp.toutiao.com/profile_v4/manage/draft?enter_from=left_menu',
        'user-agent': TOUT_UA,
        accept: 'application/json',
      },
    },
  )
  const body = (await res.json()) as { code?: number; message?: string }
  if (body.code !== 0) {
    throw new Error(`接口回 code=${body.code} ${body.message ?? ''}（登录态可能已失效）`.trim())
  }
  const items: Record<string, unknown>[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    const obj = node as Record<string, unknown>
    if (typeof obj.title === 'string' && obj.gid) {
      items.push({
        title: obj.title,
        gid: String(obj.gid),
        draftType: obj.draft_type ?? 2,
        updateTime: obj.update_time ?? obj.create_time ?? null,
        hasCover: Boolean(obj.cover_image),
      })
    }
    Object.values(obj).forEach(walk)
  }
  walk(body)
  const seen = new Set<string>()
  const uniq = items.filter((i) => (seen.has(i.gid as string) ? false : seen.add(i.gid as string)))
  // gid 是雪花号（超出 Number 安全整数）⇒ 用 BigInt 比较，越大越新
  uniq.sort((a, b) => {
    try {
      const x = BigInt(String(a.gid))
      const y = BigInt(String(b.gid))
      return x > y ? -1 : x < y ? 1 : 0
    } catch {
      return 0
    }
  })
  return uniq
}

async function listToutiaoFans(): Promise<Record<string, unknown>> {
  const cookie = await toutiaoCookieHeader()
  const res = await fetch('https://mp.toutiao.com/mp/agw/statistic/v2/fans/latest_stat?app_id=1231', {
    headers: {
      cookie,
      referer: 'https://mp.toutiao.com/profile_v4/analysis/fans/overview',
      'user-agent': TOUT_UA,
      accept: 'application/json',
    },
  })
  const body = (await res.json()) as {
    code?: number
    message?: string
    date?: string
    fans_stat?: {
      total_fans_count?: number
      increase_count?: number
      decrease_count?: number
      active_fans_count?: number
      active_fans_rate?: number
      change_count?: number
    }
  }
  if (body.code !== 0 || !body.fans_stat) {
    throw new Error(`接口回 code=${body.code} ${body.message ?? ''}（登录态可能已失效）`.trim())
  }
  const s = body.fans_stat
  return {
    statDate: body.date,
    totalFans: s.total_fans_count,
    increase: s.increase_count,
    decrease: s.decrease_count,
    activeFans: s.active_fans_count,
    activeRate: s.active_fans_rate !== undefined ? Number((s.active_fans_rate * 100).toFixed(2)) : undefined,
  }
}

async function listWeixinDrafts(): Promise<Record<string, unknown>> {
  const cfg = await ConfigStore.getWeixin()
  if (!cfg.appId || !cfg.appSecret) throw new Error('未配置 AppID/AppSecret')
  const tok = (await (
    await fetch(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${cfg.appId}&secret=${cfg.appSecret}`,
    )
  ).json()) as { access_token?: string; errcode?: number; errmsg?: string }
  if (!tok.access_token) throw new Error(`取 token 失败：${tok.errcode} ${tok.errmsg}`)
  const draft = (await (
    await fetch(`https://api.weixin.qq.com/cgi-bin/draft/count?access_token=${tok.access_token}`)
  ).json()) as { total_count?: number; errcode?: number; errmsg?: string }
  if (typeof draft.total_count !== 'number') {
    throw new Error(`草稿计数接口不可用：${draft.errcode} ${draft.errmsg}`)
  }
  return { totalDrafts: draft.total_count }
}

export async function runList(
  what: string,
  options: { platform?: string; count?: string; json?: boolean } = {},
): Promise<void> {
  const platform = options.platform || 'toutiao'
  const count = Number(options.count || 20)
  const json = Boolean(options.json)

  try {
    if (what === 'drafts') {
      if (platform === 'toutiao') {
        const items = await listToutiaoDrafts(count)
        emitSuccess({ platform, count: items.length, drafts: items }, {
          json,
          human: () =>
            formatTable(
              items.map((d) => ({
                标题: String(d.title).slice(0, 42),
                gid: String(d.gid),
                封面: d.hasCover ? '有' : '无',
              })),
            ) + `\n\n共 ${items.length} 条草稿。`,
        })
        return
      }
      if (platform === 'weixin') {
        const data = await listWeixinDrafts()
        emitSuccess({ platform, ...data }, {
          json,
          human: () => `公众号草稿箱：${data.totalDrafts} 篇（微信不提供草稿列表接口，只有计数）`,
        })
        return
      }
      emitFailure(
        { code: 'UNSUPPORTED', message: `暂不支持 list drafts -p ${platform}`, hint: '已支持：toutiao / weixin' },
        { json },
      )
      return
    }

    if (what === 'fans') {
      if (platform === 'toutiao') {
        const data = await listToutiaoFans()
        emitSuccess({ platform, ...data }, {
          json,
          human: () =>
            [
              `粉丝总数：${data.totalFans}`,
              `昨日涨粉：${data.increase}　掉粉：${data.decrease}`,
              `活跃粉丝：${data.activeFans}（${data.activeRate}%）`,
              `数据日期：${data.statDate}`,
            ].join('\n'),
        })
        return
      }
      emitFailure(
        { code: 'UNSUPPORTED', message: `暂不支持 list fans -p ${platform}`, hint: '已支持：toutiao' },
        { json },
      )
      return
    }

    emitFailure({ code: 'UNKNOWN_SUBCOMMAND', message: `未知子命令 ${what}`, hint: '可用：drafts / fans' }, { json })
  } catch (err) {
    emitFailure(
      { code: 'LIST_FAILED', message: (err as Error).message, hint: '先跑 mpub doctor 看凭据状态' },
      { json },
    )
  }
}

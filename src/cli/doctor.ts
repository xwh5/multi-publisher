/**
 * doctor 命令 —— 平台凭据/能力体检。
 *
 * 存在的理由（2026-10-22 实测踩坑）：**凭据文件在 ≠ 凭据可用**。
 * 头条 cookie 过期、公众号 access_token 过期、小红书 cookie ≈10h 失效，
 * 三次都是「文件还在、发布却失败」。所以体检必须**发真实请求**去问平台，
 * 而不是看本地有没有配置文件。
 */
import { ConfigStore } from '../config.js'
import { emitSuccess, emitFailure, formatTable } from './output.js'

type Status = 'valid' | 'expired' | 'invalid' | 'unconfigured' | 'unknown'

interface Probe {
  platform: string
  status: Status
  detail: string
  /** 探针实际验证了什么 */
  probe: string
  checkedAt: string
}

const XHS_MCP_PORT = process.env.XHS_MCP_PORT || '18060'

/** fetch 重试：网络偶发失败（实测偶发 fetch failed）不该被当成"过期" */
async function fetchWithRetry(url: string, init?: RequestInit, attempts = 2): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init)
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500))
    }
  }
  throw lastErr
}


async function probeWeixin(): Promise<Probe> {
  const checkedAt = new Date().toISOString()
  const cfg = await ConfigStore.getWeixin()
  if (!cfg.appId || !cfg.appSecret) {
    return { platform: 'weixin', status: 'unconfigured', detail: '未配置 AppID/AppSecret', probe: 'config', checkedAt }
  }
  try {
    const res = await fetchWithRetry(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${cfg.appId}&secret=${cfg.appSecret}`,
    )
    const tok = (await res.json()) as { access_token?: string; errcode?: number; errmsg?: string }
    if (!tok.access_token) {
      return {
        platform: 'weixin',
        status: 'invalid',
        detail: `取 token 失败：${tok.errcode ?? '?'} ${tok.errmsg ?? ''}`.trim(),
        probe: 'token',
        checkedAt,
      }
    }
    // 再问一次草稿箱：token 能取到但接口不可用（如 IP 未白名单）也要暴露
    const draftRes = await fetchWithRetry(`https://api.weixin.qq.com/cgi-bin/draft/count?access_token=${tok.access_token}`)
    const draft = (await draftRes.json()) as { total_count?: number; errcode?: number; errmsg?: string }
    if (typeof draft.total_count !== 'number') {
      return {
        platform: 'weixin',
        status: 'invalid',
        detail: `草稿箱接口不可用：${draft.errcode ?? '?'} ${draft.errmsg ?? ''}`.trim(),
        probe: 'draft/count',
        checkedAt,
      }
    }
    return {
      platform: 'weixin',
      status: 'valid',
      detail: `token 可取；草稿箱 ${draft.total_count} 篇`,
      probe: 'token + draft/count',
      checkedAt,
    }
  } catch (err) {
    return { platform: 'weixin', status: 'unknown', detail: `网络异常：${(err as Error).message}`, probe: 'token', checkedAt }
  }
}

async function probeToutiao(): Promise<Probe> {
  const checkedAt = new Date().toISOString()
  const cookies = await ConfigStore.getToutiaoCookies()
  if (!cookies || Object.keys(cookies).length === 0) {
    return { platform: 'toutiao', status: 'unconfigured', detail: '未配置 cookie', probe: 'config', checkedAt }
  }
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  try {
    const res = await fetchWithRetry(
      'https://mp.toutiao.com/mp/agw/creator_center/draft_list?type=0&count=1&app_id=1231',
      {
        headers: {
          cookie,
          referer: 'https://mp.toutiao.com/profile_v4/manage/draft?enter_from=left_menu',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
          accept: 'application/json',
        },
      },
    )
    const body = (await res.json()) as { code?: number; message?: string }
    if (body.code !== 0) {
      return {
        platform: 'toutiao',
        status: 'expired',
        detail: `登录态失效（接口回 code=${body.code} ${body.message ?? ''}）`.trim(),
        probe: 'draft_list',
        checkedAt,
      }
    }
    return { platform: 'toutiao', status: 'valid', detail: '登录态有效（草稿列表可读）', probe: 'draft_list', checkedAt }
  } catch (err) {
    return { platform: 'toutiao', status: 'unknown', detail: `网络异常：${(err as Error).message}`, probe: 'draft_list', checkedAt }
  }
}

async function probeXiaohongshu(): Promise<Probe> {
  const checkedAt = new Date().toISOString()
  try {
    const res = await fetchWithRetry(`http://127.0.0.1:${XHS_MCP_PORT}/health`)
    const body = (await res.json()) as { success?: boolean; data?: { account?: string } }
    if (body.success) {
      return {
        platform: 'xiaohongshu',
        status: 'valid',
        detail: `本地通道在（:${XHS_MCP_PORT}${body.data?.account ? ' · ' + body.data.account : ''}）`,
        probe: 'local /health',
        checkedAt,
      }
    }
    return {
      platform: 'xiaohongshu',
      status: 'invalid',
      detail: `通道回 success=false（:${XHS_MCP_PORT}）`,
      probe: 'local /health',
      checkedAt,
    }
  } catch (err) {
    return {
      platform: 'xiaohongshu',
      status: 'unconfigured',
      detail: `本地通道不在（127.0.0.1:${XHS_MCP_PORT}）：${(err as Error).message}`,
      probe: 'local /health',
      checkedAt,
    }
  }
}

async function probeCookieOnly(platform: string, cookies: Record<string, string> | null): Promise<Probe> {
  const checkedAt = new Date().toISOString()
  if (!cookies || Object.keys(cookies).length === 0) {
    return { platform, status: 'unconfigured', detail: '未配置 cookie', probe: 'config', checkedAt }
  }
  return {
    platform,
    status: 'unknown',
    detail: `已配置 ${Object.keys(cookies).length} 个 cookie，但没有只读探针（无法判定是否仍有效）`,
    probe: 'config',
    checkedAt,
  }
}

export async function runDoctor(options: { json?: boolean; platform?: string }): Promise<void> {
  const only = options.platform
  const probes: Probe[] = []
  const want = (p: string) => !only || only === p

  if (want('weixin')) probes.push(await probeWeixin())
  if (want('toutiao')) probes.push(await probeToutiao())
  if (want('xiaohongshu')) probes.push(await probeXiaohongshu())
  for (const p of ['zhihu', 'juejin', 'csdn', 'qq', 'weibo', 'bilibili']) {
    if (!want(p)) continue
    const map: Record<string, () => Promise<Record<string, string> | null>> = {
      zhihu: () => ConfigStore.getZhihuCookies(),
      juejin: () => ConfigStore.getJuejinCookies(),
      csdn: () => ConfigStore.getCSDNCookies(),
      qq: () => ConfigStore.getQQCookies(),
      weibo: () => ConfigStore.getWeiboCookies(),
      bilibili: () => ConfigStore.getBilibiliCookies(),
    }
    probes.push(await probeCookieOnly(p, await map[p]()))
  }

  const bad = probes.filter((p) => p.status === 'expired' || p.status === 'invalid')
  const data = {
    checkedAt: new Date().toISOString(),
    healthy: bad.length === 0,
    platforms: probes,
  }

  emitSuccess(data, {
    json: options.json,
    human: () => {
      const icon: Record<Status, string> = {
        valid: '✅',
        expired: '⏰',
        invalid: '❌',
        unconfigured: '—',
        unknown: '？',
      }
      const rows = probes.map((p) => ({
        平台: p.platform,
        状态: `${icon[p.status]} ${p.status}`,
        探针: p.probe,
        说明: p.detail,
      }))
      return `${formatTable(rows)}\n\n共 ${probes.length} 个平台，异常 ${bad.length} 个。`
    },
  })

  // 有平台明确失效 ⇒ 退出码非 0（可接 CI/定时监控）
  if (bad.length > 0) {
    process.exitCode = 1
  }
}

/** 供其他命令复用的探针（不打印） */
export async function probePlatforms(): Promise<Probe[]> {
  const probes: Probe[] = [
    await probeWeixin(),
    await probeToutiao(),
    await probeXiaohongshu(),
  ]
  return probes
}

export function probeError(platform: string, detail: string): void {
  emitFailure(
    { code: 'PROBE_FAILED', message: `${platform} 读取失败：${detail}` },
    { json: false },
  )
}

/**
 * 写操作租约 —— 防止同一账号被两条命令同时写。
 *
 * 为什么需要（2026-10-21 实测踩过）：后台监听脚本 + 手动发布同时触发，
 * 同一篇小红书笔记被发了两遍；小红书笔记**不可删除**，只能人工删。
 * OpenCLI 用 session-lease 做同一件事（同一 session 第二个写命令快速失败）。
 *
 * 机制：锁文件放在 ~/.config/multi-publisher/locks/<平台>.<账号>.lock
 *   - 记录 pid 与开始时间；pid 还活着 ⇒ 判定为"有人在写"⇒ 快速失败（session_busy）
 *   - 进程已死（崩溃/被 kill）⇒ 锁自动作废，可被接管
 *   - 超过 TTL 仍持有 ⇒ 视为僵尸锁，可接管
 */
import { promises as fs, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const LOCK_DIR = path.join(os.homedir(), ".config", "multi-publisher", "locks");
const DEFAULT_TTL_MS = 10 * 60 * 1000;

interface LockInfo {
  pid: number;
  startedAt: number;
  command: string;
}

function lockPath(key: string): string {
  return path.join(LOCK_DIR, `${key.replace(/[^\w.-]/g, "_")}.lock`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface Lease {
  ok: boolean;
  /** 失败时说明谁占着 */
  holder?: string;
  release?: () => Promise<void>;
  /** 同步释放（process.exit 会跳过 finally，必须留这条后门） */
  releaseSync?: () => void;
}

/**
 * 拿写租约。拿到返回 ok=true，调用方必须在 finally 里 release()。
 */
export async function acquireWriteLease(
  key: string,
  command: string,
  ttlMs = DEFAULT_TTL_MS,
): Promise<Lease> {
  await fs.mkdir(LOCK_DIR, { recursive: true });
  const file = lockPath(key);
  let existing: LockInfo | null = null;
  try {
    existing = JSON.parse(await fs.readFile(file, "utf-8")) as LockInfo;
  } catch {
    existing = null;
  }
  if (existing) {
    const alive = isAlive(existing.pid);
    const fresh = Date.now() - existing.startedAt < ttlMs;
    if (alive && fresh) {
      return {
        ok: false,
        holder: `pid=${existing.pid} 命令=${existing.command} 开始于 ${new Date(existing.startedAt).toLocaleString("zh-CN")}`,
      };
    }
  }
  const info: LockInfo = { pid: process.pid, startedAt: Date.now(), command };
  await fs.writeFile(file, JSON.stringify(info, null, 2), "utf-8");
  const releaseSync = (): void => {
    try {
      const cur = JSON.parse(readFileSync(file, "utf-8")) as LockInfo;
      if (cur.pid === process.pid) unlinkSync(file);
    } catch {
      /* 已经没了就算了 */
    }
  };
  return {
    ok: true,
    release: async () => {
      try {
        const cur = JSON.parse(await fs.readFile(file, "utf-8")) as LockInfo;
        if (cur.pid === process.pid) await fs.unlink(file);
      } catch {
        /* 已经没了就算了 */
      }
    },
    releaseSync,
  };
}

/** 判断某个平台是不是"写"通道（需要租约） */
export function writeLeaseKey(platform: string, account = "default"): string {
  return `${platform}.${account}`;
}

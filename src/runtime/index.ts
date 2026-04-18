/**
 * Runtime Interface - 抽象 HTTP/fetch 能力，让适配器可测试
 */
export interface RuntimeInterface {
  fetch(url: string, init?: RequestInit): Promise<Response>
  readFile(path: string): Promise<string>
  readFileBuffer(path: string): Promise<Buffer>
  getConfigDir(): string
}

export interface RuntimeOptions {
  fetchImpl?: typeof fetch
}

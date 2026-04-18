/**
 * CSS 内联 - 将主题 CSS 注入到 HTML 中
 */
import juice from 'juice'

export interface StylerOptions {
  css: string
  preservePPI?: boolean
}

/**
 * 将 CSS 内联到 HTML，返回处理后的 HTML 字符串
 */
export function inlineStyles(html: string, css: string): string {
  // juice 将外部 CSS 内联到 HTML 标签的 style 属性
  return juice.inlineContent(html, css)
}

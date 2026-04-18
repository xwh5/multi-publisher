/**
 * LaTeX 公式处理
 * 使用 codecogs 外部服务将 LaTeX 转为图片
 */
function isLatexFormula(text: string): boolean {
  if (/[\\^_{}]/.test(text)) return true
  if (/[α-ωΑ-Ω]/.test(text)) return true
  if (/[∑∏∫∂∇∞≠≤≥±×÷√]/.test(text)) return true
  return false
}

/**
 * 将 HTML 中的 LaTeX 公式替换为图片
 */
export function processMath(htmlContent: string): string {
  // Process $$...$$ (display math)
  let result = htmlContent.replace(
    /\$\$([^$]+)\$\$/g,
    (match: string, latex: string) => {
      if (!isLatexFormula(latex)) return match
      const encoded = encodeURIComponent(latex.trim())
      return `<p style="text-align:center"><img src="https://latex.codecogs.com/png.latex?\\dpi{150}%20${encoded}" alt="formula" style="vertical-align:middle;max-width:100%"></p>`
    }
  )

  // Process $...$ (inline math)
  result = result.replace(
    /\$([^$\n]+)\$/g,
    (match: string, latex: string) => {
      if (!isLatexFormula(latex)) return match
      const encoded = encodeURIComponent(latex.trim())
      return `<img src="https://latex.codecogs.com/png.latex?\\dpi{120}%20${encoded}" alt="formula" style="vertical-align:middle">`
    }
  )

  return result
}

// Generate loader HTML for Tabulator's dataLoaderLoading option
export function generateTabulatorLoaderHTML(message: string = 'Rendering grid...', subtitle?: string): string {
  const primaryColor = 'rgb(0, 158, 247)'
  const primaryColor20 = 'rgba(0, 158, 247, 0.2)'
  const textMutedColor = 'rgba(94, 98, 120, 0.7)'
  
  const spinnerHTML = `<div style="width: 48px; height: 48px; border: 4px solid ${primaryColor20}; border-top-color: ${primaryColor}; border-radius: 50%; animation: tabulator-loader-spin 1s linear infinite;"></div>`
  const messageHTML = `<div style="color: ${primaryColor}; font-size: 15px; font-weight: 500; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', sans-serif;">${message}</div>`
  const subtitleHTML = subtitle ? `<div style="color: ${textMutedColor}; font-size: 14px; font-weight: normal; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', sans-serif;">${subtitle}</div>` : ''
  
  return `
    <style>
      @keyframes tabulator-loader-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    </style>
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 20px; text-align: center;">
      ${spinnerHTML}
      ${messageHTML}
      ${subtitleHTML}
    </div>
  `
}

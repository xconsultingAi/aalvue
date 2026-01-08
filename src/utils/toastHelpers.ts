import { showToast } from '@/stores/toastStore'

export function showSuccessToast(count: number, itemName: string, action: string): void {
  if (count > 0) {
    showToast('success', `${action.charAt(0).toUpperCase() + action.slice(1)} ${count} ${itemName}`)
  } else {
    showToast('warning', `No ${itemName} to ${action}`)
  }
}

export function showWarningToast(itemName: string, action: string): void {
  showToast('warning', `No ${itemName} to ${action}`)
}

/**
 * Show error toast for failed operations
 * 
 * REASONING: Standardizes error messages with operation context
 * 
 * @param operation - Name of the operation that failed
 * @param error - Error object or message
 */
export function showErrorToast(operation: string, error: Error | string): void {
  const errorMessage = error instanceof Error ? error.message : error
  showToast('error', `Failed to ${operation}: ${errorMessage || 'Unknown error'}`)
}

export function showCopySuccessToast(count: number): void {
  showSuccessToast(count, 'value(s)', 'Copied to Result column')
}

export function showMarkFinalSuccessToast(count: number): void {
  showSuccessToast(count, 'cell(s)', 'Marked as final')
}

/**
 * Show success toast for clear results operations
 * 
 * REASONING: Specialized helper for clear results operations
 */
export function showClearResultsSuccessToast(count: number): void {
  showSuccessToast(count, 'result(s)', 'Cleared')
}

export function showManualCorrectionSuccessToast(count: number, correctionType: 'baseline' | 'multiplier'): void {
  const typeLabel = correctionType === 'baseline' ? 'baseline correction' : 'multiplier'
  showSuccessToast(count, 'cell(s)', `Applied ${typeLabel} to`)
}

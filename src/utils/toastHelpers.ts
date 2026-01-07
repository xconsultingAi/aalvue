// Toast Notification Helpers
// Extracts common toast notification patterns to eliminate repetitive message construction

import { showToast } from '@/stores/toastStore'

/**
 * Show success toast for operations with count
 * 
 * REASONING: Standardizes success messages for operations that process items
 * 
 * @param count - Number of items processed
 * @param itemName - Name of the item type (e.g., "value(s)", "cell(s)")
 * @param action - Action performed (e.g., "copied", "marked", "cleared")
 */
export function showSuccessToast(count: number, itemName: string, action: string): void {
  if (count > 0) {
    showToast('success', `${action.charAt(0).toUpperCase() + action.slice(1)} ${count} ${itemName}`)
  } else {
    showToast('warning', `No ${itemName} to ${action}`)
  }
}

// Show warning toast for operations with no items (standardizes warning messages)
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

// Show success toast for copy operations
export function showCopySuccessToast(count: number): void {
  showSuccessToast(count, 'value(s)', 'Copied to Result column')
}

// Show success toast for mark final operations
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

// Show success toast for manual correction operations
export function showManualCorrectionSuccessToast(count: number, correctionType: 'baseline' | 'multiplier'): void {
  const typeLabel = correctionType === 'baseline' ? 'baseline correction' : 'multiplier'
  showSuccessToast(count, 'cell(s)', `Applied ${typeLabel} to`)
}

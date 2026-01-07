// Operation Handler Composable
// Extracts repeated pattern of executing operations with loading overlay, error handling, and toast notifications

import { showToast } from '@/stores/toastStore'
import { withLoadingOverlay, withLoadingOverlayAndProgress } from './useAsyncOperation'

export interface OperationResult<T = void> {
  success: boolean
  count?: number
  data?: T
  message?: string
}

/**
 * Execute an operation with loading overlay, error handling, and toast notifications
 * 
 * REASONING: Consolidates the pattern:
 * 1. Show loading overlay
 * 2. Execute operation
 * 3. Show success/warning toast based on result
 * 4. Handle errors with error toast
 * 
 * @param options - Operation configuration
 * @returns Promise that resolves with operation result
 */
export async function handleOperation<T = void>(options: {
  loadingMessage: string
  operation: () => Promise<OperationResult<T>>
  successMessage: (result: OperationResult<T>) => string
  warningMessage?: (result: OperationResult<T>) => string
  errorMessage?: (error: Error) => string
}): Promise<OperationResult<T> | null> {
  const {
    loadingMessage,
    operation,
    successMessage,
    warningMessage,
    errorMessage = (error: Error) => `Operation failed: ${error.message || 'Unknown error'}`
  } = options

  try {
    const result = await withLoadingOverlay(loadingMessage, operation)

    if (result.success) {
      if (result.count !== undefined && result.count > 0) {
        showToast('success', successMessage(result))
      } else if (warningMessage) {
        showToast('warning', warningMessage(result))
      } else {
        showToast('warning', 'No items to process')
      }
    } else {
      showToast('error', result.message || 'Operation failed')
    }

    return result
  } catch (error) {
    const errorMsg = error instanceof Error ? errorMessage(error) : 'Unknown error occurred'
    showToast('error', errorMsg)
    return null
  }
}

// Execute an operation with progress tracking (extended version for operations needing progress updates)
export async function handleOperationWithProgress<T = void>(options: {
  loadingMessage: string
  operation: (updateProgress: (current: number, total: number) => void) => Promise<OperationResult<T>>
  successMessage: (result: OperationResult<T>) => string
  warningMessage?: (result: OperationResult<T>) => string
  errorMessage?: (error: Error) => string
}): Promise<OperationResult<T> | null> {
  const {
    loadingMessage,
    operation,
    successMessage,
    warningMessage,
    errorMessage = (error: Error) => `Operation failed: ${error.message || 'Unknown error'}`
  } = options

  try {
    const result = await withLoadingOverlayAndProgress(loadingMessage, operation)

    if (result.success) {
      if (result.count !== undefined && result.count > 0) {
        showToast('success', successMessage(result))
      } else if (warningMessage) {
        showToast('warning', warningMessage(result))
      } else {
        showToast('warning', 'No items to process')
      }
    } else {
      showToast('error', result.message || 'Operation failed')
    }

    return result
  } catch (error) {
    const errorMsg = error instanceof Error ? errorMessage(error) : 'Unknown error occurred'
    showToast('error', errorMsg)
    return null
  }
}

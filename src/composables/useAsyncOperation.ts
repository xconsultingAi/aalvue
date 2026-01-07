// Async Operation Composable
// Extracts repeated pattern of showing loading overlay, ensuring it renders, executing operation, and hiding overlay

import { nextTick } from 'vue'
import { useLoadingStore } from '@/stores/loadingStore'

// Execute an async operation with loading overlay
// Shows overlay, waits for render (nextTick + requestAnimationFrame + delay), executes operation, hides overlay
export async function withLoadingOverlay<T>(
  message: string,
  operation: () => Promise<T>
): Promise<T> {
  const loadingStore = useLoadingStore()
  
  // Show loading overlay
  loadingStore.show(message)
  
  // CRITICAL: Ensure overlay actually renders before starting heavy operation
  // Use requestAnimationFrame to yield to browser for rendering, then small delay
  await nextTick()
  await new Promise(resolve => requestAnimationFrame(() => {
    setTimeout(resolve, 50) // Small delay to ensure overlay is painted
  }))
  
  try {
    // Execute the operation
    const result = await operation()
    
    // Hide overlay (loadingStore handles minimum display time)
    loadingStore.hide()
    
    return result
  } catch (error) {
    // Hide overlay on error
    loadingStore.hide()
    
    // Re-throw error so caller can handle it
    throw error
  }
}

// Execute an async operation with loading overlay and progress updates
// Extended version for operations that need progress tracking (e.g., chunked processing)
export async function withLoadingOverlayAndProgress<T>(
  message: string,
  operation: (updateProgress: (current: number, total: number) => void) => Promise<T>
): Promise<T> {
  const loadingStore = useLoadingStore()
  
  loadingStore.show(message)
  
  // Ensure overlay renders before starting heavy operation
  await nextTick()
  await new Promise(resolve => requestAnimationFrame(() => {
    setTimeout(resolve, 50)
  }))
  
  try {
    const result = await operation((current, total) => {
      loadingStore.updateProgress(current, total)
    })
    loadingStore.hide()
    return result
  } catch (error) {
    loadingStore.hide()
    throw error // Re-throw so caller can handle it
  }
}

// Process items in chunks with progress updates
export async function processInChunks<T>(
  items: T[],
  processor: (item: T, index: number) => void | Promise<void>,
  options: {
    chunkSize?: number
    onProgress?: (current: number, total: number) => void
    progressUpdateInterval?: number
  } = {}
): Promise<void> {
  const {
    chunkSize = 50,
    onProgress,
    progressUpdateInterval = 10
  } = options

  const total = items.length

  // Process items in chunks
  for (let i = 0; i < total; i += chunkSize) {
    const chunk = items.slice(i, Math.min(i + chunkSize, total))

    // Process chunk items
    for (let chunkIndex = 0; chunkIndex < chunk.length; chunkIndex++) {
      const index = i + chunkIndex
      const item = chunk[chunkIndex]

      // Process item (can be async)
      await processor(item, index)

      // Update progress periodically
      if (onProgress && (index % progressUpdateInterval === 0 || index === total - 1)) {
        onProgress(index + 1, total)
      }
    }

    // Yield to browser after each chunk to keep UI responsive
    if (i + chunkSize < total) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
}

// Process items in chunks and collect results
export async function processInChunksWithResults<T, R>(
  items: T[],
  processor: (item: T, index: number) => R | Promise<R>,
  options: {
    chunkSize?: number
    onProgress?: (current: number, total: number) => void
    progressUpdateInterval?: number
  } = {}
): Promise<R[]> {
  const results: R[] = []
  
  await processInChunks(
    items,
    async (item, index) => {
      const result = await processor(item, index)
      results.push(result)
    },
    options
  )
  
  return results
}

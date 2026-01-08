// API client for authenticated requests with CSRF token support

import sampleData from '@/data/sample-data-table.json'

export interface ApiClientConfig {
  csrfToken?: string
  baseUrl?: string
  timeout?: number
  useSampleData?: boolean
}

/**
 * Extract CSRF token from cookie (fallback method)
 */
function getCsrfTokenFromCookie(): string {
  const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

function fetchWithTimeout(url: string, options: RequestInit, timeout: number): Promise<Response> {
  return Promise.race([
    fetch(url, options),
    new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeout)
    )
  ])
}

/**
 * Create a mock Response object from sample data (for dev mode)
 */
function createMockResponse(data: any): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    statusText: 'OK',
    headers: {
      'Content-Type': 'application/json'
    }
  })
}

function shouldUseSampleData(url: string, config?: ApiClientConfig): boolean {
  if (!import.meta.env.DEV) return false
  
  if (config?.useSampleData === true) return true
  
  // If no baseUrl and URL is relative/local, assume dev mode
  if (!config?.baseUrl && (url.startsWith('/') || url.includes('localhost'))) {
    return true
  }
  
  return false
}

export function createApiClient(config?: ApiClientConfig) {
  const csrfToken = config?.csrfToken || getCsrfTokenFromCookie()
  
  const getCsrfToken = () => {
    return csrfToken || getCsrfTokenFromCookie()
  }
  
  return {
    /**
     * GET request - includes auth cookies, no CSRF needed
     * In dev mode with useSampleData=true, returns sample data instead of making API call
     */
    async get(url: string): Promise<Response> {
      // Check if we should use sample data (dev mode)
      if (shouldUseSampleData(url, config)) {
        // Simulate network delay for realistic dev experience
        await new Promise(resolve => setTimeout(resolve, 300))
        return createMockResponse(sampleData)
      }
      
      // Production: make real API call
      const fullUrl = config?.baseUrl ? `${config.baseUrl}${url}` : url
      
      return fetch(fullUrl, {
        method: 'GET',
        credentials: 'include', // Send auth cookies automatically
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      })
    },
    
    /**
     * POST request - includes auth cookies and CSRF token
     */
    async post(url: string, body: any): Promise<Response> {
      const fullUrl = config?.baseUrl ? `${config.baseUrl}${url}` : url
      const timeout = config?.timeout || 30000 // Default 30 seconds
      
      return fetchWithTimeout(fullUrl, {
        method: 'POST',
        credentials: 'include', // Send auth cookies automatically
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-CSRF-Token': getCsrfToken(), // CSRF for state-changing requests
          'X-Requested-With': 'XMLHttpRequest' // Identify as AJAX request
        },
        body: JSON.stringify(body)
      }, timeout)
    },
    
    /**
     * PUT request - includes auth cookies and CSRF token
     */
    async put(url: string, body: any): Promise<Response> {
      const fullUrl = config?.baseUrl ? `${config.baseUrl}${url}` : url
      
      return fetch(fullUrl, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify(body)
      })
    },
    
    async delete(url: string): Promise<Response> {
      const fullUrl = config?.baseUrl ? `${config.baseUrl}${url}` : url
      const timeout = config?.timeout || 30000
      
      return fetchWithTimeout(fullUrl, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
          'X-Requested-With': 'XMLHttpRequest'
        }
      }, timeout)
    }
  }
}

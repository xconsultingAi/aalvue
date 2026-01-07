import { useToast } from 'vue-toastification'
import type { ToastOptions } from 'vue-toastification'

export function showToast(type: 'success' | 'error' | 'warning' | 'info', message: string, options?: ToastOptions) {
  const toast = useToast()
  const defaultOptions: ToastOptions = {
    timeout: 4000,
    position: 'top-right',
    ...options
  }
  
  toast[type](message, defaultOptions)
}

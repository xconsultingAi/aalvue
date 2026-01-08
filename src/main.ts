import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import 'tabulator-tables/dist/css/tabulator.min.css'
import Toast from 'vue-toastification'
import 'vue-toastification/dist/index.css'
import './styles/tailwind.css'
import './styles/shared.css'

const DataArrayVue = {
  mount(selector: string, options?: { initialData?: any; apiEndpoint?: string; csrfToken?: string }) {
    console.log('DataArrayVue.mount called:', { selector, hasInitialData: !!options?.initialData, hasApiEndpoint: !!options?.apiEndpoint, hasCsrfToken: !!options?.csrfToken })
    
    const el = document.querySelector(selector)
    if (!el) {
      console.error(`Element not found: ${selector}`)
      return
    }

    console.log('Element found, creating Vue app...')
    const app = createApp(App, {
      initialData: options?.initialData,
      apiEndpoint: options?.apiEndpoint,
      csrfToken: options?.csrfToken
    })
    app.use(createPinia())
    app.use(Toast, {
      position: 'top-right',
      timeout: 4000,
      closeOnClick: true,
      pauseOnFocusLoss: true,
      pauseOnHover: true,
      draggable: true,
      draggablePercent: 0.6,
      showCloseButtonOnHover: false,
      hideProgressBar: false,
      closeButton: 'button',
      icon: true,
      rtl: false
    })
    
    console.log('Mounting Vue app to element...')
    app.mount(el)
    console.log('Vue app mounted successfully')
    
    return app
  }
}

export default DataArrayVue

if (typeof window !== 'undefined') {
  (window as any).DataArrayVue = DataArrayVue
}

if (import.meta.env.DEV && document.getElementById('app')) {
  DataArrayVue.mount('#app')
}

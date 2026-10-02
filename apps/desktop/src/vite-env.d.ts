/// <reference types="vite/client" />

interface ImportMetaEnv { readonly VITE_EDIT_MODE?: string; readonly VITE_APP_TARGET?: 'desktop' | 'android' }
interface ImportMeta { readonly env: ImportMetaEnv }

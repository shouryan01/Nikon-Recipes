import React from 'react'
import { useTheme } from 'next-themes'
import { Sun, Moon, Monitor } from 'lucide-react'

export const ThemeToggle: React.FC = () => {
  const { theme, setTheme } = useTheme()

  const handleToggle = () => {
    if (theme === 'dark') {
      setTheme('light')
    } else if (theme === 'light') {
      setTheme('system')
    } else {
      setTheme('dark')
    }
  }

  const currentTheme = theme || 'system'
  const label =
    currentTheme === 'dark'
      ? 'Dark'
      : currentTheme === 'light'
      ? 'Light'
      : 'System'

  return (
    <button
      type="button"
      onClick={handleToggle}
      title={`Theme: ${label} (click to switch)`}
      aria-label={`Current theme: ${label}. Click to switch between Light, Dark, and System.`}
      className="p-1.5 rounded-md bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-900 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border border-neutral-200 dark:border-neutral-800 transition-colors flex items-center justify-center shadow-xs"
    >
      {currentTheme === 'dark' && <Moon className="w-3.5 h-3.5 text-white" />}
      {currentTheme === 'light' && <Sun className="w-3.5 h-3.5 text-black dark:text-white" />}
      {currentTheme === 'system' && <Monitor className="w-3.5 h-3.5 text-neutral-700 dark:text-neutral-300" />}
    </button>
  )
}

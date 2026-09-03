import { ThemeProvider } from "next-themes"
import type { PropsWithChildren } from "react"

const ThemeModeProvider = ({children}: PropsWithChildren) => {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="enspatium-color-mode"
    >
      {children}
    </ThemeProvider>
  )
}

export default ThemeModeProvider
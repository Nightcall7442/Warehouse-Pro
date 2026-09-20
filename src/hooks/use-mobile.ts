import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return window.innerWidth < MOBILE_BREAKPOINT
  })

  React.useEffect(() => {
    // jsdom (тесты страниц) matchMedia не знает — остаётся ширина окна из useState.
    if (typeof window.matchMedia !== "function") return
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches)
    }
    onChange(mql)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}

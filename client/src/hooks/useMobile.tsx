import * as React from "react";

const tko_MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    undefined
  );

  React.useEffect(() => {
    const tko_mql = window.matchMedia(`(max-width: ${tko_MOBILE_BREAKPOINT - 1}px)`);
    const tko_onChange = () => {
      setIsMobile(window.innerWidth < tko_MOBILE_BREAKPOINT);
    };
    tko_mql.addEventListener("change", tko_onChange);
    setIsMobile(window.innerWidth < tko_MOBILE_BREAKPOINT);
    return () => tko_mql.removeEventListener("change", tko_onChange);
  }, []);

  return !!isMobile;
}

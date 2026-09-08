export interface ClientInteractionCapabilities {
  preciseHover: boolean;
  desktopAnkiPlatform: boolean;
}

interface CapabilityNavigator {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string };
}

interface CapabilityWindow {
  matchMedia: (query: string) => { matches: boolean };
  navigator: CapabilityNavigator;
}

export function readClientInteractionCapabilities(
  browserWindow: CapabilityWindow,
): ClientInteractionCapabilities {
  const navigator = browserWindow.navigator;
  const userAgent = navigator.userAgent ?? "";
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  const maxTouchPoints = navigator.maxTouchPoints ?? 0;
  const preciseHover = browserWindow.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const ipadOs = /iPad|iPhone|iPod/i.test(userAgent)
    || (/Mac/i.test(platform) && maxTouchPoints > 1);
  const android = /Android/i.test(userAgent) || /Android/i.test(platform);
  const touchFirstNonWindows = maxTouchPoints > 0 && !preciseHover && !/Win/i.test(platform);

  return {
    preciseHover,
    desktopAnkiPlatform: !ipadOs && !android && !touchFirstNonWindows,
  };
}

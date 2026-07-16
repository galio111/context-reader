declare module "page-flip/dist/js/page-flip.module.js" {
  export type PageFlipCorner = "top" | "bottom";

  export interface PageFlipEvent {
    data: number | string | boolean | object;
    object: PageFlip;
  }

  export interface PageFlipSettings {
    width: number;
    height: number;
    size?: "fixed" | "stretch";
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    drawShadow?: boolean;
    flippingTime?: number;
    usePortrait?: boolean;
    startZIndex?: number;
    autoSize?: boolean;
    maxShadowOpacity?: number;
    showCover?: boolean;
    mobileScrollSupport?: boolean;
    clickEventForward?: boolean;
    useMouseEvents?: boolean;
    swipeDistance?: number;
    showPageCorners?: boolean;
    disableFlipByClick?: boolean;
    startPage?: number;
  }

  export class PageFlip {
    constructor(element: HTMLElement, settings: PageFlipSettings);
    loadFromHTML(items: HTMLElement[]): void;
    updateFromHtml(items: HTMLElement[]): void;
    turnToPage(page: number): void;
    flip(page: number, corner?: PageFlipCorner): void;
    flipNext(corner?: PageFlipCorner): void;
    flipPrev(corner?: PageFlipCorner): void;
    update(): void;
    destroy(): void;
    on(eventName: string, callback: (event: PageFlipEvent) => void): PageFlip;
    off(eventName: string): void;
  }
}

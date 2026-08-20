"use client";

import Link from "next/link";
import {
  useLayoutEffect,
  useRef,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { gsap } from "gsap";
import styles from "./PillNavAction.module.css";

interface PillNavActionProps {
  label: string;
  className?: string;
  tone?: "light" | "dark";
  href?: string;
  type?: "button" | "submit" | "reset";
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  ariaLabel?: string;
  ariaExpanded?: boolean;
  ariaControls?: string;
  title?: string;
  renderIcon?: () => ReactNode;
  ease?: string;
  motion?: "pill" | "none";
}

export function PillNavAction({
  label,
  className = "",
  tone = "light",
  href,
  type = "button",
  onClick,
  disabled = false,
  ariaLabel,
  ariaExpanded,
  ariaControls,
  title,
  renderIcon,
  ease = "power3.out",
  motion = "pill",
}: PillNavActionProps) {
  const actionRef = useRef<HTMLAnchorElement | HTMLButtonElement | null>(null);
  const circleRef = useRef<HTMLSpanElement | null>(null);
  const primaryContentRef = useRef<HTMLSpanElement | null>(null);
  const hoverContentRef = useRef<HTMLSpanElement | null>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const activeTweenRef = useRef<gsap.core.Tween | null>(null);
  const reducedMotionRef = useRef(false);

  useLayoutEffect(() => {
    const action = actionRef.current;
    const circle = circleRef.current;
    const primaryContent = primaryContentRef.current;
    const hoverContent = hoverContentRef.current;
    if (!action || !circle || !primaryContent || !hoverContent) return;

    let cancelled = false;
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const hoverQuery = window.matchMedia("(hover: hover) and (pointer: fine)");

    if (!hoverQuery.matches || motion === "none") {
      activeTweenRef.current?.kill();
      timelineRef.current?.kill();
      timelineRef.current = null;
      reducedMotionRef.current = true;
      gsap.set(circle, { scale: 0 });
      gsap.set(primaryContent, { y: 0 });
      gsap.set(hoverContent, { opacity: 0 });
      return;
    }

    const layout = () => {
      if (cancelled) return;

      activeTweenRef.current?.kill();
      timelineRef.current?.kill();

      const { width, height } = action.getBoundingClientRect();
      const radius = ((width * width) / 4 + height * height) / (2 * height);
      const diameter = Math.ceil(2 * radius) + 2;
      const delta = Math.ceil(
        radius - Math.sqrt(Math.max(0, radius * radius - (width * width) / 4)),
      ) + 1;
      const originY = diameter - delta;

      circle.style.width = `${diameter}px`;
      circle.style.height = `${diameter}px`;
      circle.style.bottom = `-${delta}px`;

      gsap.set(circle, {
        xPercent: -50,
        scale: 0,
        transformOrigin: `50% ${originY}px`,
      });
      gsap.set(primaryContent, { y: 0 });
      gsap.set(hoverContent, {
        y: Math.ceil(height + 100),
        opacity: 0,
      });

      reducedMotionRef.current = reducedMotionQuery.matches || disabled || !hoverQuery.matches;
      if (reducedMotionRef.current) {
        timelineRef.current = null;
        return;
      }

      const timeline = gsap.timeline({ paused: true });
      timeline.to(
        circle,
        {
          scale: 1.2,
          xPercent: -50,
          duration: 2,
          ease,
          overwrite: "auto",
        },
        0,
      );
      timeline.to(
        primaryContent,
        {
          y: -(height + 8),
          duration: 2,
          ease,
          overwrite: "auto",
        },
        0,
      );
      timeline.to(
        hoverContent,
        {
          y: 0,
          opacity: 1,
          duration: 2,
          ease,
          overwrite: "auto",
        },
        0,
      );
      timelineRef.current = timeline;
    };

    layout();
    window.addEventListener("resize", layout);
    reducedMotionQuery.addEventListener("change", layout);
    document.fonts?.ready.then(layout).catch(() => undefined);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", layout);
      reducedMotionQuery.removeEventListener("change", layout);
      activeTweenRef.current?.kill();
      timelineRef.current?.kill();
    };
  }, [disabled, ease, label, motion]);

  const play = () => {
    if (disabled) return;
    const timeline = timelineRef.current;
    if (!timeline || reducedMotionRef.current) return;
    activeTweenRef.current?.kill();
    activeTweenRef.current = timeline.tweenTo(timeline.duration(), {
      duration: 0.3,
      ease,
      overwrite: "auto",
    });
  };

  const reverse = () => {
    if (disabled) return;
    const timeline = timelineRef.current;
    if (!timeline || reducedMotionRef.current) return;
    activeTweenRef.current?.kill();
    activeTweenRef.current = timeline.tweenTo(0, {
      duration: 0.2,
      ease,
      overwrite: "auto",
    });
  };

  const content = (
    <>
      <span className={styles.hoverCircle} aria-hidden="true" ref={circleRef} />
      <span className={styles.labelStack}>
        <span className={styles.content} ref={primaryContentRef}>
          <span>{label}</span>
          {renderIcon?.()}
        </span>
        <span
          className={`${styles.content} ${styles.hoverContent}`}
          aria-hidden="true"
          ref={hoverContentRef}
        >
          <span>{label}</span>
          {renderIcon?.()}
        </span>
      </span>
    </>
  );

  const sharedClassName = [
    styles.pillAction,
    tone === "dark" ? styles.dark : styles.light,
    motion === "none" ? styles.noMotion : "",
    className,
  ].filter(Boolean).join(" ");

  if (href) {
    return (
      <Link
        ref={(element) => { actionRef.current = element; }}
        className={sharedClassName}
        href={href}
        aria-label={ariaLabel}
        title={title}
        onMouseEnter={play}
        onMouseLeave={reverse}
        onFocus={play}
        onBlur={reverse}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      ref={(element) => { actionRef.current = element; }}
      className={sharedClassName}
      type={type}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      title={title}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={play}
      onMouseLeave={reverse}
      onFocus={play}
      onBlur={reverse}
    >
      {content}
    </button>
  );
}

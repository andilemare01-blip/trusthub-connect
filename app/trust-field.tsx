"use client";

import { useEffect, useRef } from "react";
import { startTrustField } from "./trust-field-engine";
import styles from "./home.module.css";

/** The hero's moving word. Decorative: the headline beside it carries the meaning. */
export function TrustField() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let stop = () => undefined as void; let gone = false;
    const family = getComputedStyle(element).fontFamily;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void document.fonts.load(`800 120px ${family}`).catch(() => undefined).then(() => { if (!gone) stop = startTrustField(element, family, reduced); });
    return () => { gone = true; stop(); };
  }, []);
  return <canvas ref={canvas} className={styles.field} aria-hidden="true" />;
}

/** Lights each line as it reaches the middle of the screen, so reading the steps moves the page along. */
export function ScrollSteps({ steps }: { steps: string[] }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const items = list.current ? [...list.current.children] : [];
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) entry.target.toggleAttribute("data-lit", entry.isIntersecting);
    }, { rootMargin: "-35% 0px -35% 0px" });
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);
  return <ol ref={list} className={styles.steps}>{steps.map((step) => <li key={step}>{step}</li>)}</ol>;
}

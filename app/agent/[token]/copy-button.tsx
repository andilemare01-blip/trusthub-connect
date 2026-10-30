"use client";

import { useState } from "react";
import styles from "./agent.module.css";

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={styles.button} onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1800); }).catch(() => undefined); }}>
      {done ? "Copied ✓" : label}
    </button>
  );
}

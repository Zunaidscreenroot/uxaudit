"use client";

import { useEffect } from "react";

export default function EmbeddedMode() {
  useEffect(() => {
    try {
      if (window.self !== window.top) {
        document.documentElement.classList.add("uxaudit-embedded");
      }
    } catch {
      document.documentElement.classList.add("uxaudit-embedded");
    }
    return () => document.documentElement.classList.remove("uxaudit-embedded");
  }, []);
  return null;
}

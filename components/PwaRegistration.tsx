"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      // A production worker left behind on localhost can cache Next's un-hashed
      // development chunks and make the browser show an older UI after HMR.
      // Remove only the localhost PWA runtime; account data lives elsewhere.
      void navigator.serviceWorker.getRegistrations().then((registrations) => (
        Promise.all(registrations.map((registration) => registration.unregister()))
      ));
      if ("caches" in window) {
        void window.caches.keys().then((keys) => Promise.all(
          keys.filter((key) => key.startsWith("context-reader-")).map((key) => window.caches.delete(key)),
        ));
      }
      return;
    }

    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js");
    });
  }, []);

  return null;
}

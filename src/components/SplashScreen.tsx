import { useEffect, useState } from "react";
import logoAsset from "@/assets/logo.png.asset.json";
import cluckAsset from "@/assets/cluck.mp3.asset.json";

const TOTAL_MS = 2500;
const EXIT_MS = 600;

// Module-level flag: ensures the splash only shows once per full page load,
// even if the component's parent tree re-mounts (auth changes, HMR, etc.).
// A real browser refresh reloads this module and resets the flag.
let hasShownThisPageLoad = false;

export const SplashScreen = () => {
  const [mounted, setMounted] = useState(() => !hasShownThisPageLoad);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (hasShownThisPageLoad) return;
    hasShownThisPageLoad = true;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const exitDuration = prefersReduced ? 300 : EXIT_MS;
    const holdMs = TOTAL_MS - exitDuration;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Play chicken cluck once. Fail silently if autoplay is blocked.
    const audio = new Audio(cluckAsset.url);
    audio.volume = 0.4;
    audio.preload = "auto";
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        /* autoplay blocked — silent */
      });
    }

    const t1 = window.setTimeout(() => setExiting(true), holdMs);
    const t2 = window.setTimeout(() => setMounted(false), TOTAL_MS);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      try {
        audio.pause();
        audio.currentTime = 0;
        audio.src = "";
      } catch {
        /* noop */
      }
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    if (!mounted) document.body.style.overflow = "";
  }, [mounted]);

  if (!mounted) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "#FFFFFF",
        zIndex: 2147483000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <img
        src={logoAsset.url}
        alt=""
        className={exiting ? "splash-logo splash-logo-exit" : "splash-logo"}
        style={{
          width: "38vw",
          maxWidth: 280,
          height: "auto",
          display: "block",
        }}
      />
      <style>{`
        @media (max-width: 1024px) { .splash-logo { max-width: 220px !important; } }
        @media (max-width: 640px)  { .splash-logo { max-width: 160px !important; } }
        .splash-logo { transform: scale(1); opacity: 1; will-change: transform, opacity; }
        .splash-logo-exit {
          animation: splashExit 600ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        @keyframes splashExit {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(0.65); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .splash-logo-exit {
            animation: splashFade 300ms ease-out forwards;
          }
          @keyframes splashFade {
            from { opacity: 1; }
            to { opacity: 0; }
          }
        }
      `}</style>
    </div>
  );
};

export default SplashScreen;
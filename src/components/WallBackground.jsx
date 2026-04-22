import { memo, useEffect, useState } from "react";
import PixelBlast from "./PixelBlast.jsx";

const backgroundStyle = {
  position: "absolute",
  inset: 0,
  zIndex: 0,
  pointerEvents: "none",
};

const staticBackgroundStyle = {
  width: "100%",
  height: "100%",
  background: [
    "radial-gradient(circle at 20% 25%, rgba(159, 207, 151, 0.16), transparent 22%)",
    "radial-gradient(circle at 78% 34%, rgba(159, 207, 151, 0.1), transparent 18%)",
    "radial-gradient(circle at 50% 72%, rgba(159, 207, 151, 0.08), transparent 26%)",
    "linear-gradient(180deg, rgba(22, 46, 22, 0.18), rgba(0, 0, 0, 0.06))",
  ].join(", "),
};

function getBackgroundProfile() {
  if (typeof window === "undefined") {
    return { reducedMotion: false, compact: false };
  }

  return {
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false,
    compact: window.innerWidth <= 768,
  };
}

function WallBackground() {
  const [profile, setProfile] = useState(getBackgroundProfile);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const mediaQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const updateProfile = () => setProfile(getBackgroundProfile());

    updateProfile();
    window.addEventListener("resize", updateProfile);
    mediaQuery?.addEventListener?.("change", updateProfile);

    return () => {
      window.removeEventListener("resize", updateProfile);
      mediaQuery?.removeEventListener?.("change", updateProfile);
    };
  }, []);

  if (profile.reducedMotion) {
    return (
      <div aria-hidden="true" style={backgroundStyle}>
        <div style={staticBackgroundStyle} />
      </div>
    );
  }

  return (
    <div aria-hidden="true" style={backgroundStyle}>
      <PixelBlast
        variant="circle"
        antialias={!profile.compact}
        interactive={false}
        maxPixelRatio={profile.compact ? 1 : 1.5}
        pixelSize={profile.compact ? 5 : 3}
        color="#9fcf97"
        patternScale={profile.compact ? 2.2 : 3}
        patternDensity={profile.compact ? 1.15 : 1.45}
        pixelSizeJitter={profile.compact ? 0.45 : 1.1}
        enableRipples={!profile.compact}
        rippleSpeed={profile.compact ? 0.25 : 0.4}
        rippleThickness={profile.compact ? 0.08 : 0.12}
        rippleIntensityScale={profile.compact ? 0.8 : 1.5}
        liquid={false}
        liquidStrength={0.12}
        liquidRadius={1.2}
        liquidWobbleSpeed={5}
        speed={profile.compact ? 1.1 : 2.25}
        targetFps={profile.compact ? 24 : 36}
        edgeFade={0.25}
        transparent
      />
    </div>
  );
}

export default memo(WallBackground);

import { memo } from "react";
import FaultyTerminal from "./FaultyTerminal.jsx";

const backgroundStyle = {
  position: "absolute",
  inset: 0,
  zIndex: 0,
  pointerEvents: "none",
};

function WallBackground() {
  return (
    <div aria-hidden="true" style={backgroundStyle}>
      <FaultyTerminal
        scale={2.5}
        gridMul={[2, 1]}
        digitSize={3}
        timeScale={0.3}
        pause={false}
        scanlineIntensity={0.2}
        glitchAmount={1}
        flickerAmount={1}
        noiseAmp={1}
        chromaticAberration={0}
        dither={0}
        curvature={0}
        tint="#A7EF9E"
        mouseReact={false}
        mouseStrength={0.5}
        pageLoadAnimation={false}
        brightness={0.6}
      />
    </div>
  );
}

export default memo(WallBackground);


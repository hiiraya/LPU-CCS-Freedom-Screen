import { memo } from "react";
import PixelBlast from "./PixelBlast.jsx";

const backgroundStyle = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  zIndex: 0,
  pointerEvents: "none",
};

function WallBackground() {
  return (
    <div aria-hidden="true" style={backgroundStyle}>
      <PixelBlast
        variant="circle"
        pixelSize={3}
        color="#9fcf97"
        patternScale={3}
        patternDensity={1.45}
        pixelSizeJitter={1.1}
        enableRipples
        rippleSpeed={0.4}
        rippleThickness={0.12}
        rippleIntensityScale={1.5}
        liquid={false}
        liquidStrength={0.12}
        liquidRadius={1.2}
        liquidWobbleSpeed={5}
        speed={2.25}
        edgeFade={0.25}
        transparent
      />
    </div>
  );
}

export default memo(WallBackground);
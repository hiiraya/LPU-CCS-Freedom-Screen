import { getLanguageConfig } from "../utils/languages.js";

export default function LanguageIcon({ language, size = 16, style = {} }) {
  const config = getLanguageConfig(language);
  const pixelSize = typeof size === "number" ? size : Number.parseFloat(size) || 16;

  if (!config.icon) {
    return (
      <div
        aria-hidden="true"
        style={{
          width: pixelSize,
          height: pixelSize,
          borderRadius: Math.max(3, Math.round(pixelSize * 0.18)),
          background: "#202020",
          border: "1px solid rgba(255,255,255,0.08)",
          flexShrink: 0,
          ...style,
        }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{
        width: pixelSize,
        height: pixelSize,
        display: "grid",
        placeItems: "center",
        borderRadius: Math.max(3, Math.round(pixelSize * 0.18)),
        overflow: "hidden",
        flexShrink: 0,
        ...style,
      }}
    >
      <img
        src={config.icon}
        alt=""
        aria-hidden="true"
        loading="eager"
        style={{
          width: "78%",
          height: "78%",
          display: "block",
          objectFit: "contain",
        }}
      />
    </div>
  );
}

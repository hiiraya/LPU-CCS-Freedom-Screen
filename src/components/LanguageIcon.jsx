import { getLanguageConfig } from "../utils/languages.js";

export default function LanguageIcon({ language, size = 16, style = {} }) {
  const config = getLanguageConfig(language);

  if (!config.icon) {
    return (
      <div
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: Math.max(3, Math.round(size * 0.18)),
          background: "#202020",
          border: "1px solid rgba(255,255,255,0.08)",
          ...style,
        }}
      />
    );
  }

  return (
    <img
      src={config.icon}
      alt=""
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        display: "block",
        objectFit: "contain",
        ...style,
      }}
    />
  );
}

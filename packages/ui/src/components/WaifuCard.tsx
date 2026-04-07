import React from "react";
import type { Waifu } from "@syntax-senpai/waifu-core";

type Props = {
  waifu: Waifu;
  onClick?: () => void;
  showAvatar?: boolean;
};

const WaifuCard: React.FC<Props> = ({ waifu, onClick, showAvatar = true }) => {
  const emojiFallback =
    (waifu.communicationStyle && waifu.communicationStyle.signatureEmojis && waifu.communicationStyle.signatureEmojis[0]) || "🎀";
  const neutralAsset = waifu.avatar && waifu.avatar.expressions && waifu.avatar.expressions.neutral;
  const avatarUri = neutralAsset && neutralAsset.uri;

  const truncated = waifu.backstory && waifu.backstory.length > 140 ? waifu.backstory.slice(0, 140) + "..." : waifu.backstory;

  const containerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: 12,
    border: "1px solid #eee",
    borderRadius: 10,
    background: "#fff",
    cursor: onClick ? "pointer" : "default",
    maxWidth: 420,
  };

  const avatarStyle: React.CSSProperties = { width: 72, height: 72, borderRadius: 8, objectFit: "cover", flex: "0 0 auto" };
  const nameStyle: React.CSSProperties = { margin: 0, fontSize: 16, fontWeight: 600 };
  const backstoryStyle: React.CSSProperties = { margin: "6px 0 8px", color: "#444", fontSize: 13 };
  const tagsContainerStyle: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap" };
  const tagStyle: React.CSSProperties = { fontSize: 11, padding: "4px 6px", background: "#f3f4f6", borderRadius: 6, color: "#333" };

  return (
    <div style={containerStyle} onClick={onClick} role={onClick ? "button" : undefined}>
      {showAvatar &&
        (avatarUri ? (
          <img src={avatarUri} alt={waifu.displayName} style={avatarStyle} />
        ) : (
          <div
            style={{
              ...avatarStyle,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
            }}
          >
            {emojiFallback}
          </div>
        ))}

      <div style={{ flex: 1 }}>
        <h3 style={nameStyle}>{waifu.displayName}</h3>
        <p style={backstoryStyle}>{truncated}</p>
        <div style={tagsContainerStyle}>{waifu.tags && waifu.tags.map((t) => <span key={t} style={tagStyle}>#{t}</span>)}</div>
      </div>
    </div>
  );
};

export default WaifuCard;

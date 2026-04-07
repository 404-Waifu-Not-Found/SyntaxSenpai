import React, { useEffect, useState } from "react";
import type { Waifu } from "@syntax-senpai/waifu-core";
import useFavorites from "../hooks/useFavorites";

type Props = {
  waifu: Waifu;
  onClick?: () => void;
  showAvatar?: boolean;
  enterDelayMs?: number;
};

const INJECTED_STYLE_ID = "waifu-card-styles";

function ensureStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(INJECTED_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = INJECTED_STYLE_ID;
  style.innerHTML = `
@keyframes waifu-shimmer {
  0% { transform: translateX(-150%); }
  100% { transform: translateX(150%); }
}
@keyframes fav-pulse {
  0% { transform: scale(1); opacity: 1; }
  60% { transform: scale(1.18); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
.waifu-tag { transition: transform 160ms ease, background 160ms ease; }
.waifu-tag:hover { transform: translateY(-2px) scale(1.02); background: #eef2ff; }
.waifu-card { transform-style: preserve-3d; will-change: transform; }
.waifu-card .fav-btn { transition: transform 180ms ease; border: none; background: transparent; }
`;
  document.head.appendChild(style);
}

const WaifuCard: React.FC<Props> = ({ waifu, onClick, showAvatar = true, enterDelayMs = 0 }) => {
  const [mounted, setMounted] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [hover, setHover] = useState(false);
  const [favPulse, setFavPulse] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  useEffect(() => {
    ensureStyles();
    const t = setTimeout(() => setMounted(true), enterDelayMs || 0);
    return () => clearTimeout(t);
  }, [enterDelayMs]);

  const { favorites, isFavorite, toggleFavorite } = useFavorites();
  const isFav = isFavorite ? isFavorite(waifu.id) : false;

  const emojiFallback = (waifu.communicationStyle && waifu.communicationStyle.signatureEmojis && waifu.communicationStyle.signatureEmojis[0]) || "🎀";
  const neutralAsset = waifu.avatar && waifu.avatar.expressions && waifu.avatar.expressions.neutral;
  const avatarUri = neutralAsset && neutralAsset.uri;

  // prefer local generated avatar (served from UI public/avatars)
  const localAvatarPng = `/avatars/${waifu.id}.png`;
  const localAvatarSvg = `/avatars/${waifu.id}.svg`;
  const avatarSrc = avatarUri || localAvatarPng;

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
    transform: mounted ? (hover ? `translateY(-4px) scale(1.004) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` : `translateY(0) scale(1) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`) : "translateY(8px) scale(.995)",
    opacity: mounted ? 1 : 0,
    transition: "transform 260ms cubic-bezier(0.2,0,0,1), box-shadow 220ms ease, opacity 220ms ease",
    boxShadow: hover ? "0 10px 30px rgba(16,24,40,0.12)" : "0 2px 6px rgba(2,6,23,0.06)",
  };

  const avatarStyle: React.CSSProperties = {
    width: 72,
    height: 72,
    borderRadius: 10,
    objectFit: "cover",
    flex: "0 0 auto",
    background: "#fff",
    transition: "transform 180ms ease, opacity 180ms ease, box-shadow 200ms ease",
    transform: imgLoaded ? "scale(1)" : "scale(.96)",
    opacity: imgLoaded ? 1 : 0.7,
    boxShadow: hover ? "0 6px 18px rgba(2,6,23,0.08)" : undefined,
  };

  const placeholderStyle: React.CSSProperties = {
    ...avatarStyle,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 30,
    color: "#999",
    position: "relative",
    overflow: "hidden",
  };

  const nameStyle: React.CSSProperties = { margin: 0, fontSize: 16, fontWeight: 600 };
  const backstoryStyle: React.CSSProperties = { margin: "6px 0 8px", color: "#444", fontSize: 13 };
  const tagsContainerStyle: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap" };
  const tagStyle: React.CSSProperties = { fontSize: 11, padding: "4px 6px", background: "#f3f4f6", borderRadius: 6, color: "#333", transition: "transform 160ms ease" };

  return (
    <div
      className="waifu-card"
      style={containerStyle}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseMove={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const rotY = ((x - cx) / cx) * 6; // max 6deg
        const rotX = -((y - cy) / cy) * 6;
        setTilt({ x: Number(rotX.toFixed(2)), y: Number(rotY.toFixed(2)) });
      }}
      onMouseLeave={() => {
        setHover(false);
        setTilt({ x: 0, y: 0 });
      }}
    >
      {showAvatar &&
        (avatarSrc ? (
          <div style={{ position: "relative", width: 72, height: 72, flex: "0 0 auto" }}>
            <img
              src={avatarSrc}
              alt={waifu.displayName}
              style={avatarStyle}
              onLoad={() => setImgLoaded(true)}
              onError={(e) => {
                setImgLoaded(false);
                try {
                  (e.target as HTMLImageElement).src = localAvatarSvg;
                } catch (err) {}
              }}
              width={72}
              height={72}
            />
            <button
              aria-label={"favorite-" + waifu.id}
              className="fav-btn"
              onClick={(e) => {
                e.stopPropagation();
                const res = toggleFavorite(waifu.id);
                const nowFav = Array.isArray(res) ? (res as string[]).includes(waifu.id) : !isFav;
                if (nowFav) {
                  setFavPulse(true);
                  setTimeout(() => setFavPulse(false), 380);
                }
              }}
              style={{
                position: "absolute",
                top: -6,
                right: -6,
                borderRadius: 9999,
                border: "1px solid rgba(0,0,0,0.06)",
                background: "#fff",
                padding: 6,
                cursor: "pointer",
                fontSize: 12,
                lineHeight: 1,
                boxShadow: "0 2px 10px rgba(2,6,23,0.06)",
                animation: favPulse ? "fav-pulse 380ms cubic-bezier(.2,.9,.2,1)" : undefined,
                transform: favPulse ? "scale(1.12)" : undefined,
              }}
            >
              {isFav ? "★" : "☆"}
            </button>
          </div>
        ) : (
          <div style={placeholderStyle}>
            <span aria-hidden>{emojiFallback}</span>
            <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.6) 50%, rgba(255,255,255,0) 100%)", transform: "translateX(-150%)", animation: "waifu-shimmer 1.2s linear infinite" }} />
            </div>
          </div>
        ))}

      <div style={{ flex: 1 }}>
        <h3 style={nameStyle}>{waifu.displayName}</h3>
        <p style={backstoryStyle}>{truncated}</p>
        <div style={tagsContainerStyle}>{waifu.tags && waifu.tags.map((t) => <span key={t} style={tagStyle} className="waifu-tag">#{t}</span>)}</div>
      </div>
    </div>
  );
};

export { WaifuCard };
export default WaifuCard;

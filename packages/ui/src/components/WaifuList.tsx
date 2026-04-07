import React from "react";
import type { Waifu } from "@syntax-senpai/waifu-core";
import WaifuCard from "./WaifuCard";

export type WaifuListProps = {
  waifus: Waifu[];
  onSelect?: (w: Waifu) => void;
  showAvatar?: boolean;
  className?: string;
};

export default function WaifuList({
  waifus,
  onSelect,
  showAvatar = true,
  className,
}: WaifuListProps) {
  const containerStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
    alignItems: "start",
  };

  return (
    <div style={containerStyle} className={className}>
      {waifus.map((w) => (
        <div
          key={w.id}
          onClick={() => onSelect?.(w)}
          style={{ cursor: onSelect ? "pointer" : "default" }}
        >
          <WaifuCard waifu={w} onClick={() => onSelect?.(w)} showAvatar={showAvatar} />
        </div>
      ))}
    </div>
  );
}

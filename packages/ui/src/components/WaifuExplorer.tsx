import React, { useMemo, useState } from "react";
import type { Waifu } from "@syntax-senpai/waifu-core";
import WaifuList from "./WaifuList";
import { filterWaifus } from "../utils/filterWaifus";
import useFavorites from "../hooks/useFavorites";
import { applyFavoritesAndFilter } from "../utils/applyFavoritesAndFilter";

export type WaifuExplorerProps = {
  waifus: Waifu[];
  onSelect?: (w: Waifu) => void;
  showAvatar?: boolean;
};

export default function WaifuExplorer({ waifus, onSelect, showAvatar = true }: WaifuExplorerProps) {
  const [query, setQuery] = useState("");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const { favorites } = useFavorites();

  const filtered = useMemo(() => applyFavoritesAndFilter(waifus || [], favorites, query, onlyFavorites), [waifus, favorites, query, onlyFavorites]);

  const containerStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
  const inputStyle: React.CSSProperties = { padding: 8, borderRadius: 8, border: "1px solid #ddd", width: "100%", maxWidth: 420 };
  const toolbarStyle: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center" };
  const toggleStyle: React.CSSProperties = { padding: "6px 8px", borderRadius: 8, border: "1px solid #ddd", background: onlyFavorites ? "#eef2ff" : "#fff", cursor: "pointer" };

  return (
    <div style={containerStyle}>
      <div style={toolbarStyle}>
        <input aria-label="search" placeholder="Search waifus by name, tag or story..." value={query} onChange={(e) => setQuery(e.target.value)} style={inputStyle} />
        <button aria-pressed={onlyFavorites} onClick={() => setOnlyFavorites((s) => !s)} style={toggleStyle}>{onlyFavorites ? "Showing favorites" : "Show favorites only"}</button>
      </div>
      <WaifuList waifus={filtered} onSelect={onSelect} showAvatar={showAvatar} />
    </div>
  );
}

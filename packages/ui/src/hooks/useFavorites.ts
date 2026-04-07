import { useEffect, useState } from "react";

const KEY = "syntax-senpai:favorites";

export function getFavorites(): string[] {
  try {
    if (typeof window === "undefined" || !window.localStorage) return [];
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

export function setFavorites(favs: string[]) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(KEY, JSON.stringify(favs));
  } catch (e) {
    // ignore
  }
}

export function toggleFavoriteSync(id: string): string[] {
  const current = getFavorites();
  if (current.includes(id)) {
    const next = current.filter((x) => x !== id);
    setFavorites(next);
    return next;
  }
  const next = [...current, id];
  setFavorites(next);
  return next;
}

export default function useFavorites() {
  const [favorites, setFavoritesState] = useState<string[]>(() => getFavorites());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setFavoritesState(getFavorites());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function toggle(id: string) {
    const res = toggleFavoriteSync(id);
    setFavoritesState(res);
    return res;
  }

  function addFavorite(id: string) {
    if (!favorites.includes(id)) toggle(id);
  }

  function removeFavorite(id: string) {
    if (favorites.includes(id)) toggle(id);
  }

  const isFavorite = (id: string) => favorites.includes(id);

  return { favorites, isFavorite, toggleFavorite: toggle, addFavorite, removeFavorite };
}

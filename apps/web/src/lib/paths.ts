// Vite base keeps the standalone game and the OnlineBoard mount independent.
export const gameBase = import.meta.env.BASE_URL.replace(/\/$/, '');
export const gamePath = (path: string) => gameBase + path;
export const currentGamePath = () => location.pathname.slice(gameBase.length) + location.search;

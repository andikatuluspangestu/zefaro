import { createContext, useContext } from "react";

/** False while the logo preloader is on screen, so the hero waits to play. */
export const ReadyContext = createContext(true);
export const useReady = () => useContext(ReadyContext);

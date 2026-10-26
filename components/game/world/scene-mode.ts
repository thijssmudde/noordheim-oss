'use client';
import { createContext, useContext } from 'react';

/** False in the attract mode and photo captures: no health bars, rings or labels. */
export const OverlaysContext = createContext(true);
export const useOverlays = () => useContext(OverlaysContext);

/**
 * True in the home-screen attract mode (not in captures): load the light
 * variants of assets, e.g. the `_lod` trees everywhere instead of the full
 * trees near the camera, so the hero scene downloads a fraction of the bytes.
 */
export const LightAssetsContext = createContext(false);
export const useLightAssets = () => useContext(LightAssetsContext);

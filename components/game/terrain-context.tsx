'use client';
import { createContext, useContext } from 'react';
import { legacyTerrain } from '@/lib/tactical-terrain';
export const TerrainContext = createContext(legacyTerrain);
export const useTerrain = () => useContext(TerrainContext);

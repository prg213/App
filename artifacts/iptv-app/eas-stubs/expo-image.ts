/**
 * Minimal stub for expo-image used in Jest tests.
 * The real expo-image ships as ESM which babel-jest cannot parse via the
 * pnpm-store nested node_modules path; this stub provides just enough surface
 * area (a plain string component) so tests that don't exercise image rendering
 * can still import modules that transitively depend on expo-image.
 */
import React from 'react';

export const Image = 'Image';
export default { Image };

'use client';
import * as React from 'react';

/** Embedded forms share their host's in-flow navigation and must stay inline. */
export const EmbeddedAuthFormContext = React.createContext(false);

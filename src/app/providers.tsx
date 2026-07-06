'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="standard"
      value={{
        standard: 'standard',
        dark: 'dark',
        cat: 'cat',
        'picture-book': 'picture-book',
        botanical: 'botanical',
        cyber: 'cyber',
      }}
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}

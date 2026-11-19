// Class-name merging for shadcn/ui components, from the approved clsx + tailwind-merge.
// The official registry now imports `cn` from an npm package of that name; that package is not an
// approved dependency, so the bare specifier "cn" is aliased here (vite.config.ts, tsconfig paths).
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

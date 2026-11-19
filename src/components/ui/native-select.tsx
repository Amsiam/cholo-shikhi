// A native <select> styled like Input: 44px tall, square-ish corners, teal focus ring. Native so it
// works with the phone's own picker and needs no extra dependency.
import { cn } from 'cn';
import type * as React from 'react';

export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'h-11 w-full min-w-0 rounded-sm border border-input bg-background px-3 text-base outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

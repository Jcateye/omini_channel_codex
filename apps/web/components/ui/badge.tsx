import * as React from 'react';

import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'muted' | 'accent';
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-full border border-ink/10 px-2.5 py-1 text-xs font-medium tracking-wide',
        variant === 'muted' && 'bg-ink/5 text-muted',
        variant === 'accent' && 'bg-accent/15 text-accent',
        variant === 'default' && 'bg-surface/80 text-ink',
        className
      )}
      {...props}
    />
  )
);

Badge.displayName = 'Badge';

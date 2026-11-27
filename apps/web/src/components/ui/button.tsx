import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[transform,background-color,box-shadow,color] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-[var(--shadow-sm),inset_0_1px_0_oklch(100%_0_0/0.18)] hover:bg-primary-hover',
        outline:
          'border border-border-strong bg-background hover:bg-primary-soft hover:text-primary-ink',
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
        google:
          'h-auto min-h-11 whitespace-normal border border-border-strong bg-background py-2 text-center font-semibold hover:bg-canvas',
      },
      size: {
        default: 'h-10 px-4',
        lg: 'h-11.5 px-5 text-[0.9375rem]',
        icon: 'size-9 p-0',
      },
      block: { true: 'w-full' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({
  className,
  variant,
  size,
  block,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, block, className }))} {...props} />;
}

export function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
    />
  );
}

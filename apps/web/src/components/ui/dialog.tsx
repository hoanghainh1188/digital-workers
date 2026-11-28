import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Modal dialog in the style of docs/design/screens/_shared.css (.scrim / .dialog):
 * head, body and a canvas-coloured footer. Radix handles focus trap, Escape and ARIA.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide = false,
  role = 'dialog',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
  wide?: boolean;
  /** 'alertdialog' for blocking messages ("cannot archive", "last Owner"). */
  role?: 'dialog' | 'alertdialog';
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[oklch(22%_0.03_262/0.42)] backdrop-blur-[2px] data-[state=open]:animate-[fade-in_var(--duration-fast)_ease-out]" />
        <DialogPrimitive.Content
          role={role}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-background shadow-[0_24px_60px_-20px_oklch(22%_0.03_262/0.35)] focus:outline-none data-[state=open]:animate-[dialog-in_var(--duration-normal)_var(--ease-out-expo)]',
            wide ? 'max-w-[38rem]' : 'max-w-[28rem]',
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <header className="px-6 pt-5 pb-3">
            <DialogPrimitive.Title className="text-lg font-semibold tracking-[-0.01em]">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </header>
          {children ? <div className="grid gap-4.5 px-6 pt-3 pb-5">{children}</div> : null}
          <footer className="flex flex-wrap justify-end gap-2 rounded-b-2xl border-t bg-canvas px-6 py-4">
            {footer}
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const DialogClose = DialogPrimitive.Close;

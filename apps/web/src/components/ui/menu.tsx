import { MoreHorizontal } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type MenuItem = {
  readonly label: string;
  readonly onSelect: () => void;
  readonly danger?: boolean;
  /** Draw a separator above this item. */
  readonly separated?: boolean;
};

/** "…" row menu (users.html .menu). Keyboard and focus handling come from Radix. */
export function RowMenu({ label, items }: { label: string; items: readonly MenuItem[] }) {
  if (items.length === 0) return null;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label} title={label}>
          <MoreHorizontal />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-30 min-w-[12rem] rounded-xl border bg-background p-1.5 shadow-[0_18px_40px_-18px_oklch(22%_0.03_262/0.35)]"
        >
          {items.map((item) => (
            <div key={item.label}>
              {item.separated ? <DropdownMenu.Separator className="my-1 h-px bg-border" /> : null}
              <DropdownMenu.Item
                onSelect={item.onSelect}
                className={cn(
                  'flex cursor-pointer items-center rounded-md px-2.5 py-2 text-sm outline-none select-none data-[highlighted]:bg-primary-soft data-[highlighted]:text-primary-ink',
                  item.danger &&
                    'text-destructive-ink data-[highlighted]:bg-destructive-soft data-[highlighted]:text-destructive-ink',
                )}
              >
                {item.label}
              </DropdownMenu.Item>
            </div>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

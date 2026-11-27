import { Eye, EyeOff } from 'lucide-react';
import { type ComponentProps, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { t } from '@/i18n/t';

/** Password input with a show / hide toggle. */
export function PasswordInput(props: Omit<ComponentProps<'input'>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className="pr-11" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-1/2 right-1 -translate-y-1/2 active:-translate-y-1/2"
        aria-label={visible ? t('signup.password.hide') : t('signup.password.show')}
        aria-pressed={visible}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}

import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import {
  CLIENT_MESSAGES,
  type ClientMessageSet,
  GLOBAL,
  pickMessages,
} from '@/lib/client-messages';

/**
 * Gives the client components inside it the messages of one set (lib/client-messages.ts), on top of
 * the global ones, instead of shipping the whole catalogue with every page.
 */
export async function ClientMessages({
  set,
  children,
}: {
  set: ClientMessageSet;
  children: ReactNode;
}) {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider
      messages={pickMessages(messages as never, [...GLOBAL, ...CLIENT_MESSAGES[set]])}
    >
      {children}
    </NextIntlClientProvider>
  );
}

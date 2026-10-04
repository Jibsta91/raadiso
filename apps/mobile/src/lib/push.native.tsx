// Push notifications on devices (ADR-0025): register this installation's Expo push token while
// signed in, remove it on sign-out, and open the screen a push points to when it is tapped. A new
// message can also be answered from the notification itself (Reply), without opening the app.
import * as Notifications from 'expo-notifications';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useI18n } from '../i18n';
import { useApi } from './api';
import { useAuth } from './auth/context';
import { config } from './config';
import { conversationOf, isCurrentScreen, safeAppPath } from './push-path';

/** The screen on show (an Expo Router path), kept by PushRegistration. */
let currentPath = '';

// Show pushes as banners while the app is open too (a new message in another conversation),
// but not for the screen already on show: a message in the open conversation appears there.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const here = isCurrentScreen(notification.request.content.data?.url, currentPath);
    return {
      shouldShowBanner: !here,
      shouldShowList: !here,
      shouldPlaySound: false,
      shouldSetBadge: false,
    };
  },
});

/** Responses already acted on: the "last response" survives reloads and must open only once. */
const handled = new Set<string>();

/** The notification category of message pushes (set by the server) and its Reply action. */
const MESSAGE_CATEGORY = 'message';
const REPLY = 'reply';

/** Replies typed on a notification, sent once the session has loaded (the app may just have woken). */
const replies: Array<{ conversation: string; text: string }> = [];
let sendReplies: (() => void) | undefined;

function open(response: Notifications.NotificationResponse | null): void {
  if (!response) return;
  const id = response.notification.request.identifier;
  if (handled.has(id)) return;
  handled.add(id);
  const url = response.notification.request.content.data?.url;
  if (response.actionIdentifier === REPLY) {
    const conversation = conversationOf(url);
    const text = response.userText?.trim().slice(0, 2000);
    if (conversation && text) {
      replies.push({ conversation, text });
      sendReplies?.();
    }
    return;
  }
  const path = safeAppPath(url);
  // After the current render: the navigator must be mounted before we navigate.
  if (path) setTimeout(() => router.push(path as never), 0);
}

/** This installation's Expo push token, asking for permission once; null if not allowed or unavailable. */
async function pushToken(projectId: string): Promise<string | null> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Raadiso',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const status =
    current.status !== 'granted' && current.canAskAgain
      ? (await Notifications.requestPermissionsAsync()).status
      : current.status;
  if (status !== 'granted') return null;
  // Throws in simulators and in Expo Go on Android (no remote push there): no push then.
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}

export function PushRegistration(): null {
  const auth = useAuth();
  const api = useApi();
  const { m } = useI18n();
  const registered = useRef<string | null>(null);
  const { status, beforeSignOut } = auth;
  const pathname = usePathname();

  useEffect(() => {
    currentPath = pathname;
  }, [pathname]);

  // Taps: the push that started the app, and those tapped while it runs.
  useEffect(() => {
    void Notifications.getLastNotificationResponseAsync().then(open, () => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, []);

  // The Reply action on message notifications: a text field, answered in the background.
  useEffect(() => {
    void Notifications.setNotificationCategoryAsync(MESSAGE_CATEGORY, [
      {
        identifier: REPLY,
        buttonTitle: m.messages.reply,
        textInput: { submitButtonTitle: m.messages.send, placeholder: m.contact.placeholder },
        options: { opensAppToForeground: false },
      },
    ]).catch(() => undefined);
  }, [m]);

  // Send replies typed on notifications once signed in (the session loads after a cold start).
  useEffect(() => {
    if (status !== 'signedIn') return;
    sendReplies = () => {
      for (const reply of replies.splice(0)) {
        void api.messaging
          .POST('/api/v1/messaging/conversations/{id}/messages', {
            params: { path: { id: reply.conversation } },
            body: { body: reply.text },
          })
          .catch(() => undefined);
      }
    };
    sendReplies();
    return () => {
      sendReplies = undefined;
    };
  }, [status, api]);

  // Register on every start while signed in (tokens can change; the server moves them between users).
  useEffect(() => {
    const projectId = config.easProjectId;
    if (status !== 'signedIn' || !projectId) return;
    let cancelled = false;
    (async () => {
      const token = await pushToken(projectId);
      if (!token || cancelled) return;
      const { response } = await api.notifications.PUT('/api/v1/notifications/devices', {
        body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
      });
      if (response.ok) registered.current = token;
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [status, api]);

  // Sign-out: stop pushing to this device while the session still works.
  useEffect(
    () =>
      beforeSignOut(async () => {
        const token = registered.current;
        if (!token) return;
        registered.current = null;
        await api.notifications.DELETE('/api/v1/notifications/devices/{token}', {
          params: { path: { token } },
        });
      }),
    [beforeSignOut, api],
  );

  return null;
}

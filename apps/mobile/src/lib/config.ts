import Constants from 'expo-constants';
import { Platform } from 'react-native';

interface Extra {
  publicBaseUrl: string;
  authBaseUrl: string;
  realm: string;
  clientId: string;
  errorsPublicKey?: string;
  errorsProjectId?: string;
  eas?: { projectId?: string };
}

const extra = Constants.expoConfig?.extra as Extra;

export const config = {
  /** Empty on the web: the web build is served by the gateway, so API calls stay same-origin. */
  apiBaseUrl: Platform.OS === 'web' ? '' : extra.publicBaseUrl,
  issuer: `${extra.authBaseUrl}/realms/${extra.realm}`,
  clientId: extra.clientId,
  /** GlitchTip's public project key and project (ADR-0038); empty turns error reporting off. */
  errorsPublicKey: extra.errorsPublicKey ?? '',
  errorsProjectId: extra.errorsProjectId ?? '',
  /** The linked Expo project; push tokens are issued per project (none: no push). */
  easProjectId: extra.eas?.projectId,
};

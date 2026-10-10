// Lets `node --test` import the components: .tsx is compiled with TypeScript's transpiler (JSX to
// react/jsx-runtime), and extensionless relative imports find their .ts/.tsx file.
import { register } from 'node:module';

register('./tsx-loader.mjs', import.meta.url);

// Loaded with `node --import` before the application so instrumentation can
// patch http and pino as they are imported.
import { startTelemetry } from '@raadi/service-kit/telemetry';

startTelemetry({ serviceName: 'llm-mock' });

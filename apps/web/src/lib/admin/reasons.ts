/** Reason codes the services accept for staff decisions (ADR-0030); labels are in messages. */
export const REMOVAL_REASONS = [
  'fraud',
  'prohibited',
  'offensive',
  'wrong_category',
  'duplicate',
  'spam',
  'other',
] as const;
export const SUSPENSION_REASONS = [
  'fraud',
  'spam',
  'abuse',
  'chargeback',
  'impersonation',
  'security',
  'other',
] as const;
export const REFUND_REASONS = [
  'customer_request',
  'duplicate',
  'service_failure',
  'fraud',
  'goodwill',
  'other',
] as const;
export const REVIEW_REMOVAL_REASONS = [
  'abusive',
  'personal_data',
  'not_genuine',
  'off_topic',
  'other',
] as const;

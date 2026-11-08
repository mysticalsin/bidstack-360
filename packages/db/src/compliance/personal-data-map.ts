/**
 * Where personal data lives, and what GDPR export and erase do with each store.
 *
 * The coverage test (personal-data-map.test.ts) enumerates every Prisma model
 * with `personalFieldsInSchema` and fails until each detected field is listed
 * here, either as a SUBJECT_STORE (the engine in data-subject.ts exports and
 * erases it) or a NON_SUBJECT_STORE (not a store of data subject records, with
 * the reason). data-subject.ts types its handler table as
 * Record<SubjectStoreModel, ...>, so a store without a handler does not compile.
 */

export interface SchemaField {
  name: string;
  kind: string;
  type: string;
  isList?: boolean;
  dbName?: string | null;
  nativeType?: readonly unknown[] | null;
}

export interface SchemaModel {
  name: string;
  dbName?: string | null;
  fields: readonly SchemaField[];
}

/** Field names that hold contact details, identities or captured speech. */
const DIRECT_PERSONAL =
  /(email|phone|mobile|fromNumber|toNumber|firstName|lastName|fullName|contactName|attendeeName|attendees|participants$|participantEmails|recipients$|linkedin(url)?$|transcript|ipAddress|openedIp)/i;
/** A field that names a person only when its model also holds contact details. */
const CONTEXTUAL_PERSONAL = /^(name|body|bodyText|bodyHtml|subject)$/;
const CONTACT_DETAIL = /(email|phone|mobile|fromNumber|toNumber)/i;
const NON_TEXT_TYPES = new Set(['Boolean', 'Int', 'BigInt', 'Float', 'Decimal', 'DateTime']);

function isCandidate(f: SchemaField): boolean {
  return (
    f.kind !== 'object' &&
    !NON_TEXT_TYPES.has(f.type) &&
    !/(Id|Hash)$/.test(f.name) &&
    f.name !== 'id'
  );
}

/** Every (model, field) pair the detector treats as personal data. */
export function personalFieldsInSchema(
  models: readonly SchemaModel[],
): Array<{ model: string; field: string }> {
  const out: Array<{ model: string; field: string }> = [];
  for (const m of models) {
    const candidates = m.fields.filter(isCandidate);
    const direct = candidates.filter((f) => DIRECT_PERSONAL.test(f.name));
    const hasContact = direct.some((f) => CONTACT_DETAIL.test(f.name));
    const contextual = hasContact ? candidates.filter((f) => CONTEXTUAL_PERSONAL.test(f.name)) : [];
    for (const f of [...direct, ...contextual]) out.push({ model: m.name, field: f.name });
  }
  return out;
}

export type StoreStrategy = 'tombstone' | 'delete' | 'scrub' | 'retain' | 'pseudonymise';

export interface SubjectStore {
  model: string;
  /** Personal fields the engine exports and erases (or retains) for a subject. */
  fields: readonly string[];
  strategy: StoreStrategy;
  /** How rows are linked to the subject. */
  match: string;
  /** Legal basis for keeping some or all rows. */
  basis?: string;
}

export const SUBJECT_STORES = [
  {
    model: 'Contact',
    fields: ['name', 'email', 'phone', 'role'],
    strategy: 'tombstone',
    match: 'subject id',
  },
  {
    model: 'Lead',
    fields: ['firstName', 'lastName', 'email', 'phone', 'title', 'notes', 'intel'],
    strategy: 'tombstone',
    match: 'subject id',
  },
  {
    model: 'OrgChartNode',
    fields: ['name', 'email', 'phone', 'linkedinUrl', 'title', 'photoUrl', 'profile'],
    strategy: 'tombstone',
    match: 'node id, contact id or email',
  },
  {
    model: 'ActivityAttendee',
    fields: ['email'],
    strategy: 'scrub',
    match: 'contact id or email',
  },
  {
    model: 'Activity',
    fields: ['subject', 'description', 'body', 'metadata'],
    strategy: 'scrub',
    match: 'entity link or mention',
  },
  {
    model: 'ContactFact',
    fields: ['claim', 'evidenceDetail'],
    strategy: 'delete',
    match: 'contact id or mention',
  },
  {
    model: 'CustomerCommitment',
    fields: ['promise', 'sourceNote'],
    strategy: 'scrub',
    match: 'owner contact id or mention',
  },
  {
    model: 'OpportunityContact',
    fields: ['notes'],
    strategy: 'delete',
    match: 'contact id',
  },
  {
    model: 'MeetingIntelAttendee',
    fields: ['name', 'email', 'title'],
    strategy: 'tombstone',
    match: 'contact id, email or name',
  },
  {
    model: 'MeetingIntel',
    fields: ['transcriptText', 'summary'],
    strategy: 'scrub',
    match: 'attended or mentioned',
  },
  {
    model: 'MeetingIngestItem',
    fields: ['payload'],
    strategy: 'scrub',
    match: 'mention in a raw payload (redacted in place)',
  },
  {
    model: 'KamSession',
    fields: ['attendees', 'transcriptText', 'transcriptStructured', 'aiNote'],
    strategy: 'scrub',
    match: 'attendee entry or mention',
  },
  {
    model: 'GovernanceMeeting',
    fields: ['participants', 'outcomes'],
    strategy: 'scrub',
    match: 'participant entry or mention',
  },
  {
    model: 'CalendarEvent',
    fields: ['attendees', 'organizerEmail', 'subject', 'bodyPreview'],
    strategy: 'scrub',
    match: 'attendee, organizer, related entity or mention',
  },
  {
    model: 'Booking',
    fields: ['attendeeName', 'attendeeEmail', 'attendeePhone', 'answers'],
    strategy: 'tombstone',
    match: 'email or phone',
  },
  {
    model: 'EmailMessage',
    fields: ['fromEmail', 'toEmails', 'ccEmails', 'subject', 'bodyText', 'bodyHtml'],
    strategy: 'tombstone',
    match: 'sender, recipient, entity link or mention',
  },
  {
    model: 'EmailTrackingPixel',
    fields: ['firstOpenedIp'],
    strategy: 'scrub',
    match: 'pixel of an erased message',
  },
  {
    model: 'SmsMessage',
    fields: ['fromNumber', 'toNumber', 'body'],
    strategy: 'tombstone',
    match: 'phone, entity link or mention',
  },
  {
    model: 'SmsConsent',
    fields: ['phoneNumber'],
    strategy: 'delete',
    match: 'phone',
    basis:
      'An opt-out record is kept so the number is never messaged again (GDPR Art. 17(3)(b), Art. 21(3); TCPA opt-out).',
  },
  {
    model: 'CallSession',
    fields: [
      'participantEmails',
      'transcriptText',
      'transcriptStructured',
      'summary',
      'actionItems',
    ],
    strategy: 'scrub',
    match: 'participant, entity link or mention',
  },
  {
    model: 'CallSummary',
    fields: ['value'],
    strategy: 'delete',
    match: 'summary line of a scrubbed call',
  },
  {
    model: 'Reference',
    fields: ['contactName', 'contactEmail'],
    strategy: 'scrub',
    match: 'email or name',
  },
  {
    model: 'Notification',
    fields: ['title', 'body'],
    strategy: 'scrub',
    match: 'mention (redacted in place)',
  },
  {
    model: 'IntelEvidence',
    fields: ['excerpt', 'label'],
    strategy: 'scrub',
    match: 'mention in a public-source excerpt (redacted in place)',
  },
  {
    model: 'SignatureRequest',
    fields: ['recipients'],
    strategy: 'retain',
    match: 'recipient email',
    basis:
      'E-signature records evidence a contract and are kept for the establishment or defence of legal claims (GDPR Art. 17(3)(e)).',
  },
  {
    model: 'SignatureEvent',
    fields: ['recipientEmail', 'ipAddress'],
    strategy: 'retain',
    match: 'recipient email',
    basis:
      'E-signature audit trail (who signed, when, from where) is kept for legal claims (GDPR Art. 17(3)(e)).',
  },
  {
    model: 'AuditLog',
    fields: [],
    strategy: 'pseudonymise',
    match: 'target id',
    basis:
      'Hash-chained audit rows cannot change without breaking the chain. They point at the subject id, which no longer resolves to a person once the subject row is tombstoned. Diffs written before audit writers were made id-only can still hold a name; the residue scan reports them as retained.',
  },
] as const satisfies readonly SubjectStore[];

export type SubjectStoreModel = (typeof SUBJECT_STORES)[number]['model'];

export interface NonSubjectStore {
  model: string;
  fields: readonly string[];
  reason: string;
}

export const NON_SUBJECT_STORES: readonly NonSubjectStore[] = [
  {
    model: 'User',
    fields: ['email', 'microsoftEmail', 'name'],
    reason:
      'Workforce identity (staff login), not a customer data subject. Removed through identity provider offboarding; the audit FK is nulled on user delete.',
  },
  {
    model: 'KamConsultant',
    fields: ['email', 'name'],
    reason:
      'Internal consultant roster (workforce data). Encrypted at rest; handled by HR offboarding, not by customer data subject requests.',
  },
  {
    model: 'VoiceCommandLog',
    fields: ['transcript'],
    reason:
      "A staff member's own voice commands to the app. Workforce data with its own retention class (RETENTION_VOICE_COMMANDS_DAYS).",
  },
  {
    model: 'IntegrationToken',
    fields: ['externalAccountEmail'],
    reason:
      'The connected mailbox or calendar account of a staff member. Workforce data; revoked and deleted with the integration.',
  },
  {
    model: 'OrgSettings',
    fields: ['emailFromName', 'emailFromAddress'],
    reason:
      'Tenant sender identity for outbound mail (usually a shared mailbox). Tenant configuration, not a data subject record.',
  },
  {
    model: 'Company',
    fields: ['billingEmail', 'name'],
    reason:
      'Account-level business data. A billing mailbox is a company address; a named individual here is a gap tracked in CONTROL-MAP.md.',
  },
];

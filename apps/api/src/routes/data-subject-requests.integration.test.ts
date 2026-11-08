// Integration tests for GDPR data subject export and erase (Art. 15, 17, 20).
//
// WHY these assertions matter:
//   - erasure must reach every sidecar that copies a person's identifiers
//     (activities, attendees, calendar events, email, SMS, account people,
//     meeting attendees, intel evidence, bookings, calls), not only the
//     contact row; the residue scan proves nothing identifying is left;
//   - other people sharing those records (a second attendee, another contact)
//     must survive untouched;
//   - the audit log is hash chained and immutable: erasure pseudonymises it
//     (ids only, subject row tombstoned) and the chain must still verify;
//   - a dry run must change nothing; an admin gate and the tenant guard apply.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, vi } from 'vitest';

import {
  eraseDataSubject,
  exportDataSubject,
  makeTenantScopeGuardMiddleware,
  prisma,
  PrismaClient,
  resolveDataSubject,
  runDataSubjectRequest,
  scanSubjectResidue,
} from '@bidstack/db';

import { verifyAuditChain } from '../lib/audit-chain.js';
import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let userId: string | null = null;
let restoreAuth: (() => void) | null = null;
let previousStubRoleHeader: string | undefined;

beforeAll(async () => {
  previousStubRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const iso = await createIsolatedOrg('dsr');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);
  const user = await prisma.user.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' } });
  userId = user!.id;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  restoreAuth?.();
  if (server) await server.close();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgId);

type Seeded = {
  contactId: string;
  otherContactId: string;
  email: string;
  phone: string;
  name: string;
  calendarEventId: string;
  emailMessageId: string;
};

/** A contact plus a copy of their identifiers in every sidecar store. */
async function seedSubject(opts: { optedOut?: boolean } = {}): Promise<Seeded> {
  const o = orgId!;
  const u = userId!;
  const tag = randomUUID().slice(0, 8);
  const name = `Ines Residue ${tag}`;
  const email = `ines.residue.${tag}@example.com`;
  const phone = `+1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const otherEmail = `other.person.${tag}@example.com`;

  const company = await prisma.company.create({ data: { orgId: o, name: `Residue Co ${tag}` } });
  const contact = await prisma.contact.create({
    data: { orgId: o, customer: company.name, companyId: company.id, name, email, phone },
  });
  const other = await prisma.contact.create({
    data: {
      orgId: o,
      customer: company.name,
      companyId: company.id,
      name: `Other ${tag}`,
      email: otherEmail,
    },
  });

  const activity = await prisma.activity.create({
    data: {
      orgId: o,
      type: 'meeting',
      entityType: 'contact',
      entityId: contact.id,
      subject: `Call with ${name}`,
      description: `Discussed renewal with ${name} (${email})`,
    },
  });
  await prisma.activityAttendee.create({
    data: { orgId: o, activityId: activity.id, contactId: contact.id, email },
  });

  const cal = await prisma.calendarEvent.create({
    data: {
      orgId: o,
      ownerId: u,
      provider: 'microsoft_graph',
      subject: 'Quarterly review',
      startAt: new Date(),
      endAt: new Date(Date.now() + 3_600_000),
      organizerEmail: email,
      attendees: [
        { email, name },
        { email: otherEmail, name: `Other ${tag}` },
      ],
    },
  });

  const token = await prisma.integrationToken.upsert({
    where: { orgId_userId_provider: { orgId: o, userId: u, provider: 'twilio' } },
    create: {
      orgId: o,
      userId: u,
      provider: 'twilio',
      accessTokenEncrypted: 'placeholder-ciphertext',
    },
    update: {},
  });
  const mail = await prisma.emailMessage.create({
    data: {
      orgId: o,
      userId: u,
      integrationTokenId: token.id,
      provider: 'OUTLOOK',
      externalMessageId: `ext-${tag}`,
      fromEmail: email,
      toEmails: [{ email: 'seller@test.local' }],
      ccEmails: [{ email: otherEmail }],
      subject: `Hello from ${name}`,
      bodyText: `Regards, ${name}, ${phone}`,
      isOutbound: false,
    },
  });
  await prisma.emailTrackingPixel.create({
    data: { orgId: o, emailMessageId: mail.id, token: `px-${tag}`, firstOpenedIp: '203.0.113.7' },
  });
  await prisma.smsMessage.create({
    data: {
      orgId: o,
      userId: u,
      integrationTokenId: token.id,
      fromNumber: '+15550000000',
      toNumber: phone,
      body: `Hi ${name}, confirming tomorrow`,
    },
  });
  await prisma.smsConsent.create({
    data: { orgId: o, phoneNumber: phone, optedOut: Boolean(opts.optedOut) },
  });

  const chart = await prisma.orgChart.create({ data: { orgId: o, companyId: company.id } });
  await prisma.orgChartNode.create({
    data: {
      orgId: o,
      chartId: chart.id,
      contactId: contact.id,
      name,
      email,
      phone,
      linkedinUrl: `https://www.linkedin.com/in/ines-${tag}`,
    },
  });

  const meeting = await prisma.meetingIntel.create({
    data: {
      orgId: o,
      companyId: company.id,
      title: 'Discovery',
      heldAt: new Date(),
      dedupeKey: `dk-${tag}`,
      transcriptText: `${name}: we need help with data`,
    },
  });
  await prisma.meetingIntelAttendee.create({
    data: { orgId: o, meetingId: meeting.id, contactId: contact.id, name, email },
  });
  await prisma.meetingIngestItem.create({
    data: {
      orgId: o,
      source: 'manual',
      externalId: `ing-${tag}`,
      payload: { attendees: [{ name, email }], transcript: `${name} said hello` },
    },
  });
  await prisma.kamSession.create({
    data: {
      orgId: o,
      companyId: company.id,
      heldAt: new Date(),
      sourceType: 'manual_paste',
      attendees: [name, `Other ${tag}`],
      transcriptText: `${name}: budget is approved`,
    },
  });

  await prisma.intelEvidence.create({
    data: {
      orgId: o,
      companyId: company.id,
      source: 'fixture',
      kind: 'registry',
      key: `director-${tag}`,
      excerpt: `Director: ${name}`,
      fetchedAt: new Date(),
    },
  });

  const page = await prisma.bookingPage.create({
    data: { orgId: o, userId: u, slug: `bp-${tag}`, name: 'Intro call' },
  });
  await prisma.booking.create({
    data: {
      orgId: o,
      bookingPageId: page.id,
      attendeeName: name,
      attendeeEmail: email,
      attendeePhone: phone,
      startAt: new Date(),
      endAt: new Date(Date.now() + 1_800_000),
    },
  });

  await prisma.callSession.create({
    data: {
      orgId: o,
      userId: u,
      entityType: 'contact',
      entityId: contact.id,
      provider: 'zoom',
      participantEmails: [email, 'seller@test.local'],
      transcriptText: `${name}: thanks for the call`,
      summary: `Call with ${name}`,
    },
  });

  await prisma.reference.create({
    data: { orgId: o, title: `Ref ${tag}`, tags: [], contactName: name, contactEmail: email },
  });
  await prisma.notification.create({
    data: { orgId: o, userId: u, type: 'mention', title: 'New reply', body: `${name} replied` },
  });
  await prisma.contactFact.create({
    data: {
      orgId: o,
      contactId: contact.id,
      kind: 'buying_role',
      claim: `${name} signs off budget`,
    },
  });
  await prisma.customerCommitment.create({
    data: { orgId: o, companyId: company.id, promise: 'Send the RFP', ownerContactId: contact.id },
  });
  const opp = await prisma.opportunity.findFirst({ where: { orgId: o } });
  await prisma.opportunityContact.create({
    data: {
      orgId: o,
      opportunityId: opp!.id,
      contactId: contact.id,
      notes: `${name} is the champion`,
    },
  });

  // An audit row about the subject written before the erasure (ids only).
  await prisma.auditLog.create({
    data: {
      orgId: o,
      userId: u,
      action: 'contact.update',
      targetType: 'contact',
      targetId: contact.id,
      diff: { fields: ['role'] },
    },
  });

  return {
    contactId: contact.id,
    otherContactId: other.id,
    email,
    phone,
    name,
    calendarEventId: cal.id,
    emailMessageId: mail.id,
  };
}

describe('data subject requests API', () => {
  t('admin files a request: 202, queued row, dry run by default, audit event', async () => {
    const s = await seedSubject();
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/data-subject-requests`,
      payload: { kind: 'erase', subjectType: 'contact', subjectId: s.contactId },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { id: string; status: string; dryRun: boolean };
    expect(body.status).toBe('queued');
    expect(body.dryRun).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { orgId: orgId!, action: 'gdpr.dsr.requested', targetId: body.id },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.diff)).not.toContain(s.email);

    // Nothing is erased until the worker runs the job.
    const contact = await prisma.contact.findUnique({ where: { id: s.contactId } });
    expect(contact?.name).toBe(s.name);
  });

  t('read-only role is refused (403); unknown subject 404; other org 403', async () => {
    const s = await seedSubject();
    const denied = await server.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/data-subject-requests`,
      headers: { 'x-bidstack-e2e-role': 'read-only' },
      payload: { kind: 'export', subjectType: 'contact', subjectId: s.contactId },
    });
    expect(denied.statusCode).toBe(403);

    const unknown = await server.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/data-subject-requests`,
      payload: { kind: 'export', subjectType: 'contact', subjectId: randomUUID() },
    });
    expect(unknown.statusCode).toBe(404);

    const cross = await server.inject({
      method: 'POST',
      url: `/api/v1/orgs/00000000-0000-4000-8000-000000000000/data-subject-requests`,
      payload: { kind: 'export', subjectType: 'contact', subjectId: s.contactId },
    });
    expect(cross.statusCode).toBe(403);
  });

  t('worker run completes the request; status and export download are served', async () => {
    const s = await seedSubject();
    const created = await server.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/data-subject-requests`,
      payload: { kind: 'export', subjectType: 'contact', subjectId: s.contactId, dryRun: false },
    });
    const { id } = created.json() as { id: string };

    await runDataSubjectRequest(prisma, id, orgId!);

    const status = await server.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgId}/data-subject-requests/${id}`,
    });
    expect(status.statusCode).toBe(200);
    const view = status.json() as { status: string; report: { stores: Record<string, unknown> } };
    expect(view.status).toBe('done');
    expect(JSON.stringify(view.report)).not.toContain(s.email);

    const download = await server.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgId}/data-subject-requests/${id}/export`,
    });
    expect(download.statusCode).toBe(200);
    expect(download.body).toContain(s.email);
    const audit = await prisma.auditLog.findFirst({
      where: { orgId: orgId!, action: 'gdpr.export.downloaded', targetId: id },
    });
    expect(audit).not.toBeNull();
  });
});

describe('data subject engine', () => {
  t('export gathers the subject from every sidecar store with plaintext values', async () => {
    const s = await seedSubject();
    const subject = await resolveDataSubject(prisma, orgId!, 'contact', s.contactId);
    expect(subject).not.toBeNull();
    const bundle = await exportDataSubject(prisma, subject!);
    expect(Object.keys(bundle.stores)).toEqual(
      expect.arrayContaining([
        'Contact',
        'Activity',
        'ActivityAttendee',
        'CalendarEvent',
        'EmailMessage',
        'EmailTrackingPixel',
        'SmsMessage',
        'SmsConsent',
        'OrgChartNode',
        'MeetingIntel',
        'MeetingIntelAttendee',
        'MeetingIngestItem',
        'KamSession',
        'IntelEvidence',
        'Booking',
        'CallSession',
        'Reference',
        'Notification',
        'ContactFact',
        'CustomerCommitment',
        'OpportunityContact',
        'AuditLog',
      ]),
    );
    const contactRows = bundle.stores.Contact as Array<{ email: string }>;
    expect(contactRows[0]?.email).toBe(s.email);
    // The export holds this subject only: the other attendee is not exported as a person.
    expect(JSON.stringify(bundle.stores.Contact)).not.toContain('other.person');
  });

  t('dry run reports what would change and changes nothing', async () => {
    const s = await seedSubject();
    const subject = await resolveDataSubject(prisma, orgId!, 'contact', s.contactId);
    const before = await scanSubjectResidue(prisma, subject!);
    expect(before.length).toBeGreaterThan(5);

    const report = await eraseDataSubject(prisma, subject!, { dryRun: true, actorUserId: userId });
    expect(report.dryRun).toBe(true);
    expect(report.stores.EmailMessage?.rows).toBe(1);
    expect(report.stores.CalendarEvent?.rows).toBe(1);

    const after = await scanSubjectResidue(prisma, subject!);
    expect(after).toEqual(before);
    const contact = await prisma.contact.findUnique({ where: { id: s.contactId } });
    expect(contact?.name).toBe(s.name);
    const audit = await prisma.auditLog.findFirst({
      where: { orgId: orgId!, action: 'gdpr.erasure.dry_run', targetId: s.contactId },
    });
    expect(audit).not.toBeNull();
  });

  t('erase leaves no residue, keeps other people, and the audit chain still verifies', async () => {
    const s = await seedSubject();
    const subject = await resolveDataSubject(prisma, orgId!, 'contact', s.contactId);
    const report = await eraseDataSubject(prisma, subject!, { dryRun: false, actorUserId: userId });
    expect(report.dryRun).toBe(false);
    expect(report.auditRowsPseudonymised).toBeGreaterThanOrEqual(1);

    expect(await scanSubjectResidue(prisma, subject!)).toEqual([]);

    // Other people sharing the records survive.
    const other = await prisma.contact.findUnique({ where: { id: s.otherContactId } });
    expect(other?.name).toMatch(/^Other /);
    const cal = await prisma.calendarEvent.findFirst({
      where: { id: s.calendarEventId, deletedAt: { not: undefined } },
    });
    expect(JSON.stringify(cal?.attendees)).toContain('other.person');
    expect(JSON.stringify(cal?.attendees)).not.toContain(s.email);

    // Audit: the erasure record carries ids, field names and counts only.
    const erasure = await prisma.auditLog.findFirst({
      where: { orgId: orgId!, action: 'gdpr.erasure', targetId: s.contactId },
    });
    const diff = JSON.stringify(erasure?.diff);
    expect(diff).not.toContain(s.email);
    expect(diff).not.toContain(s.phone);
    expect(diff).not.toContain(s.name);

    const chain = await verifyAuditChain(orgId!);
    expect(chain.ok).toBe(true);

    // Idempotent: a second run finds nothing left and still verifies.
    const again = await eraseDataSubject(prisma, subject!, { dryRun: false, actorUserId: userId });
    expect(again.scrubbedFields).toEqual([]);
    expect((await verifyAuditChain(orgId!)).ok).toBe(true);
  });

  t('an opted-out SMS consent is retained under a legal basis and reported', async () => {
    const s = await seedSubject({ optedOut: true });
    const subject = await resolveDataSubject(prisma, orgId!, 'contact', s.contactId);
    const report = await eraseDataSubject(prisma, subject!, { dryRun: false, actorUserId: userId });
    expect(report.retained.SmsConsent?.rows).toBe(1);
    expect(report.retained.SmsConsent?.basis).toMatch(/opt-out/i);
    const residue = await scanSubjectResidue(prisma, subject!);
    expect(residue).toEqual([
      { model: 'SmsConsent', field: 'phoneNumber', rows: 1, retained: true },
    ]);
  });

  t('a lead subject is erased with its linked email', async () => {
    const tag = randomUUID().slice(0, 8);
    const email = `lead.residue.${tag}@example.com`;
    const lead = await prisma.lead.create({
      data: {
        orgId: orgId!,
        firstName: 'Lena',
        lastName: `Residue${tag}`,
        companyName: 'Residue Test Co',
        email,
        phone: '+15557654321',
      },
    });
    const token = await prisma.integrationToken.upsert({
      where: { orgId_userId_provider: { orgId: orgId!, userId: userId!, provider: 'twilio' } },
      create: {
        orgId: orgId!,
        userId: userId!,
        provider: 'twilio',
        accessTokenEncrypted: 'placeholder-ciphertext',
      },
      update: {},
    });
    await prisma.emailMessage.create({
      data: {
        orgId: orgId!,
        userId: userId!,
        integrationTokenId: token.id,
        provider: 'GMAIL',
        externalMessageId: `lead-${tag}`,
        fromEmail: 'seller@test.local',
        toEmails: [{ email }],
        entityType: 'lead',
        entityId: lead.id,
        subject: 'Intro',
        bodyText: `Hi Lena Residue${tag}`,
      },
    });
    const subject = await resolveDataSubject(prisma, orgId!, 'lead', lead.id);
    await eraseDataSubject(prisma, subject!, { dryRun: false, actorUserId: userId });
    expect(await scanSubjectResidue(prisma, subject!)).toEqual([]);
  });
});

describe('data subject matching is bounded to the subject', () => {
  t('a lookalike address and a third-party record are kept; mentions are redacted', async () => {
    const o = orgId!;
    const u = userId!;
    const tag = randomUUID().slice(0, 8);
    const email = `an.${tag}@acme.test`;
    const lookalike = `dan.${tag}@acme.test`;
    const name = `Ana Bounded${tag}`;
    const subjectContact = await prisma.contact.create({
      data: { orgId: o, customer: 'Bounded Co', name, email },
    });
    const bystander = await prisma.contact.create({
      data: { orgId: o, customer: 'Bounded Co', name: `Dan Bystander${tag}`, email: lookalike },
    });
    const token = await prisma.integrationToken.upsert({
      where: { orgId_userId_provider: { orgId: o, userId: u, provider: 'twilio' } },
      create: { orgId: o, userId: u, provider: 'twilio', accessTokenEncrypted: 'placeholder' },
      update: {},
    });
    // Dan's own mail, which merely mentions the subject.
    const thirdParty = await prisma.emailMessage.create({
      data: {
        orgId: o,
        userId: u,
        integrationTokenId: token.id,
        provider: 'OUTLOOK',
        externalMessageId: `bounded-${tag}`,
        fromEmail: lookalike,
        toEmails: [{ email: 'seller@test.local' }],
        subject: 'Budget',
        bodyText: `Looping in ${name} (${email}) on the budget.`,
        isOutbound: false,
      },
    });
    const mentioning = await prisma.notification.create({
      data: { orgId: o, userId: u, type: 'mention', title: 'Reply', body: `${name} replied` },
    });
    const firstNameOnly = await prisma.notification.create({
      data: { orgId: o, userId: u, type: 'mention', title: 'Reply', body: 'Ana said thanks' },
    });

    const subject = await resolveDataSubject(prisma, o, 'contact', subjectContact.id);
    expect(subject!.emails).toEqual([email]);

    // Export: mention-only rows are listed by id and field, never with content.
    const bundle = await exportDataSubject(prisma, subject!);
    const mailRows = JSON.stringify(bundle.stores.EmailMessage ?? []);
    expect(mailRows).toContain(thirdParty.id);
    expect(mailRows).not.toContain('Looping in');
    expect(mailRows).not.toContain(lookalike);

    await eraseDataSubject(prisma, subject!, { dryRun: false, actorUserId: u });

    const dan = await prisma.contact.findUnique({ where: { id: bystander.id } });
    expect(dan?.email).toBe(lookalike);
    const mail = await prisma.emailMessage.findFirst({
      where: { id: thirdParty.id, deletedAt: { not: undefined } },
    });
    expect(mail?.deletedAt ?? null).toBeNull();
    expect(mail?.fromEmail).toBe(lookalike);
    expect(mail?.bodyText).toContain('[erased]');
    expect(mail?.bodyText).not.toContain(email);
    expect(mail?.bodyText).not.toContain(name);

    const n1 = await prisma.notification.findUnique({ where: { id: mentioning.id } });
    expect(n1?.body).toBe('[erased] replied');
    const n2 = await prisma.notification.findUnique({ where: { id: firstNameOnly.id } });
    expect(n2?.body).toBe('Ana said thanks');

    expect(await scanSubjectResidue(prisma, subject!)).toEqual([]);
  });

  t(
    'a namesake with their own address keeps their records; JSON after a newline is found',
    async () => {
      const o = orgId!;
      const tag = randomUUID().slice(0, 8);
      const name = `John Namesake${tag}`;
      const email = `john.${tag}@one.test`;
      const otherEmail = `john.${tag}@two.test`;
      const company = await prisma.company.create({
        data: { orgId: o, name: `Namesake Co ${tag}` },
      });
      const subjectContact = await prisma.contact.create({
        data: { orgId: o, customer: company.name, companyId: company.id, name, email },
      });
      const namesake = await prisma.contact.create({
        data: { orgId: o, customer: company.name, companyId: company.id, name, email: otherEmail },
      });
      // The namesake attended this meeting with their own address.
      const theirMeeting = await prisma.meetingIntel.create({
        data: {
          orgId: o,
          companyId: company.id,
          title: 'Their meeting',
          heldAt: new Date(),
          dedupeKey: `ns-${tag}`,
          transcriptText: 'Opening remarks on scope',
        },
      });
      await prisma.meetingIntelAttendee.create({
        data: {
          orgId: o,
          meetingId: theirMeeting.id,
          contactId: namesake.id,
          name,
          email: otherEmail,
        },
      });
      const ref = await prisma.reference.create({
        data: {
          orgId: o,
          title: `Ref ${tag}`,
          tags: [],
          contactName: name,
          contactEmail: otherEmail,
        },
      });
      const ingest = await prisma.meetingIngestItem.create({
        data: {
          orgId: o,
          source: 'manual',
          externalId: `nl-${tag}`,
          payload: { transcript: `Intro\n${email} joined late` },
        },
      });

      const subject = await resolveDataSubject(prisma, o, 'contact', subjectContact.id);
      await eraseDataSubject(prisma, subject!, { dryRun: false, actorUserId: userId });

      const kept = await prisma.contact.findUnique({ where: { id: namesake.id } });
      expect(kept?.name).toBe(name);
      expect(kept?.email).toBe(otherEmail);
      const meeting = await prisma.meetingIntel.findUnique({ where: { id: theirMeeting.id } });
      expect(meeting?.transcriptText).toBe('Opening remarks on scope');
      const attendee = await prisma.meetingIntelAttendee.findFirst({
        where: { meetingId: theirMeeting.id },
      });
      expect(attendee?.email).toBe(otherEmail);
      const r = await prisma.reference.findUnique({ where: { id: ref.id } });
      expect(r?.contactEmail).toBe(otherEmail);

      const item = await prisma.meetingIngestItem.findUnique({ where: { id: ingest.id } });
      expect(JSON.stringify(item?.payload)).not.toContain(email);
      expect(JSON.stringify(item?.payload)).toContain('[erased] joined late');

      expect(await scanSubjectResidue(prisma, subject!)).toEqual([]);
    },
  );

  t('a single first name or a short phone is not used as an identifier', async () => {
    const c = await prisma.contact.create({
      data: { orgId: orgId!, customer: 'Short Co', name: 'Ana', phone: '12345' },
    });
    const subject = await resolveDataSubject(prisma, orgId!, 'contact', c.id);
    expect(subject!.names).toEqual([]);
    expect(subject!.phones).toEqual([]);
  });
});

describe('data subject request runner', () => {
  async function fileRequest(
    kind: 'export' | 'erase',
    subjectType: 'contact' | 'account_person',
    subjectId: string,
    dryRun = false,
  ): Promise<string> {
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/data-subject-requests`,
      payload: { kind, subjectType, subjectId, dryRun },
    });
    expect(res.statusCode).toBe(202);
    return (res.json() as { id: string }).id;
  }

  async function seedPortrait(): Promise<{ nodeId: string; key: string }> {
    const tag = randomUUID().slice(0, 8);
    const company = await prisma.company.create({ data: { orgId: orgId!, name: `Portrait Co ${tag}` } });
    const chart = await prisma.orgChart.create({ data: { orgId: orgId!, companyId: company.id } });
    const key = `${orgId}/orgchart/${tag}/photo.jpg`;
    const node = await prisma.orgChartNode.create({
      data: {
        orgId: orgId!,
        chartId: chart.id,
        name: `Paula Portrait ${tag}`,
        email: `paula.portrait.${tag}@example.com`,
        photoStorageKey: key,
      },
    });
    return { nodeId: node.id, key };
  }

  // WHY: production may run with BIDSTACK_TENANT_SCOPE_GUARD=enforce; an
  // unscoped claim or sidecar read would throw and strand every request.
  t('export and erasure both complete with the tenant scope guard enforced', async () => {
    const guarded = new PrismaClient();
    guarded.$use(makeTenantScopeGuardMiddleware({ mode: 'enforce' }));
    try {
      const s = await seedSubject();
      const exportId = await fileRequest('export', 'contact', s.contactId);
      expect((await runDataSubjectRequest(guarded, exportId, orgId!)).status).toBe('done');
      const eraseId = await fileRequest('erase', 'contact', s.contactId, true);
      expect((await runDataSubjectRequest(guarded, eraseId, orgId!)).status).toBe('done');
    } finally {
      await guarded.$disconnect();
    }
  });

  // WHY: re-delivery while a run still holds the claim used to complete the job
  // as skipped; if that run then died the row stayed `running` forever.
  t('a request another run still holds comes back busy until the claim goes stale', async () => {
    const s = await seedSubject();
    const id = await fileRequest('export', 'contact', s.contactId);
    const startedAt = new Date(Date.now() - 60_000);
    await prisma.dataSubjectRequest.update({ where: { id }, data: { status: 'running', startedAt } });

    const busy = await runDataSubjectRequest(prisma, id, orgId!);
    expect(busy.status).toBe('busy');
    expect(busy.retryAt!.getTime()).toBeGreaterThan(startedAt.getTime() + 15 * 60_000);

    await prisma.dataSubjectRequest.update({
      where: { id },
      data: { startedAt: new Date(Date.now() - 16 * 60_000) },
    });
    expect((await runDataSubjectRequest(prisma, id, orgId!)).status).toBe('done');
  });

  // WHY: erasure nulled photoStorageKey but left the uploaded portrait in the
  // bucket, unreachable and never deleted.
  t('erasure deletes the uploaded portrait, retrying the delete without erasing twice', async () => {
    const { nodeId, key } = await seedPortrait();
    const id = await fileRequest('erase', 'account_person', nodeId);

    const failing = vi.fn(async () => {
      throw new Error('bucket unavailable');
    });
    const first = await runDataSubjectRequest(prisma, id, orgId!, { deleteObjects: failing });
    expect(first.status).toBe('busy');
    expect(failing).toHaveBeenCalledWith([key]);
    // Erased nodes are soft-deleted; `not: undefined` reads past the soft-delete filter.
    const node = await prisma.orgChartNode.findFirst({
      where: { id: nodeId, orgId: orgId!, deletedAt: { not: undefined } },
    });
    expect(node).not.toBeNull();
    expect(node?.photoStorageKey).toBeNull();
    const held = await prisma.dataSubjectRequest.findFirst({ where: { id, orgId: orgId! } });
    expect(held?.status).toBe('running');
    expect((held?.report as { pendingStorageKeys?: string[] }).pendingStorageKeys).toEqual([key]);

    await prisma.dataSubjectRequest.update({
      where: { id },
      data: { startedAt: new Date(Date.now() - 16 * 60_000) },
    });
    const deleted: string[] = [];
    const second = await runDataSubjectRequest(prisma, id, orgId!, {
      deleteObjects: async (keys) => {
        deleted.push(...keys);
      },
    });
    expect(second.status).toBe('done');
    expect(deleted).toEqual([key]);
    const done = await prisma.dataSubjectRequest.findFirst({ where: { id, orgId: orgId! } });
    expect(done?.status).toBe('done');
    expect(JSON.stringify(done?.report)).not.toContain('pendingStorageKeys');
    const erasures = await prisma.auditLog.count({
      where: { orgId: orgId!, action: 'gdpr.erasure', targetId: nodeId },
    });
    expect(erasures).toBe(1);
  });
});

import { useSeo } from '@/lib/seo';
import { LegalLayout } from '@/components/LegalLayout';

export function SecurityPage() {
  useSeo({
    title: 'Security — BidStack 360°',
    description:
      'BidStack security overview. Encryption, SOC2-track posture, penetration testing, RBAC, audit logging, GDPR export, sub-processor list.',
    canonical: 'https://bidstack.dev/legal/security',
  });

  return (
    <LegalLayout
      title="Security"
      updated="[EFFECTIVE DATE]"
      intro={
        <p>
          Security is a discipline at BidStack, not a checkbox. This page summarises the controls,
          processes, and certifications that protect your data. We update it whenever we make a
          material change. For more detail or to request our security questionnaire, contact{' '}
          <a href="mailto:security@bidstack.dev">security@bidstack.dev</a>.
        </p>
      }
    >
      <h2>1. Encryption</h2>
      <ul>
        <li>
          <strong>In transit:</strong> TLS 1.2 or higher on all connections (web, API, MCP). HSTS
          with includeSubDomains and preload. TLS 1.3 preferred where supported.
        </li>
        <li>
          <strong>At rest:</strong> AES-256 server-side encryption for all primary databases,
          backups, object storage (documents, attachments), and queue payloads.
        </li>
        <li>
          <strong>Key management:</strong> AWS KMS with rotated customer master keys (CMKs).
          Enterprise customers may opt for BYOK (Bring Your Own Key) with HSM-backed keys.
        </li>
        <li>
          <strong>Secrets:</strong> Application secrets stored in AWS Secrets Manager, never in
          source control or environment files committed to git.
        </li>
      </ul>

      <h2>2. Compliance &amp; certifications</h2>
      <ul>
        <li>
          <strong>SOC 2 Type II — track.</strong> Auditor engaged; observation period started{' '}
          <strong>[OBSERVATION PERIOD START]</strong>. Type II report targeted for{' '}
          <strong>[REPORT DATE]</strong>. Bridge letters issued quarterly until then.
        </li>
        <li>
          <strong>ISO 27001 — planned.</strong> Targeted certification 12 months after SOC 2 Type II.
        </li>
        <li>
          <strong>GDPR — yes.</strong> EU data residency by default. DPO appointed. Standard
          Contractual Clauses incorporated into all sub-processor agreements. See the{' '}
          <a href="/legal/privacy">Privacy Policy</a> and{' '}
          <a href="/legal/dpa">Data Processing Agreement</a>.
        </li>
        <li>
          <strong>EU AI Act — yes.</strong> AI features classified per Article 6. Article 13
          transparency obligations honoured (model + prompt + sources logged on every AI output).
          High-risk AI subsystems undergo Fundamental Rights Impact Assessments (FRIA).
        </li>
      </ul>

      <h2>3. Application security</h2>
      <ul>
        <li>
          <strong>Authentication:</strong> Clerk-backed identity with OAuth (Google, Microsoft),
          email magic-links, and TOTP MFA. SSO (SAML 2.0, OIDC) for Enterprise. Password storage
          uses bcrypt/Argon2.
        </li>
        <li>
          <strong>Authorisation:</strong> Role-based access control (RBAC) with field-level scopes.
          Every database query is org-scoped at the ORM layer; multi-tenant isolation enforced in
          tests.
        </li>
        <li>
          <strong>Session security:</strong> httpOnly + secure + sameSite cookies. Session
          invalidation on password change, MFA enrolment change, or staff intervention.
        </li>
        <li>
          <strong>Input validation:</strong> Zod-validated request bodies on every API route.
          Parameterised database queries only (Prisma ORM); no string-concatenated SQL.
        </li>
        <li>
          <strong>Rate limiting:</strong> Per-IP and per-org on all auth endpoints, MCP server,
          public API, and webhook receivers.
        </li>
        <li>
          <strong>CSP &amp; security headers:</strong> Strict Content-Security-Policy,
          X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin,
          Permissions-Policy minimal.
        </li>
      </ul>

      <h2>4. Infrastructure security</h2>
      <ul>
        <li>
          <strong>Hosting:</strong> AWS (Frankfurt eu-central-1) by default. Enterprise customers
          can pin US (us-east-1) or UK (eu-west-2) residency.
        </li>
        <li>
          <strong>Network isolation:</strong> Production runs in a private VPC with no public
          ingress except through the application load balancer. RDS, Redis, S3 accessed via VPC
          endpoints.
        </li>
        <li>
          <strong>Patching:</strong> OS and runtime patches applied within 7 days of security
          advisory; critical patches within 24 hours.
        </li>
        <li>
          <strong>DDoS protection:</strong> AWS Shield + CloudFront with rate-based rules.
        </li>
        <li>
          <strong>Backups:</strong> Point-in-time recovery (PITR) for Postgres with 30-day window.
          Cross-region replicated daily snapshots. Restoration drills run quarterly.
        </li>
        <li>
          <strong>Disaster recovery:</strong> RPO 15 minutes, RTO 4 hours. Failover region tested
          twice yearly.
        </li>
      </ul>

      <h2>5. Penetration testing &amp; vulnerability management</h2>
      <ul>
        <li>
          <strong>Pen tests:</strong> Independent black-box penetration test annually + after every
          major architectural change. Latest report available under NDA on request.
        </li>
        <li>
          <strong>Dependency scanning:</strong> Dependabot + Snyk on every PR. Critical CVEs
          remediated within 48 hours.
        </li>
        <li>
          <strong>Static analysis:</strong> ESLint security rules + Semgrep + CodeQL on every PR.
        </li>
        <li>
          <strong>Secret scanning:</strong> Pre-commit hook + GitHub secret scanning. Any leaked
          secret is rotated immediately and incident-logged.
        </li>
        <li>
          <strong>Bug bounty:</strong> Responsible disclosure program at{' '}
          <a href="mailto:security@bidstack.dev">security@bidstack.dev</a>. Acknowledgement within
          24 hours; rewards for valid reports.
        </li>
      </ul>

      <h2>6. Audit logging</h2>
      <ul>
        <li>
          Every change to Customer Data is logged with actor, timestamp, before/after diff, IP, and
          user agent.
        </li>
        <li>Logs are immutable (append-only) and exported to a separate audit log store.</li>
        <li>
          Retention: 30 days on Free, 1 year on Pro, 7+ years on Enterprise (configurable).
        </li>
        <li>
          Customer-accessible audit log UI plus REST API and SIEM webhook integration (Splunk,
          Datadog, Sumo Logic).
        </li>
      </ul>

      <h2>7. Personnel security</h2>
      <ul>
        <li>Background checks for all employees with production access.</li>
        <li>Mandatory annual security + privacy training.</li>
        <li>
          Least-privilege production access enforced via SSO + MFA. Just-in-time elevation logged
          and reviewed monthly.
        </li>
        <li>Laptops enrolled in MDM with full-disk encryption, screen lock, and remote wipe.</li>
      </ul>

      <h2>8. Incident response</h2>
      <p>
        24/7 on-call rotation. Severity-classified runbook with SLA targets: SEV-1 acknowledged
        &lt; 15 minutes, root cause &lt; 72 hours, post-mortem published to status page within 7
        days. Customer notification within 48 hours of any incident affecting Customer Data, per
        the <a href="/legal/dpa">DPA</a>.
      </p>

      <h2>9. Sub-processors</h2>
      <p>
        See the up-to-date sub-processor list in our <a href="/legal/privacy">Privacy Policy</a>.
        Customers can subscribe to email notifications for any sub-processor addition or
        replacement.
      </p>

      <h2>10. Responsible disclosure</h2>
      <p>
        Found a vulnerability? We want to hear from you. Please email{' '}
        <a href="mailto:security@bidstack.dev">security@bidstack.dev</a> with reproduction steps
        and we will:
      </p>
      <ul>
        <li>Acknowledge your report within 24 hours.</li>
        <li>Provide a triage update within 5 business days.</li>
        <li>Issue a CVE and credit you (if you wish) once the fix is shipped.</li>
        <li>
          Not pursue legal action against good-faith researchers who follow this disclosure
          process.
        </li>
      </ul>

      <h2>11. Contact</h2>
      <p>
        Security questions, audit report requests, or vulnerability reports:{' '}
        <a href="mailto:security@bidstack.dev">security@bidstack.dev</a>.
      </p>
    </LegalLayout>
  );
}

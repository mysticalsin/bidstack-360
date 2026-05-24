import { useSeo } from '@/lib/seo';
import { LegalLayout } from '@/components/LegalLayout';

export function PrivacyPage() {
  useSeo({
    title: 'Privacy Policy — BidStack 360°',
    description:
      'How BidStack collects, processes, and protects your personal data. GDPR-aware: controller info, lawful basis, sub-processors, subject rights, DPO contact.',
    canonical: 'https://bidstack.dev/legal/privacy',
  });

  return (
    <LegalLayout
      title="Privacy Policy"
      updated="[EFFECTIVE DATE]"
      intro={
        <p>
          This Privacy Policy explains how <strong>[COMPANY NAME]</strong> (&ldquo;BidStack&rdquo;,
          &ldquo;we&rdquo;) collects, uses, and protects your personal data when you use the
          BidStack 360° platform and related services. We are committed to GDPR, the UK Data
          Protection Act 2018, and equivalent regimes worldwide.
        </p>
      }
    >
      <h2>1. Data controller</h2>
      <p>
        The data controller for personal data collected via this website and the BidStack 360°
        platform is <strong>[COMPANY NAME]</strong>, registered at <strong>[REGISTERED ADDRESS]</strong>.
        You can reach our Data Protection Officer at{' '}
        <a href="mailto:dpo@bidstack.dev">dpo@bidstack.dev</a>.
      </p>

      <h2>2. What data we collect</h2>
      <h3>2.1 Information you give us</h3>
      <ul>
        <li>
          <strong>Account data</strong> — name, work email, organisation, role, password (hashed).
        </li>
        <li>
          <strong>Billing data</strong> — billing contact, address, VAT ID, payment method details
          (handled by Stripe — we never store full card numbers).
        </li>
        <li>
          <strong>Customer Data</strong> — pipeline records, accounts, contacts, documents, emails,
          and any content you upload to the platform.
        </li>
        <li>
          <strong>Communications</strong> — support tickets, sales conversations, survey responses.
        </li>
      </ul>
      <h3>2.2 Information we collect automatically</h3>
      <ul>
        <li>
          <strong>Usage data</strong> — pages visited, features used, click events (privacy-friendly
          analytics; IP addresses are truncated and not tied to identity).
        </li>
        <li>
          <strong>Device data</strong> — browser version, OS, locale, time-zone for layout and
          security purposes.
        </li>
        <li>
          <strong>Cookies</strong> — strictly necessary cookies for auth + preferences. We do not
          use marketing cookies on this site.
        </li>
      </ul>

      <h2>3. Why we process your data (purposes &amp; lawful basis)</h2>
      <table className="mkt-compare">
        <thead>
          <tr>
            <th scope="col">Purpose</th>
            <th scope="col">Lawful basis (GDPR Art. 6)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Provide and operate the Services</td>
            <td>Performance of a contract</td>
          </tr>
          <tr>
            <td>Bill you and collect payment</td>
            <td>Performance of a contract</td>
          </tr>
          <tr>
            <td>Detect fraud, abuse, and security incidents</td>
            <td>Legitimate interest</td>
          </tr>
          <tr>
            <td>Comply with legal obligations (tax, accounting, court orders)</td>
            <td>Legal obligation</td>
          </tr>
          <tr>
            <td>Send service updates (security advisories, breaking changes)</td>
            <td>Legitimate interest</td>
          </tr>
          <tr>
            <td>Send marketing emails (newsletters, product updates)</td>
            <td>Consent (opt-in; you can withdraw at any time)</td>
          </tr>
        </tbody>
      </table>

      <h2>4. Sub-processors</h2>
      <p>
        We share personal data with the following third-party sub-processors who help us run the
        Services. Each sub-processor is bound by a written data processing agreement consistent with
        GDPR Article 28 and (where required) EU Standard Contractual Clauses.
      </p>
      <table className="mkt-compare">
        <thead>
          <tr>
            <th scope="col">Sub-processor</th>
            <th scope="col">Purpose</th>
            <th scope="col">Location</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>AWS (Amazon Web Services)</td>
            <td>Cloud infrastructure, storage, compute</td>
            <td>EU (Frankfurt) by default</td>
          </tr>
          <tr>
            <td>Stripe</td>
            <td>Payment processing</td>
            <td>EU, US</td>
          </tr>
          <tr>
            <td>Clerk</td>
            <td>Authentication and identity</td>
            <td>US (with EU DPA + SCCs)</td>
          </tr>
          <tr>
            <td>Resend</td>
            <td>Transactional email delivery</td>
            <td>EU, US</td>
          </tr>
          <tr>
            <td>Sentry</td>
            <td>Error monitoring</td>
            <td>EU (Frankfurt)</td>
          </tr>
        </tbody>
      </table>
      <p>
        We notify customers at least 30 days before adding a new sub-processor and provide a
        mechanism to object.
      </p>

      <h2>5. International transfers</h2>
      <p>
        Where sub-processors are located outside the European Economic Area (EEA), we rely on EU
        Standard Contractual Clauses (2021) and, where applicable, supplementary measures such as
        encryption in transit and at rest, pseudonymisation, and access controls.
      </p>

      <h2>6. Retention</h2>
      <ul>
        <li>
          <strong>Account &amp; Customer Data</strong> — kept for the lifetime of your subscription,
          then 30 days read-only, then permanent deletion. Backups purged within 90 days.
        </li>
        <li>
          <strong>Billing records</strong> — retained for 7 years to comply with EU tax law.
        </li>
        <li>
          <strong>Support tickets</strong> — retained for 3 years for service-quality purposes.
        </li>
        <li>
          <strong>Marketing opt-in records</strong> — retained until you unsubscribe + 3 years for
          audit purposes.
        </li>
      </ul>

      <h2>7. Your rights (GDPR Articles 15–22)</h2>
      <p>If you are in the EEA, UK, or Switzerland, you have the right to:</p>
      <ul>
        <li>Access the personal data we hold about you.</li>
        <li>Rectify inaccurate or incomplete data.</li>
        <li>Erase your data (&ldquo;right to be forgotten&rdquo;).</li>
        <li>Restrict or object to processing.</li>
        <li>Receive your data in a portable, machine-readable format.</li>
        <li>Withdraw consent at any time.</li>
        <li>Lodge a complaint with your supervisory authority (e.g., CNIL in France, ICO in the UK).</li>
      </ul>
      <p>
        Most rights can be exercised directly from your account settings. For anything else, email{' '}
        <a href="mailto:dpo@bidstack.dev">dpo@bidstack.dev</a>. We respond within 30 days.
      </p>

      <h2>8. Security</h2>
      <p>
        We protect personal data with encryption in transit (TLS 1.2+) and at rest (AES-256),
        role-based access control, multi-factor authentication for staff, immutable audit logs,
        and continuous monitoring. See the <a href="/legal/security">Security page</a> for a
        complete summary.
      </p>

      <h2>9. Children</h2>
      <p>
        The Services are not directed to children under 16. We do not knowingly collect personal
        data from children. If you believe we have, contact{' '}
        <a href="mailto:dpo@bidstack.dev">dpo@bidstack.dev</a> and we will delete it.
      </p>

      <h2>10. Changes to this Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Material changes will be communicated
        by email or in-product notice at least 30 days before they take effect.
      </p>

      <h2>11. Contact</h2>
      <p>
        Email <a href="mailto:dpo@bidstack.dev">dpo@bidstack.dev</a> or write to our Data Protection
        Officer at <strong>[COMPANY NAME]</strong>, <strong>[REGISTERED ADDRESS]</strong>.
      </p>
    </LegalLayout>
  );
}

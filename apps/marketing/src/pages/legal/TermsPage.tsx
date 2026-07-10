import { useSeo } from '@/lib/seo';
import { LegalLayout } from '@/components/LegalLayout';

export function TermsPage() {
  useSeo({
    title: 'Terms of Service — Polo PreSales',
    description:
      'Polo PreSales standard SaaS Terms of Service. Acceptance, account terms, payment, data ownership, IP, termination, liability, and governing law.',
    canonical: 'https://bidstack.dev/legal/terms',
  });

  return (
    <LegalLayout
      title="Terms of Service"
      updated="[EFFECTIVE DATE]"
      intro={
        <p>
          These Terms of Service (the &ldquo;Terms&rdquo;) govern your access to and use of the
          services provided by <strong>[COMPANY NAME]</strong> (&ldquo;Polo PreSales&rdquo;,
          &ldquo;we&rdquo;, &ldquo;us&rdquo;), including the Polo PreSales platform and any related
          websites, APIs, and applications (the &ldquo;Services&rdquo;). By accessing or using the
          Services, you agree to be bound by these Terms.
        </p>
      }
    >
      <h2>1. Acceptance of Terms</h2>
      <p>
        By creating an account, accessing the Services, or clicking &ldquo;I agree&rdquo;, you
        confirm that you have read, understood, and agree to be bound by these Terms and our{' '}
        <a href="/legal/privacy">Privacy Policy</a>. If you are entering into these Terms on behalf
        of a company or other legal entity, you represent that you have the authority to bind that
        entity.
      </p>

      <h2>2. Account terms</h2>
      <p>To use the Services you must:</p>
      <ul>
        <li>Be at least 18 years of age (or the age of majority in your jurisdiction).</li>
        <li>Provide accurate and complete account information and keep it up to date.</li>
        <li>Keep your account credentials secure and notify us of any unauthorised access.</li>
        <li>Be responsible for all activity that occurs under your account.</li>
        <li>
          Comply with all applicable laws and regulations, including export control, privacy, and
          intellectual property laws.
        </li>
      </ul>
      <p>
        You are responsible for any user (including employees, contractors, and agents) you invite
        to your workspace, and for ensuring they comply with these Terms.
      </p>

      <h2>3. Subscription and payment</h2>
      <h3>3.1 Plans and fees</h3>
      <p>
        The Services are offered under Free, Pro, and Enterprise plans, with features and fees as
        described on our <a href="/pricing">Pricing page</a>. You agree to pay all fees associated
        with the plan you select, in the currency specified, on the billing cadence chosen (monthly
        or annual).
      </p>
      <h3>3.2 Billing and renewal</h3>
      <p>
        Paid plans renew automatically at the end of each billing cycle unless cancelled. We may
        change our prices on 30 days&apos; written notice; price changes take effect at your next
        renewal.
      </p>
      <h3>3.3 Refunds</h3>
      <p>
        Annual subscriptions are refundable pro-rata within 30 days of the renewal date. Monthly
        subscriptions are not refundable but can be cancelled to stop the next billing cycle.
      </p>
      <h3>3.4 Taxes</h3>
      <p>
        All fees are exclusive of applicable taxes (VAT, GST, sales tax) unless otherwise stated.
        You are responsible for paying any taxes associated with your subscription, except those
        based on our net income.
      </p>

      <h2>4. Data ownership and use</h2>
      <h3>4.1 Your data</h3>
      <p>
        You own all data, content, and information that you submit to, store in, or transmit
        through the Services (&ldquo;Customer Data&rdquo;). You grant Polo PreSales a limited,
        non-exclusive, worldwide license to host, process, and display Customer Data solely for
        the purpose of providing and improving the Services to you.
      </p>
      <h3>4.2 Use of Customer Data</h3>
      <p>
        We will not access, use, or disclose your Customer Data except as necessary to provide the
        Services, comply with the law, or with your explicit written consent. We do not use
        Customer Data to train AI models. See our <a href="/legal/privacy">Privacy Policy</a> and{' '}
        <a href="/legal/dpa">Data Processing Agreement</a> for detail.
      </p>
      <h3>4.3 Data export</h3>
      <p>
        You may export your Customer Data at any time via the in-product export, REST API, or
        GDPR data subject request. Upon termination, your data is retained read-only for 30 days
        and then permanently deleted unless you reactivate.
      </p>

      <h2>5. Intellectual property</h2>
      <p>
        The Services and all underlying software, designs, trademarks, and content (other than
        Customer Data) are the exclusive property of Polo PreSales and its licensors. Nothing in these
        Terms transfers any of those rights to you. You may not copy, modify, reverse-engineer, or
        create derivative works of the Services except as expressly permitted by law.
      </p>
      <p>
        Feedback, suggestions, or ideas you provide to us about the Services may be used by us
        without restriction and without obligation to you.
      </p>

      <h2>6. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Services for any unlawful, fraudulent, or harmful purpose.</li>
        <li>
          Send spam, unsolicited marketing, or any communication that violates the CAN-SPAM Act,
          GDPR, or comparable anti-spam laws.
        </li>
        <li>
          Reverse-engineer, decompile, or attempt to extract the source code of the Services
          except to the extent expressly permitted by law.
        </li>
        <li>
          Use automated means (other than our public API used in accordance with rate limits) to
          access the Services or scrape data.
        </li>
        <li>Interfere with or disrupt the Services or the servers and networks behind them.</li>
        <li>Upload malicious code, viruses, or content that infringes third-party rights.</li>
      </ul>

      <h2>7. Termination</h2>
      <p>
        You may terminate your account at any time from the billing settings. We may suspend or
        terminate your access to the Services if you materially breach these Terms, fail to pay
        fees when due, or if we are required to do so by law. On termination:
      </p>
      <ul>
        <li>Your right to access the Services ends.</li>
        <li>
          Your Customer Data remains read-only for 30 days, then is permanently deleted unless
          you reactivate.
        </li>
        <li>Sections 4 (data ownership), 5 (IP), 8 (liability), and 10 (governing law) survive.</li>
      </ul>

      <h2>8. Disclaimers and limitation of liability</h2>
      <h3>8.1 Disclaimer</h3>
      <p>
        The Services are provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without
        warranties of any kind, express or implied. To the maximum extent permitted by law,
        Polo PreSales disclaims all warranties including merchantability, fitness for a particular
        purpose, non-infringement, and any warranties arising from course of dealing or trade
        usage.
      </p>
      <h3>8.2 Limitation of liability</h3>
      <p>
        To the maximum extent permitted by law, Polo PreSales&apos;s total aggregate liability arising
        out of or in connection with these Terms or your use of the Services shall not exceed the
        greater of (a) the amount you paid us in the 12 months immediately preceding the event
        giving rise to the liability, or (b) one hundred euros (€100). In no event will Polo PreSales
        be liable for any indirect, incidental, consequential, or punitive damages.
      </p>

      <h2>9. Indemnification</h2>
      <p>
        You agree to indemnify and hold harmless Polo PreSales, its officers, directors, employees,
        and agents from any claim, demand, loss, liability, or expense (including reasonable
        attorneys&apos; fees) arising out of (a) your breach of these Terms, (b) your violation
        of applicable law, or (c) your Customer Data infringing the rights of a third party.
      </p>

      <h2>10. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of <strong>[JURISDICTION]</strong>, without regard to
        its conflict-of-laws principles. The courts of <strong>[JURISDICTION]</strong> have
        exclusive jurisdiction to hear any dispute arising out of or in connection with these
        Terms, except that Polo PreSales may seek injunctive relief in any court of competent
        jurisdiction to protect its intellectual property.
      </p>
      <p>
        Before filing a claim, the parties agree to attempt to resolve the dispute informally
        through good-faith negotiation for at least 60 days.
      </p>

      <h2>11. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. If we make a material change, we will notify
        you by email or in-product banner at least 30 days before the change takes effect. Your
        continued use of the Services after the effective date constitutes acceptance of the new
        Terms.
      </p>

      <h2>12. Contact</h2>
      <p>
        Questions about these Terms? Email <a href="mailto:legal@bidstack.dev">legal@bidstack.dev</a>{' '}
        or write to <strong>[COMPANY NAME]</strong>, <strong>[REGISTERED ADDRESS]</strong>.
      </p>
    </LegalLayout>
  );
}

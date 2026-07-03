import { useSeo } from '@/lib/seo';
import { LegalLayout } from '@/components/LegalLayout';

export function DPAPage() {
  useSeo({
    title: 'Data Processing Agreement — Polo PreSales',
    description:
      'Polo PreSales Data Processing Agreement (Article 28 GDPR). Subject matter, duration, processing instructions, sub-processors, security measures, and audit rights.',
    canonical: 'https://bidstack.dev/legal/dpa',
  });

  return (
    <LegalLayout
      title="Data Processing Agreement"
      updated="[EFFECTIVE DATE]"
      intro={
        <p>
          This Data Processing Agreement (&ldquo;DPA&rdquo;) forms part of the Terms of Service
          between you (&ldquo;Customer&rdquo;, the &ldquo;data controller&rdquo;) and{' '}
          <strong>[COMPANY NAME]</strong> (&ldquo;Polo PreSales&rdquo;, the &ldquo;data processor&rdquo;)
          and reflects the parties&apos; agreement with regard to the processing of Personal Data
          by Polo PreSales on behalf of Customer in accordance with the requirements of Article 28 of
          Regulation (EU) 2016/679 (&ldquo;GDPR&rdquo;).
        </p>
      }
    >
      <h2>1. Definitions</h2>
      <ul>
        <li>
          <strong>Personal Data</strong> — any information relating to an identified or
          identifiable natural person, as defined in GDPR Article 4(1).
        </li>
        <li>
          <strong>Processing</strong> — any operation performed on Personal Data, as defined in
          GDPR Article 4(2).
        </li>
        <li>
          <strong>Data Subject</strong> — the identified or identifiable natural person to whom
          Personal Data relates.
        </li>
        <li>
          <strong>Sub-processor</strong> — any third party engaged by Polo PreSales to process Personal
          Data on behalf of Customer.
        </li>
      </ul>

      <h2>2. Subject matter and duration</h2>
      <p>
        <strong>Subject matter:</strong> Provision of the Polo PreSales services as described in
        the Terms of Service.
      </p>
      <p>
        <strong>Duration:</strong> For the duration of the Terms of Service plus any retention
        period required for lawful purposes (see Section 9).
      </p>

      <h2>3. Nature and purpose of processing</h2>
      <p>
        Polo PreSales processes Personal Data on Customer&apos;s behalf to provide the Services,
        including: hosting and storing Customer Data, providing user authentication, enabling
        collaboration features, generating analytics and reporting, providing support, and
        ensuring security.
      </p>

      <h2>4. Types of Personal Data and categories of Data Subjects</h2>
      <p>
        <strong>Types of Personal Data:</strong> name, email, phone, job title, organisation,
        login credentials (hashed), profile data, IP address, and any Personal Data Customer or
        its end-users choose to include in Customer Data (such as contact records, deal notes,
        proposal content).
      </p>
      <p>
        <strong>Categories of Data Subjects:</strong> Customer&apos;s employees, agents,
        contractors, prospects, customers, and any individuals whose Personal Data Customer
        chooses to store in the Services.
      </p>

      <h2>5. Customer instructions</h2>
      <p>
        Polo PreSales shall process Personal Data only on documented instructions from Customer,
        including with regard to transfers of Personal Data to third countries. The Terms of
        Service, the agreed configuration of the Services, and Customer&apos;s use of the Services
        constitute Customer&apos;s complete and final instructions.
      </p>

      <h2>6. Confidentiality</h2>
      <p>
        Polo PreSales ensures that personnel authorised to process Personal Data have committed
        themselves to confidentiality or are under appropriate statutory obligations of
        confidentiality.
      </p>

      <h2>7. Security of processing</h2>
      <p>
        Polo PreSales implements appropriate technical and organisational measures to ensure a level
        of security appropriate to the risk, including:
      </p>
      <ul>
        <li>Encryption of Personal Data in transit (TLS 1.2+) and at rest (AES-256).</li>
        <li>
          Pseudonymisation where technically feasible and where the purpose can still be achieved.
        </li>
        <li>
          Ongoing confidentiality, integrity, availability, and resilience of processing systems.
        </li>
        <li>The ability to restore availability and access to Personal Data after an incident.</li>
        <li>
          Regular testing, assessing, and evaluating the effectiveness of technical and
          organisational measures (annual penetration tests, continuous monitoring).
        </li>
        <li>
          Role-based access control with the principle of least privilege; multi-factor
          authentication for all staff with access to production systems.
        </li>
        <li>Immutable audit logging of access to Personal Data.</li>
      </ul>
      <p>
        See the <a href="/legal/security">Security page</a> for the full controls inventory.
      </p>

      <h2>8. Sub-processors</h2>
      <p>
        Customer hereby grants Polo PreSales a general written authorisation to engage sub-processors,
        provided that:
      </p>
      <ul>
        <li>Polo PreSales maintains a current list of sub-processors (see the Privacy Policy).</li>
        <li>
          Polo PreSales notifies Customer of any intended addition or replacement of a sub-processor at
          least 30 days in advance and gives Customer the opportunity to object on reasonable
          grounds related to data protection.
        </li>
        <li>
          Polo PreSales imposes data protection obligations on each sub-processor that are no less
          protective than those in this DPA, by way of a written contract.
        </li>
        <li>
          Polo PreSales remains fully liable to Customer for the performance of each sub-processor.
        </li>
      </ul>

      <h2>9. Data Subject rights</h2>
      <p>
        Taking into account the nature of the processing, Polo PreSales shall assist Customer by
        appropriate technical and organisational measures, insofar as possible, in fulfilling
        Customer&apos;s obligation to respond to requests for the exercise of Data Subject rights
        under Chapter III of the GDPR (access, rectification, erasure, restriction, portability,
        objection, and automated decision-making).
      </p>
      <p>
        Most Data Subject rights can be exercised by Customer directly via the in-product
        administration UI and REST API. For any request that cannot be fulfilled through
        self-service tools, Polo PreSales will assist Customer within 7 business days.
      </p>

      <h2>10. Personal data breach notification</h2>
      <p>
        Polo PreSales shall notify Customer without undue delay and, where feasible, no later than 48
        hours after becoming aware of a Personal Data Breach affecting Customer Data. The
        notification shall include, to the extent known at the time:
      </p>
      <ul>
        <li>Description of the nature of the breach and categories/numbers affected.</li>
        <li>Likely consequences of the breach.</li>
        <li>Measures taken or proposed to address the breach and mitigate its effects.</li>
        <li>Contact details for further information.</li>
      </ul>

      <h2>11. Data Protection Impact Assessments (DPIA) and prior consultation</h2>
      <p>
        Polo PreSales provides reasonable assistance to Customer with any Data Protection Impact
        Assessment and prior consultation with supervisory authorities that Customer is required
        to carry out under Articles 35 and 36 of the GDPR.
      </p>

      <h2>12. Audit rights</h2>
      <p>
        Polo PreSales makes available to Customer all information necessary to demonstrate compliance
        with this DPA, including up-to-date independent audit reports (such as SOC 2 Type II, ISO
        27001, where applicable). On reasonable advance written notice and not more than once per
        calendar year, Customer may carry out, at Customer&apos;s expense, an audit of
        Polo PreSales&apos;s data processing activities to verify compliance. Audits must be conducted
        in a manner that does not unreasonably disrupt Polo PreSales&apos;s operations or other
        customers, and the auditor must enter a reasonable confidentiality agreement.
      </p>

      <h2>13. Return and deletion of Personal Data</h2>
      <p>
        Upon termination of the Services, Polo PreSales shall, at Customer&apos;s choice, return or
        delete all Personal Data after the end of the provision of services relating to processing,
        and delete existing copies unless EU or Member State law requires storage.
      </p>
      <p>Standard timing: 30 days read-only, then permanent deletion. Backups purged within 90 days.</p>

      <h2>14. International transfers</h2>
      <p>
        Where Personal Data is transferred outside the European Economic Area, the parties rely on
        the European Commission&apos;s Standard Contractual Clauses (Module 2: Controller to
        Processor) annexed to Commission Decision 2021/914/EU, which are incorporated into this
        DPA by reference. Where required, supplementary measures (encryption, access controls,
        contractual safeguards) are applied.
      </p>

      <h2>15. Liability</h2>
      <p>
        Each party&apos;s liability under this DPA is subject to the limitations of liability set
        out in the Terms of Service. Nothing in this DPA limits either party&apos;s liability to
        Data Subjects under Article 82 of the GDPR.
      </p>

      <h2>16. Governing law and order of precedence</h2>
      <p>
        This DPA is governed by the laws of <strong>[JURISDICTION]</strong>. In the event of
        conflict between this DPA and the Terms of Service, this DPA prevails with respect to
        data protection matters.
      </p>

      <h2>17. Contact</h2>
      <p>
        Email <a href="mailto:dpo@bidstack.dev">dpo@bidstack.dev</a> for any DPA-related questions
        or requests to sign a separate signed copy.
      </p>
    </LegalLayout>
  );
}

import type { Metadata } from 'next';
import { LegalPageLayout } from '@/components/legal/LegalPageLayout';

export const metadata: Metadata = {
  title: 'Terms of Service — APForce',
  description: 'The terms governing your access to and use of APForce.',
};

// Public, unauthenticated — required for Meta App Review. Do not move this
// route under (v3) (ProtectedRoute) or gate it behind login in any way.
export default function TermsPage() {
  return (
    <LegalPageLayout title="Terms of Service" effectiveDate="July 10, 2026" lastUpdated="July 10, 2026">
      <h2>1. Agreement to Terms</h2>
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use of APForce, a WhatsApp-based CRM platform
        operated by Viir Trading (&quot;APForce,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), including our website (apforce.in), dashboard, and
        related services (collectively, the &quot;Service&quot;). By creating an account or using the Service, you
        (&quot;Customer,&quot; &quot;you,&quot; or &quot;your&quot;) agree to be bound by these Terms. If you do not agree, do not use the Service.
      </p>

      <h2>2. The Service</h2>
      <p>
        APForce provides a platform for businesses to manage WhatsApp-based communications with their own
        customers, including inbox management, CRM pipelines, contact management, automation workflows, template
        messaging, and analytics, delivered via integration with Meta&apos;s WhatsApp Business Platform (Cloud API).
      </p>

      <h2>3. Eligibility and Account Registration</h2>
      <ul>
        <li>You must be at least 18 years old and legally authorized to bind the business you represent to these Terms.</li>
        <li>You are responsible for providing accurate registration information and keeping your account credentials secure.</li>
        <li>You are responsible for all activity that occurs under your account, including actions taken by team members you add.</li>
      </ul>

      <h2>4. Your WhatsApp Business Account</h2>
      <p>
        To use the Service, you must connect your own WhatsApp Business Account (WABA), obtained directly from
        Meta, and authorize APForce to send and receive messages on your behalf through that account. You are
        solely responsible for:
      </p>
      <ul>
        <li>
          Complying with{' '}
          <a href="https://business.whatsapp.com/policy" target="_blank" rel="noopener noreferrer">
            Meta&apos;s WhatsApp Business Messaging Policy
          </a>{' '}
          and Meta&apos;s Commerce Policy
        </li>
        <li>Obtaining any consent required from your own customers before messaging them</li>
        <li>The content of messages, templates, and automations you create and send through the Service</li>
        <li>Any suspension, restriction, or ban Meta places on your WhatsApp Business Account as a result of your use of the platform</li>
      </ul>
      <p>
        APForce is not responsible for actions taken by Meta against your WhatsApp Business Account, including due
        to your non-compliance with Meta&apos;s policies.
      </p>

      <h2>5. Acceptable Use</h2>
      <p>You agree not to use the Service to:</p>
      <ul>
        <li>Send unsolicited, spam, or bulk messages in violation of Meta&apos;s policies or applicable law</li>
        <li>Send unlawful, fraudulent, deceptive, harassing, or abusive content</li>
        <li>Impersonate any person or entity, or misrepresent your affiliation</li>
        <li>Violate any applicable data protection, telecommunications, or consumer protection law</li>
        <li>Attempt to gain unauthorized access to the Service, other accounts, or our systems</li>
        <li>Reverse-engineer, decompile, or attempt to extract the source code of the Service, except as permitted by law</li>
        <li>Use the Service in a manner that could disable, overburden, or impair its functioning</li>
      </ul>
      <p>We reserve the right to suspend or terminate accounts that violate this section.</p>

      <h2>6. Subscription, Fees, and Payment</h2>
      <ul>
        <li>Use of the Service may require payment of subscription fees as described at the time of purchase.</li>
        <li>Fees are billed in advance on a recurring basis unless otherwise stated and are non-refundable except as required by law or expressly stated in our refund policy.</li>
        <li>We may change our fees with reasonable prior notice; continued use after a fee change constitutes acceptance.</li>
        <li>You are responsible for any third-party costs, including WhatsApp conversation-based pricing charged by Meta.</li>
      </ul>

      <h2>7. Data and Privacy</h2>
      <p>
        Your use of the Service is also governed by our <a href="/privacy-policy">Privacy Policy</a>, which describes
        how we collect, use, and protect information, including data relating to your own End Users processed on
        your behalf. As between you and APForce, you remain the data controller for your End Users&apos; data, and
        APForce acts as your data processor.
      </p>

      <h2>8. Intellectual Property</h2>
      <p>
        APForce and its licensors retain all right, title, and interest in and to the Service, including all
        software, design, trademarks, and content, excluding content you upload or generate (such as your contact
        data, message templates, and configurations, which remain yours). We grant you a limited, non-exclusive,
        non-transferable license to access and use the Service during your subscription term, solely for your
        internal business purposes.
      </p>

      <h2>9. Third-Party Services</h2>
      <p>
        The Service integrates with third-party platforms, including Meta&apos;s WhatsApp Business Platform, cloud
        infrastructure providers, and payment processors. Your use of such integrations is also subject to the
        applicable third party&apos;s own terms and policies. We are not responsible for the availability, accuracy, or
        practices of third-party services.
      </p>

      <h2>10. Service Availability</h2>
      <p>
        We aim to maintain high availability but do not guarantee uninterrupted or error-free operation. The
        Service may be temporarily unavailable for maintenance, updates, or due to factors outside our control,
        including outages or policy changes by Meta or our infrastructure providers.
      </p>

      <h2>11. Termination</h2>
      <ul>
        <li>You may cancel your account at any time in accordance with our cancellation process.</li>
        <li>We may suspend or terminate your access to the Service, with or without notice, if you breach these Terms, misuse the Service, or if required to do so by Meta or applicable law.</li>
        <li>Upon termination, your right to use the Service ends immediately. Provisions that by their nature should survive termination (including Sections 8, 12, and 13) will survive.</li>
      </ul>

      <h2>12. Disclaimers and Limitation of Liability</h2>
      <p>
        THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE,&quot; WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR
        IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT. TO
        THE MAXIMUM EXTENT PERMITTED BY LAW, APFORCE SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
        CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, OR BUSINESS, ARISING OUT OF OR RELATED TO
        YOUR USE OF THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL LIABILITY FOR ANY
        CLAIM ARISING FROM THESE TERMS OR THE SERVICE SHALL NOT EXCEED THE AMOUNT YOU PAID US IN THE TWELVE (12)
        MONTHS PRECEDING THE CLAIM.
      </p>

      <h2>13. Indemnification</h2>
      <p>
        You agree to indemnify and hold harmless APForce and its officers, employees, and affiliates from any
        claims, damages, liabilities, and expenses (including reasonable legal fees) arising from your use of the
        Service, your violation of these Terms, your violation of Meta&apos;s policies, or your infringement of any
        third-party rights, including claims brought by your own End Users relating to messages you send through
        the Service.
      </p>

      <h2>14. Governing Law and Dispute Resolution</h2>
      <p>
        These Terms are governed by the laws of India, without regard to conflict of law principles. Any disputes
        arising under these Terms shall be subject to the exclusive jurisdiction of the courts located in Bagalkot,
        Karnataka.
      </p>

      <h2>15. Changes to These Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes will be notified via the dashboard or email,
        and will take effect on the date specified. Continued use of the Service after changes take effect
        constitutes acceptance of the revised Terms.
      </p>

      <h2>16. Contact Us</h2>
      <p>For questions about these Terms, contact us at:</p>
      <p>
        <strong>Email:</strong> support@apforce.in
        <br />
        <strong>Phone:</strong> +91 99012 51785
        <br />
        <strong>Address:</strong> Sector No 34, 1st Main, 2nd Cross, Navanagar, Bagalkot, Karnataka 587103, India
      </p>
    </LegalPageLayout>
  );
}

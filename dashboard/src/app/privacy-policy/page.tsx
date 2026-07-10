import type { Metadata } from 'next';
import { LegalPageLayout } from '@/components/legal/LegalPageLayout';

export const metadata: Metadata = {
  title: 'Privacy Policy — APForce',
  description: 'How APForce collects, uses, stores, and protects information.',
};

// Public, unauthenticated — required for Meta App Review. Do not move this
// route under (v3) (ProtectedRoute) or gate it behind login in any way.
export default function PrivacyPolicyPage() {
  return (
    <LegalPageLayout title="Privacy Policy" effectiveDate="July 10, 2026" lastUpdated="July 10, 2026">
      <h2>1. Introduction</h2>
      <p>
        APForce (&quot;APForce,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is a WhatsApp-based Customer Relationship Management (CRM) platform
        provided by Viir Trading (&quot;Company&quot;) for businesses (&quot;Customers,&quot; &quot;you,&quot; or &quot;your business&quot;) to manage
        communications and customer relationships with their own end customers (&quot;End Users&quot;) over WhatsApp and
        related channels.
      </p>
      <p>
        This Privacy Policy explains how we collect, use, store, and protect information when you use the APForce
        platform, including our website (apforce.in), dashboard, and integrations with Meta&apos;s WhatsApp Business
        Platform.
      </p>
      <p>
        This Policy applies to APForce <strong>as a software provider</strong>. If you are an End User communicating with one
        of our business Customers over WhatsApp, please refer to that specific business&apos;s own privacy policy for
        information about how they handle your data — APForce processes that data on the Customer&apos;s behalf, as
        described in Section 6 below.
      </p>

      <h2>2. Information We Collect</h2>
      <h3>2.1 Information from Customers (businesses using APForce)</h3>
      <ul>
        <li>Account details: name, business name, email address, phone number</li>
        <li>Billing and subscription information</li>
        <li>Login credentials and authentication data</li>
        <li>Team member details added to a Customer&apos;s account</li>
      </ul>

      <h3>2.2 Information from End Users (via WhatsApp, on behalf of Customers)</h3>
      <p>When a Customer uses APForce to communicate with their own End Users over WhatsApp, we process:</p>
      <ul>
        <li>WhatsApp profile information (name, phone number, profile picture where available)</li>
        <li>Message content (text, media, documents, location data) sent and received</li>
        <li>Conversation metadata (timestamps, delivery/read status, message type)</li>
        <li>Data provided by End Users through forms, tags, or CRM fields configured by the Customer (e.g., lead source, pipeline stage, notes)</li>
      </ul>

      <h3>2.3 Information Collected Automatically</h3>
      <ul>
        <li>Log data (IP address, browser type, device information, pages visited)</li>
        <li>Usage analytics (feature usage, session duration)</li>
        <li>Cookies and similar tracking technologies on our website and dashboard</li>
      </ul>

      <h2>3. How We Use Information</h2>
      <p>We use the information described above to:</p>
      <ul>
        <li>Provide, operate, and maintain the APForce platform</li>
        <li>Enable Customers to send, receive, and manage WhatsApp messages through Meta&apos;s WhatsApp Business Platform (Cloud API)</li>
        <li>Power CRM features such as contact management, pipeline tracking, automation workflows, and analytics</li>
        <li>Process payments and manage subscriptions</li>
        <li>Provide customer support</li>
        <li>Improve and develop new features</li>
        <li>Detect, prevent, and address technical issues, fraud, or misuse</li>
        <li>Comply with legal obligations</li>
      </ul>

      <h2>4. Meta / WhatsApp Business Platform</h2>
      <p>
        APForce integrates with Meta&apos;s WhatsApp Business Platform (Cloud API) to send and receive messages on behalf
        of our Customers. As part of this integration:
      </p>
      <ul>
        <li>We request and use WhatsApp Business Management and WhatsApp Business Messaging permissions solely to enable Customers to connect their own WhatsApp Business Account(s) and send/receive messages through their own number(s).</li>
        <li>We do not access, request, or use any Customer&apos;s or End User&apos;s data for purposes other than providing the APForce service.</li>
        <li>We do not sell WhatsApp user data to third parties or use it for advertising purposes.</li>
        <li>
          Message and account data obtained through the WhatsApp Business Platform is handled in accordance with
          Meta&apos;s{' '}
          <a href="https://www.facebook.com/legal/technology-terms" target="_blank" rel="noopener noreferrer">
            WhatsApp Business Data Processing Terms
          </a>{' '}
          and this Privacy Policy.
        </li>
      </ul>

      <h2>5. Data Storage and Security</h2>
      <ul>
        <li>Data is stored on secure cloud infrastructure (Amazon Web Services) with industry-standard encryption in transit (TLS) and at rest.</li>
        <li>Access to Customer and End User data is restricted to authorized personnel on a need-to-know basis.</li>
        <li>We implement reasonable technical and organizational measures to protect against unauthorized access, alteration, disclosure, or destruction of data.</li>
        <li>No method of transmission or storage is 100% secure; we cannot guarantee absolute security.</li>
      </ul>

      <h2>6. Our Role as a Data Processor</h2>
      <p>
        For data relating to a Customer&apos;s End Users (i.e., the people that Customer communicates with over
        WhatsApp), APForce acts as a <strong>data processor</strong>, and the Customer acts as the <strong>data
        controller</strong>. We process this data only on the Customer&apos;s instructions and as necessary to provide the
        platform. Customers are responsible for ensuring they have appropriate legal basis and consent to
        communicate with their End Users via WhatsApp and to process their data through APForce.
      </p>

      <h2>7. Data Sharing and Disclosure</h2>
      <p>We do not sell personal information. We may share information:</p>
      <ul>
        <li>With Meta, as necessary to deliver WhatsApp messaging functionality</li>
        <li>With service providers who help us operate the platform (e.g., cloud hosting, payment processing), under confidentiality obligations</li>
        <li>If required by law, regulation, legal process, or governmental request</li>
        <li>In connection with a merger, acquisition, or sale of business assets, with notice where required</li>
        <li>With a Customer&apos;s own team members, as configured within that Customer&apos;s account</li>
      </ul>

      <h2>8. Data Retention</h2>
      <p>
        We retain Customer and End User data for as long as the Customer&apos;s account is active, or as needed to
        provide the service, comply with legal obligations, resolve disputes, and enforce agreements. Customers may
        request deletion of their data as described in our{' '}
        <a href="/data-deletion">Data Deletion Instructions</a>.
      </p>

      <h2>9. Your Rights</h2>
      <p>
        Depending on your jurisdiction, you may have rights to access, correct, export, or delete your personal
        information, and to object to or restrict certain processing. To exercise these rights, contact us using the
        details in Section 12. Customers seeking to exercise rights on behalf of their End Users should also refer to
        Section 6.
      </p>

      <h2>10. Children&apos;s Privacy</h2>
      <p>
        APForce is intended for use by businesses and is not directed at individuals under the age of 18. We do not
        knowingly collect personal information from children.
      </p>

      <h2>11. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Material changes will be posted on this page with an
        updated &quot;Last Updated&quot; date. Continued use of APForce after changes constitutes acceptance of the revised
        Policy.
      </p>

      <h2>12. Contact Us</h2>
      <p>If you have questions about this Privacy Policy or our data practices, contact us at:</p>
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

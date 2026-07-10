import type { Metadata } from 'next';
import { LegalPageLayout } from '@/components/legal/LegalPageLayout';

export const metadata: Metadata = {
  title: 'Data Deletion Instructions — APForce',
  description: 'How to request deletion of your data from APForce.',
};

// Public, unauthenticated — required for Meta App Review. Do not move this
// route under (v3) (ProtectedRoute) or gate it behind login in any way.
//
// NOTE ON CONTENT: the source draft's "in-app request" method (Settings ->
// Organisation -> Account -> "Delete Account") is deliberately omitted here.
// Confirmed against the live codebase (2026-07-10) that no such feature
// exists anywhere -- Settings' Organisation tab is a "coming soon" stub,
// with no frontend call and no backend route for whole-account/company
// deletion. The source draft's own footer explicitly warned: "do not
// publish a self-service deletion path that isn't actually implemented."
// Only the email-based request method (which is real and accurate) is
// published. See the chat report for full detail -- add the in-app method
// back here once/if that feature is actually built.
export default function DataDeletionPage() {
  return (
    <LegalPageLayout title="Data Deletion Instructions" effectiveDate="July 10, 2026" lastUpdated="July 10, 2026">
      <p>
        APForce is committed to giving you control over your data. This page explains how you can request the
        deletion of your data from our systems.
      </p>

      <h2>Who This Applies To</h2>
      <ul>
        <li><strong>Customers</strong> (businesses with an APForce account) who want to delete their account and associated data.</li>
        <li><strong>End Users</strong> (people who have messaged one of our business Customers on WhatsApp) who want their personal data removed from a Customer&apos;s APForce account.</li>
      </ul>

      <h2>How to Request Data Deletion</h2>

      <h3>If you are an APForce Customer (business account holder)</h3>
      <p>
        Send an email to <strong>support@apforce.in</strong>{' '}
        from your registered account email address, with the
        subject line &quot;Data Deletion Request,&quot; including your business/account name.
      </p>
      <p>
        Once verified, we will delete your account data, including contacts, conversation history, templates, and
        configuration, within <strong>30 days</strong>, except where we are required to retain certain records for
        legal, tax, or regulatory compliance purposes (in which case that data will be securely retained only for as
        long as legally required, then deleted).
      </p>

      <h3>If you are an End User (a customer of one of our business Customers)</h3>
      <p>
        Because APForce provides the messaging platform on behalf of businesses (our Customers) who communicate
        with you directly, we recommend you first contact the specific business you have been messaging on
        WhatsApp to request deletion of your data, since they control what data is collected and how it is used.
      </p>
      <p>
        If you are unable to reach that business, or want to request deletion of data held at the platform level,
        you may contact us directly at <strong>support@apforce.in</strong>{' '}
        with:
      </p>
      <ul>
        <li>The WhatsApp number associated with your conversation</li>
        <li>The name of the business you were messaging</li>
      </ul>
      <p>
        We will forward your request to the relevant Customer and/or process deletion of the associated data from
        our systems within <strong>30 days</strong>, in accordance with applicable law, except where retention is
        legally required.
      </p>

      <h2>What Gets Deleted</h2>
      <p>Upon a verified deletion request, we permanently remove:</p>
      <ul>
        <li>Contact and profile information</li>
        <li>Message and conversation history</li>
        <li>CRM data associated with the account or contact (tags, notes, pipeline stage, custom fields)</li>
      </ul>

      <h2>What May Be Retained</h2>
      <p>We may retain limited data where required to:</p>
      <ul>
        <li>Comply with legal, tax, or regulatory obligations</li>
        <li>Resolve disputes or enforce our agreements</li>
        <li>Maintain records required under applicable financial services or anti-fraud regulations</li>
      </ul>
      <p>
        Any retained data is kept securely and solely for the purpose described above, and is deleted once the
        retention requirement no longer applies.
      </p>

      <h2>Questions</h2>
      <p>If you have questions about this process, contact us at:</p>
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

import type { Metadata } from "next";
import Link from "next/link";
import styles from "./privacy.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy | TrustHub Connect",
  description:
    "Learn how TrustHub Connect collects, uses, and protects information when you use our service.",
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <article className={styles.policy}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/">
            TrustHub Connect
          </Link>
          <p className={styles.eyebrow}>Privacy</p>
          <h1>Privacy Policy</h1>
          <p className={styles.updated}>Effective October 7, 2026</p>
          <p className={styles.introduction}>
            This policy explains what information TrustHub Connect may receive
            when you use our service, how we use it, and the choices available
            to you.
          </p>
        </header>

        <div className={styles.sections}>
          <section>
            <h2>1. About TrustHub Connect</h2>
            <p>
              TrustHub Connect is a community connection service that helps
              people find information and connect around local needs and
              resources. You may interact with the service through WhatsApp
              and other interfaces we make available.
            </p>
          </section>

          <section>
            <h2>2. Information we collect</h2>
            <p>
              The information we receive depends on how you use TrustHub
              Connect. It may include:
            </p>
            <ul>
              <li>
                <strong>Account and profile information</strong>, such as
                information you provide to identify yourself or manage a
                profile.
              </li>
              <li>
                <strong>WhatsApp information</strong>, such as your WhatsApp
                identifier or phone number as made available through WhatsApp,
                and the messages, requests, replies, or other content you send
                when you interact with TrustHub Connect there.
              </li>
              <li>
                <strong>Location and community information</strong>, such as a
                place, area, community, or local need that you choose to share
                or that is included in your request.
              </li>
              <li>
                <strong>Technical and log information</strong>, such as
                information about requests to our service, timestamps,
                diagnostic events, and device or connection details made
                available when you use our web experience.
              </li>
            </ul>
            <p>
              Please avoid sending sensitive personal information unless it is
              necessary for your interaction.
            </p>
          </section>

          <section>
            <h2>3. How we use information</h2>
            <p>We may use information to:</p>
            <ul>
              <li>provide the service and respond to your messages or requests;</li>
              <li>help identify relevant local information or connections;</li>
              <li>maintain, troubleshoot, and improve the service;</li>
              <li>protect the service, prevent misuse, and keep appropriate records; and</li>
              <li>meet legal obligations and enforce applicable terms.</li>
            </ul>
            <p>
              We use information for these purposes and do not sell personal
              information.
            </p>
          </section>

          <section>
            <h2>4. WhatsApp and Meta</h2>
            <p>
              If you contact TrustHub Connect through WhatsApp, your
              communications are transmitted through WhatsApp and processed by
              Meta under its own terms and privacy policies. We receive
              information needed to handle your interaction, which may include
              your WhatsApp identifier and message content. We use it to
              provide the service, reply, and support the community features
              you request.
            </p>
            <p>
              WhatsApp and Meta operate their own services and may process
              information under their own policies. Their handling of
              information is not controlled by this policy.
            </p>
          </section>

          <section>
            <h2>5. Sharing and service providers</h2>
            <p>
              We may share information with service providers that help us
              operate TrustHub Connect, such as providers of hosting,
              databases, messaging, or AI-assisted features. These providers
              may process information on our behalf to deliver their services
              and are expected to protect it appropriately.
            </p>
            <p>
              We may also disclose information when required by law, to protect
              people or the service, or as part of a business transfer. We do
              not make personal information available to others for their own
              advertising.
            </p>
          </section>

          <section>
            <h2>6. Data retention</h2>
            <p>
              We keep information for as long as reasonably needed to provide
              and maintain the service, handle requests, meet legal
              requirements, resolve disputes, and protect the service. Retention
              periods may vary by the type of information and how it is used.
              When information is no longer needed, we take steps to delete or
              de-identify it, subject to applicable obligations and
              operational backups.
            </p>
          </section>

          <section>
            <h2>7. Security</h2>
            <p>
              We use reasonable technical and organizational measures designed
              to protect information. No method of transmission or storage is
              completely secure, so we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2>8. Your rights and data requests</h2>
            <p>
              Depending on where you live, you may have rights to request
              access to, correction of, or deletion of personal information, or
              to object to or limit certain processing. To make a privacy
              request or ask a question, message TrustHub Connect through the
              WhatsApp conversation where you use the service and identify the
              information or interaction concerned. We may need to verify your
              request before acting on it.
            </p>
            <p>
              You can also stop communicating with TrustHub Connect at any
              time. This does not remove information that we must retain or
              that remains with WhatsApp or other providers under their own
              policies.
            </p>
          </section>

          <section>
            <h2>9. Children’s privacy</h2>
            <p>
              TrustHub Connect is not directed to children under 13, and we do
              not knowingly collect personal information from children under
              13. If you believe a child has provided us with personal
              information, contact us through the TrustHub Connect WhatsApp
              conversation so we can review the request.
            </p>
          </section>

          <section>
            <h2>10. Changes to this policy</h2>
            <p>
              We may update this policy as the service or our practices change.
              We will post the updated version on this page and revise the
              effective date above. Please check back periodically.
            </p>
          </section>

          <section>
            <h2>11. Contact</h2>
            <p>
              For questions, privacy requests, or data deletion requests,
              contact TrustHub Connect by sending a message through the
              WhatsApp conversation where you use the service.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}

"use client";

import { useGenotype } from "./components/UserDataUpload";
import { trackGetStartedClicked } from "@/lib/analytics";


const INSTRUCTIONAL_VIDEO_URL = "https://youtu.be/1mqLYTAOK90";
const SCHEDULE_CALL_URL = "https://calendar.app.google/eVDN4d44GreUjR8p8";

const introCopy = [
  {
    label: "DNA insights",
    text: "Monadic DNA Explorer lets you unlock the potential of DNA data to inform diet, lifestyle, and health.",
  },
  {
    label: "GWAS Catalog",
    text: "We use over one million scientifically vetted traits from the GWAS Catalog to help you understand your DNA.",
  },
  {
    label: "Privacy first",
    text: "Your DNA is the most sensitive data you own, so we ensure your data stays private and secure. We do not store, snoop on, or sell your data.",
  },
  {
    label: "Secure AI",
    text: "Using local processing in your browser and AI running in Trusted Execution Environments, we maximize your anonymity and privacy.",
  },
];

export default function LandingClient() {
  const { error } = useGenotype();

  return (
    <main className="page landing-page landing-home-page">
      <section className="landing-home-intro">
        <div className="landing-home-copy">
          <h1>Understand your DNA without giving it away.</h1>

          <div className="landing-home-explainer" aria-label="Monadic DNA Explorer overview">
            {introCopy.map((item) => (
              <p key={item.label}>
                <span>{item.label}</span>
                {item.text}
              </p>
            ))}
          </div>

          {error && <p className="landing-upload-error">{error}</p>}
        </div>

        <aside className="landing-home-start-panel" aria-labelledby="landing-start-heading">
          <h2 id="landing-start-heading">Get Started</h2>
          <div className="landing-start-actions">
            <a
              className="landing-secondary-button"
              href={INSTRUCTIONAL_VIDEO_URL}
              target="_blank"
              rel="noreferrer"
              onClick={() => trackGetStartedClicked("instructional_video")}
            >
              Watch Instructional Video
            </a>
            <a
              className="landing-secondary-button"
              href={SCHEDULE_CALL_URL}
              target="_blank"
              rel="noreferrer"
              onClick={() => trackGetStartedClicked("schedule_video_call")}
            >
              Book a Free Help Call
            </a>
          </div>
        </aside>
      </section>
    </main>
  );
}

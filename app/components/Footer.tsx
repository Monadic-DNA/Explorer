export default function Footer() {
  return (
    <footer className="app-footer">
      <div className="footer-content">
        <div className="footer-section">
          <p className="copyright">
            © {new Date().getFullYear()}{" "}
            <a
              href="https://recherche.tech/"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link"
            >
              Recherche Inc
            </a>
            . All rights reserved.
          </p>
        </div>

        <div className="footer-section social-links">
          <p>Follow Monadic DNA:</p>
          <div className="social-icons">
            <a
              href="https://github.com/Monadic-DNA/Explorer"
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              aria-label="GitHub"
              title="View source on GitHub"
            >
              <svg className="social-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </a>
            <a
              href="https://x.com/MonadicDNA"
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              aria-label="X (Twitter)"
              title="Follow us on X"
            >
              <svg className="social-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            </a>
            <a
              href="https://farcaster.xyz/monadicdna"
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              aria-label="Farcaster"
              title="Follow us on Farcaster"
            >
              <svg className="social-icon" viewBox="0 0 1000 1000" fill="currentColor">
                <path d="M257.778 155.556H742.222V844.445H671.111V528.889H670.414C662.554 441.677 589.258 373.333 500 373.333C410.742 373.333 337.446 441.677 329.586 528.889H328.889V844.445H257.778V155.556Z"/>
                <path d="M128.889 253.333L155.556 279.999H155.555V844.445H233.333V257.778L128.889 253.333Z"/>
                <path d="M871.111 253.333L844.444 279.999H844.445V844.445H766.667V257.778L871.111 253.333Z"/>
              </svg>
            </a>
            <a
              href="https://recherche.discourse.group/c/public/monadic-dna/30"
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              aria-label="Community Forum"
              title="Join our community forum"
            >
              <svg className="social-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.103 0C18.666 0 24 5.485 24 11.997c0 6.51-5.33 11.99-11.9 11.99L0 24V11.79C0 5.28 5.532 0 12.103 0zm.116 4.563c-2.593-.003-4.996 1.352-6.337 3.57-1.33 2.208-1.387 4.957-.148 7.22L4.4 19.61l4.794-1.074c2.745 1.225 5.965.676 8.136-1.39 2.17-2.054 2.86-5.228 1.737-7.997-1.135-2.778-3.84-4.59-6.84-4.585h-.008z"/>
              </svg>
            </a>
          </div>
        </div>

        <div className="footer-section">
          <p className="data-credit">
            Data sourced from the{" "}
            <a
              href="https://www.ebi.ac.uk/gwas/"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link"
            >
              GWAS Catalog
            </a>
            . Dataset: "All associations v1.0.2 - with added ontology annotations, GWAS Catalog study accession numbers and genotyping technology".
          </p>
        </div>
      </div>
    </footer>
  );
}

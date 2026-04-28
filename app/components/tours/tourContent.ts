export type TourStep = {
  name: string;
  title: string;
  body: string;
  /** CSS selector for the element to spotlight. If omitted or not found, the popover renders centered. */
  selector?: string;
  /** Preferred placement of the popover relative to the target. Defaults to "bottom". */
  placement?: "top" | "bottom" | "left" | "right";
};

export type TourContent = {
  id: string;
  title: string;
  steps: TourStep[];
};

const myDataStep: TourStep = {
  name: "my_data",
  title: "Upload your DNA first",
  body: "If you haven't already, click 'My Data' in the top bar to upload your raw genetic data file from 23andMe, AncestryDNA, or similar. Your data is processed entirely in your browser and never sent to any server.",
  selector: '[data-tour="my-data-button"]',
  placement: "bottom",
};

export const exploreTour: TourContent = {
  id: "explore",
  title: "Welcome to Explore",
  steps: [
    {
      name: "intro",
      title: "Welcome to Explore",
      body: "This is your window into over a million scientifically vetted studies linking genetic variants to traits. We'll show you the four things you need to know.",
    },
    myDataStep,
    {
      name: "search",
      title: "Search for anything",
      body: "Type a trait, condition, or keyword here. Similarity search finds related concepts even if your wording doesn't match exactly.",
      selector: "input#search",
      placement: "bottom",
    },
    {
      name: "filters",
      title: "Narrow down with filters",
      body: "Use these to focus on stronger studies (higher sample size, smaller p-value) or specific quality and genotype options.",
      selector: ".panel-content",
      placement: "bottom",
    },
    {
      name: "run_all",
      title: "Or just analyze everything",
      body: "Click Run All to compare your DNA against every matching study at once. Saved results power the DNA Chat and Overview Report tabs.",
      selector: '[data-tour="run-all-button"]',
      placement: "bottom",
    },
    {
      name: "your_result",
      title: "Your personal result",
      body: "After analyzing, the Your Result column shows how your genotype compares to each study. Click any row to see the details.",
      selector: '[data-tour="your-result-header"]',
      placement: "bottom",
    },
  ],
};

export const dnaChatTour: TourContent = {
  id: "dna_chat",
  title: "Welcome to DNA Chat",
  steps: [
    {
      name: "intro",
      title: "Chat with your DNA",
      body: "DNA Chat is a private LLM that uses your saved genetic results as context. Ask anything about your traits, sleep, diet, or risks.",
    },
    myDataStep,
    {
      name: "prompts",
      title: "Try a suggested prompt",
      body: "Not sure what to ask? Tap any of these suggestions to fill the chat box. They're a great starting point.",
      selector: ".example-questions",
      placement: "top",
    },
    {
      name: "input",
      title: "Or type your own",
      body: "Type any question about your DNA here. The chat keeps your context across follow-up questions.",
      selector: "textarea.chat-input",
      placement: "top",
    },
    {
      name: "send",
      title: "Send your question",
      body: "Click here to send. The first answer pulls in your most relevant studies as context — follow-ups continue the conversation.",
      selector: ".chat-send-button",
      placement: "top",
    },
    {
      name: "attach",
      title: "Upload lab reports and documents",
      body: "You can attach PDFs, CSVs, or text files — like genetic lab reports or bloodwork — and ask questions about them directly. Come back every time you have a new document to analyse.",
      selector: '[data-tour="attach-button"]',
      placement: "top",
    },
    {
      name: "llm",
      title: "Pick your LLM provider",
      body: "By default, DNA Chat runs on Nillion nilAI inside a Trusted Execution Environment so your data stays private. Click here to switch providers if you want a different model.",
      selector: '[data-tour="llm-config-button"]',
      placement: "bottom",
    },
  ],
};

export const overviewReportTour: TourContent = {
  id: "overview_report",
  title: "Welcome to Overview Report",
  steps: [
    {
      name: "intro",
      title: "Synthesize your results",
      body: "The Overview Report turns all your saved results into a single readable summary, organized by themes like cardiovascular, metabolic, and lifestyle.",
    },
    myDataStep,
    {
      name: "saved_count",
      title: "You need saved results first",
      body: "This shows how many results you've saved. The report uses these as its source. The more you have, the richer the report.",
      selector: '[data-tour="saved-results-count"]',
      placement: "bottom",
    },
    {
      name: "run_all",
      title: "No results yet? Run All first",
      body: "Click Run All in the menu bar to analyze your DNA against every matching study. Once that finishes, come back here.",
      selector: '[data-tour="run-all-button"]',
      placement: "bottom",
    },
    {
      name: "generate",
      title: "Generate your report",
      body: "Once you have saved results, click here. The report is generated by an LLM and is for educational purposes only — not medical advice.",
      selector: '[data-tour="generate-report-button"]',
      placement: "top",
    },
  ],
};

export const menuBarTour: TourContent = {
  id: "menu_bar",
  title: "Menu Bar Tour",
  steps: [
    {
      name: "intro",
      title: "Your toolkit",
      body: "These buttons in the top bar are how you control the app. Let's walk through each one so you know exactly where to go.",
    },
    {
      name: "my_data",
      title: "My Data — start here",
      body: "Upload your raw DNA file from 23andMe, AncestryDNA, or any compatible provider. Your data is processed entirely in your browser and never leaves your device.",
      selector: '[data-tour="my-data-button"]',
      placement: "bottom",
    },
    {
      name: "results",
      title: "Results",
      body: "Save your analysis results to a file or load a previous session. Use this to pick up where you left off or share results between devices.",
      selector: '[data-tour="results-button"]',
      placement: "bottom",
    },
    {
      name: "run_all",
      title: "Run All",
      body: "Analyze your DNA against every matching study in the GWAS Catalog in one go. The results feed DNA Chat and the Overview Report.",
      selector: '[data-tour="run-all-button"]',
      placement: "bottom",
    },
    {
      name: "personalize",
      title: "Personalize",
      body: "Add context like your age, sex, and health conditions so the LLM gives you more relevant answers.",
      selector: '[data-tour="personalize-button"]',
      placement: "bottom",
    },
    {
      name: "llm",
      title: "LLM provider",
      body: "Choose which AI model powers DNA Chat and Overview Report. Default is Nillion nilAI running in a privacy-preserving Trusted Execution Environment.",
      selector: '[data-tour="llm-config-button"]',
      placement: "bottom",
    },
    {
      name: "cache",
      title: "Cache",
      body: "The first Run All downloads ~54 MB of GWAS Catalog data and stores it locally. Here you can see how much is cached or clear it to re-download.",
      selector: '[data-tour="cache-button"]',
      placement: "bottom",
    },
    {
      name: "help",
      title: "Help",
      body: "Reopen the onboarding tour or find answers to common questions here.",
      selector: '[data-tour="help-button"]',
      placement: "bottom",
    },
    {
      name: "theme",
      title: "Light / Dark mode",
      body: "Toggle between light and dark themes. Your preference is saved and applied on every visit.",
      selector: '[data-tour="theme-button"]',
      placement: "bottom",
    },
  ],
};

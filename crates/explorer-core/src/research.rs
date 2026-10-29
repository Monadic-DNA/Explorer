//! Research in Chat: the premium multi-angle pipeline. Shared by the web (lib/research-service.ts)
//! and the native apps so all three send identical prompts. Hosts make the LLM calls.
use crate::{array, text};
use serde_json::{json, Value};

pub const ANGLES: usize = 10;
/// Matched results considered for each research angle.
pub const RESULTS_PER_ANGLE: usize = 100;

fn context(v: &Value) -> &str { let c = text(v, "customization"); if c.is_empty() { "No personalization set." } else { c } }
pub(crate) fn group(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() { if i > 0 && (digits.len() - i) % 3 == 0 { out.push(','); } out.push(c); }
    out
}
fn risk(score: f64, level: &str, beta: bool) -> String {
    if level == "neutral" { return if beta { "baseline".into() } else { "1.0x".into() }; }
    if beta { format!("β={}{:.3} units", if score >= 0.0 { "+" } else { "" }, score) } else { format!("{score:.2}x") }
}
pub(crate) fn format_results(rows: &[Value]) -> String {
    rows.iter().enumerate().map(|(i, r)| format!(
        "{}. {} ({}):\n   - Your genotype: {}\n   - Risk allele: {}\n   - Risk score: {} ({})\n   - SNP: {}",
        i + 1, text(r, "traitName"), text(r, "studyTitle"), text(r, "userGenotype"), text(r, "riskAllele"),
        risk(r["riskScore"].as_f64().unwrap_or(1.0), text(r, "riskLevel"), text(r, "effectType") == "beta"), text(r, "riskLevel"), text(r, "matchedSnp"),
    )).collect::<Vec<_>>().join("\n\n")
}

/// Step 1: asks the model for research angles (search keywords) for the question.
pub fn keywords_prompt(v: &Value) -> Value {
    json!({"maxTokens":150,"temperature":0.5,"messages":[
        {"role":"system","content":format!("You extract GWAS database search keywords from a user's question about their genetics.

RULES:
- Output exactly {ANGLES} keywords or short phrases, one per line, no numbering, no explanation.
- Keywords must reflect the TOPIC of the question — the biological traits, phenotypes, or mechanisms being asked about.
- Do NOT use the user's medical conditions as keywords unless the question is directly asking about those conditions.
- The user context is provided only to help you pick the most relevant angles within the question's topic. It must not redirect the keywords toward unrelated health conditions.
- Be specific. \"Bitter taste receptor TAS2R\" is better than \"taste preferences\".

EXAMPLE: If the question is \"What foods will I like?\" extract keywords about food preference genetics (taste receptors, flavor perception, olfaction, dietary patterns, food aversion). NOT about diabetes or autoimmune disease.")},
        {"role":"user","content":format!("User question: \"{}\"\n\nUser context (for prioritization only, do not redirect keywords):\n{}", text(v, "query"), context(v))}
    ]})
}
/// Parses the keyword reply into at most `ANGLES` angles, falling back to the question itself.
pub fn parse_keywords(v: &Value) -> Value {
    let mut keywords: Vec<&str> = text(v, "content").lines().map(str::trim).filter(|k| !k.is_empty()).take(ANGLES).collect();
    if keywords.is_empty() { keywords.push(text(v, "query")); }
    json!(keywords)
}
/// Step 2: a focused analysis of one angle, given the user's results most relevant to it.
pub fn angle_prompt(v: &Value) -> Value {
    let (query, keyword) = (text(v, "query"), text(v, "keyword"));
    json!({"maxTokens":350,"temperature":0.6,"messages":[
        {"role":"system","content":format!("You analyze GWAS genetic findings for a specific research angle. {}

USER CONTEXT:
{}

ORIGINAL USER QUESTION: \"{query}\"

RESEARCH ANGLE: \"{keyword}\"

GWAS FINDINGS:
{}

Write a focused 150-word analysis of what these findings mean for this user, specific to the \"{keyword}\" angle. Reference actual findings by trait name and OR/beta values. Be concrete and personalized. No disclaimers needed here.", text(v, "llmDescription"), context(v), format_results(array(&v["results"])))},
        {"role":"user","content":format!("Analyze the \"{keyword}\" angle.")}
    ]})
}
/// Step 3: synthesizes the angle analyses into the streamed answer.
pub fn synthesis_prompt(v: &Value) -> Value {
    let analyses = array(&v["analyses"]);
    let text_of = analyses.iter().map(|a| format!("**Angle: {}** ({} studies)\n{}", text(a, "keyword"), a["resultsCount"].as_u64().unwrap_or(0), text(a, "analysis"))).collect::<Vec<_>>().join("\n\n");
    json!({"maxTokens":3000,"temperature":0.7,"reasoningEffort":"medium","messages":[
        {"role":"system","content":format!("You synthesize multi-angle genetic research into a comprehensive personalized answer. {}

USER CONTEXT:
{}

Total results in user profile: {}

RESEARCH ANALYSES ({} angles):
{text_of}

Synthesize these analyses into a comprehensive answer to the user's question. Identify patterns across angles, highlight convergent findings, note what stands out given the user's context. Use the standard structure: overview, genetic landscape, personal implications, action steps. Target 600-900 words. Plain language. Complete your full response.

GWAS results show statistical associations at the population level, not deterministic outcomes. Educational purposes only.

After the response, append exactly this block:

FOLLOWUP:
- [question from the user's perspective connecting a finding directly to their personal situation]
- [question digging deeper on the most impactful finding across the analyses]
- [question connecting two of the research angles or asking how they interact]", text(v, "llmDescription"), context(v), group(v["totalResults"].as_u64().unwrap_or(0)), analyses.len())},
        {"role":"user","content":text(v, "query")}
    ]})
}
/// Splits a reply into the answer and its follow-up questions, like LLMChatInline.tsx on the web.
pub fn extract(v: &Value) -> Value {
    static SPLIT: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let content = text(v, "content");
    let mut parts = SPLIT.get_or_init(|| regex::Regex::new(r"\n+FOLLOWUP:\n").unwrap()).split(content);
    let answer = parts.next().unwrap_or("").trim();
    let questions: Vec<&str> = parts.next().map(|f| f.split('\n').filter_map(|l| l.strip_prefix("- ")).map(str::trim).filter(|q| !q.is_empty()).collect()).unwrap_or_default();
    json!({"answer":answer,"questions":questions})
}
/// How the selected model is described in prompts; matches getLLMDescription in lib/llm-client.ts.
pub fn description(v: &Value) -> Value {
    let config = crate::llm::config(v);
    let id = text(&config, "identifier");
    json!(match text(&config, "provider") {
        "ollama" => format!("🖥️ Using local Ollama ({id}) at {}:{}", if text(v, "ollamaAddress").is_empty() { "localhost" } else { text(v, "ollamaAddress") }, v["ollamaPort"].as_u64().filter(|p| *p > 0).unwrap_or(11434)),
        "huggingface" => format!("☁️ Using HuggingFace Router ({id})"),
        _ => format!("🛡️ Powered by Nillion nilAI using {id} in TEE (Trusted Execution Environment)"),
    })
}

/// Regular DNA Chat, as in LLMChatInline.tsx on the web. The first question gets the detailed prompt with the
/// user's most relevant results; follow-ups get the conversational prompt and the conversation so far.
pub const CHAT_RESULTS: usize = 500;
/// Explains one matched result in plain language, with the user's most related results as context.
/// Web parity: app/components/LLMCommentaryModal.tsx builds the same counselor prompt.
pub fn commentary_prompt(v: &Value) -> Value {
    let current = &v["result"];
    let beta = text(current, "effectType") == "beta";
    // Study quality from the stored row, so the interpretation is tempered by the evidence.
    let sample = text(current, "sampleSize");
    let replication = text(current, "replicationSampleSize");
    let pvalue = text(current, "pValue");
    let size_note = match crate::quality::sample_size(sample) {
        Some(n) if n < 5000.0 => " (SMALL STUDY - interpret with caution)",
        Some(n) if n < 50000.0 => " (medium study)",
        Some(_) => " (large, well-powered study)",
        None => "",
    };
    let p_note = match crate::quality::p_value(pvalue) {
        Some(p) if p > 5e-8 => " (NOT genome-wide significant - findings are suggestive only)",
        Some(_) => " (genome-wide significant)",
        None => "",
    };
    let ancestry_note = if sample.to_lowercase().contains("european") { " (mostly European ancestry participants - may not generalize to other ancestries)" } else { "" };
    let quality = format!(
        "STUDY QUALITY (USE THESE TO TEMPER YOUR INTERPRETATION):\n- Sample size: {}{sample}{size_note}{ancestry_note}\n- Replication: {}\n- P-value: {}{pvalue}{p_note}\n- Mapped gene(s): {}\n\nCRITICAL: You MUST acknowledge these study limitations in your commentary. If the sample size is small, ancestry is limited, or replication is lacking, explicitly say this reduces confidence in the findings.",
        if sample.is_empty() { "Not reported" } else { "" },
        if replication.is_empty() { "No independent replication (interpret with caution)" } else { replication },
        if pvalue.is_empty() { "Not reported" } else { "" },
        text(current, "mappedGene"),
    );
    let customization = context(v);
    json!({"maxTokens":1800,"temperature":0.7,"reasoningEffort":"low","messages":[
        {"role":"system","content":"You are a knowledgeable genetic counselor who explains GWAS results clearly and responsibly, always emphasizing appropriate disclaimers and limitations."},
        {"role":"user","content":format!("You are a genetic counselor providing educational commentary on GWAS (Genome-Wide Association Study) results.

IMPORTANT DISCLAIMERS TO INCLUDE:
1. This is for educational purposes only
2. This is NOT medical advice and should not be used for medical decisions
3. GWAS results show statistical associations, not deterministic outcomes
4. Genetic risk is just one factor among many (lifestyle, environment, other genes)
5. Always consult healthcare professionals for medical interpretation

{quality}

USER BACKGROUND (CONFIDENTIAL - USE TO PERSONALIZE INTERPRETATION; be specific about ancestry-related limitations if the study population does not match the user's background):
{customization}

CURRENT RESULT TO ANALYZE:
Trait: {}
Study: {}
Your genotype: {}
Risk allele: {}
Effect size: {}
Risk score: {} ({})
Matched SNP: {}

OTHER SAVED RESULTS MOST RELATED TO THIS TRAIT, FOR CONTEXT:
{}

Please provide:
1. A brief, plain-language summary of what this research study found
2. A clear explanation of what this result means for the user specifically
3. Context about the trait that anyone can understand
4. Interpretation of the risk level in practical terms
5. How this relates to their other results, if applicable
6. Appropriate disclaimers and next steps

Keep your response concise (400-600 words), educational, and reassuring where appropriate. Use clear, accessible language suitable for someone with no scientific background. Avoid jargon, and when technical terms are necessary, explain them simply.",
            text(current, "traitName"), text(current, "studyTitle"), text(current, "userGenotype"), text(current, "riskAllele"),
            text(current, "effectSize"), risk(current["riskScore"].as_f64().unwrap_or(1.0), level_of(current), beta), level_of(current), text(current, "matchedSnp"),
            format_results(array(&v["results"])))}
    ]})
}
fn level_of(r: &Value) -> &str { text(r, "riskLevel") }
pub fn chat_prompt(v: &Value) -> Value {
    static TEMPLATES: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    let t = TEMPLATES.get_or_init(|| serde_json::from_str(include_str!("../data/chat-prompts.json")).unwrap());
    let history = array(&v["history"]);
    let fill = |template: &str, pairs: &[(&str, String)]| pairs.iter().fold(template.to_string(), |out, (k, val)| out.replace(&format!("{{{{{k}}}}}"), val));
    let description = text(v, "llmDescription").to_string();
    let mut messages = Vec::new();
    if history.is_empty() {
        let rows = array(&v["results"]);
        let summary = text(v, "summary");
        let user_context = if summary.is_empty() { String::new() } else { fill(text(t, "userContext"), &[("summary", summary.into())]) };
        messages.push(json!({"role":"system","content":fill(text(t, "first"), &[("llmDescription", description), ("totalResults", group(v["totalResults"].as_u64().unwrap_or(0))), ("resultCount", rows.len().to_string()), ("userContext", user_context), ("contextResults", format_results(rows)), ("query", text(v, "query").into())])}));
    } else {
        messages.push(json!({"role":"system","content":fill(text(t, "followup"), &[("llmDescription", description)])}));
        for m in history.iter().filter(|m| text(m, "role") != "system") { messages.push(json!({"role":text(m, "role"),"content":text(m, "content")})); }
    }
    messages.push(json!({"role":"user","content":text(v, "query")}));
    json!({"maxTokens":5000,"temperature":0.7,"reasoningEffort":"medium","messages":messages})
}

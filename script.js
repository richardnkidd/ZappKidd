        const taskData = {
            "deep-research": {
                title: "Deep Research & Analysis",
                contexts: ["Professional", "Nonprofit", "Strategy"],
                primary: {
                    model: "Perplexity Pro + Claude Opus 4",
                    rationale: "Perplexity's real-time citations combined with Claude's synthesis capabilities. Perfect for grant research, market analysis, and policy deep-dives.",
                    cost: "$20/mo + $0.015/1k", // Note: Claude Opus pricing might vary. This is illustrative.
                    context: "Unlimited searches + 200k"
                },
                secondary: {
                    model: "GPT-4o with Web Browse",
                    rationale: "Faster for quick fact-checking and current events. Good for initial scoping before deep analysis.",
                    cost: "$0.005/1k input, $0.015/1k output",
                    context: "128k tokens"
                },
                prompt: `[Research Framework]\nTopic: {YOUR_TOPIC}\nDepth: Comprehensive with primary sources\nPerspective: Skeptical, evidence-based\n\nPhase 1 - Landscape Mapping:\n- Current state analysis with quantified metrics\n- Key stakeholders and their incentives\n- Historical context (last 5-10 years of evolution)\n- Competing narratives and their proponents\n\nPhase 2 - Critical Analysis:\n- Methodological weaknesses in existing research\n- Conflicts of interest in source materials\n- Understudied angles and research gaps\n- Cross-industry pattern matching\n\nPhase 3 - Strategic Synthesis:\n- Probabilistic scenario modeling (base/bear/bull cases)\n- Second-order effects and unintended consequences\n- Implementation roadmap with dependency mapping\n- Risk mitigation strategies\n\nOutput format: Executive briefing with actionable insights`,
                workflow: ["Perplexity Pro (gather sources)", "→", "Claude Opus (synthesize)", "→", "Notion Database", "→", "GPT-4o (visualizations)"],
                tools: ["Perplexity", "Claude API", "Notion", "Zapier"]
            },
            "creative-writing": { // MODIFIED SECTION
                title: "Creative Writing Suite",
                contexts: ["Personal", "Creative", "Professional"],
                primary: {
                    model: "Claude Sonnet 4",
                    rationale: "Excellent for narrative coherence, character development, and maintaining voice consistency, making it ideal for fiction, screenwriting, and in-depth storytelling. Its nuanced language generation also suits poetry, personal journaling, and crafting thoughtful letters or speeches.",
                    cost: "$0.003/1k input, $0.015/1k output", // Example Claude 3 Sonnet pricing
                    context: "200k tokens"
                },
                secondary: {
                    model: "GPT-4o + DALL-E 3",
                    rationale: "Highly versatile for a range of creative tasks. Great for brainstorming and drafting blog posts, emails, or quick stories. DALL-E 3 integration supports multimodal storytelling, generating scene visuals alongside prose, and is useful for experimental formats or content requiring illustration ideas.",
                    cost: "$0.005/1k input, $0.015/1k output",
                    context: "128k tokens"
                },
                prompt: `[Creative Writing Task]\nSpecific Form: {e.g., Short Story, Poem, Blog Post, Screenplay Scene, Journal Entry, Persuasive Email, Speech Segment}\nAudience: {e.g., General Public, Self, Specific Colleague, Target Demographic for Blog}\nPrimary Goal: {e.g., Evoke emotion, Tell a compelling story, Inform and engage, Persuade, Reflect}\nDesired Tone/Style: {e.g., Whimsical, Formal, Urgent, Reflective, Humorous, Sorkin-esque dialogue}\nKey Elements/Themes to Include: {e.g., A mysterious artifact, a lesson learned, call to action for an email, specific poetic devices}\nWord Count/Length (approximate): {e.g., 500 words, 3 paragraphs, one page}\n\n[Core Content Generation - adapt as needed]\nIf Fictional/Narrative:\n- Core Conflict/Plot Idea: \n- Main Characters (brief description/motivation): \n- Setting/Atmosphere: \n\nIf Non-Fictional (Blog, Speech, Email):\n- Main Points/Arguments: \n- Supporting Details/Evidence (if any): \n- Desired Call to Action (if any): \n\nIf Poetic:\n- Subject/Inspiration: \n- Preferred Structure/Rhyme Scheme (if any): \n\nGeneral Guidance:\n- Maintain clarity and engagement appropriate for the specified form and audience.\n- Employ vivid language and sensory details where suitable.\n- For longer forms, ensure a logical flow or narrative arc.`,
                workflow: ["GPT-4o (initial ideas/draft)", "→", "Claude Sonnet (refinement/depth)", "→", "Review & Edit (e.g., Sudowrite, ProWritingAid)", "→", "Final Output (Google Docs, Scrivener, etc.)"],
                tools: ["GPT-4", "Claude", "Sudowrite", "ProWritingAid", "Scrivener", "Google Workspace"]
            },
            "google-automation": {
                title: "Google Workspace Automation",
                contexts: ["Professional", "Nonprofit", "Technical"],
                primary: {
                    model: "Gemini 1.5 Pro",
                    rationale: "Native Google API integration, superior Apps Script knowledge, and direct workspace access.",
                    cost: "$0.002/1k input, $0.006/1k output", // Updated Gemini pricing
                    context: "1M tokens (2M via API)"
                },
                secondary: {
                    model: "GPT-4o",
                    rationale: "Best for complex ES6+ patterns and quota-safe batching. Excellent error handling and modern JavaScript idioms.",
                    cost: "$0.005/1k input, $0.015/1k output",
                    context: "128k tokens"
                },
                tertiary: {
                    model: "Claude Opus 4", // Or latest Claude 3 Opus
                    rationale: "Use for large multi-file projects with complex state management. Best documentation generation.",
                    cost: "$0.015/1k input, $0.075/1k output", // Example Claude 3 Opus pricing
                    context: "200k tokens"
                },
                prompt: `[Google Apps Script Automation]\nObjective: {AUTOMATION_GOAL}\nScope: {Single function | Multi-file project}\nIntegration: {Sheets | Docs | Gmail | Calendar | Drive}\n\nRequirements:\n1. Modern ES6+ JavaScript with JSDoc annotations\n2. Comprehensive error handling with user notifications\n3. Batch operations for quota management\n4. Timezone-aware date handling (America/Los_Angeles)\n5. Audit trail via console.log for debugging\n\nCode Structure:\n- Configuration object at top for easy customization\n- Pure functions where possible\n- Cache service for expensive operations\n- Trigger-safe implementation (6-min execution limit)\n\nInclude:\n- Setup instructions for non-technical users\n- Common modification scenarios\n- Performance optimization tips\n- Integration with Zapier webhooks where applicable`,
                workflow: ["Gemini 1.5 (script generation)", "→", "Apps Script Editor", "→", "Test deployment", "→", "Zapier integration"],
                tools: ["Gemini", "Google Apps Script", "Zapier", "GitHub"]
            },
            "financial-modeling": {
                title: "Real Estate Financial Modeling",
                contexts: ["Real Estate", "Professional", "Investment", "Business"],
                primary: {
                    model: "GPT-4o + Code Interpreter",
                    rationale: "Live Monte Carlo simulations, instant chart generation, and real-time scenario testing. Most multifamily models fit within 128k tokens easily.",
                    cost: "$0.005/1k input, $0.015/1k output (plus execution)", // Code Interpreter might have separate costs
                    context: "128k tokens + execution"
                },
                secondary: {
                    model: "Claude Opus 4", // Or latest Claude 3 Opus
                    rationale: "Use for complex multi-asset portfolios exceeding 128k tokens. Superior at maintaining state across massive models and explaining intricate waterfalls.",
                    cost: "$0.015/1k input, $0.075/1k output",
                    context: "200k tokens"
                },
                prompt: `[Institutional-Grade RE Model]\nProperty Type: {PROPERTY_TYPE}\nInvestment Strategy: {Core | Core+ | Value-Add | Opportunistic}\nHold Period: {X} years with {Y} year extension options\n\nModel Architecture:\n1. Revenue Build-up\n   - Rent roll with unit-level detail\n   - Market rent growth: MSA-specific forecasts\n   - Vacancy: Physical + economic with lease-up curves\n   - Other income streams with % of EGI\n2. Operating Expenses\n   - Line-item detail with CPI escalations\n   - Management fee structure (% of EGI)\n   - Replacement reserves ($X/unit/year)\n   - Real estate taxes with reassessment logic\n3. Capital Structure\n   - Senior debt: LTV, rate, amortization, IO period\n   - Mezzanine layers with payment waterfalls\n   - GP/LP split with promotes at hurdles\n4. Returns Analysis\n   - LP IRR/Multiple at base case\n   - GP IRR with promote participation\n   - Sensitivity tables: ±50bps cap rate, ±10% rents\n   - Monte Carlo simulation across key variables\n\nOutput: Full Excel model with dashboard + investment memo`,
                workflow: ["Claude Opus (model architecture)", "→", "Google Sheets", "→", "GPT-4 Code Interpreter (validation)", "→", "Notion (memo)"],
                tools: ["Claude", "Google Sheets", "Excel", "Argus"]
            },
            "nonprofit-operations": {
                title: "Nonprofit Management Suite",
                contexts: ["Nonprofit", "Strategy", "Communications", "Business"],
                primary: {
                    model: "Claude Opus 4",
                    rationale: "Maintains donor context and grant requirements across long documents. Better at mission-aligned language.",
                    cost: "$0.015/1k input, $0.075/1k output",
                    context: "200k tokens"
                },
                secondary: {
                    model: "GPT-4o",
                    rationale: "Faster for donor personalization at scale. Better emotional resonance in fundraising appeals.",
                    cost: "$0.005/1k input, $0.015/1k output",
                    context: "128k tokens"
                },
                prompt: `[Nonprofit Strategic Framework]\nOrganization: {ORG_NAME}\nMission Focus: {MISSION_AREA}\nDocument Type: {Grant Proposal | Donor Report | Board Deck | Impact Assessment}\n\nStrategic Positioning:\n- Theory of Change with measurable outcomes\n- Competitive landscape analysis\n- Unique value proposition\n- Partnership ecosystem mapping\n\nContent Requirements:\n- Data-driven impact metrics (X beneficiaries, Y% improvement)\n- Compelling beneficiary stories (anonymized)\n- Financial sustainability narrative\n- DEI integration throughout\n- Funder-specific language alignment\n\nTone Calibration:\n- Professional yet passionate\n- Evidence-based but human-centered\n- Ambitious but achievable\n- Transparent about challenges\n\nInclude:\n- Executive summary (1-page max)\n- Logic model visualization\n- Budget narrative connecting dollars to outcomes\n- Risk mitigation strategies`,
                workflow: ["Grant research (Perplexity)", "→", "Claude Opus (draft)", "→", "Team review (Google Docs)", "→", "Final polish (GPT-4o)"],
                tools: ["Claude", "Google Workspace", "Asana", "DonorSearch"]
            },
            "project-management": {
                title: "Strategic Project Management",
                contexts: ["Professional", "Cross-functional", "Technical", "Business"],
                primary: {
                    model: "GPT-4o",
                    rationale: "Excellent at generating comprehensive project artifacts quickly. Great API for automation.",
                    cost: "$0.005/1k input, $0.015/1k output",
                    context: "128k tokens"
                },
                secondary: {
                    model: "Claude Sonnet 4",
                    rationale: "Better stakeholder communication and risk narrative development. More nuanced dependency analysis.",
                    cost: "$0.003/1k input, $0.015/1k output",
                    context: "200k tokens"
                },
                prompt: `[Strategic PM Framework]\nProject: {PROJECT_NAME}\nMethodology: {Agile-Waterfall Hybrid}\nStakeholders: {Technical | Executive | Cross-functional}\n\nDeliverables Package:\n1. One-Page Strategic Brief\n   - Problem/solution fit\n   - Success metrics (leading + lagging)\n   - Resource requirements\n   - Go/no-go decision criteria\n2. Execution Roadmap\n   - Phased approach with MVPs\n   - Dependency mapping (technical + organizational)\n   - Resource leveling across initiatives\n   - Buffer management strategy\n3. Risk Register\n   - Pre-mortem analysis\n   - Quantified impact (time/cost/scope)\n   - Mitigation vs acceptance strategies\n   - Trigger identification\n4. Communication Plan\n   - RACI with escalation paths\n   - Stakeholder-specific views\n   - Automated status updates via Zapier\n   - Retrospective cadence\n\nOutput format: Notion database with linked artifacts`,
                workflow: ["GPT-4o (artifact generation)", "→", "Notion PM workspace", "→", "Zapier automations", "→", "Slack updates"],
                tools: ["GPT-4", "Notion", "Zapier", "Asana", "Slack"]
            },
            "video-creative": {
                title: "Video & Visual Storytelling",
                contexts: ["Creative", "Professional", "Marketing"],
                primary: {
                    model: "Gemini 1.5 Pro", // Or latest Gemini with strong video capabilities
                    rationale: "Unmatched multimodal understanding. Can analyze existing footage and suggest edits. Native YouTube integration.",
                    cost: "$0.002/1k input, $0.006/1k output",
                    context: "1M-2M tokens"
                },
                secondary: {
                    model: "GPT-4o with Vision",
                    rationale: "Better for storyboarding and shot list generation. Superior DALL-E 3 integration for concept art.",
                    cost: "$0.005/1k input, $0.015/1k output",
                    context: "128k tokens"
                },
                prompt: `[Cinematic Video Framework]\nProject Type: {Documentary | Narrative | Commercial | Social}\nDuration: {X} minutes\nPlatform: {YouTube | Instagram | Film Festival}\n\nPre-Production Package:\n1. Treatment (1-page)\n   - Logline + elevator pitch\n   - Visual style references (film/photographer)\n   - Emotional arc mapping\n   - Key moments/scenes\n2. Shot List\n   - Coverage strategy per scene\n   - Camera movement motivation\n   - Lens choices for emotional impact\n   - B-roll requirements\n3. Post-Production Plan\n   - Editing rhythm/pacing notes\n   - Color grade reference (LUT suggestions)\n   - Sound design moments\n   - Music/scoring direction\n\nTechnical Specs:\n- Camera/lens package justification\n- Lighting diagrams for key scenes\n- Location scouting priorities\n- Crew size/role requirements\n\nInclude: Moodboard + reference reel links`,
                workflow: ["Gemini 1.5 (footage analysis)", "→", "GPT-4o (shot lists)", "→", "Adobe Premiere (edit)", "→", "Frame.io (review)"],
                tools: ["Gemini", "Adobe CC", "Frame.io", "Milanote"]
            },
            "api-orchestration": {
                title: "API & Automation Orchestration",
                contexts: ["Technical", "Business", "Scalability"],
                primary: {
                    model: "GPT-4o",
                    rationale: "Best knowledge of modern APIs and webhook patterns. Excellent at generating Zapier/Make.com flows.",
                    cost: "$0.005/1k input, $0.015/1k output",
                    context: "128k tokens"
                },
                secondary: {
                    model: "Claude Opus 4",
                    rationale: "Superior for complex state management and error handling. Better documentation generation.",
                    cost: "$0.015/1k input, $0.075/1k output",
                    context: "200k tokens"
                },
                prompt: `[API Orchestration Architecture]\nUse Case: {INTEGRATION_GOAL}\nAPIs: {List all services: Notion, Anthropic, OpenAI, Google, etc.}\nTrigger: {Webhook | Schedule | Event-based}\n\nSystem Design:\n1. Architecture Pattern\n   - Event-driven with queuing\n   - Error handling: Exponential backoff + DLQ\n   - Idempotency keys for safe retries\n   - Rate limiting respect (per-API basis)\n2. Data Flow\n   - Input validation schemas\n   - Transformation logic\n   - State management approach\n   - Output formatting\n3. Monitoring/Observability\n   - Health check endpoints\n   - Latency tracking per step\n   - Cost tracking per API call\n   - Alert thresholds\n\nImplementation Options:\n- Zapier: Visual flow with code steps\n- Make.com: Advanced branching logic\n- Custom: Node.js/Python with PM2\n- Hybrid: Zapier + custom webhooks\n\nInclude: Cost optimization strategies`,
                workflow: ["System design (GPT-4o)", "→", "Zapier prototype", "→", "Custom code (Claude)", "→", "Production deployment"],
                tools: ["Zapier", "Make.com", "Pipedream", "GitHub Actions"]
            },
            "code-review": {
                title: "Code Review & Debugging",
                contexts: ["Technical", "Professional", "Quality Assurance"],
                primary: {
                    model: "Claude Opus 4",
                    rationale: "200k context handles large diffs and entire codebases. Superior step-by-step debugging reasoning and security vulnerability detection.",
                    cost: "$0.015/1k input, $0.075/1k output",
                    context: "200k tokens"
                },
                secondary: {
                    model: "GPT-4o + Code Interpreter",
                    rationale: "Can execute failing test cases and validate fixes in real-time. Better for iterative debugging with live validation.",
                    cost: "$0.005/1k input, $0.015/1k output (plus execution)",
                    context: "128k tokens + execution"
                },
                prompt: `[Code Review & Debug Protocol]\nRepository: {REPO_NAME}\nLanguage: {PRIMARY_LANGUAGE}\nFocus Areas: {Security | Performance | Maintainability | All}\n\nReview Framework:\n1. Static Analysis\n   - Code smell detection (DRY, SOLID violations)\n   - Complexity metrics (cyclomatic, cognitive)\n   - Security vulnerabilities (OWASP Top 10)\n   - Performance bottlenecks\n2. Architecture Review\n   - Design pattern appropriateness\n   - Dependency management\n   - API contract stability\n   - Test coverage analysis\n3. Bug Investigation\n   - Reproduce steps validation\n   - Root cause analysis\n   - Fix verification\n   - Regression test creation\n\nOutput Format:\n- Critical issues (must fix)\n- Recommendations (should fix)\n- Suggestions (nice to have)\n- Refactoring opportunities\n\nInclude: Code snippets with before/after examples`,
                workflow: ["GitHub PR webhook", "→", "Claude Opus (review)", "→", "GPT-4o (test execution)", "→", "GitHub comments"],
                tools: ["GitHub", "GitLab", "Cursor", "VS Code"]
            },
            "data-analysis": {
                title: "Data Analysis & Visualization",
                contexts: ["Analytics", "Business Intelligence", "Research", "Business"],
                primary: {
                    model: "GPT-4o + Code Interpreter",
                    rationale: "Unmatched for inline Python execution, pandas operations, and matplotlib/seaborn visualizations. Handles CSV/Excel natively.",
                    cost: "$0.005/1k input, $0.015/1k output (plus execution)",
                    context: "128k tokens + execution"
                },
                secondary: {
                    model: "Claude Opus 4",
                    rationale: "Better for explaining statistical methodologies and creating comprehensive analysis narratives. Use when interpretation matters more than computation.",
                    cost: "$0.015/1k input, $0.075/1k output",
                    context: "200k tokens"
                },
                prompt: `[Data Analysis Framework]\nDataset: {DATASET_NAME}\nAnalysis Type: {Exploratory | Hypothesis Testing | Predictive | Descriptive}\nBusiness Question: {SPECIFIC_QUESTION}\n\nAnalysis Pipeline:\n1. Data Profiling\n   - Shape, dtypes, missing values\n   - Distribution analysis\n   - Outlier detection\n   - Correlation matrix\n2. Statistical Analysis\n   - Descriptive statistics\n   - Hypothesis tests with p-values\n   - Effect size calculations\n   - Confidence intervals\n3. Visualization Suite\n   - Distribution plots\n   - Time series (if applicable)\n   - Correlation heatmaps\n   - Business-friendly charts\n4. Insights & Recommendations\n   - Key findings (top 3-5)\n   - Statistical significance\n   - Business implications\n   - Next steps\n\nOutput: Jupyter-style report with inline visualizations`,
                workflow: ["Upload data", "→", "GPT-4o Code Interpreter", "→", "Export visualizations", "→", "Notion/Google Sheets"],
                tools: ["GPT-4", "Google Colab", "Tableau", "Google Sheets"]
            },
            "email-automation": {
                title: "Email Automation & Parsing",
                contexts: ["Communications", "CRM", "Marketing", "Business"],
                primary: {
                    model: "GPT-4o",
                    rationale: "Superior function calling for Gmail API integration. Excellent at parsing varied email formats and generating contextual responses.",
                    cost: "$0.005/1k input, $0.015/1k output",
                    context: "128k tokens"
                },
                secondary: {
                    model: "Claude Sonnet 4",
                    rationale: "More nuanced tone matching and better at maintaining conversation context across long threads. Use for sensitive stakeholder communications.",
                    cost: "$0.003/1k input, $0.015/1k output",
                    context: "200k tokens"
                },
                prompt: `[Email Automation Framework]\nUse Case: {Outreach | Follow-up | Parsing | Classification}\nVolume: {X} emails/day\nPersonalization Level: {High | Medium | Template-based}\n\nAutomation Rules:\n1. Parsing Logic\n   - Extract: {Name, Company, Intent, Urgency}\n   - Classify: {Sales, Support, Partnership, Other}\n   - Sentiment analysis\n   - Action triggers\n2. Response Generation\n   - Tone matching (formal/casual detection)\n   - Context preservation\n   - Personalization variables\n   - CTA optimization\n3. Workflow Integration\n   - CRM updates (HubSpot/Salesforce)\n   - Task creation (Asana/Notion)\n   - Calendar scheduling\n   - Follow-up sequences\n\nSafety Checks:\n- Never auto-send without review flag\n- Sensitive topic detection\n- Duplicate prevention\n- Unsubscribe handling`,
                workflow: ["Gmail trigger", "→", "Zapier parse", "→", "GPT-4o process", "→", "CRM update + draft"],
                tools: ["Gmail", "Zapier", "HubSpot", "Mailchimp"]
            },
            "knowledge-synthesis": {
                title: "Knowledge Base Synthesis",
                contexts: ["Research", "Documentation", "Learning", "Professional"],
                primary: {
                    model: "NotebookLM",
                    rationale: "Purpose-built for document synthesis with native citation support. Handles 50+ sources with automatic cross-referencing.",
                    cost: "Free (Google)",
                    context: "500k tokens/source"
                },
                secondary: {
                    model: "Claude Opus 4",
                    rationale: "Use for synthesizing 500+ documents or when you need API access for automation. Superior at finding contradictions across sources.",
                    cost: "$0.015/1k input, $0.075/1k output",
                    context: "200k tokens"
                },
                prompt: `[Knowledge Synthesis Protocol]\nSource Materials: {X documents, Y videos, Z web pages}\nSynthesis Goal: {Comprehensive review | Specific question | Trend analysis}\nOutput Format: {Executive brief | Academic paper | Wiki}\n\nSynthesis Framework:\n1. Source Mapping\n   - Credibility assessment\n   - Recency weighting\n   - Bias identification\n   - Coverage gaps\n2. Thematic Analysis\n   - Core themes extraction\n   - Cross-source validation\n   - Contradiction flagging\n   - Evolution tracking\n3. Insight Generation\n   - Novel connections\n   - Trend identification\n   - Future implications\n   - Research gaps\n4. Knowledge Graph\n   - Entity relationships\n   - Concept hierarchy\n   - Citation network\n   - Confidence levels\n\nDeliverable: Hyperlinked knowledge base with source attribution`,
                workflow: ["Upload sources", "→", "NotebookLM processing", "→", "Review + Q&A", "→", "Export to Notion"],
                tools: ["NotebookLM", "Obsidian", "Roam Research", "Notion"]
            },
            "travel-planning": {
                title: "Travel Planning & Itineraries",
                contexts: ["Personal", "Business Travel", "Event Planning"],
                primary: {
                    model: "Gemini 1.5 Pro", // Or latest Gemini with strong travel integration
                    rationale: "Native Google Maps/Flights/Hotels integration. Real-time availability checking and route optimization. Multimodal for destination visuals.",
                    cost: "$0.002/1k input, $0.006/1k output",
                    context: "1M tokens"
                },
                secondary: {
                    model: "GPT-4o",
                    rationale: "Better for complex multi-city itineraries and constraint juggling. Superior at finding unique experiences and local recommendations.",
                    cost: "$0.005/1k input, $0.015/1k output",
                    context: "128k tokens"
                },
                prompt: `[Travel Planning Framework]\nDestination(s): {LOCATION(S)}\nDuration: {X} days\nTravel Style: {Luxury | Budget | Adventure | Business}\nInterests: {Culture | Food | Nature | Architecture}\n\nItinerary Components:\n1. Logistics Optimization\n   - Flight routing (cost vs. time)\n   - Accommodation strategy\n   - Local transportation\n   - Visa/document requirements\n2. Daily Planning\n   - Morning/afternoon/evening structure\n   - Travel time buffers\n   - Restaurant reservations\n   - Attraction tickets\n3. Local Intelligence\n   - Hidden gems beyond tourist spots\n   - Seasonal considerations\n   - Cultural events calendar\n   - Safety advisories\n4. Contingency Planning\n   - Weather alternatives\n   - Backup restaurants\n   - Emergency contacts\n   - Flexible day options\n\nOutput: Mobile-friendly itinerary with offline maps`,
                workflow: ["Requirements input", "→", "Gemini (routes + availability)", "→", "GPT-4o (experiences)", "→", "Google Trips export"],
                tools: ["Google Travel", "Airbnb", "Wanderlog", "TripIt"]
            },
            // New Task Categories
            "nutrition-health": {
                title: "Nutrition & Health Guidance",
                contexts: ["Personal", "Health", "Wellness"],
                categoryType: "Health", // For warning banner
                primary: {
                    model: "GPT-4o",
                    rationale: "Best balance of current medical knowledge and ability to parse research. Excellent at personalized recommendations.",
                    cost: "$0.005/1k input, $0.015/1k output",
                    context: "128k tokens"
                },
                secondary: {
                    model: "Claude Sonnet 4",
                    rationale: "More cautious with health claims. Better at explaining complex biological mechanisms and interactions.",
                    cost: "$0.003/1k input, $0.015/1k output",
                    context: "200k tokens"
                },
                prompt: `[Health & Nutrition Framework]\nTopic: {Specific health goal/concern}\nContext: {Age, activity level, restrictions}\nApproach: Evidence-based, personalized\n\nInformation Structure:\n1. Current Scientific Understanding\n   - Peer-reviewed research summary\n   - Mechanism of action\n   - Evidence quality assessment\n\n2. Practical Implementation\n   - Daily/weekly protocols\n   - Measurement tracking\n   - Progress indicators\n\n3. Safety Considerations\n   - Contraindications\n   - Interaction warnings\n   - When to seek professional help\n\nAlways include: "Consult healthcare provider before making significant changes"`,
                workflow: ["Research request", "→", "GPT-4o (initial research)", "→", "Verify key claims", "→", "Personalized plan"],
                tools: ["PubMed", "Examine.com", "Cronometer", "MyFitnessPal"]
            },
            "cooking-recipes": {
                title: "Cooking & Recipe Development",
                contexts: ["Personal", "Creative", "Lifestyle"],
                // No categoryType for warning needed
                primary: {
                    model: "GPT-4o",
                    rationale: "Excellent at recipe scaling, substitutions, and technique explanations. Great food science knowledge.",
                    cost: "$0.005/1k input, $0.015/1k output",
                    context: "128k tokens"
                },
                secondary: {
                    model: "Claude Sonnet 4",
                    rationale: "Better at creative fusion and explaining cultural context. More detailed technique descriptions.",
                    cost: "$0.003/1k input, $0.015/1k output",
                    context: "200k tokens"
                },
                prompt: `[Recipe Development Framework]\nDish/Cuisine: {Type or specific dish}\nDietary Needs: {Restrictions/preferences}\nSkill Level: {Beginner/Intermediate/Advanced}\n\nRecipe Components:\n1. Ingredients\n   - Exact measurements (with metric)\n   - Substitution options\n   - Shopping tips\n\n2. Technique Breakdown\n   - Step-by-step with timing\n   - Visual/sensory cues\n   - Common mistakes to avoid\n\n3. Variations\n   - Dietary adaptations\n   - Seasonal swaps\n   - Scaling math\n\nInclude: Nutritional info, storage tips, wine pairings`,
                workflow: ["Recipe request", "→", "GPT-4o (base recipe)", "→", "Test & refine", "→", "Format & photo tips"],
                tools: ["Paprika", "Yummly", "ChefSteps", "Serious Eats"]
            },
            "legal-review": {
                title: "Legal Document Review",
                contexts: ["Professional", "Business", "Personal", "Legal"], // Added Legal context for filter
                categoryType: "Legal", // For warning banner
                primary: {
                    model: "Claude Opus 4",
                    rationale: "Superior at maintaining context across long documents. Better at identifying potential issues and ambiguities.",
                    cost: "$0.015/1k input, $0.075/1k output",
                    context: "200k tokens"
                },
                secondary: {
                    model: "GPT-4o",
                    rationale: "Faster for quick contract summaries. Good at plain-English explanations of legal concepts.",
                    cost: "$0.005/1k input, $0.015/1k output",
                    context: "128k tokens"
                },
                prompt: `[Legal Document Analysis]\nDocument Type: {Contract/Agreement/Policy}\nYour Role: {Buyer/Seller/Employee/etc}\nKey Concerns: {List specific areas}\n\nAnalysis Framework:\n1. Executive Summary\n   - Key terms & obligations\n   - Important dates/deadlines\n   - Financial implications\n\n2. Risk Assessment\n   - Unfavorable clauses\n   - Missing protections\n   - Ambiguous language\n\n3. Recommendations\n   - Negotiation points\n   - Additional clauses needed\n   - Red flags requiring attorney\n\nNote: "This is not legal advice. Consult an attorney."`,
                workflow: ["Upload document", "→", "Claude Opus (analysis)", "→", "Highlight concerns", "→", "Attorney consultation"],
                tools: ["DocuSign", "Adobe Acrobat", "Notion", "Google Docs"]
            }
        };

        let selectedTask = null;
        let activeContext = localStorage.getItem('selectedContext') || 'all';
        const favorites = JSON.parse(localStorage.getItem('favorites') || '[]');

        // Define the order of categories for consistent display
        const categoryDisplayOrder = [
            'deep-research', 'creative-writing', 'google-automation', 'financial-modeling',
            'nonprofit-operations', 'project-management', 'video-creative', 'api-orchestration',
            'code-review', 'data-analysis', 'email-automation', 'knowledge-synthesis',
            'travel-planning', 'nutrition-health', 'cooking-recipes', 'legal-review'
        ];

        function renderCategories() {
            const categoriesEl = document.getElementById('categories');
            categoriesEl.innerHTML = ''; // Clear existing categories

            // Create a "Favorites" section
            const favoriteTaskIds = categoryDisplayOrder.filter(id => taskData[id] && favorites.includes(id));
            if (favoriteTaskIds.length > 0) {
                const favTitle = document.createElement('h4');
                favTitle.className = 'category-subtitle';
                favTitle.textContent = 'Favorites';
                categoriesEl.appendChild(favTitle);
                favoriteTaskIds.forEach(taskId => {
                    const task = taskData[taskId];
                    const div = document.createElement('div');
                    div.className = 'category-item favorite-category-item'; // Special class for styling if needed
                    div.dataset.taskId = taskId;
                    div.innerHTML = `${task.title} <span class="fav-star">⭐</span>`; // Solid star for favorites
                    div.onclick = () => selectTask(taskId);
                    categoriesEl.appendChild(div);
                });
                const hr = document.createElement('hr');
                hr.style.margin = '10px 0';
                hr.style.borderColor = 'rgba(255,255,255,0.05)';
                categoriesEl.appendChild(hr);
            }

            // "All Categories" or main list
            const allTitle = document.createElement('h4');
            allTitle.className = 'category-subtitle';
            allTitle.textContent = 'All Categories';
            categoriesEl.appendChild(allTitle);

            categoryDisplayOrder.forEach(taskId => {
                if (taskData[taskId]) {
                    const task = taskData[taskId];
                    const div = document.createElement('div');
                    div.className = 'category-item';
                    div.dataset.taskId = taskId; // For linking and filtering
                    const isFavorite = favorites.includes(taskId);
                    // The star in the main list should also toggle
                    div.innerHTML = `${task.title} <span class="fav-star-indicator">${isFavorite ? '⭐' : '☆'}</span>`;
                    div.onclick = () => selectTask(taskId);
                    categoriesEl.appendChild(div);
                }
            });
            // After creating items, re-apply active state and filters
            updateActiveCategoryVisuals();
            filterAndSearchCategories();
        }
        
        function updateActiveCategoryVisuals() {
            document.querySelectorAll('.category-item').forEach(el => {
                if (el.dataset.taskId === selectedTask) {
                    el.classList.add('active');
                } else {
                    el.classList.remove('active');
                }
            });
        }


        function filterAndSearchCategories() {
            const searchTerm = document.getElementById('categorySearch').value.toLowerCase();
            document.querySelectorAll('.category-item').forEach(item => {
                const taskId = item.dataset.taskId;
                const task = taskData[taskId];
                if (!task) return; // Should not happen if IDs are correct

                const categoryName = task.title.toLowerCase();
                
                const contextMatch = activeContext === 'all' || task.contexts.includes(activeContext) || (task.categoryType && task.contexts.includes(task.categoryType)) || (activeContext === 'Legal' && task.categoryType === 'Legal');


                const searchMatch = categoryName.includes(searchTerm);

                if (contextMatch && searchMatch) {
                    item.style.display = 'block';
                } else {
                    item.style.display = 'none';
                }
            });
        }

        function initContextFilter() {
            document.querySelectorAll('.context-pill').forEach(pill => {
                pill.addEventListener('click', (e) => {
                    const context = e.target.dataset.context;
                    setActiveContext(context);
                });
                // Set initial active pill
                if (pill.dataset.context === activeContext) {
                    pill.classList.add('active');
                    pill.setAttribute('aria-checked', 'true');
                } else {
                    pill.setAttribute('aria-checked', 'false');
                }
            });
        }

        function setActiveContext(context) {
            activeContext = context;
            localStorage.setItem('selectedContext', context);

            document.querySelectorAll('.context-pill').forEach(pill => {
                if (pill.dataset.context === context) {
                    pill.classList.add('active');
                    pill.setAttribute('aria-checked', 'true');
                } else {
                    pill.classList.remove('active');
                    pill.setAttribute('aria-checked', 'false');
                }
            });
            filterAndSearchCategories(); // Re-filter categories
        }

        function initSearch() {
            const searchInput = document.getElementById('categorySearch');
            searchInput.addEventListener('input', () => {
                filterAndSearchCategories();
            });
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    e.target.value = '';
                    filterAndSearchCategories(); // Re-filter with empty search
                }
            });
        }
        
        function toggleFavorite(taskId) {
            const index = favorites.indexOf(taskId);
            if (index > -1) {
                favorites.splice(index, 1);
            } else {
                favorites.push(taskId);
            }
            localStorage.setItem('favorites', JSON.stringify(favorites));
            updateFavoritesUI(); // Update UI elements reflecting favorite state
        }

        function updateFavoritesUI() {
            // Update the favorite button in the currently displayed task detail (if any)
            const detailFavoriteButton = document.querySelector(`.main-content .favorite-btn[data-task-id="${selectedTask}"]`);
            if (detailFavoriteButton) {
                detailFavoriteButton.innerHTML = favorites.includes(selectedTask) ? '⭐' : '☆';
            }
            // Re-render categories to update stars in the sidebar and the favorites section
            renderCategories(); 
            // renderCategories itself calls filterAndSearchCategories and updateActiveCategoryVisuals
        }


        function selectTask(taskId) {
            selectedTask = taskId;
            updateActiveCategoryVisuals(); // Update active highlight in sidebar
            renderTaskDetails(taskData[taskId]);
        }

        function renderTaskDetails(task) {
            const mainContent = document.getElementById('mainContent');
            if (!task) {
                mainContent.innerHTML = `<div class="welcome-message">Error: Task data not found.</div>`;
                return;
            }
            
            const roiData = {
                'deep-research': { budget: '$50-150', timeSaved: '20-25 hrs/mo', roi: '10-15x' },
                'creative-writing': { budget: '$30-80', timeSaved: '15-20 hrs/mo', roi: '8-12x' },
                'google-automation': { budget: '$20-50', timeSaved: '25-30 hrs/mo', roi: '15-20x' },
                'financial-modeling': { budget: '$50-100', timeSaved: '20-25 hrs/mo', roi: '12-18x' },
                'nonprofit-operations': { budget: '$40-100', timeSaved: '15-20 hrs/mo', roi: '8-12x' },
                'project-management': { budget: '$40-80', timeSaved: '10-15 hrs/mo', roi: '6-10x' },
                'video-creative': { budget: '$30-60', timeSaved: '10-15 hrs/mo', roi: '5-8x' },
                'api-orchestration': { budget: '$50-200', timeSaved: '30-40 hrs/mo', roi: '20-30x' },
                'code-review': { budget: '$50-150', timeSaved: '15-20 hrs/mo', roi: '10-15x' },
                'data-analysis': { budget: '$30-50', timeSaved: '20-30 hrs/mo', roi: '15-25x' },
                'email-automation': { budget: '$20-40', timeSaved: '10-15 hrs/mo', roi: '10-15x' },
                'knowledge-synthesis': { budget: '$0-50', timeSaved: '25-35 hrs/mo', roi: '20-30x' },
                'travel-planning': { budget: '$10-30', timeSaved: '5-10 hrs/trip', roi: '5-10x' },
                'nutrition-health': { budget: '$20-60', timeSaved: '5-10 hrs/mo', roi: 'Variable' },
                'cooking-recipes': { budget: '$10-40', timeSaved: '3-5 hrs/wk', roi: 'Enjoyment++' },
                'legal-review': { budget: '$50-250', timeSaved: '10-20 hrs/doc', roi: 'Risk Mitigation' }
            };
            const roi = roiData[selectedTask] || { budget: '$N/A', timeSaved: 'N/A', roi: 'N/A' };

            let secondaryCardHtml = '';
            if (task.secondary) {
                 secondaryCardHtml += `
                    <div class="model-card">
                        <span class="model-label alt-a">Alternative A</span>
                        <h3 class="model-name">${task.secondary.model}</h3>
                        <p class="model-rationale">${task.secondary.rationale}</p>
                        <div class="model-meta">
                            <span>💰 ${task.secondary.cost}</span>
                            <span>📊 ${task.secondary.context}</span>
                        </div>
                    </div>`;
            }
            if (task.tertiary) {
                 secondaryCardHtml += `
                    <div class="model-card">
                        <span class="model-label alt-b">Alternative B</span>
                        <h3 class="model-name">${task.tertiary.model}</h3>
                        <p class="model-rationale">${task.tertiary.rationale}</p>
                        <div class="model-meta">
                            <span>💰 ${task.tertiary.cost}</span>
                            <span>📊 ${task.tertiary.context}</span>
                        </div>
                    </div>`;
            }


            mainContent.innerHTML = `
                <div class="task-header">
                    <h2 class="task-title">${task.title}</h2>
                    <div class="task-meta">
                         <button class="favorite-btn" aria-label="Toggle Favorite" data-task-id="${selectedTask}" onclick="toggleFavorite('${selectedTask}')" title="Toggle Favorite">
                            ${favorites.includes(selectedTask) ? '⭐' : '☆'}
                        </button>
                        <div class="context-badges">
                            ${task.contexts.map(ctx => `<span class="badge">${ctx}</span>`).join('')}
                        </div>
                    </div>
                </div>

                ${task.categoryType === 'Health' ? `
                <div class="warning-banner medical-warning">
                    ⚠️ General information only. This is not medical advice. Always consult with a licensed healthcare professional for any health concerns or before making any decisions related to your health.
                </div>
                ` : ''}
                ${task.categoryType === 'Legal' ? `
                <div class="warning-banner legal-warning">
                    ⚖️ General information only. This is not legal advice and should not be substituted for advice from a licensed attorney. Consult an attorney for your specific situation.
                </div>
                ` : ''}

                <div class="model-recommendation ${task.tertiary ? 'has-tertiary' : ''}">
                    <div class="model-card primary">
                        <span class="model-label">Primary Choice</span>
                        <h3 class="model-name">${task.primary.model}</h3>
                        <p class="model-rationale">${task.primary.rationale}</p>
                        <div class="model-meta">
                            <span>💰 ${task.primary.cost}</span>
                            <span>📊 ${task.primary.context}</span>
                        </div>
                    </div>
                    ${secondaryCardHtml}
                </div>

                <div class="prompt-section">
                    <details ${task.prompt.split('\n').length <= 20 ? 'open' : ''}>
                        <summary class="prompt-header">
                            <h3 class="prompt-title">Pre-Configured Prompt Template</h3>
                        </summary>
                        <div class="prompt-box" id="promptBox">${task.prompt.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
                        <button class="copy-button" onclick="copyPrompt()">Copy to Clipboard</button>
                    </details>
                </div>

                <div class="workflow-section">
                    <h3 class="workflow-title">Recommended Workflow</h3>
                    <div class="workflow-steps">
                        ${task.workflow.map(step =>
                            step === '→'
                                ? '<span class="workflow-arrow">→</span>'
                                : `<div class="workflow-step">${step}</div>`
                        ).join('')}
                    </div>
                </div>
                <div class="workflow-section">
                    <h3 class="workflow-title">Cost-Benefit Analysis (Illustrative)</h3>
                    <div class="cost-analysis">
                        <div class="cost-item">
                            <div class="cost-label">Est. Monthly Budget</div>
                            <div class="cost-value">${roi.budget}</div>
                        </div>
                        <div class="cost-item">
                            <div class="cost-label">Est. Time Saved</div>
                            <div class="cost-value">${roi.timeSaved}</div>
                        </div>
                        <div class="cost-item">
                            <div class="cost-label">Potential ROI</div>
                            <div class="cost-value">${roi.roi}</div>
                        </div>
                    </div>
                </div>
                <div class="workflow-section">
                    <h3 class="workflow-title">Key Tool Integrations</h3>
                    <div class="integration-tools">
                        ${task.tools.map(tool => `<span class="tool-tag">${tool}</span>`).join('')}
                    </div>
                </div>
            `;
        }

        function copyPrompt() {
            const promptBox = document.getElementById('promptBox');
            if (!promptBox) return;
            const promptText = promptBox.innerText; // Use innerText to get rendered text

            const textArea = document.createElement('textarea');
            textArea.value = promptText;
            // Prevent scrolling to bottom
            textArea.style.top = "0";
            textArea.style.left = "0";
            textArea.style.position = "fixed";

            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();

            let success = false;
            try {
                success = document.execCommand('copy');
            } catch (err) {
                console.error('Fallback: Oops, unable to copy', err);
            }

            document.body.removeChild(textArea);

            const button = document.querySelector('.copy-button');
            if (button) {
                if (success) {
                    button.textContent = 'Copied!';
                    button.classList.add('copied');
                    setTimeout(() => {
                        button.textContent = 'Copy to Clipboard';
                        button.classList.remove('copied');
                    }, 2000);
                } else {
                    button.textContent = 'Copy Failed';
                     setTimeout(() => {
                        button.textContent = 'Copy to Clipboard';
                    }, 2000);
                }
            }
        }

        // --- Initializations ---
        document.addEventListener('DOMContentLoaded', () => {
            renderCategories(); // Initial render of categories and favorites
            initContextFilter(); // Setup context filter buttons and apply initial filter
            initSearch(); // Setup search functionality
            
            // If there's a selected context from localStorage, filterAndSearchCategories would have been called by setActiveContext via initContextFilter.
            // If it's 'all', filterAndSearchCategories is also called by renderCategories.
            // No need for an extra call here if logic is sound.
            const sidebar = document.querySelector(".category-sidebar");
            const toggleBtn = document.getElementById("sidebarToggle");
            if (toggleBtn) {
                toggleBtn.addEventListener("click", () => {
                    sidebar.classList.toggle("collapsed");
                });
            }
        });

let settings = {};
let stats = { processed: 0, total: 0, matches: 0, skipped: 0 };
let activeTabId = null;
let processedJobsCache = [];

function delay(ms) {
    return new Promise(resolve => {
        if (activeTabId) {
            try {
                chrome.tabs.sendMessage(activeTabId, { action: 'WAIT', ms: ms }, () => {
                    const err = chrome.runtime.lastError;
                    if (err) {
                        // Receiving end does not exist usually means the tab was closed or refreshed mid-wait
                        console.warn("Content script WAIT failed, falling back to setTimeout:", err.message);
                        setTimeout(resolve, ms);
                    } else {
                        resolve();
                    }
                });
            } catch (e) {
                setTimeout(resolve, ms);
            }
        } else {
            setTimeout(resolve, ms);
        }
    });
}

// Load settings initially
chrome.storage.local.get(['apiProvider', 'apiKey', 'anthropicApiKey', 'webhookUrl', 'negativeKeywords', 'profile', 'resume', 'experience', 'sendEmails', 'stats'], (result) => {
    if (result.apiProvider) settings.apiProvider = result.apiProvider;
    if (result.apiKey) settings.apiKey = result.apiKey;
    if (result.anthropicApiKey) settings.anthropicApiKey = result.anthropicApiKey;
    if (result.webhookUrl) settings.webhookUrl = result.webhookUrl;
    if (result.negativeKeywords !== undefined) settings.negativeKeywords = result.negativeKeywords;
    if (result.profile) settings.profile = result.profile;
    if (result.resume) settings.resume = result.resume;
    if (result.experience) settings.experience = result.experience;
    if (result.sendEmails !== undefined) settings.sendEmails = result.sendEmails;
    if (result.stats) stats = result.stats;
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes.apiProvider) settings.apiProvider = changes.apiProvider.newValue;
        if (changes.apiKey) settings.apiKey = changes.apiKey.newValue;
        if (changes.anthropicApiKey) settings.anthropicApiKey = changes.anthropicApiKey.newValue;
        if (changes.webhookUrl) settings.webhookUrl = changes.webhookUrl.newValue;
        if (changes.negativeKeywords) settings.negativeKeywords = changes.negativeKeywords.newValue;
        if (changes.profile) settings.profile = changes.profile.newValue;
        if (changes.resume) settings.resume = changes.resume.newValue;
        if (changes.experience) settings.experience = changes.experience.newValue;
        if (changes.sendEmails) settings.sendEmails = changes.sendEmails.newValue;
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'START_EVALUATION') {
        activeTabId = message.tabId;
        stats = { processed: 0, total: 0, matches: 0, skipped: 0 };
        processedJobsCache = [];

        const beginText = 'Fetching previously saved jobs...';
        chrome.storage.local.set({ lastStatus: { text: beginText, isError: false } });
        chrome.runtime.sendMessage({ action: 'STATUS_MSG', text: beginText });

        fetchProcessedJobs(settings.webhookUrl).then((jobs) => {
            processedJobsCache = jobs;

            // Inject and start content script
            chrome.scripting.executeScript({
                target: { tabId: activeTabId },
                files: ['content.js']
            }, () => {
                // After injection, tell content script to start
                if (chrome.runtime.lastError) {
                    const errText = "Could not inject script: " + chrome.runtime.lastError.message;
                    chrome.storage.local.set({ lastStatus: { text: "Error: " + errText, isError: true } });
                    chrome.runtime.sendMessage({
                        action: 'EVALUATION_ERROR',
                        error: errText
                    });
                    return;
                }
                chrome.tabs.sendMessage(activeTabId, { action: 'START_CARDS_PROCESSING', jobIndex: 0 });
            });
        }).catch(err => {
            const errText = "Failed to fetch previous jobs. " + err.message;
            chrome.storage.local.set({ lastStatus: { text: "Error: " + errText, isError: true } });
            chrome.runtime.sendMessage({ action: 'EVALUATION_ERROR', error: errText });
        });
    } else if (message.action === 'STOP_EVALUATION') {
        if (activeTabId) {
            chrome.tabs.sendMessage(activeTabId, { action: 'STOP_EVALUATION' });
        }
    } else if (message.action === 'EVALUATE_JOB') {
        const { jobData, jobIndex, totalJobs } = message;
        stats.total = totalJobs;

        if (checkDuplicate(jobData)) {
            stats.skipped++;
            finishJobEvaluationStep(jobIndex);
            return;
        }

        // Pre-Filtering: Negative Keywords
        const titleLower = String(jobData.title || "").toLowerCase();
        const negKeywords = (settings.negativeKeywords || "graduate").split(',').map(k => k.trim().toLowerCase()).filter(k => k);
        let preRejectReason = null;
        for (const kw of negKeywords) {
            if (titleLower.includes(kw)) {
                preRejectReason = `Negative Title Keyword: ${kw}`;
                break;
            }
        }

        // Pre-Filtering: Closed Applications
        const descLower = String(jobData.htmlContent || "").toLowerCase();
        if (!preRejectReason && descLower.includes("no longer accepting applications")) {
            preRejectReason = "No longer accepting applications";
        }

        if (preRejectReason) {
            stats.processed++; // Count as processed but rejected instantly

            processedJobsCache.push({
                title: String(jobData.title || "").toLowerCase().trim(),
                company: String(jobData.company || "").toLowerCase().trim(),
                url: String(jobData.url || "").toLowerCase().trim()
            });

            saveJobToWebhook({
                job_title: jobData.title,
                company_name: jobData.company,
                location: "Unknown",
                is_eligible: false,
                fit_score: 0,
                readiness_score: 0,
                strengths_alignment: "N/A",
                critical_gaps: preRejectReason,
                decision: "REJECT"
            }, jobData.url);

            finishJobEvaluationStep(jobIndex);
            return;
        }

        let evaluationPromise;
        if (settings.apiProvider === 'anthropic') {
            evaluationPromise = evaluateJobWithAnthropic(jobData);
        } else {
            evaluationPromise = evaluateJobWithGemini(jobData);
        }

        evaluationPromise.then(decisionResult => {
            stats.processed++;

            // Add to cache so we don't process it again in this run
            processedJobsCache.push({
                title: String(jobData.title || "").toLowerCase().trim(),
                company: String(jobData.company || "").toLowerCase().trim(),
                url: String(jobData.url || "").toLowerCase().trim()
            });

            if (decisionResult && decisionResult.decision === "SAVE") {
                stats.matches++;
            }
            if (decisionResult) { // Post ALL decisions to webhook
                saveJobToWebhook(decisionResult, jobData.url);
            }

            finishJobEvaluationStep(jobIndex);

        }).catch(err => {
            console.error(err);
            chrome.storage.local.set({ lastStatus: { text: "Error: " + err.message, isError: true } });
            chrome.runtime.sendMessage({ action: 'EVALUATION_ERROR', error: err.message });
        });
    } else if (message.action === 'STATUS_MSG' || message.action === 'EVALUATION_COMPLETE') {
        // Intercept messages from content.js and save them to storage for UI recovery
        const text = message.text || (message.action === 'EVALUATION_COMPLETE' ? 'Evaluation complete!' : '');
        chrome.storage.local.set({ lastStatus: { text: text, isError: message.isError || false } });
    }
});

function finishJobEvaluationStep(jobIndex) {
    chrome.storage.local.set({ stats });
    chrome.runtime.sendMessage({ action: 'UPDATE_PROGRESS', stats });
    chrome.tabs.sendMessage(activeTabId, { action: 'START_CARDS_PROCESSING', jobIndex: jobIndex + 1 });
}

async function fetchProcessedJobs(webhookUrl) {
    if (!webhookUrl) return [];
    try {
        const response = await fetch(webhookUrl);
        if (!response.ok) return [];
        const result = await response.json();
        if (result.status === "success" && result.jobs) {
            return result.jobs;
        }
        return [];
    } catch (e) {
        console.error("Failed to fetch processed jobs", e);
        return [];
    }
}

function normalizeText(text) {
    // Remove all non-alphanumeric characters and lowercase it to make matching extremely resilient
    return String(text || "").toLowerCase().replace(/[^a-z0-9]/g, '');
}

function checkDuplicate(jobData) {
    const title = normalizeText(jobData.title);
    const company = normalizeText(jobData.company);

    for (const job of processedJobsCache) {
        if (normalizeText(job.title) === title && normalizeText(job.company) === company) {
            return true;
        }
    }
    return false;
}

async function evaluateJobWithAnthropic(jobData) {
    if (!settings.anthropicApiKey) throw new Error("Anthropic API Key is missing");

    const prompt = getSystemPrompt(jobData);

    const requestBody = {
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        system: prompt,
        messages: [
            { "role": "user", "content": "Please parse this job description against the profile and output the requested JSON object." }
        ],
        temperature: 0.1
    };

    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': settings.anthropicApiKey,
                'anthropic-version': '2023-06-01',
                // This header is required when calling Anthropic API directly from a browser/extension
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();

            if (response.status === 429 || response.status === 529) {
                retries++;
                const reason = response.status === 529 ? "Overloaded" : "Rate limit";
                const rlText = `Anthropic ${reason} hit. Waiting to retry (${retries}/${maxRetries})...`;
                chrome.storage.local.set({ lastStatus: { text: rlText, isError: true } });
                chrome.runtime.sendMessage({ action: 'STATUS_MSG', text: rlText, isError: true });
                await delay(60000); // Increased: Wait 60 seconds on 429/529 for Paid
                continue;
            }
            throw new Error(`Anthropic API Error: ${response.status} ${errorText}`);
        }

        const json = await response.json();
        const textResponse = json.content[0].text;

        try {
            // Claude sometimes wraps its response in ```json ... ``` despite instructions
            let cleanText = textResponse.trim();
            if (cleanText.startsWith('```json')) cleanText = cleanText.substring(7);
            if (cleanText.startsWith('```')) cleanText = cleanText.substring(3);
            if (cleanText.endsWith('```')) cleanText = cleanText.substring(0, cleanText.length - 3);

            return JSON.parse(cleanText.trim());
        } catch (e) {
            throw new Error("Failed to parse JSON from Claude: " + textResponse);
        }
    }
    throw new Error("Max retries reached for Anthropic API due to rate limits.");
}

function getSystemPrompt(jobData) {
    return `
You are a strict technical recruiter evaluating a LinkedIn job description. You will evaluate the job in two phases: Eligibility and Deep Analysis.

Phase 1: Eligibility (Hard Filter)
Use the Candidate's Profile to determine if they are strictly eligible for the role.
Candidate Profile & Demographics:
${settings.profile || "No profile provided."}

Phase 2: Deep Analysis (Soft Filter)
If the candidate is eligible, evaluate their Fit and Readiness.
Target Skills (For calculating Fit Score):
${settings.resume || "No skills provided."}

Experience (For calculating Readiness Score):
${settings.experience || "No experience provided."}

Job Details Extracted:
Title: ${jobData.title}
Company: ${jobData.company}
URL: ${jobData.url}

Raw Job Description HTML (Sanitized):
${jobData.htmlContent}

Task:
Step 1: Determine Eligibility based on strict alignment with the Demographic Profile. 
Step 2: If Ineligible, set scores to 0 and decision to DELETE.
Step 3: If Eligible, calculate the Fit Score (how well the job description aligns with Target Skills) and Readiness Score (how likely the candidate is to get the job based on Experience). Also extract the Location (specific city, or "Remote").
Output ONLY a raw, valid JSON object with the following schema, and absolutely no markdown formatting (do not wrap in \`\`\`json):
{
  "job_title": "string",
  "company_name": "string",
  "location": "string",
  "is_eligible": true or false,
  "fit_score": 85,
  "readiness_score": 70,
  "strengths_alignment": "string describing why the readiness score is what it is based on experience",
  "critical_gaps": "string describing missing experience/skills for readiness",
  "decision": "SAVE" or "DELETE"
}
`;
}

async function evaluateJobWithGemini(jobData) {
    if (!settings.apiKey) throw new Error("API Key is missing");

    const prompt = getSystemPrompt(jobData);

    const requestBody = {
        contents: [{
            parts: [{ text: prompt }]
        }],
        generationConfig: {
            temperature: 0.1, // Be deterministic
            responseMimeType: "application/json"
        }
    };

    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${settings.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            }
        );

        if (!response.ok) {
            const errorText = await response.text();

            // Handle rate limit natively
            if (response.status === 429) {
                retries++;
                console.warn(`Rate limit hit. Retry ${retries}/${maxRetries}`);
                const rlText = `Rate limit hit. Waiting to retry (${retries}/${maxRetries})...`;
                chrome.storage.local.set({ lastStatus: { text: rlText, isError: true } });
                chrome.runtime.sendMessage({ action: 'STATUS_MSG', text: rlText, isError: true });

                let waitTime = 32000; // default 32 seconds

                try {
                    const errJson = JSON.parse(errorText);
                    // Extract retryDelay if available in details array (e.g. "31s")
                    if (errJson.error && errJson.error.details) {
                        for (const detail of errJson.error.details) {
                            if (detail.retryDelay) {
                                const secondsStr = detail.retryDelay.replace('s', '');
                                waitTime = (parseFloat(secondsStr) + 1) * 1000;
                            }
                        }
                    }
                } catch (e) {
                    // Ignore parse error, use default waitTime
                }

                // Minimum wait time of 60s
                waitTime = Math.max(waitTime, 60000);

                await delay(waitTime);
                continue; // Retry the loop
            }

            throw new Error(`Gemini API Error: ${response.status} ${errorText}`);
        }

        const json = await response.json();
        let textResponse = json.candidates[0].content.parts[0].text;

        try {
            const result = JSON.parse(textResponse);
            return result;
        } catch (e) {
            throw new Error("Failed to parse JSON from LLM: " + textResponse);
        }
    }

    throw new Error("Max retries reached for Gemini API due to rate limits.");
}

async function saveJobToWebhook(decisionResult, url) {
    if (!settings.webhookUrl) return;

    // Payload for Google Apps Script
    const payload = {
        job_title: decisionResult.job_title,
        company_name: decisionResult.company_name,
        location: decisionResult.location || "Unknown",
        url: url,
        is_eligible: decisionResult.is_eligible ? "Yes" : "No",
        fit_score: decisionResult.fit_score,
        readiness_score: decisionResult.readiness_score || 0,
        strengths_alignment: decisionResult.strengths_alignment,
        critical_gaps: decisionResult.critical_gaps,
        decision: decisionResult.decision || "REJECT",
        ineligibility_reason: decisionResult.ineligibility_reason || decisionResult.critical_gaps,
        send_email: settings.sendEmails !== undefined ? settings.sendEmails : true
    };

    try {
        const response = await fetch(settings.webhookUrl, {
            method: 'POST',
            // Simple text/plain avoids CORS preflight OPTIONS request
            body: JSON.stringify(payload),
            headers: {
                "Content-Type": "text/plain;charset=utf-8"
            }
        });
        console.log("Webhook response sent.");
    } catch (e) {
        console.error("Failed to call webhook", e);
    }
}
